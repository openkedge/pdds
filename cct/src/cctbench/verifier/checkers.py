"""Evidence-driven conditions; these functions never inspect fixture labels or families."""

from datetime import datetime

from cctbench.canonicalize import (
    compute_core_digest,
    compute_digest,
    compute_proposal_digest,
    compute_state_digest,
)
from cctbench.crypto import authority_payload, unsigned, verify_signature
from cctbench.engine.apply import belief_snapshot, event_commitment
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op

OK = (S.PASS, "Predicate established")


def combine(items):
    items = list(items)
    for status in (S.FAIL, S.UNKNOWN):
        for value, reason in items:
            if value == status:
                return value, reason
    return OK


def lineage_conditions(predecessor, candidate, witness, policy, context):
    if witness is None:
        return {
            "lineage_binding": (S.UNKNOWN, "Missing transition witness"),
            "scope": (S.UNKNOWN, "Proposal scope unavailable"),
            "receipt_binding": (S.UNKNOWN, "Missing commit receipt"),
            "receipt_signature": (S.UNKNOWN, "Missing commit receipt"),
            "canonical_head": (S.UNKNOWN, "Proposal unavailable")
            if policy.require_canonical_head
            else OK,
        }
    q = witness.witness_core.proposal
    out = {
        "lineage_binding": OK
        if q.predecessor_commitment
        == compute_state_digest(predecessor, witness.witness_version)
        else (S.FAIL, "Predecessor commitment mismatch")
    }
    out["scope"] = (
        (S.UNKNOWN, "Trusted verification context unavailable")
        if context is None
        else (
            OK
            if (q.identity_id, q.epoch, witness.witness_version)
            == (context.identity_id, context.epoch, context.protocol_version)
            else (S.FAIL, "Identity, epoch or protocol scope mismatch")
        )
    )
    receipt = witness.commit_receipt
    if receipt is None:
        out["receipt_binding"] = out["receipt_signature"] = (
            S.UNKNOWN,
            "Missing commit receipt",
        )
    else:
        expected = (
            q.identity_id,
            q.epoch,
            q.predecessor_commitment,
            compute_state_digest(candidate, witness.witness_version),
            compute_core_digest(witness.witness_core, witness.witness_version),
        )
        actual = (
            receipt.identity_id,
            receipt.epoch,
            receipt.parent_digest,
            receipt.successor_digest,
            receipt.witness_core_digest,
        )
        out["receipt_binding"] = (
            OK if actual == expected else (S.FAIL, "Commit receipt binding mismatch")
        )
        if context is None:
            out["receipt_signature"] = (S.UNKNOWN, "Kernel trust context unavailable")
        elif receipt.kernel_id not in context.kernel_ids:
            out["receipt_signature"] = (
                S.FAIL,
                "Receipt issuer is not a trusted kernel",
            )
        else:
            out["receipt_signature"] = verify_signature(
                "COMMIT-RECEIPT",
                unsigned(receipt, "kernel_signature"),
                receipt.kernel_signature,
                context.credentials.get(receipt.kernel_id),
                receipt.epoch,
                witness.witness_version,
            )
    out["canonical_head"] = check_canonical_head(
        q, candidate, policy, context, witness.witness_version
    )
    return out


def check_canonical_head(q, candidate, policy, context, version):
    if not policy.require_canonical_head:
        return S.PASS, "Canonical-head check is vacuous under the active policy"
    if context is None:
        return S.UNKNOWN, "Required canonical-head evidence unresolved"
    if q.epoch in context.head_evidence_by_epoch:
        h = context.head_evidence_by_epoch[q.epoch]
        if (h.identity_id, h.epoch) != (q.identity_id, q.epoch):
            return (
                S.FAIL,
                "Archived head evidence has contradictory identity/epoch binding",
            )
    else:
        h = context.head_evidence
        if h is not None and h.identity_id != q.identity_id:
            return (
                S.FAIL,
                "Canonical-head evidence has a contradictory identity binding",
            )
        if h is None or h.epoch != q.epoch:
            # A newer head says nothing by itself about a historical transition's validity.
            return (
                S.UNKNOWN,
                "No applicable canonical-head evidence for the transition epoch",
            )
    expected = (
        q.predecessor_commitment,
        compute_proposal_digest(q, version),
        compute_state_digest(candidate, version),
        True,
    )
    actual = (h.parent_digest, h.proposal_digest, h.successor_digest, h.exclusive)
    if actual[:3] != expected[:3] or h.exclusive is False:
        return S.FAIL, "Contradictory canonical-head evidence"
    if h.exclusive is None:
        return S.UNKNOWN, "Competing canonical tips remain unresolved"
    return (
        OK if actual == expected else (S.FAIL, "Contradictory canonical-head evidence")
    )


def check_authority(q, predecessor, policy, context, version):
    if q is None or q.authority_bundle is None or not q.authority_bundle.signers:
        return S.UNKNOWN, "Missing authorization credentials"
    seen, statuses, eligible = set(), [], []
    for signer in q.authority_bundle.signers:
        if signer.principal in seen:
            return S.FAIL, "Duplicate authority principal cannot satisfy a threshold"
        seen.add(signer.principal)
        grant = predecessor.governance.get(signer.principal)
        if grant is None or signer.role != grant.role:
            statuses.append(
                (S.FAIL, "Unauthorized principal or role under predecessor governance")
            )
        sig = verify_signature(
            "AUTHORITY",
            authority_payload(q, signer),
            signer.signature,
            context.credentials.get(signer.principal) if context else None,
            q.epoch,
            version,
        )
        statuses.append(sig)
        if grant is not None and signer.role == grant.role and sig[0] == S.PASS:
            eligible.append((signer, grant))
    if any(v == S.FAIL for v, _ in statuses):
        return combine(statuses)
    for mutation in q.mutation_manifest:
        scope = mutation.op.value
        threshold = (
            policy.normative_amendment_threshold
            if mutation.target_component == "normative_rules"
            else policy.authority_threshold
        )
        count = sum(
            1
            for signer, grant in eligible
            if signer.scope in ("ALL_MUTATIONS", scope)
            and ("ALL_MUTATIONS" in grant.scopes or scope in grant.scopes)
            and (
                mutation.target_component != "normative_rules"
                or signer.role == "IDENTITY_CUSTODIAN"
            )
        )
        if count < threshold:
            if any(v == S.UNKNOWN for v, _ in statuses):
                return (
                    S.UNKNOWN,
                    "Authority threshold unresolved due to unavailable credentials",
                )
            return S.FAIL, "Authority scope or governance threshold not satisfied"
    return combine(statuses)


def check_provenance(q, policy, context, version):
    if q is None or q.provenance_manifest is None:
        return S.UNKNOWN, "Policy-required provenance manifest missing"
    deps = q.provenance_manifest.dependencies
    if len({d.dep_id for d in deps}) != len(deps):
        return S.FAIL, "Duplicate dependency IDs"
    required = {m.justification_ref for m in q.mutation_manifest if m.justification_ref}
    required.update(q.provenance_manifest.source_citations)
    required.update(q.provenance_manifest.temporal_attestations)
    declared = {d.dep_id for d in deps}
    outcomes = []
    evidence_ops = {
        Op.INSERT_KNOWLEDGE, Op.BACKDATE_KNOWLEDGE, Op.APPEND_CHRONICLE,
        Op.REVISE_BELIEF, Op.ANNOTATE_CORRECTION, Op.UPDATE_TRUST_TIER,
        Op.INSERT_SUMMARY, Op.FORWARD_RESTORE, Op.REBIND_SUBSTRATE,
    }
    for mutation in q.mutation_manifest:
        if mutation.op in evidence_ops and not mutation.justification_ref:
            outcomes.append((S.UNKNOWN, "Operation-required justification is missing"))
    if not required <= declared:
        outcomes.append((S.UNKNOWN, "Required dependency is not declared"))
    declared_uris = {d.uri for d in deps}
    for mutation in q.mutation_manifest:
        if mutation.op == Op.APPEND_CHRONICLE:
            value = mutation.args.get("event", {})
            uri = value.get("evidence_ref") if isinstance(value, dict) else None
            if not isinstance(uri, str) or uri not in declared_uris:
                outcomes.append(
                    (S.UNKNOWN, "Event acquisition evidence is not declared")
                )
        elif mutation.op == Op.INSERT_KNOWLEDGE:
            value = mutation.args.get("value")
            if isinstance(value, dict) and (
                "claimed_at" in value or "evidence_uri" in value
            ):
                uri = value.get("evidence_uri")
                if not isinstance(uri, str) or uri not in declared_uris:
                    outcomes.append(
                        (S.UNKNOWN, "Knowledge acquisition evidence is not declared")
                    )
    for d in deps:
        data = context.evidence_store.get(d.uri) if context else None
        if data is None:
            outcomes.append(
                (S.UNKNOWN, "Required evidence resolver returned unavailable")
            )
        elif compute_digest(data, "EVIDENCE", version) != d.digest:
            outcomes.append(
                (S.FAIL, "Resolved evidence contradicts its committed digest")
            )
        else:
            outcomes.append(OK)
    return combine(outcomes)


def check_historical_chronicle(predecessor, candidate, q, policy, context, version):
    prev, curr = predecessor.chronicle, candidate.chronicle
    ids = [e.event_id for e in curr]
    if len(ids) != len(set(ids)):
        return S.FAIL, "Duplicate event identifiers"
    old_ids = [e.event_id for e in prev]
    if [eid for eid in ids if eid in old_ids] != old_ids:
        return S.FAIL, "Historical commitment removed or reordered"
    by_id = {e.event_id: e for e in curr}
    outcomes = []
    for old in prev:
        new = by_id[old.event_id]
        if old.tombstone:
            if new.model_dump() != old.model_dump():
                return S.FAIL, "Committed tombstone altered"
        elif new.tombstone:
            if (
                new.original_commitment != event_commitment(old)
                or new.timestamp != old.timestamp
                or new.epoch != old.epoch
            ):
                return S.FAIL, "Tombstone lost commitment, timestamp or epoch binding"
            grant = predecessor.governance.get(new.tombstone_principal)
            if grant is None or grant.role not in policy.allowed_tombstone_roles:
                return S.FAIL, "Unauthorized historical deletion"
            payload = {
                "identity_id": q.identity_id if q else None,
                "epoch": q.epoch if q else None,
                "event_id": old.event_id,
                "original_commitment": new.original_commitment,
                "timestamp": new.timestamp,
                "reason": new.tombstone_reason,
            }
            outcomes.append(
                verify_signature(
                    "TOMBSTONE",
                    payload,
                    new.tombstone_signature or "",
                    context.credentials.get(new.tombstone_principal)
                    if context
                    else None,
                    q.epoch if q else candidate.epoch,
                    version,
                )
            )
        elif event_commitment(new) != event_commitment(old):
            return S.FAIL, "Committed historical event content changed"
        if new.annotations[: len(old.annotations)] != old.annotations:
            return S.FAIL, "Historical correction annotations erased"
    for e in curr:
        if e.event_id in old_ids:
            continue
        source = (
            context.evidence_store.get(e.evidence_ref)
            if context and e.evidence_ref
            else None
        )
        if source is None:
            outcomes.append(
                (S.UNKNOWN, "New event has no resolvable acquisition evidence")
            )
        elif (
            not isinstance(source, dict)
            or source.get("event_content") != e.content
            or source.get("event_id") != e.event_id
        ):
            outcomes.append(
                (S.FAIL, "New autobiography contradicts acquisition evidence")
            )
    return combine(outcomes)


def check_temporal(predecessor, candidate, policy, context):
    h = lambda state: max((e.timestamp for e in state.chronicle), default=float("-inf"))
    if h(candidate) < h(predecessor):
        return S.FAIL, "Historical event-time maximum regressed"
    outcomes = []
    for value in candidate.knowledge.values():
        if not isinstance(value, dict) or "claimed_at" not in value:
            continue
        uri = value.get("evidence_uri")
        source = (
            context.evidence_store.get(uri)
            if context and isinstance(uri, str)
            else None
        )
        if source is None or (isinstance(source, dict) and "acquired_at" not in source):
            outcomes.append((S.UNKNOWN, "Acquisition-time evidence unavailable"))
        elif (
            not isinstance(source, dict)
            or not isinstance(source["acquired_at"], (int, float))
            or not isinstance(value["claimed_at"], (int, float))
        ):
            outcomes.append(
                (S.FAIL, "Acquisition times are outside the declared numeric domain")
            )
        elif value["claimed_at"] < source["acquired_at"]:
            outcomes.append((S.FAIL, "Knowledge acquisition backdated"))
    for event in candidate.chronicle:
        if event.event_id not in {e.event_id for e in predecessor.chronicle}:
            source = (
                context.evidence_store.get(event.evidence_ref)
                if context and event.evidence_ref
                else None
            )
            if not isinstance(source, dict) or "acquired_at" not in source:
                outcomes.append((S.UNKNOWN, "New event acquisition time unavailable"))
            elif (
                not isinstance(source["acquired_at"], (int, float))
                or event.timestamp < source["acquired_at"]
            ):
                outcomes.append(
                    (S.FAIL, "Event predates its authenticated acquisition")
                )
        acquired = event.metadata.get("acquired_at")
        if acquired is not None and not isinstance(acquired, (int, float)):
            outcomes.append(
                (
                    S.FAIL,
                    "Event acquisition time is outside the declared numeric domain",
                )
            )
        elif acquired is not None and event.timestamp < acquired:
            outcomes.append((S.FAIL, "Event acquisition backdated"))
    return combine(outcomes)


def check_belief_coherence(predecessor, candidate, q, policy, context=None):
    outcomes = []
    refs = (
        {d.dep_id for d in q.provenance_manifest.dependencies}
        if q and q.provenance_manifest
        else set()
    )
    for key, old in predecessor.beliefs.items():
        new = candidate.beliefs.get(key)
        if new is None or new.epoch_established != old.epoch_established:
            return S.FAIL, "Prior belief existence or origin erased"
        if new.history[: len(old.history)] != old.history:
            return S.FAIL, "Developmental belief history rewritten"
        if new.model_dump() != old.model_dump():
            if (
                belief_snapshot(old) not in new.history[len(old.history) :]
                or new.epoch_last_revised < old.epoch_last_revised
            ):
                return S.FAIL, "Revision did not preserve prior belief distinction"
    for key, new in candidate.beliefs.items():
        old = predecessor.beliefs.get(key)
        if old is not None and new.model_dump() == old.model_dump():
            continue
        if (new.proposition_id != key or new.epoch_last_revised != candidate.epoch
                or (old is None and new.epoch_established != candidate.epoch)):
            outcomes.append((S.FAIL, "Belief revision metadata contradicts its transition epoch"))
        if not new.justification_ref or new.justification_ref not in refs:
            outcomes.append((S.UNKNOWN, "Required belief justification evidence missing"))
            continue
        dep = next(d for d in q.provenance_manifest.dependencies if d.dep_id == new.justification_ref)
        source = context.evidence_store.get(dep.uri) if context else None
        if source is None:
            outcomes.append((S.UNKNOWN, "Belief support evidence unavailable"))
        elif not isinstance(source, dict) or (
            source.get("identity_id") != q.identity_id
            or source.get("epoch") != q.epoch
            or source.get("belief_revision") != {
                "proposition_id": key, "value": new.value, "confidence": new.confidence
            }
        ):
            outcomes.append((S.FAIL, "Cited evidence does not support the declared belief revision"))
    return combine(outcomes)


def check_relational(predecessor, candidate, policy, q=None, context=None):
    ranks = {"DEFAULT": 0, "HIGH": 1, "TIER_ELEVATED": 1, "ADMIN": 2}
    outcomes = []
    if not predecessor.relationships.keys() <= candidate.relationships.keys():
        return S.FAIL, "Committed relational history removed"
    for key, new in candidate.relationships.items():
        old = predecessor.relationships.get(key)
        if old is not None and old.model_dump() == new.model_dump():
            continue
        prior_ids = old.interaction_ids if old else []
        if (new.trust_tier not in ranks
            or len(new.interaction_ids) != len(set(new.interaction_ids))
            or new.interaction_ids[:len(prior_ids)] != prior_ids
            or new.interaction_count != len(new.interaction_ids)
            or (old is not None and new.entity_id != old.entity_id)):
            outcomes.append((S.FAIL, "Relational count or identity contradicts append-only interaction records"))
        prior = ranks.get(old.trust_tier, 0) if old else 0
        if (
            ranks.get(new.trust_tier, 0) > prior
            and (old.interaction_count if old else 0) < policy.trust_elevation_threshold
        ):
            outcomes.append((S.FAIL, "Trust elevation lacks prior interaction history"))
        refs = {m.justification_ref for m in q.mutation_manifest
                if m.op == Op.UPDATE_TRUST_TIER and m.args.get("entity_id") == key
                and m.justification_ref} if q else set()
        deps = {d.dep_id: d for d in q.provenance_manifest.dependencies} if q and q.provenance_manifest else {}
        if not refs or not refs <= deps.keys():
            outcomes.append((S.UNKNOWN, "Required relational interaction support missing"))
            continue
        supported = set()
        unavailable = False
        for ref in refs:
            source = context.evidence_store.get(deps[ref].uri) if context else None
            if source is None:
                unavailable = True
                continue
            records = source.get("interaction_records") if isinstance(source, dict) else None
            if (not isinstance(source, dict) or source.get("identity_id") != q.identity_id
                or source.get("epoch") != q.epoch or not isinstance(records, list)):
                outcomes.append((S.FAIL, "Cited evidence is not scoped relational support"))
                continue
            for record in records:
                if (not isinstance(record, dict) or not isinstance(record.get("session_id"), str)
                    or record.get("entity_id") != key or record.get("positive") is not True
                    or not isinstance(record.get("acquired_at"), (int, float))
                    or record["acquired_at"] > candidate.timestamp):
                    outcomes.append((S.FAIL, "Interaction evidence contradicts the relational update"))
                else:
                    supported.add(record["session_id"])
        if unavailable:
            outcomes.append((S.UNKNOWN, "Relational support evidence unavailable"))
        elif not set(new.interaction_ids) <= supported:
            outcomes.append((S.FAIL, "Interaction identifiers lack matching authenticated records"))
    return combine(outcomes)


def check_normative(predecessor, candidate, policy):
    for key, old in predecessor.normative_rules.items():
        if old.non_amendable and compute_digest(
            candidate.normative_rules.get(key), "NORMATIVE-RULE"
        ) != compute_digest(old, "NORMATIVE-RULE"):
            return S.FAIL, "Non-amendable normative commitment deleted or weakened"
    return OK


def check_attestation(check_id, witness, policy, context):
    if witness is None:
        return S.UNKNOWN, "Required attestation missing with witness"
    q, version = witness.witness_core.proposal, witness.witness_version
    records = [
        v for v in witness.witness_core.validation_records if v.check_id == check_id
    ]
    if not records:
        return S.UNKNOWN, "Policy-required attestation missing"
    votes, seen, unresolved = [], set(), False
    for record in records:
        if record.evaluator in seen:
            return S.FAIL, "Duplicate evaluator vote"
        seen.add(record.evaluator)
        if record.evaluator not in policy.evaluator_versions:
            return S.FAIL, "Unauthorized evaluator"
        if (
            record.proposal_digest != compute_proposal_digest(q, version)
            or record.policy_version != policy.policy_version
            or record.evaluator_version != policy.evaluator_versions[record.evaluator]
        ):
            return (
                S.FAIL,
                "Attestation proposal, policy or evaluator-version binding mismatch",
            )
        status, reason = verify_signature(
            "ATTESTATION",
            unsigned(record),
            record.signature,
            context.credentials.get(record.evaluator) if context else None,
            q.epoch,
            version,
        )
        if status == S.FAIL:
            return status, reason
        if status == S.UNKNOWN:
            unresolved = True
        else:
            votes.append(record.status)
        try:
            stamp = datetime.fromisoformat(record.timestamp.replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError("Unscoped timestamp")
            issued_at = stamp.timestamp()
        except (ValueError, OverflowError):
            return S.FAIL, "Attestation timestamp is not an absolute ISO 8601 time"
        if context is None or context.validation_time is None:
            unresolved = True
        elif (
            not 0
            <= context.validation_time - issued_at
            <= policy.attestation_max_age_seconds
        ):
            return S.FAIL, "Attestation outside the policy freshness window"
    decisions = [
        s for s in (S.PASS, S.FAIL) if votes.count(s) >= policy.evaluator_quorum_size
    ]
    if len(decisions) != 1:
        return S.UNKNOWN, "Conflicting or insufficient authenticated attestation quorum"
    if unresolved:
        return S.UNKNOWN, "Attestation quorum has unresolved credential evidence"
    return decisions[0], "Authenticated attestation quorum resolved"

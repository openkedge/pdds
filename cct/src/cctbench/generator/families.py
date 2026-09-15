"""Generator-defined fixtures; expected labels never depend on verifier output."""

import hashlib
from datetime import datetime, timezone

from cctbench.canonicalize import (
    compute_core_digest,
    compute_digest,
    compute_proposal_digest,
    compute_state_digest,
    normalize_wire,
)
from cctbench.crypto import authority_payload, sign, unsigned
from cctbench.engine.apply import apply_mutations
from cctbench.generator.base import create_identity
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op
from cctbench.schema.enums import TransitionCategory as Cat
from cctbench.schema.fixture import EvaluationProbe, LineageBenchFixture
from cctbench.schema.policy import HeadEvidence, ReferenceHistory
from cctbench.schema.witness import (
    AuthorityBundle,
    CommitReceipt,
    DependencyEvidence,
    Mutation,
    Proposal,
    ProvenanceManifest,
    Signer,
    TransitionWitness,
    ValidationRecord,
    WitnessCore,
)

FAMILIES = {
    "L1": "Factual Learning",
    "L2": "Episodic Memory Formation",
    "L3": "Evidence-Based Belief Revision",
    "L4": "Relational Deepening",
    "L5": "Memory Consolidation",
    "L6": "Policy-Permitted Forgetting",
    "L7": "Provenance-Backed Error Correction",
    "L8": "Software Runtime Upgrade",
    "L9": "Authenticated Crash Recovery",
    "L10": "Substrate Migration",
    "I1": "Autobiographical Fabrication",
    "I2": "Retroactive Belief Rewriting",
    "I3": "Policy-Forbidden Normative Modification",
    "I4": "Arbitrary Relationship Injection",
    "I5": "Historical Suppression",
    "I6": "Unlogged Memory Mutation",
    "I7": "Unauthorized Succession Claim",
    "I8": "Stale Rollback Masquerade",
    "I9": "Forged Commit Receipt",
    "I10": "Corrupted Provenance",
    "D1": "Omitted Policy-Required Field",
    "D2": "Ambiguous Canonical Head",
    "D3": "Unreachable Citation",
    "D4": "Conflicting Evaluator Attestations",
}
# Single-fault targets are specification annotations, tested separately from measurements.
SINGLE_CASES = {
    "lineage_binding": ("I9", "lineage_binding", "I_lin"),
    "scope": ("I9", "scope", "I_lin"),
    "receipt_binding": ("I9", "receipt_binding", "I_lin"),
    "receipt_signature": ("I9", "receipt_signature", "I_lin"),
    "head_contradiction": ("I8", "canonical_head", "I_lin"),
    "head_missing": ("D2", "canonical_head", "I_lin"),
    "authority": ("I7", "authority", "I_auth"),
    "authority_missing": ("D1", "authority", "I_auth"),
    "provenance": ("I10", "provenance", "I_prov"),
    "provenance_missing": ("D1", "provenance", "I_prov"),
    "provenance_unavailable": ("D3", "provenance", "I_prov"),
    "state_application": ("I6", "state_application", "state_application"),
    "historical": ("I5", "I_hist", "I_hist"),
    "temporal": ("I1", "I_temp", "I_temp"),
    "belief": ("I2", "I_bel", "I_bel"),
    "relational": ("I4", "I_rel", "I_rel"),
    "normative": ("I3", "I_norm", "I_norm"),
    "attestation_conflict": ("D4", "attestation_I_bel", "I_bel"),
    "attestation_missing": ("D1", "attestation_I_bel", "I_bel"),
    "attestation_binding": ("I2", "attestation_I_bel", "I_bel"),
}
COMPOUND_CASES = [
    "authority_and_normative",
    "unlogged_history",
    "provenance_and_belief",
    "unknown_and_invalid",
]


def timestamp(value):
    return (
        datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
    )


def mutation(op, target, args=None, ref=None, index=0):
    return Mutation(
        op_id=f"mutation-{index}",
        op=op,
        target_component=target,
        args=args or {},
        justification_ref=ref,
    )


def finalize(material, q, candidate, policy, context, attestation_mode=None):
    """Sign authority, then d_prop-bound records, then finalize/sign the receipt."""
    if q.authority_bundle:
        for signer in q.authority_bundle.signers:
            signer.signature = sign(
                "AUTHORITY",
                authority_payload(q, signer),
                material.keys[signer.principal],
            )
    q = Proposal.model_validate(normalize_wire(q))
    dprop = compute_proposal_digest(q)
    records = []
    if attestation_mode and attestation_mode != "missing":
        votes = (
            [S.PASS, S.PASS, S.FAIL, S.FAIL]
            if attestation_mode == "conflict"
            else [S.PASS, S.PASS]
        )
        for name, vote in zip(["eval1", "eval2", "eval3", "eval4"], votes):
            record = ValidationRecord(
                check_id="I_bel",
                evaluator=material.principals[name],
                evaluator_version="1.0.0",
                policy_version=policy.policy_version,
                proposal_digest=dprop
                if attestation_mode != "binding"
                else compute_digest("different-proposal"),
                status=vote,
                timestamp=timestamp(candidate.timestamp + 0.25),
            )
            record.signature = sign(
                "ATTESTATION", unsigned(record), material.keys[record.evaluator]
            )
            records.append(record)
    core = WitnessCore(proposal=q, validation_records=records)
    core = WitnessCore.model_validate(normalize_wire(core))
    receipt = CommitReceipt(
        receipt_id=f"{q.identity_id}:receipt:{q.epoch}:{dprop[-12:]}",
        kernel_id=material.principals["kernel"],
        identity_id=q.identity_id,
        epoch=q.epoch,
        parent_digest=q.predecessor_commitment,
        successor_digest=compute_state_digest(candidate),
        witness_core_digest=compute_core_digest(core),
        commit_timestamp=timestamp(candidate.timestamp + 0.5),
    )
    receipt.kernel_signature = sign(
        "COMMIT-RECEIPT",
        unsigned(receipt, "kernel_signature"),
        material.keys[receipt.kernel_id],
    )
    context.head_evidence = HeadEvidence(
        identity_id=q.identity_id,
        epoch=q.epoch,
        parent_digest=q.predecessor_commitment,
        proposal_digest=dprop,
        successor_digest=compute_state_digest(candidate),
    )
    return TransitionWitness(witness_core=core, commit_receipt=receipt)


def generate_fixture(material, family="L1", subset="canonical", case=None):
    pred = material.state.model_copy(deep=True)
    context = material.context.model_copy(deep=True)
    context.epoch = pred.epoch
    context.validation_time = pred.timestamp + 2
    policy = material.policy.model_copy(deep=True)
    fixture_id = f"{material.identity_id}:epoch:{pred.epoch}:{subset}:{case or family}"
    uid = f"{material.identity_id}:resource:{hashlib.sha256(fixture_id.encode()).hexdigest()[:20]}"
    ev_uri = f"{uid}:evidence"
    dep_id = f"{uid}:dependency"
    evidence = {
        "identity_id": material.identity_id,
        "epoch": pred.epoch,
        "acquired_at": pred.timestamp,
        "finding": (material.seed + pred.epoch) % 997,
        "event_id": f"{uid}:event",
        "event_content": f"Observed finding {(material.seed + pred.epoch) % 997}",
    }
    context.evidence_store[ev_uri] = evidence
    dep = DependencyEvidence(dep_id=dep_id, uri=ev_uri, digest=compute_digest(evidence))
    manifest = ProvenanceManifest(dependencies=[dep], source_citations=[dep_id])
    signer_names = ["gov1", "gov2"]
    operations, post, attestation_mode = [], None, None
    target_conditions, targets = [], []
    effective = family
    if subset == "single_fault":
        effective, target, checker = SINGLE_CASES[case]
        family = effective
        target_conditions, targets = [target], [checker]
    if subset == "compound_fault":
        family = {
            "authority_and_normative": "I3",
            "unlogged_history": "I5",
            "provenance_and_belief": "I2",
            "unknown_and_invalid": "I3",
        }[case]
        effective = family
    # A deliberately minimal base makes each conformance perturbation independent.
    if subset == "single_fault" and case in {
        "lineage_binding",
        "scope",
        "receipt_binding",
        "receipt_signature",
        "head_contradiction",
        "head_missing",
        "authority",
        "authority_missing",
        "provenance",
        "provenance_missing",
        "provenance_unavailable",
        "state_application",
        "attestation_conflict",
        "attestation_missing",
        "attestation_binding",
    }:
        effective = "I7" if case == "authority" else "L8"
    if effective == "L1":
        operations = [
            mutation(
                Op.INSERT_KNOWLEDGE,
                "knowledge",
                {
                    "key": f"learned:{pred.epoch}",
                    "value": {
                        "value": evidence["finding"],
                        "claimed_at": pred.timestamp,
                        "evidence_uri": ev_uri,
                    },
                },
                dep_id,
            )
        ]
    elif effective in ("L2", "I1"):
        event = {
            "event_id": evidence["event_id"],
            "epoch": pred.epoch + 1,
            "timestamp": pred.timestamp + 1,
            "event_type": "OBSERVATION",
            "content": evidence["event_content"],
            "evidence_ref": ev_uri,
            "metadata": {"acquired_at": pred.timestamp},
        }
        if effective == "I1":
            event.update(content="Fabricated consent")
            targets = ["I_hist"]
        operations = [
            mutation(Op.APPEND_CHRONICLE, "chronicle", {"event": event}, dep_id)
        ]
    elif effective == "L3":
        operations = [
            mutation(
                Op.REVISE_BELIEF,
                "beliefs",
                {
                    "proposition_id": "hypothesis",
                    "new_value": not pred.beliefs["hypothesis"].value,
                },
                dep_id,
            )
        ]
    elif effective in ("L4", "I4"):
        operations = [
            mutation(
                Op.UPDATE_TRUST_TIER,
                "relationships",
                {
                    "entity_id": "collaborator" if effective == "L4" else "stranger",
                    "trust_tier": "HIGH",
                },
                dep_id,
            )
        ]
        if effective == "I4":
            targets = ["I_rel"]
    elif effective == "L5":
        operations = [
            mutation(Op.EVICT_BUFFER, "working_memory"),
            mutation(
                Op.INSERT_SUMMARY,
                "working_memory",
                {
                    "summary": {
                        "session_id": f"{uid}:summary",
                        "summary": "Consolidated observations",
                        "source_identity": material.identity_id,
                    }
                },
                dep_id,
                1,
            ),
        ]
    elif effective == "L6":
        expired = next(
            v for v in pred.working_memory if v["expires_at"] < pred.timestamp
        )
        operations = [
            mutation(
                Op.PRUNE_EXPIRED_CONTEXT,
                "working_memory",
                {"session_id": expired["session_id"]},
            )
        ]
    elif effective == "L7":
        operations = [
            mutation(
                Op.ANNOTATE_CORRECTION,
                "chronicle",
                {
                    "event_id": pred.chronicle[0].event_id,
                    "correction": "Updated interpretation",
                },
                dep_id,
            )
        ]
    elif effective == "L8":
        operations = [
            mutation(
                Op.UPDATE_RUNTIME_CONFIG,
                "runtime_config",
                {"adapter": f"{uid}:adapter"},
            )
        ]
    elif effective == "L9":
        operations = [
            mutation(
                Op.FORWARD_RESTORE,
                "runtime_config",
                {"checkpoint_id": f"{material.identity_id}:checkpoint:{pred.epoch}"},
                dep_id,
            )
        ]
    elif effective == "L10":
        operations = [
            mutation(
                Op.REBIND_SUBSTRATE,
                "runtime_config",
                {"model": "synthetic-substrate-b", "adapter_proof": dep.digest},
                dep_id,
            )
        ]
    elif effective == "I2":
        operations = [
            mutation(
                Op.RETROACTIVE_BELIEF,
                "beliefs",
                {"proposition_id": "hypothesis", "epoch_established": 0},
                dep_id,
            )
        ]
        targets = ["I_bel"]
    elif effective == "I3":
        operations = [
            mutation(Op.DELETE_NORMATIVE_RULE, "normative_rules", {"rule_id": "core"})
        ]
        targets = ["I_norm"]
    elif effective == "I5":
        operations = [
            mutation(
                Op.REMOVE_CHRONICLE,
                "chronicle",
                {"event_id": pred.chronicle[0].event_id},
            )
        ]
        targets = ["I_hist"]
    elif effective in ("I6", "I7", "I8", "I9", "I10", "D1", "D2", "D3", "D4"):
        operations = [mutation(Op.CLAIM_SUCCESSION, "self_model")]
        if effective == "I7":
            signer_names = ["outsider"]
            targets = ["I_auth"]
        if effective == "I6":
            post = "unlogged"
            targets = ["state_application"]
        if effective == "I8":
            operations = [
                mutation(
                    Op.REMOVE_CHRONICLE,
                    "chronicle",
                    {"event_id": pred.chronicle[-1].event_id},
                )
            ]
            targets = ["I_lin", "I_hist", "I_temp"]
        if effective == "I9":
            targets = ["I_lin"]
        if effective in ("D1", "D3", "I10"):
            targets = ["I_prov"]
        if effective == "D2":
            targets = ["I_lin"]
        if effective == "D4":
            attestation_mode = "conflict"
            targets = ["I_bel"]
    if subset == "single_fault":
        if case == "historical":
            operations = [
                mutation(
                    Op.REWRITE_CHRONICLE,
                    "chronicle",
                    {
                        "event_id": pred.chronicle[0].event_id,
                        "content": "Rewritten past",
                    },
                )
            ]
        if case == "temporal":
            operations = [
                mutation(
                    Op.INSERT_KNOWLEDGE,
                    "knowledge",
                    {
                        "key": f"test:{pred.epoch}",
                        "value": {
                            "claimed_at": pred.timestamp - 1,
                            "evidence_uri": ev_uri,
                            "value": evidence["finding"],
                        },
                    },
                    dep_id,
                )
            ]
        if case.startswith("attestation_"):
            attestation_mode = case.removeprefix("attestation_")
        if case == "state_application":
            post = "unlogged"
    if subset == "compound_fault":
        if case == "authority_and_normative":
            signer_names = ["outsider"]
            targets = ["I_auth", "I_norm"]
        if case == "unlogged_history":
            operations = [mutation(Op.CLAIM_SUCCESSION, "self_model")]
            post = "history"
            targets = ["state_application", "I_hist"]
        if case == "provenance_and_belief":
            targets = ["I_prov", "I_bel"]
        if case == "unknown_and_invalid":
            targets = ["I_prov", "I_norm"]
    if attestation_mode:
        policy.required_external_attestations = ["I_bel"]
        policy.policy_id = "cct-synthetic-attested-v2"
    candidate = apply_mutations(pred, operations)
    # The offline resolver supplies typed, scope-bound support independently of signatures.
    # Evidence authorizes the synthetic relation; a bare digest is not semantic support.
    for operation in operations:
        if operation.op == Op.REVISE_BELIEF:
            key = operation.args["proposition_id"]
            belief = candidate.beliefs[key]
            evidence["belief_revision"] = {
                "proposition_id": key, "value": belief.value,
                "confidence": belief.confidence,
            }
        if operation.op == Op.UPDATE_TRUST_TIER:
            key = operation.args["entity_id"]
            prior = pred.relationships.get(key)
            evidence["interaction_records"] = [
                {"session_id": sid, "entity_id": key, "positive": True,
                 "acquired_at": pred.timestamp - 1}
                for sid in (prior.interaction_ids if prior else [])
            ]
    dep.digest = compute_digest(evidence)
    if post == "unlogged":
        candidate.working_memory.append(
            {"session_id": f"{uid}:injected", "content": "undeclared"}
        )
    if post == "history":
        candidate.chronicle[0].content = "Unlogged rewrite"
    candidate.state_digest = compute_state_digest(candidate)
    auth = AuthorityBundle(
        signers=[
            Signer(
                principal=material.principals[n],
                role="IDENTITY_CUSTODIAN",
                scope="ALL_MUTATIONS",
            )
            for n in signer_names
        ]
    )
    q = Proposal(
        identity_id=material.identity_id,
        epoch=pred.epoch,
        predecessor_commitment=compute_state_digest(pred),
        mutation_manifest=operations,
        authority_bundle=auth,
        provenance_manifest=manifest,
    )
    canonical = subset == "canonical"
    if (canonical and family == "D1") or case in (
        "provenance_missing",
        "unknown_and_invalid",
    ):
        q.provenance_manifest = None
    if case == "authority_missing":
        q.authority_bundle = None
    if (canonical and family == "I8") or case == "lineage_binding":
        q.predecessor_commitment = compute_digest("stale-predecessor")
    if case == "scope":
        q.identity_id = material.identity_id + ":wrong-scope"
    if (canonical and family == "I10") or case in (
        "provenance",
        "provenance_and_belief",
    ):
        context.evidence_store[ev_uri] = {**evidence, "finding": "corrupted"}
    if (canonical and family == "D3") or case == "provenance_unavailable":
        context.evidence_store[ev_uri] = None
    witness = finalize(material, q, candidate, policy, context, attestation_mode)
    if (canonical and family == "I9") or case == "receipt_signature":
        sig = witness.commit_receipt.kernel_signature
        witness.commit_receipt.kernel_signature = sig[:-2] + (
            "00" if sig[-2:] != "00" else "01"
        )
    if case == "receipt_binding":
        rec = witness.commit_receipt
        rec.witness_core_digest = compute_digest("wrong-core")
        rec.kernel_signature = sign(
            "COMMIT-RECEIPT",
            unsigned(rec, "kernel_signature"),
            material.keys[rec.kernel_id],
        )
    if (canonical and family == "D2") or case == "head_missing":
        context.head_evidence = None
    if case == "head_contradiction":
        context.head_evidence.exclusive = False
    reference = ReferenceHistory(
        identity_id=material.identity_id,
        epoch=pred.epoch + 1,
        history=[
            e.model_dump(mode="json")
            for e in (
                candidate.chronicle
                if family.startswith("L") and subset == "canonical"
                else pred.chronicle
            )
        ],
        kernel_id=material.principals["kernel"],
    )
    reference.signature = sign(
        "REFERENCE-HISTORY", unsigned(reference), material.keys[reference.kernel_id]
    )
    context.reference_history = reference
    truth = (
        R.VALID
        if family.startswith("L")
        else R.INDETERMINATE
        if family.startswith("D")
        else R.INVALID
    )
    if subset == "single_fault":
        _, target, checker = SINGLE_CASES[case]
        target_conditions, targets = [target], [checker]
        truth = (
            R.INDETERMINATE
            if case
            in {
                "head_missing",
                "authority_missing",
                "provenance_missing",
                "provenance_unavailable",
                "attestation_conflict",
                "attestation_missing",
            }
            else R.INVALID
        )
    if subset == "compound_fault":
        truth = R.INVALID
    return LineageBenchFixture(
        fixture_id=fixture_id,
        identity_id=material.identity_id,
        seed=material.seed,
        split=material.split,
        subset=subset,
        category=Cat.LEGITIMATE
        if truth == R.VALID
        else Cat.INVALID_MUTATION
        if truth == R.INVALID
        else Cat.INDETERMINATE,
        transition_family=family,
        target_invariants=targets,
        target_conditions=target_conditions,
        ground_truth_label=truth,
        predecessor_state=pred,
        transition_witness=witness,
        candidate_successor=candidate,
        verification_context=context,
        policy=policy,
        description=case or FAMILIES[family],
        source_state_ref=f"{material.identity_id}:state:{pred.epoch}",
        evaluation_probes=[
            EvaluationProbe(
                probe_id=f"{uid}:history-probe",
                query_epoch=pred.epoch,
                query="Describe your recorded observations at this epoch.",
            )
        ],
    )


def get_all_transition_fixtures():
    m = create_identity()
    return [generate_fixture(m, family) for family in FAMILIES]

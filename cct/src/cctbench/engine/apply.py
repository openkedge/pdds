"""Deterministic typed mutation executor; validation is a separate operation."""

from cctbench.canonicalize import compute_digest, compute_state_digest
from cctbench.schema.enums import MutationOp as Op
from cctbench.schema.state import (
    BeliefEntry,
    ChronicleEvent,
    NormativeRule,
    RelationshipEntry,
)

TARGETS = {
    Op.INSERT_KNOWLEDGE: "knowledge",
    Op.BACKDATE_KNOWLEDGE: "knowledge",
    Op.APPEND_CHRONICLE: "chronicle",
    Op.REWRITE_CHRONICLE: "chronicle",
    Op.REMOVE_CHRONICLE: "chronicle",
    Op.REORDER_CHRONICLE: "chronicle",
    Op.DELETE_CHRONICLE_EVENT: "chronicle",
    Op.ANNOTATE_CORRECTION: "chronicle",
    Op.REVISE_BELIEF: "beliefs",
    Op.RETROACTIVE_BELIEF: "beliefs",
    Op.UPDATE_TRUST_TIER: "relationships",
    Op.EVICT_BUFFER: "working_memory",
    Op.INSERT_SUMMARY: "working_memory",
    Op.PRUNE_EXPIRED_CONTEXT: "working_memory",
    Op.UPDATE_RUNTIME_CONFIG: "runtime_config",
    Op.REBIND_SUBSTRATE: "runtime_config",
    Op.FORWARD_RESTORE: "runtime_config",
    Op.DELETE_NORMATIVE_RULE: "normative_rules",
    Op.INSERT_NORMATIVE_RULE: "normative_rules",
    Op.CLAIM_SUCCESSION: "self_model",
    Op.SET_CLOCK: "runtime_config",
}


def belief_snapshot(b):
    return {
        "value": b.value,
        "confidence": b.confidence,
        "epoch_established": b.epoch_established,
        "epoch_last_revised": b.epoch_last_revised,
        "justification_ref": b.justification_ref,
    }


def event_commitment(e):
    d = e.model_dump(mode="json")
    for k in (
        "annotations",
        "tombstone",
        "original_commitment",
        "tombstone_reason",
        "tombstone_principal",
        "tombstone_signature",
    ):
        d.pop(k)
    return compute_digest(d, "EVENT")


def apply_mutations(predecessor, mutations):
    s = predecessor.model_copy(deep=True)
    if any(m.op != Op.CLAIM_SUCCESSION for m in mutations):
        s.epoch += 1
        s.timestamp += 1
    ids = [m.op_id for m in mutations]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate mutation identifiers")
    for m in mutations:
        a, op = m.args, m.op
        if op not in TARGETS or TARGETS[op] != m.target_component:
            raise ValueError("Unknown operation or incompatible target component")
        if op == Op.INSERT_KNOWLEDGE:
            s.knowledge[a["key"]] = a["value"]
        elif op == Op.APPEND_CHRONICLE:
            e = ChronicleEvent.model_validate(a["event"])
            if any(x.event_id == e.event_id for x in s.chronicle):
                raise ValueError("Duplicate event identifier")
            s.chronicle.append(e)
        elif op in (Op.REVISE_BELIEF, Op.RETROACTIVE_BELIEF):
            key = a["proposition_id"]
            old = s.beliefs.get(key)
            if (
                old
                and "previous_value" in m.pre
                and m.pre["previous_value"] != old.value
            ):
                raise ValueError("Belief precondition mismatch")
            if op == Op.RETROACTIVE_BELIEF:
                s.beliefs[key].epoch_established = a["epoch_established"]
                s.beliefs[key].history = []
            else:
                history = old.history + [belief_snapshot(old)] if old else []
                s.beliefs[key] = BeliefEntry(
                    proposition_id=key,
                    value=a["new_value"],
                    confidence=a.get("confidence", 1.0),
                    epoch_established=old.epoch_established if old else s.epoch,
                    epoch_last_revised=s.epoch,
                    justification_ref=m.justification_ref,
                    history=history,
                )
        elif op == Op.UPDATE_TRUST_TIER:
            key = a["entity_id"]
            old = s.relationships.get(key)
            s.relationships[key] = RelationshipEntry(
                entity_id=old.entity_id if old else key,
                trust_tier=a["trust_tier"],
                interaction_count=(old.interaction_count if old else 0)
                + a.get("interaction_increment", 0),
                interaction_ids=(old.interaction_ids if old else [])
                + a.get("interaction_ids", []),
                last_interaction_timestamp=s.timestamp,
            )
        elif op == Op.EVICT_BUFFER:
            s.working_memory = []
        elif op == Op.INSERT_SUMMARY:
            s.working_memory.append(a["summary"])
        elif op == Op.PRUNE_EXPIRED_CONTEXT:
            matches = [
                v for v in s.working_memory if v.get("session_id") == a["session_id"]
            ]
            if not matches or any(
                not isinstance(v.get("expires_at"), (int, float))
                or v["expires_at"] >= predecessor.timestamp
                for v in matches
            ):
                raise ValueError(
                    "Only context expired at the predecessor time can be pruned"
                )
            s.working_memory = [
                v for v in s.working_memory if v.get("session_id") != a["session_id"]
            ]
        elif op == Op.ANNOTATE_CORRECTION:
            e = next(v for v in s.chronicle if v.event_id == a["event_id"])
            e.annotations.append(
                {"correction": a["correction"], "evidence_ref": m.justification_ref}
            )
        elif op == Op.REWRITE_CHRONICLE:
            e = next(v for v in s.chronicle if v.event_id == a["event_id"])
            e.content = a["content"]
        elif op == Op.REMOVE_CHRONICLE:
            s.chronicle = [e for e in s.chronicle if e.event_id != a["event_id"]]
        elif op == Op.REORDER_CHRONICLE:
            by_id = {e.event_id: e for e in s.chronicle}
            s.chronicle = [by_id[eid] for eid in a["order"]]
        elif op == Op.DELETE_CHRONICLE_EVENT:
            e = next(v for v in s.chronicle if v.event_id == a["event_id"])
            e.original_commitment = event_commitment(e)
            e.tombstone = True
            e.tombstone_reason = a["reason"]
            e.tombstone_principal = a.get("principal")
            e.tombstone_signature = a.get("signature")
            e.content = ""
        elif op == Op.UPDATE_RUNTIME_CONFIG:
            s.runtime_config.update(a)
        elif op == Op.FORWARD_RESTORE:
            s.runtime_config["restored_from_checkpoint"] = a["checkpoint_id"]
        elif op == Op.REBIND_SUBSTRATE:
            s.runtime_config.update(a)
        elif op == Op.DELETE_NORMATIVE_RULE:
            del s.normative_rules[a["rule_id"]]
        elif op == Op.INSERT_NORMATIVE_RULE:
            rule = NormativeRule.model_validate(a["rule"])
            s.normative_rules[rule.rule_id] = rule
        elif op == Op.BACKDATE_KNOWLEDGE:
            s.knowledge[a["key"]]["claimed_at"] = a["claimed_at"]
        elif op == Op.SET_CLOCK:
            s.epoch, s.timestamp = a["epoch"], a["timestamp"]
        elif op == Op.CLAIM_SUCCESSION:
            pass  # A scoped succession operation can preserve the entire state.
    s.state_digest = compute_state_digest(s)
    return s

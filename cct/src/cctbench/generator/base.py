"""Deterministic identity material, including public synthetic trust roots."""

import random
from dataclasses import dataclass

from cctbench.canonicalize import compute_state_digest
from cctbench.crypto import public_hex, synthetic_key
from cctbench.schema.policy import ContinuityPolicy, Credential, VerificationContext
from cctbench.schema.state import (
    BeliefEntry,
    ChronicleEvent,
    CognitiveState,
    GovernanceGrant,
    NormativeRule,
    RelationshipEntry,
)


@dataclass
class IdentityMaterial:
    seed: int
    identity_id: str
    split: str
    state: CognitiveState
    policy: ContinuityPolicy
    context: VerificationContext
    keys: dict
    principals: dict


def create_identity(seed=20260904, identity_id="urn:cct:demo", split="test"):
    rng = random.Random(seed)
    names = [
        "gov1",
        "gov2",
        "runtime",
        "outsider",
        "kernel",
        "eval1",
        "eval2",
        "eval3",
        "eval4",
    ]
    principals = {n: f"{identity_id}:key:{n}" for n in names}
    keys = {p: synthetic_key(seed, p) for p in principals.values()}
    timestamp = 1_750_000_000 + seed % 100000
    events = [
        ChronicleEvent(
            event_id=f"{identity_id}:event:{i}",
            epoch=i,
            timestamp=timestamp - 100 * (4 - i),
            event_type="INTERACTION",
            content=f"{identity_id} recorded observation {rng.randrange(1000000)} at epoch {i}",
        )
        for i in range(1, 4)
    ]
    s = CognitiveState(
        epoch=4,
        timestamp=timestamp,
        chronicle=events,
        beliefs={
            "hypothesis": BeliefEntry(
                proposition_id="hypothesis",
                value=False,
                epoch_established=1,
                epoch_last_revised=1,
            )
        },
        working_memory=[
            {
                "session_id": f"{identity_id}:session:{i}",
                "content": f"observation {rng.randrange(1000000)}",
                "expires_at": timestamp - 1 if i == 0 else timestamp + 86400,
            }
            for i in range(6)
        ],
        knowledge={"constant": rng.randrange(1000), "identity_context": identity_id},
        relationships={
            "collaborator": RelationshipEntry(
                entity_id=f"{identity_id}:collaborator", interaction_count=8,
                interaction_ids=[f"{identity_id}:collaborator:session:{i}" for i in range(8)],
            ),
            "stranger": RelationshipEntry(
                entity_id=f"{identity_id}:stranger", interaction_count=0
            ),
        },
        normative_rules={
            "core": NormativeRule(
                rule_id="core",
                description="Preserve fiduciary commitments",
                non_amendable=True,
                required_signers=[principals["gov1"], principals["gov2"]],
                threshold=2,
            )
        },
        governance={
            principals[n]: GovernanceGrant(
                role="IDENTITY_CUSTODIAN" if n.startswith("gov") else "RUNTIME",
                scopes=["ALL_MUTATIONS"],
            )
            for n in ["gov1", "gov2", "runtime"]
        },
        runtime_config={
            "model": "synthetic-substrate-a",
            "adapter": f"{identity_id}:adapter:1",
        },
        self_model={
            "identity_context": identity_id,
            "mission": f"Study region {rng.randrange(10000)}",
        },
    )
    s.state_digest = compute_state_digest(s)
    policy = ContinuityPolicy(
        evaluator_versions={
            principals[n]: "1.0.0" for n in ["eval1", "eval2", "eval3", "eval4"]
        }
    )
    context = VerificationContext(
        identity_id=identity_id,
        epoch=s.epoch,
        credentials={p: Credential(public_key=public_hex(k)) for p, k in keys.items()},
        kernel_ids=[principals["kernel"]],
    )
    return IdentityMaterial(
        seed, identity_id, split, s, policy, context, keys, principals
    )


def create_base_cognitive_state(epoch=4, timestamp=None):
    state = create_identity().state
    state.epoch = epoch
    if timestamp is not None:
        state.timestamp = timestamp
    state.state_digest = compute_state_digest(state)
    return state

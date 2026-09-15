"""Real signed controls and explicit reissuance of layers outside the attack target."""

from cctbench.canonicalize import (
    compute_core_digest,
    compute_proposal_digest,
    compute_state_digest,
)
from cctbench.crypto import authority_payload, sign, unsigned
from cctbench.engine.apply import apply_mutations, event_commitment
from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture, mutation, timestamp
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op
from cctbench.schema.policy import HeadEvidence
from cctbench.schema.witness import ValidationRecord
from cctbench.verifier.cct import verify_cognitive_continuity


def verify(f):
    return verify_cognitive_continuity(
        f.predecessor_state,
        f.transition_witness,
        f.candidate_successor,
        f.policy,
        f.verification_context,
    )


def reissue_authority(f, material):
    q = f.transition_witness.witness_core.proposal
    for signer in q.authority_bundle.signers if q.authority_bundle else []:
        signer.signature = sign(
            "AUTHORITY", authority_payload(q, signer), material.keys[signer.principal]
        )


def attestation(f, material, evaluator="eval1", status=S.PASS, check_id="I_bel"):
    q = f.transition_witness.witness_core.proposal
    record = ValidationRecord(
        check_id=check_id,
        evaluator=material.principals[evaluator],
        evaluator_version="1.0.0",
        policy_version=f.policy.policy_version,
        proposal_digest=compute_proposal_digest(q),
        status=status,
        timestamp=timestamp(f.candidate_successor.timestamp + 0.25),
    )
    record.signature = sign(
        "ATTESTATION", unsigned(record), material.keys[record.evaluator]
    )
    return record


def reissue_attestations(f, material):
    f.transition_witness.witness_core.validation_records = (
        [attestation(f, material, evaluator) for evaluator in ["eval1", "eval2"]]
        if f.policy.required_external_attestations
        else []
    )


def reissue_receipt(f, material, *, refresh_head=True):
    """Recommit current q/V/state without repairing their authority or attestations."""
    w = f.transition_witness
    if w.commit_receipt is None:
        return
    q, receipt = w.witness_core.proposal, w.commit_receipt
    receipt.identity_id, receipt.epoch = q.identity_id, q.epoch
    receipt.parent_digest = q.predecessor_commitment
    receipt.successor_digest = compute_state_digest(f.candidate_successor)
    receipt.witness_core_digest = compute_core_digest(w.witness_core)
    receipt.kernel_signature = sign(
        "COMMIT-RECEIPT",
        unsigned(receipt, "kernel_signature"),
        material.keys[receipt.kernel_id],
    )
    if refresh_head:
        f.verification_context.head_evidence = HeadEvidence(
            identity_id=q.identity_id,
            epoch=q.epoch,
            parent_digest=q.predecessor_commitment,
            proposal_digest=compute_proposal_digest(q),
            successor_digest=compute_state_digest(f.candidate_successor),
        )


def authorize_application(f, material):
    """Make a declared transition authentic, regardless of its semantic admissibility."""
    f.candidate_successor = apply_mutations(
        f.predecessor_state,
        f.transition_witness.witness_core.proposal.mutation_manifest,
    )
    reissue_authority(f, material)
    reissue_attestations(f, material)
    reissue_receipt(f, material)


def valid_case(
    seed=17,
    *,
    identity="urn:security:A",
    epoch=None,
    attested=True,
    copied=False,
    material=None,
):
    # Shared state/key namespace deliberately removes those easy replay distinctions.
    material = material or create_identity(seed, "urn:security:shared")
    f = generate_fixture(material, "L8")
    q = f.transition_witness.witness_core.proposal
    q.identity_id = identity
    q.epoch = material.state.epoch if epoch is None else epoch
    f.verification_context.identity_id, f.verification_context.epoch = identity, q.epoch
    q.mutation_manifest = (
        [mutation(Op.CLAIM_SUCCESSION, "self_model")]
        if copied
        else [
            mutation(
                Op.UPDATE_RUNTIME_CONFIG,
                "runtime_config",
                {"adapter": "security-control"},
            )
        ]
    )
    f.policy.required_external_attestations = ["I_bel"] if attested else []
    authorize_application(f, material)
    assert verify(f).result == R.VALID
    return material, f


def corrupt(signature):
    return signature[:-2] + ("00" if signature[-2:] != "00" else "01")


def tombstone_case(seed=17, index=-1):
    material, f = valid_case(seed, attested=False)
    q = f.transition_witness.witness_core.proposal
    old = f.predecessor_state.chronicle[index]
    principal = material.principals["gov1"]
    payload = {
        "identity_id": q.identity_id,
        "epoch": q.epoch,
        "event_id": old.event_id,
        "original_commitment": event_commitment(old),
        "timestamp": old.timestamp,
        "reason": "Authorized redaction",
    }
    q.mutation_manifest = [
        mutation(
            Op.DELETE_CHRONICLE_EVENT,
            "chronicle",
            {
                "event_id": old.event_id,
                "principal": principal,
                "reason": payload["reason"],
                "signature": sign("TOMBSTONE", payload, material.keys[principal]),
            },
        )
    ]
    authorize_application(f, material)
    assert verify(f).result == R.VALID
    return material, f

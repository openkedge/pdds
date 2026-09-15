"""Negative cryptographic properties start from fully VALID signed controls."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from cctbench.canonicalize import (
    canonicalize_json,
    compute_core_digest,
    compute_digest,
    compute_proposal_digest,
)
from cctbench.crypto import sign, unsigned
from cctbench.engine.apply import apply_mutations
from cctbench.generator.families import timestamp
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op

from .helpers import (
    attestation,
    reissue_attestations,
    reissue_authority,
    reissue_receipt,
    valid_case,
    verify,
)

pytestmark = pytest.mark.security
SEEDS = st.integers(min_value=0, max_value=2**32 - 1)
NONCES = st.text(
    alphabet=st.characters(exclude_categories=("Cs",)), min_size=1, max_size=18
)
TAMPERS = {
    "identity_id": "scope",
    "epoch": "scope",
    "predecessor_digest": "lineage_binding",
    "mutation_operation": "authority",
    "mutation_arguments": "authority",
    "precondition": "authority",
    "provenance_dependency": "provenance",
    "authority_principal": "authority",
    "authority_scope": "authority",
    "proposal_digest": "attestation_I_bel",
    "evaluator_identity": "attestation_I_bel",
    "evaluator_version": "attestation_I_bel",
    "policy_version": "attestation_I_bel",
    "attestation_result": "attestation_I_bel",
    "attestation_timestamp": "attestation_I_bel",
    "successor_state": "receipt_binding",
    "witness_core_digest": "receipt_binding",
    "commit_timestamp": "receipt_signature",
}


@pytest.mark.parametrize("field", list(TAMPERS))
@given(seed=SEEDS, nonce=NONCES)
def test_independent_signed_field_tampering(field, soundness, seed, nonce):
    material, f = valid_case(seed)
    w = f.transition_witness
    q = w.witness_core.proposal
    v = w.witness_core.validation_records[0]
    before = canonicalize_json(w)
    if field == "identity_id":
        q.identity_id += nonce
    elif field == "epoch":
        q.epoch += 1
    elif field == "predecessor_digest":
        q.predecessor_commitment = compute_digest(["different predecessor", nonce])
    elif field == "mutation_operation":
        q.mutation_manifest[0].op = Op.FORWARD_RESTORE
    elif field == "mutation_arguments":
        q.mutation_manifest[0].args["adapter"] += nonce
    elif field == "precondition":
        q.mutation_manifest[0].pre["required_snapshot"] = nonce
    elif field == "provenance_dependency":
        q.provenance_manifest.dependencies[0].digest = compute_digest(
            ["other evidence", nonce]
        )
    elif field == "authority_principal":
        q.authority_bundle.signers[0].principal = material.principals["outsider"]
    elif field == "authority_scope":
        q.authority_bundle.signers[0].scope = Op.UPDATE_RUNTIME_CONFIG.value
    elif field == "proposal_digest":
        v.proposal_digest = compute_digest(["other proposal", nonce])
    elif field == "evaluator_identity":
        v.evaluator = material.principals["eval3"]
    elif field == "evaluator_version":
        v.evaluator_version += nonce
    elif field == "policy_version":
        v.policy_version += nonce
    elif field == "attestation_result":
        v.status = S.FAIL
    elif field == "attestation_timestamp":
        v.timestamp = timestamp(f.candidate_successor.timestamp + 0.5)
    elif field == "successor_state":
        f.candidate_successor.runtime_config["adapter"] += nonce
    elif field == "witness_core_digest":
        w.commit_receipt.witness_core_digest = compute_digest(["other core", nonce])
    elif field == "commit_timestamp":
        w.commit_receipt.commit_timestamp = timestamp(
            f.candidate_successor.timestamp + 0.75
        )
    assert field == "successor_state" or canonicalize_json(w) != before
    soundness("binding/" + field, verify(f), {TAMPERS[field]: S.FAIL}, R.INVALID)


@pytest.mark.parametrize("reused", ["authority", "attestations", "core", "receipt"])
@given(seed=SEEDS)
def test_cross_identity_replay_with_identical_states_and_shared_keys(
    reused, soundness, seed
):
    material, a = valid_case(seed, identity="urn:security:A", copied=True)
    _, b = valid_case(seed, identity="urn:security:B", copied=True, material=material)
    assert canonicalize_json(a.predecessor_state) == canonicalize_json(
        b.predecessor_state
    )
    assert canonicalize_json(a.candidate_successor) == canonicalize_json(
        b.candidate_successor
    )
    assert a.verification_context.credentials == b.verification_context.credentials
    target = replay(reused, a, b, material)
    report = verify(b)
    if reused in ["authority", "attestations"]:
        assert report.checker_results["I_lin"] == S.PASS
    if reused == "receipt":
        assert report.condition_results["receipt_signature"].status == S.PASS
    soundness("cross-identity/" + reused, report, {target: S.FAIL}, R.INVALID)


def replay(reused, a, b, material):
    if reused == "authority":
        b.transition_witness.witness_core.proposal.authority_bundle = (
            a.transition_witness.witness_core.proposal.authority_bundle.model_copy(
                deep=True
            )
        )
        # Only outer layers are reissued: the replayed authority bytes remain untouched.
        reissue_attestations(b, material)
        reissue_receipt(b, material)
        return "authority"
    if reused == "attestations":
        b.transition_witness.witness_core.validation_records = [
            v.model_copy(deep=True)
            for v in a.transition_witness.witness_core.validation_records
        ]
        reissue_receipt(b, material)
        return "attestation_I_bel"
    if reused == "core":
        b.transition_witness.witness_core = (
            a.transition_witness.witness_core.model_copy(deep=True)
        )
        return "scope"
    b.transition_witness.commit_receipt = (
        a.transition_witness.commit_receipt.model_copy(deep=True)
    )
    return "receipt_binding"


@pytest.mark.parametrize("reused", ["authority", "attestations", "receipt"])
@given(seed=SEEDS, epoch=st.integers(min_value=4, max_value=10000))
def test_cross_epoch_replay(reused, soundness, seed, epoch):
    material, a = valid_case(seed, epoch=epoch, copied=True)
    _, b = valid_case(seed, epoch=epoch + 1, copied=True, material=material)
    target = replay(reused, a, b, material)
    soundness("cross-epoch/" + reused, verify(b), {target: S.FAIL}, R.INVALID)


@pytest.mark.parametrize("changed", ["Delta", "E"])
@given(seed=SEEDS, nonce=NONCES)
def test_attestation_cannot_transfer_to_changed_proposal(
    changed, soundness, seed, nonce
):
    material, f = valid_case(seed)
    q = f.transition_witness.witness_core.proposal
    old_digest = compute_proposal_digest(q)
    old_records = canonicalize_json(
        f.transition_witness.witness_core.validation_records
    )
    if changed == "Delta":
        q.mutation_manifest[0].args["adapter"] += nonce
        f.candidate_successor = apply_mutations(
            f.predecessor_state, q.mutation_manifest
        )
    else:
        dependency = q.provenance_manifest.dependencies[0]
        document = {"new resolved evidence": nonce}
        f.verification_context.evidence_store[dependency.uri] = document
        dependency.digest = compute_digest(document)
    reissue_authority(f, material)
    reissue_receipt(f, material)
    assert compute_proposal_digest(q) != old_digest
    assert (
        canonicalize_json(f.transition_witness.witness_core.validation_records)
        == old_records
    )
    report = verify(f)
    assert report.checker_results["I_lin"] == report.checker_results["I_auth"] == S.PASS
    soundness(
        "attestation/proposal-" + changed,
        report,
        {"attestation_I_bel": S.FAIL},
        R.INVALID,
        only=True,
    )


@pytest.mark.parametrize("change", ["add", "remove", "modify", "reorder"])
@given(seed=SEEDS)
def test_receipt_commits_validation_set_membership(change, soundness, seed):
    material, f = valid_case(seed)
    core = f.transition_witness.witness_core
    old_digest = compute_core_digest(core)
    receipt_before = canonicalize_json(f.transition_witness.commit_receipt)
    if change == "add":
        core.validation_records.append(attestation(f, material, "eval3"))
    elif change == "remove":
        core.validation_records.pop()
    elif change == "modify":
        v = core.validation_records[0]
        v.timestamp = timestamp(f.candidate_successor.timestamp + 0.5)
        v.signature = sign("ATTESTATION", unsigned(v), material.keys[v.evaluator])
    else:
        core.validation_records.reverse()
    assert canonicalize_json(f.transition_witness.commit_receipt) == receipt_before
    report = verify(f)
    assert report.condition_results["receipt_signature"].status == S.PASS
    if change == "reorder":
        assert compute_core_digest(core) == old_digest
        soundness(
            "core/set-permutation",
            report,
            {"receipt_binding": S.PASS},
            R.VALID,
            only=True,
        )
    else:
        assert compute_core_digest(core) != old_digest
        soundness("core/" + change, report, {"receipt_binding": S.FAIL}, R.INVALID)


@given(seed=SEEDS, version=st.integers(min_value=2, max_value=1000))
def test_protocol_version_replay_fails(soundness, seed, version):
    _, f = valid_case(seed)
    f.transition_witness.witness_version = f"{version}.0.0"
    soundness(
        "binding/protocol-version",
        verify(f),
        {"scope": S.FAIL, "receipt_signature": S.FAIL},
        R.INVALID,
    )

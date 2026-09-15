"""Orthogonality and trust-boundary regression tests."""

import pytest
from test_algorithm1_verifier import verify

from cctbench.canonicalize import (
    compute_core_digest,
    compute_proposal_digest,
    compute_state_digest,
)
from cctbench.crypto import sign, unsigned
from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S


def resign_receipt(f, m):
    rec = f.transition_witness.commit_receipt
    rec.witness_core_digest = compute_core_digest(f.transition_witness.witness_core)
    rec.successor_digest = compute_state_digest(f.candidate_successor)
    rec.kernel_signature = sign(
        "COMMIT-RECEIPT", unsigned(rec, "kernel_signature"), m.keys[rec.kernel_id]
    )


def test_i3_i7_are_orthogonal_and_lineage_only_is_blind():
    from cctbench.eval.baselines import evaluate_arm_d_cryptographic_lineage

    for family, target in [("I3", "I_norm"), ("I7", "I_auth")]:
        f = generate_fixture(create_identity(), family)
        r = verify(f)
        assert r.checker_results["I_lin"] == S.PASS
        assert {k for k, v in r.checker_results.items() if v != S.PASS} == {target}
        assert evaluate_arm_d_cryptographic_lineage(f).prediction == "VALID"
        if family == "I7":
            assert compute_state_digest(f.predecessor_state) == compute_state_digest(
                f.candidate_successor
            )


@pytest.mark.parametrize(
    "status,expected",
    [
        ("later_revoked", R.VALID),
        ("compromised", R.INVALID),
        ("unknown", R.INDETERMINATE),
    ],
)
def test_historical_key_semantics(status, expected):
    f = generate_fixture(create_identity(), "L8")
    ctx = f.verification_context
    cred = ctx.credentials[f.transition_witness.commit_receipt.kernel_id]
    if status == "later_revoked":
        cred.revoked_at_epoch = ctx.epoch + 1
    if status == "compromised":
        cred.compromised_from_epoch = ctx.epoch
    if status == "unknown":
        cred.historical_status_known = False
    assert verify(f).result == expected


def test_bad_signature_fails_even_with_unknown_historical_status():
    f = generate_fixture(create_identity(), "I9")
    f.verification_context.credentials[
        f.transition_witness.commit_receipt.kernel_id
    ].historical_status_known = False
    assert verify(f).result == R.INVALID


def test_duplicate_evaluator_cannot_inflate_quorum():
    m = create_identity()
    f = generate_fixture(m, "D4")
    records = f.transition_witness.witness_core.validation_records
    f.transition_witness.witness_core.validation_records = [
        records[0],
        records[0].model_copy(deep=True),
    ]
    resign_receipt(f, m)
    r = verify(f)
    assert r.checker_results["I_lin"] == S.PASS
    assert r.checker_results["I_bel"] == S.FAIL


def test_attestations_bind_proposal_not_finalized_core():
    f = generate_fixture(create_identity(), "D4")
    core = f.transition_witness.witness_core
    assert all(
        v.proposal_digest == compute_proposal_digest(core.proposal)
        for v in core.validation_records
    )
    assert "core_digest" not in core.validation_records[0].model_dump()
    assert (
        f.transition_witness.commit_receipt.witness_core_digest
        == compute_core_digest(core)
    )


def test_immutable_rule_weakening_not_just_deletion():
    from cctbench.verifier.checkers import check_normative

    f = generate_fixture(create_identity(), "L8")
    f.candidate_successor.normative_rules[
        "core"
    ].description = "No fiduciary obligation"
    assert (
        check_normative(f.predecessor_state, f.candidate_successor, f.policy)[0]
        == S.FAIL
    )


def test_temporal_allows_equal_history_max_and_unchanged_copy():
    f = generate_fixture(create_identity(), "I7")
    assert verify(f).checker_results["I_temp"] == S.PASS


def test_authority_and_application_ablation_do_not_disable_other_checks():
    f = generate_fixture(
        create_identity(), subset="compound_fault", case="authority_and_normative"
    )
    assert verify(f, ["I_auth"]).result == R.INVALID
    assert verify(f, ["I_norm"]).result == R.INVALID


def test_every_targeted_checker_ablation_admits_its_single_fault():
    from cctbench.generator.families import SINGLE_CASES

    for case, (_, _, checker) in SINGLE_CASES.items():
        f = generate_fixture(create_identity(), subset="single_fault", case=case)
        assert verify(f, [checker]).result == R.VALID, (
            case,
            verify(f, [checker]).reasons,
        )
    f = generate_fixture(
        create_identity(), subset="single_fault", case="attestation_conflict"
    )
    assert verify(f, ["attestation_resolution"]).result == R.VALID

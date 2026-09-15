"""Ternary dominance, full diagnostics, and actual cryptographic replay rejection."""

import pytest

from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.verifier.cct import verify_cognitive_continuity


def verify(f, disabled=()):
    return verify_cognitive_continuity(
        f.predecessor_state,
        f.transition_witness,
        f.candidate_successor,
        f.policy,
        f.verification_context,
        disabled,
    )


@pytest.mark.parametrize(
    "family,expected", [("L8", R.INDETERMINATE), ("I3", R.INVALID)]
)
def test_missing_receipt_does_not_mask_semantic_failure(family, expected):
    f = generate_fixture(create_identity(), family)
    f.transition_witness.commit_receipt = None
    result = verify(f)
    assert result.result == expected
    assert result.condition_results["receipt_binding"].status == S.UNKNOWN
    assert len(result.trace) == 13
    assert result.checker_results["I_auth"] == S.PASS
    if family == "I3":
        assert result.checker_results["I_norm"] == S.FAIL


def test_detached_clone_and_independent_failure():
    f = generate_fixture(create_identity(), "I7")
    f.transition_witness = None
    assert verify(f).result == R.INDETERMINATE
    del f.candidate_successor.normative_rules["core"]
    assert verify(f).result == R.INVALID


@pytest.mark.parametrize(
    "part", ["proposal", "receipt", "envelope", "authority", "validation"]
)
def test_tampered_signed_fields_never_validate(part):
    f = generate_fixture(create_identity(), "D4" if part == "validation" else "L8")
    w = f.transition_witness
    if part == "proposal":
        w.witness_core.proposal.epoch += 1
    elif part == "receipt":
        w.commit_receipt.commit_timestamp = "2026-01-01T00:00:00Z"
    elif part == "envelope":
        w.witness_version = "99.0.0"
    elif part == "authority":
        w.witness_core.proposal.authority_bundle.signers[0].role = "ATTACKER"
    else:
        w.witness_core.validation_records[0].evaluator_version = "99.0.0"
    assert verify(f).result == R.INVALID


def test_unknown_is_not_invalid_detection():
    from cctbench.eval.metrics import compute_evaluation_metrics

    m = compute_evaluation_metrics([R.INDETERMINATE], [R.INVALID])
    assert m["rates"]["IDR"]["estimate"] == 0
    assert m["rates"]["IAR"]["estimate"] == 0


def test_full_trace_keeps_multiple_failures_and_latency():
    f = generate_fixture(
        create_identity(), subset="compound_fault", case="authority_and_normative"
    )
    report = verify(f)
    assert (
        report.checker_results["I_auth"] == report.checker_results["I_norm"] == S.FAIL
    )
    assert len(report.stage_latency_ns) == 5
    assert sum(report.stage_latency_ns.values()) <= report.total_latency_ns
    assert report.signature_verification_ns

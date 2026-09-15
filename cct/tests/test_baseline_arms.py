"""Calibration leakage, exact memory denominator, and no fixture-label shortcuts."""

import pytest

from cctbench.eval.baselines import (
    HashingEmbedding,
    calibrate,
    evaluate_arm_a_state_similarity,
    evaluate_arm_b_memory_overlap,
    evaluate_arm_c_sit_only,
    evaluate_arm_d_cryptographic_lineage,
    evaluate_arm_e_full_cct,
    memory_overlap,
)
from cctbench.generator.base import create_identity
from cctbench.generator.dataset import generate_dataset, validate_split
from cctbench.generator.families import generate_fixture
from cctbench.schema.enums import CCTResult as R


def test_calibration_rejects_evaluation_identity():
    f = generate_fixture(create_identity())
    with pytest.raises(ValueError, match="development"):
        calibrate([f], HashingEmbedding())


def test_identity_and_artifact_leakage_are_rejected():
    fs, _, _ = generate_dataset(41, 1, 1, 1)
    dev = next(f for f in fs if f.split == "development")
    test = next(f for f in fs if f.split == "test")
    test.predecessor_state.working_memory = [dev.predecessor_state.working_memory[0]]
    with pytest.raises(ValueError, match="reused"):
        validate_split(fs)


def test_memory_set_overlap_uses_predecessor_denominator_and_deduplicates():
    f = generate_fixture(create_identity(), "L8")
    f.predecessor_state.working_memory = [{"v": 1}, {"v": 1}, {"v": 2}]
    f.candidate_successor.working_memory = [{"v": 1}, {"v": 2}, {"v": 3}]
    assert memory_overlap(f) == 1.0
    f.candidate_successor.working_memory = [{"v": 1}, {"v": 3}]
    assert memory_overlap(f) == 0.5


def test_family_or_oracle_label_changes_do_not_change_nonoracle_predictions():
    f = generate_fixture(create_identity(), "I3")
    funcs = [
        evaluate_arm_a_state_similarity,
        evaluate_arm_b_memory_overlap,
        evaluate_arm_c_sit_only,
        evaluate_arm_d_cryptographic_lineage,
        evaluate_arm_e_full_cct,
    ]
    before = [fn(f).prediction for fn in funcs]
    f.transition_family = "L1"
    f.ground_truth_label = R.VALID
    f.fixture_id = "unrelated-label"
    assert [fn(f).prediction for fn in funcs] == before
    assert evaluate_arm_c_sit_only(f).prediction is None
    assert evaluate_arm_c_sit_only(f).status == "unavailable"


def test_ternary_missing_head_mapping_is_explicit():
    f = generate_fixture(create_identity(), "D2")
    out = evaluate_arm_d_cryptographic_lineage(f)
    assert out.prediction == "INDETERMINATE"
    assert out.diagnostics["condition_results"]["canonical_head"]["status"] == "UNKNOWN"


@pytest.mark.parametrize(
    ("family", "expected"),
    [("I3", "VALID"), ("I7", "VALID"), ("I9", "INVALID")],
)
def test_lineage_arm_uses_only_lineage_evidence(family, expected):
    f = generate_fixture(create_identity(), family)
    assert evaluate_arm_d_cryptographic_lineage(f).prediction == expected

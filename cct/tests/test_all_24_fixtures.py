"""Executed taxonomy checks across independently generated identities and epochs."""

import pytest
from test_algorithm1_verifier import verify

from cctbench.generator.base import create_identity
from cctbench.generator.dataset import generate_dataset
from cctbench.generator.families import (
    COMPOUND_CASES,
    FAMILIES,
    SINGLE_CASES,
    generate_fixture,
)
from cctbench.schema.enums import CheckStatus as S


@pytest.mark.parametrize("seed", [101, 999])
@pytest.mark.parametrize("family", list(FAMILIES))
def test_all_families(seed, family):
    f = generate_fixture(create_identity(seed, f"urn:test:{seed}"), family)
    assert verify(f).result == f.ground_truth_label


@pytest.mark.parametrize("case", list(SINGLE_CASES))
def test_exactly_one_nonpass_condition(case):
    f = generate_fixture(create_identity(), subset="single_fault", case=case)
    report = verify(f)
    bad = [k for k, v in report.condition_results.items() if v.status != S.PASS]
    assert bad == f.target_conditions
    assert report.result == f.ground_truth_label
    assert all(
        v.status == S.PASS for k, v in report.condition_results.items() if k not in bad
    )


@pytest.mark.parametrize("case", COMPOUND_CASES)
def test_compound_faults_are_real_conditions(case):
    f = generate_fixture(create_identity(), subset="compound_fault", case=case)
    report = verify(f)
    assert sum(v.status != S.PASS for v in report.trace) >= 2
    assert report.result == f.ground_truth_label


def test_multiepoch_dataset_has_real_source_chain():
    fixtures, histories, seeds = generate_dataset(73, 1, 1, 3)
    assert len(fixtures) == 2 * 3 * (24 + 20 + 4)
    for identity in seeds:
        source = [h for h in histories if h["identity_id"] == identity["identity_id"]]
        from cctbench.canonicalize import compute_state_digest

        for first, next_ in zip(source, source[1:]):
            assert first["successor_digest"] == compute_state_digest(
                next_["source_state"]
            )

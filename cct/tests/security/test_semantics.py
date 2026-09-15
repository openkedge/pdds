"""Authentic commits do not replace normative, historical, or temporal correctness."""

from dataclasses import replace

import pytest
from hypothesis import given
from hypothesis import strategies as st

from cctbench.canonicalize import canonicalize_json
from cctbench.eval.baselines import evaluate_arm_d_cryptographic_lineage
from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture, mutation
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op
from cctbench.schema.state import BeliefEntry
from cctbench.schema.witness import AuthorityBundle, Signer

from .helpers import (
    attestation,
    authorize_application,
    reissue_receipt,
    tombstone_case,
    valid_case,
    verify,
)

pytestmark = pytest.mark.security
SEEDS = st.integers(min_value=0, max_value=2**32 - 1)


@given(seed=SEEDS)
def test_proposition_two_authority_cannot_amend_nonamendable_core(soundness, seed):
    material, f = valid_case(seed, attested=False)
    q = f.transition_witness.witness_core.proposal
    assert f.predecessor_state.normative_rules["core"].non_amendable
    assert len(q.authority_bundle.signers) >= f.policy.normative_amendment_threshold
    q.mutation_manifest = [
        mutation(Op.DELETE_NORMATIVE_RULE, "normative_rules", {"rule_id": "core"})
    ]
    authorize_application(f, material)
    soundness(
        "normative/Proposition-2",
        verify(f),
        {"I_lin": S.PASS, "authority": S.PASS, "I_norm": S.FAIL},
        R.INVALID,
    )


@given(seed=SEEDS)
def test_unauthorized_copied_state_succession_is_not_receipt_forgery(soundness, seed):
    material, f = valid_case(seed, copied=True, attested=False)
    assert canonicalize_json(f.predecessor_state) == canonicalize_json(
        f.candidate_successor
    )
    q = f.transition_witness.witness_core.proposal
    q.authority_bundle = AuthorityBundle(
        signers=[
            Signer(principal=material.principals["outsider"], role="IDENTITY_CUSTODIAN")
        ]
    )
    authorize_application(f, material)
    report = verify(f)
    assert {k for k, v in report.checker_results.items() if v != S.PASS} == {"I_auth"}
    assert evaluate_arm_d_cryptographic_lineage(f).prediction == "VALID"
    soundness(
        "succession/I7-authentic-lineage-unauthorized-authority",
        report,
        {"I_lin": S.PASS, "authority": S.FAIL, "state_application": S.PASS},
        R.INVALID,
    )


@given(seed=SEEDS)
def test_witnessless_clone_is_indeterminate(soundness, seed):
    _, f = valid_case(seed, copied=True, attested=False)
    f.transition_witness = None
    report = verify(f)
    assert S.FAIL not in {v.status for v in report.trace}
    soundness(
        "succession/clone-no-witness",
        report,
        {"I_lin": S.UNKNOWN, "authority": S.UNKNOWN},
        R.INDETERMINATE,
    )


@pytest.mark.parametrize(
    "case",
    [
        "append",
        "correction",
        "tombstone",
        "silent-deletion",
        "content-rewrite",
        "fabricated-acquisition",
        "tombstone-without-commitment",
        "reorder",
    ],
)
@given(seed=SEEDS)
def test_historical_preservation(case, soundness, seed):
    if case == "tombstone" or case == "tombstone-without-commitment":
        material, f = tombstone_case(seed)
        if case == "tombstone-without-commitment":
            f.candidate_successor.chronicle[-1].original_commitment = None
            reissue_receipt(f, material)
    elif case in ["append", "correction", "fabricated-acquisition"]:
        material = create_identity(seed, "urn:security:history")
        f = generate_fixture(material, "L7" if case == "correction" else "L2")
        assert verify(f).result == R.VALID
        if case == "fabricated-acquisition":
            f.transition_witness.witness_core.proposal.mutation_manifest[0].args[
                "event"
            ]["content"] += ": fabricated"
            authorize_application(f, material)
    else:
        material, f = valid_case(seed, attested=False)
        events = f.predecessor_state.chronicle
        if case == "silent-deletion":
            op = mutation(
                Op.REMOVE_CHRONICLE, "chronicle", {"event_id": events[0].event_id}
            )
        elif case == "content-rewrite":
            op = mutation(
                Op.REWRITE_CHRONICLE,
                "chronicle",
                {
                    "event_id": events[0].event_id,
                    "content": "Affirmatively rewritten autobiography",
                },
            )
        else:
            op = mutation(
                Op.REORDER_CHRONICLE,
                "chronicle",
                {"order": [e.event_id for e in reversed(events)]},
            )
        f.transition_witness.witness_core.proposal.mutation_manifest = [op]
        authorize_application(f, material)
    allowed = case in ["append", "correction", "tombstone"]
    report = verify(f)
    assert report.checker_results["I_lin"] == report.checker_results["I_auth"] == S.PASS
    # An erased tombstone commitment is a known preservation violation, not an unavailable external proof.
    soundness(
        "historical/" + case,
        report,
        {"I_hist": S.PASS if allowed else S.FAIL},
        R.VALID if allowed else R.INVALID,
    )


@pytest.mark.parametrize(
    "case",
    [
        "acquisition",
        "backdated-knowledge",
        "no-new-event",
        "tombstone-retains-max",
        "rollback-lower-max",
        "remove-prior-tombstone-max",
    ],
)
@given(seed=SEEDS, backdate=st.integers(min_value=1, max_value=100000))
def test_temporal_history_max_and_acquisition(case, soundness, seed, backdate):
    if case in ["acquisition", "backdated-knowledge"]:
        material = create_identity(seed, "urn:security:temporal")
        f = generate_fixture(material, "L1")
        assert verify(f).result == R.VALID
        if case == "backdated-knowledge":
            q = f.transition_witness.witness_core.proposal
            q.mutation_manifest[0].args["value"]["claimed_at"] -= backdate
            authorize_application(f, material)
    elif case in ["tombstone-retains-max", "remove-prior-tombstone-max"]:
        material, f = tombstone_case(seed)
        assert max(
            e.timestamp for e in f.candidate_successor.chronicle if not e.tombstone
        ) < max(e.timestamp for e in f.candidate_successor.chronicle)
        if case == "remove-prior-tombstone-max":
            material = replace(
                material, state=f.candidate_successor.model_copy(deep=True)
            )
            _, f = valid_case(seed, material=material, attested=False)
            q = f.transition_witness.witness_core.proposal
            q.mutation_manifest = [
                mutation(
                    Op.REMOVE_CHRONICLE,
                    "chronicle",
                    {"event_id": f.predecessor_state.chronicle[-1].event_id},
                )
            ]
            authorize_application(f, material)
    else:
        material, f = valid_case(seed, attested=False)
        if case == "rollback-lower-max":
            q = f.transition_witness.witness_core.proposal
            q.mutation_manifest = [
                mutation(
                    Op.REMOVE_CHRONICLE,
                    "chronicle",
                    {"event_id": f.predecessor_state.chronicle[-1].event_id},
                )
            ]
            authorize_application(f, material)
        else:
            assert f.candidate_successor.chronicle == f.predecessor_state.chronicle
    fail = case in [
        "backdated-knowledge",
        "rollback-lower-max",
        "remove-prior-tombstone-max",
    ]
    report = verify(f)
    assert report.checker_results["I_lin"] == report.checker_results["I_auth"] == S.PASS
    soundness(
        "temporal/" + case,
        report,
        {"I_temp": S.FAIL if fail else S.PASS},
        R.INVALID if fail else R.VALID,
    )


@given(seed=SEEDS)
def test_signed_unused_attestation_cannot_override_native_history(soundness, seed):
    material, f = valid_case(seed, attested=True)
    f.transition_witness.witness_core.proposal.mutation_manifest = [
        mutation(
            Op.REWRITE_CHRONICLE,
            "chronicle",
            {
                "event_id": f.predecessor_state.chronicle[0].event_id,
                "content": "A signed falsehood remains false",
            },
        )
    ]
    authorize_application(f, material)
    f.transition_witness.witness_core.validation_records.extend(
        [
            attestation(f, material, name, check_id="I_hist")
            for name in ["eval1", "eval2"]
        ]
    )
    reissue_receipt(f, material)
    report = verify(f)
    soundness(
        "semantics/signatures-do-not-replace-native-history",
        report,
        {
            "I_lin": S.PASS,
            "authority": S.PASS,
            "attestation_I_bel": S.PASS,
            "I_hist": S.FAIL,
        },
        R.INVALID,
    )


@given(seed=SEEDS)
def test_authenticated_negative_attestation_quorum_is_still_failure(soundness, seed):
    material, f = valid_case(seed)
    f.transition_witness.witness_core.validation_records = [
        attestation(f, material, name, status=S.FAIL) for name in ["eval1", "eval2"]
    ]
    reissue_receipt(f, material)
    soundness(
        "semantics/authentic-negative-quorum",
        verify(f),
        {"I_lin": S.PASS, "attestation_I_bel": S.FAIL},
        R.INVALID,
    )


@given(seed=SEEDS)
def test_belief_justification_absence_is_unknown_but_lost_history_is_failure(
    soundness, seed
):
    material, f = valid_case(seed, attested=False)
    q = f.transition_witness.witness_core.proposal
    q.mutation_manifest = [
        mutation(
            Op.REVISE_BELIEF,
            "beliefs",
            {"proposition_id": "hypothesis", "new_value": True},
        )
    ]
    authorize_application(f, material)
    soundness(
        "belief/missing-justification",
        verify(f),
        {"I_bel": S.UNKNOWN, "provenance": S.UNKNOWN},
        R.INDETERMINATE,
        only=True,
    )
    f.candidate_successor.beliefs["hypothesis"].history = []
    reissue_receipt(f, material)
    soundness(
        "belief/missing-justification+lost-history",
        verify(f),
        {"I_bel": S.FAIL},
        R.INVALID,
    )


@given(seed=SEEDS, reverse=st.booleans())
def test_missing_justification_cannot_mask_another_rewritten_belief(
    soundness, seed, reverse
):
    material = create_identity(seed, "urn:security:belief")
    material.state.beliefs["other"] = BeliefEntry(
        proposition_id="other", value=False, epoch_established=1, epoch_last_revised=1
    )
    if reverse:
        material.state.beliefs = dict(reversed(list(material.state.beliefs.items())))
    _, f = valid_case(seed, attested=False, material=material)
    q = f.transition_witness.witness_core.proposal
    q.mutation_manifest = [
        mutation(
            Op.REVISE_BELIEF,
            "beliefs",
            {"proposition_id": "hypothesis", "new_value": True},
        ),
        mutation(
            Op.RETROACTIVE_BELIEF,
            "beliefs",
            {"proposition_id": "other", "epoch_established": 0},
            index=1,
        ),
    ]
    authorize_application(f, material)
    soundness(
        "belief/FAIL-dominates-UNKNOWN-regardless-of-order",
        verify(f),
        {"I_bel": S.FAIL, "provenance": S.UNKNOWN},
        R.INVALID,
        only=True,
    )

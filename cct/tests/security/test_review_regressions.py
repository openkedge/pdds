"""Signed semantic attacks found during independent review, plus admissible controls."""

import pytest

from cctbench.canonicalize import compute_digest
from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture, mutation
from cctbench.schema.enums import CCTResult as R, CheckStatus as S, MutationOp as Op
from cctbench.schema.witness import ProvenanceManifest
from .helpers import authorize_application, verify

pytestmark = pytest.mark.security


def native_case():
    material = create_identity(17, "urn:review:regression")
    return material, generate_fixture(material, "L8")


def set_evidence(f, data):
    q = f.transition_witness.witness_core.proposal
    dep = q.provenance_manifest.dependencies[0]
    payload = {"identity_id": q.identity_id, "epoch": q.epoch, **data}
    f.verification_context.evidence_store[dep.uri] = payload
    dep.digest = compute_digest(payload)
    return dep.dep_id


def assert_authentic(f, verdict):
    report = verify(f)
    assert report.checker_results["I_lin"] == S.PASS
    assert report.checker_results["I_auth"] == S.PASS
    assert report.condition_results["state_application"].status == S.PASS
    assert not f.transition_witness.witness_core.validation_records
    assert report.result == verdict, report.reasons
    return report


def relation_update(material, ids, increment, tier="DEFAULT", *, records=None):
    f = generate_fixture(material, "L8")
    prior = f.predecessor_state.relationships["stranger"].interaction_ids
    records = records if records is not None else [
        {"session_id": sid, "entity_id": "stranger", "positive": True,
         "acquired_at": f.predecessor_state.timestamp}
        for sid in prior + ids
    ]
    ref = set_evidence(f, {"interaction_records": records})
    f.transition_witness.witness_core.proposal.mutation_manifest = [mutation(
        Op.UPDATE_TRUST_TIER, "relationships",
        {"entity_id": "stranger", "trust_tier": tier,
         "interaction_increment": increment, "interaction_ids": ids}, ref)]
    authorize_application(f, material)
    return f


def test_fabricated_count_cannot_seed_later_privilege():
    material, f = native_case()
    q = f.transition_witness.witness_core.proposal
    q.provenance_manifest = ProvenanceManifest()
    q.mutation_manifest = [mutation(Op.UPDATE_TRUST_TIER, "relationships", {
        "entity_id": "stranger", "trust_tier": "DEFAULT", "interaction_increment": 5})]
    authorize_application(f, material)
    report = assert_authentic(f, R.INVALID)
    assert report.checker_results["I_rel"] == S.FAIL


def test_logged_count_then_elevation_and_replayed_sessions():
    material, _ = native_case()
    ids = [f"session-{i}" for i in range(5)]
    first = relation_update(material, ids, 5)
    assert_authentic(first, R.VALID)
    material.state = first.candidate_successor.model_copy(deep=True)
    material.context = first.verification_context.model_copy(deep=True)
    second = relation_update(material, [], 0, "HIGH")
    assert_authentic(second, R.VALID)
    replay = relation_update(material, ids, 5)
    assert assert_authentic(replay, R.INVALID).checker_results["I_rel"] == S.FAIL


@pytest.mark.parametrize("change", ["entity", "negative", "future", "scope", "count"])
def test_relational_evidence_must_support_update(change):
    material, _ = native_case()
    f = relation_update(material, ["real-session"], 1)
    q = f.transition_witness.witness_core.proposal
    dep = q.provenance_manifest.dependencies[0]
    evidence = f.verification_context.evidence_store[dep.uri]
    record = evidence["interaction_records"][0]
    if change == "entity": record["entity_id"] = "another-user"
    elif change == "negative": record["positive"] = False
    elif change == "future": record["acquired_at"] = f.candidate_successor.timestamp + 1
    elif change == "scope": evidence["identity_id"] = "another-identity"
    else: q.mutation_manifest[0].args["interaction_increment"] = 5
    dep.digest = compute_digest(evidence)
    authorize_application(f, material)
    assert assert_authentic(f, R.INVALID).checker_results["I_rel"] == S.FAIL


@pytest.mark.parametrize("kind", ["new", "value", "metadata"])
@pytest.mark.parametrize("support", ["missing", "irrelevant", "valid"])
def test_every_changed_belief_requires_matching_support(kind, support):
    material, f = native_case()
    q = f.transition_witness.witness_core.proposal
    key = "new-proposition" if kind == "new" else "hypothesis"
    value = False if kind == "metadata" else True
    data = {"belief_revision": {"proposition_id": key, "value": value, "confidence": 1.0}}
    ref = set_evidence(f, data if support == "valid" else {"unrelated": "weather"})
    if support == "missing":
        ref = None
        q.provenance_manifest = ProvenanceManifest()
    q.mutation_manifest = [mutation(Op.REVISE_BELIEF, "beliefs", {
        "proposition_id": key, "new_value": value}, ref)]
    authorize_application(f, material)
    expected = {"missing": R.INDETERMINATE, "irrelevant": R.INVALID, "valid": R.VALID}[support]
    report = assert_authentic(f, expected)
    assert report.checker_results["I_bel"] == {
        "missing": S.UNKNOWN, "irrelevant": S.FAIL, "valid": S.PASS}[support]


@pytest.mark.parametrize("field", ["parent_digest", "proposal_digest", "successor_digest"])
def test_unresolved_head_exclusivity_cannot_mask_wrong_binding(field):
    _, f = native_case()
    head = f.verification_context.head_evidence
    head.exclusive = None
    assert verify(f).result == R.INDETERMINATE
    setattr(head, field, compute_digest("different-object"))
    report = verify(f)
    assert report.condition_results["canonical_head"].status == S.FAIL
    assert report.result == R.INVALID


@pytest.mark.parametrize("family", ["L1", "L2", "L3", "L4", "L5", "L7", "L9", "L10"])
def test_required_operation_evidence_cannot_be_omitted(family):
    material, _ = native_case()
    f = generate_fixture(material, family)
    assert_authentic(f, R.VALID)
    q = f.transition_witness.witness_core.proposal
    for operation in q.mutation_manifest:
        operation.justification_ref = None
    q.provenance_manifest = ProvenanceManifest()
    authorize_application(f, material)
    report = verify(f)
    assert report.checker_results["I_prov"] == S.UNKNOWN
    assert report.result != R.VALID


def test_canonical_fabrication_is_a_single_historical_fault():
    material, _ = native_case()
    f = generate_fixture(material, "I1")
    report = verify(f)
    assert {k for k, v in report.checker_results.items() if v != S.PASS} == {"I_hist"}
    assert report.result == R.INVALID

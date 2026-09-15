"""Failures must follow authenticated contents, scope, and evidence availability."""

import pytest
from test_algorithm1_verifier import verify
from test_checkers import resign_receipt

from cctbench.canonicalize import (
    compute_digest,
    compute_state_digest,
    strict_json_loads,
)
from cctbench.crypto import authority_payload, sign, unsigned
from cctbench.engine.apply import apply_mutations, event_commitment
from cctbench.generator.base import create_identity
from cctbench.generator.families import finalize, generate_fixture, mutation, timestamp
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op
from cctbench.schema.witness import Proposal
from cctbench.verifier.checkers import check_historical_chronicle


@pytest.mark.parametrize(
    "text",
    [
        '{"a":1,"a":2}',
        '{"nested":{"a":0,"a":1}}',
        "[NaN]",
        "[1e999]",
        "[9007199254740992]",
    ],
)
def test_wire_parser_rejects_ambiguous_or_non_jcs_inputs(text):
    with pytest.raises(ValueError):
        strict_json_loads(text)


def test_application_arrays_are_ordered_even_when_named_like_schema_sets():
    state = create_identity().state
    state.knowledge["document"] = {
        "signers": ["alice", "bob"],
        "scopes": ["first", "second"],
    }
    before = compute_state_digest(state)
    state.knowledge["document"]["signers"].reverse()
    assert compute_state_digest(state) != before


def test_authority_preimage_is_the_augmented_unsigned_proposal():
    q = generate_fixture(
        create_identity(), "L8"
    ).transition_witness.witness_core.proposal
    signer = q.authority_bundle.signers[0]
    payload = authority_payload(q, signer)
    assert payload["identity_id"] == q.identity_id
    assert payload["principal"] == signer.principal
    assert "authority_bundle" not in payload and "proposal" not in payload


def test_omitted_provenance_field_remains_missing():
    m = create_identity()
    f = generate_fixture(m, "L8")
    data = f.transition_witness.witness_core.proposal.model_dump()
    del data["provenance_manifest"]
    q = Proposal.model_validate(data)
    assert q.provenance_manifest is None
    f.transition_witness = finalize(
        m, q, f.candidate_successor, f.policy, f.verification_context
    )
    assert verify(f).result == R.INDETERMINATE


def attested_pass():
    m = create_identity()
    f = generate_fixture(m, "D4")
    records = f.transition_witness.witness_core.validation_records[:2]
    f.transition_witness.witness_core.validation_records = records
    resign_receipt(f, m)
    assert verify(f).result == R.VALID
    return m, f


@pytest.mark.parametrize("offset", [-4000, 4000])
def test_signed_stale_or_future_attestation_is_rejected(offset):
    m, f = attested_pass()
    record = f.transition_witness.witness_core.validation_records[0]
    record.timestamp = timestamp(f.verification_context.validation_time + offset)
    record.signature = sign("ATTESTATION", unsigned(record), m.keys[record.evaluator])
    resign_receipt(f, m)
    result = verify(f)
    assert result.checker_results["I_lin"] == S.PASS
    assert result.checker_results["I_bel"] == S.FAIL
    assert "freshness" in result.condition_results["attestation_I_bel"].reason


def test_missing_freshness_context_is_unknown():
    _, f = attested_pass()
    f.verification_context.validation_time = None
    assert verify(f).result == R.INDETERMINATE


def test_d4_contains_two_opposing_authenticated_quorums():
    f = generate_fixture(create_identity(), "D4")
    records = f.transition_witness.witness_core.validation_records
    assert sum(v.status == S.PASS for v in records) == f.policy.evaluator_quorum_size
    assert sum(v.status == S.FAIL for v in records) == f.policy.evaluator_quorum_size
    assert verify(f).result == R.INDETERMINATE


def test_backdating_cannot_be_hidden_by_changing_event_metadata():
    m = create_identity()
    f = generate_fixture(m, "L2")
    q = f.transition_witness.witness_core.proposal
    q.mutation_manifest[0].args["event"]["timestamp"] = m.state.timestamp - 1
    q.mutation_manifest[0].args["event"]["metadata"]["acquired_at"] = 0
    f.candidate_successor = apply_mutations(m.state, q.mutation_manifest)
    f.transition_witness = finalize(
        m, q, f.candidate_successor, f.policy, f.verification_context
    )
    result = verify(f)
    assert {k for k, v in result.checker_results.items() if v != S.PASS} == {"I_temp"}


def test_acquisition_evidence_must_be_committed_in_proposal():
    m = create_identity()
    f = generate_fixture(m, "L2")
    q = f.transition_witness.witness_core.proposal
    q.provenance_manifest.dependencies = []
    q.provenance_manifest.source_citations = []
    q.mutation_manifest[0].justification_ref = None
    f.transition_witness = finalize(
        m, q, f.candidate_successor, f.policy, f.verification_context
    )
    result = verify(f)
    assert {k for k, v in result.checker_results.items() if v != S.PASS} == {"I_prov"}
    assert result.result == R.INDETERMINATE


def test_evidence_is_verified_by_contents_not_marker_text():
    m = create_identity()
    f = generate_fixture(m, "L8")
    q = f.transition_witness.witness_core.proposal
    dependency = q.provenance_manifest.dependencies[0]
    dependency.uri = "source://corrupted-forged-unreachable"
    data = {"text": "forged, missing, and corrupt are ordinary document words"}
    f.verification_context.evidence_store[dependency.uri] = data
    dependency.digest = compute_digest(data)
    f.transition_witness = finalize(
        m, q, f.candidate_successor, f.policy, f.verification_context
    )
    assert verify(f).result == R.VALID
    f.verification_context.evidence_store[dependency.uri]["text"] = "actual byte change"
    assert verify(f).checker_results["I_prov"] == S.FAIL


def test_authenticated_tombstone_preserves_history_and_temporal_order():
    m = create_identity()
    f = generate_fixture(m, "L8")
    q = f.transition_witness.witness_core.proposal
    old = m.state.chronicle[0]
    principal = m.principals["gov1"]
    reason = "Policy-authorized redaction"
    payload = {
        "identity_id": q.identity_id,
        "epoch": q.epoch,
        "event_id": old.event_id,
        "original_commitment": event_commitment(old),
        "timestamp": old.timestamp,
        "reason": reason,
    }
    q.mutation_manifest = [
        mutation(
            Op.DELETE_CHRONICLE_EVENT,
            "chronicle",
            {
                "event_id": old.event_id,
                "reason": reason,
                "principal": principal,
                "signature": sign("TOMBSTONE", payload, m.keys[principal]),
            },
        )
    ]
    f.candidate_successor = apply_mutations(m.state, q.mutation_manifest)
    f.transition_witness = finalize(
        m, q, f.candidate_successor, f.policy, f.verification_context
    )
    assert verify(f).result == R.VALID
    tombstone = f.candidate_successor.chronicle[0]
    assert tombstone.timestamp == old.timestamp and tombstone.epoch == old.epoch
    tombstone.original_commitment = compute_digest("different past")
    assert (
        check_historical_chronicle(
            m.state, f.candidate_successor, q, f.policy, f.verification_context, "1.0.0"
        )[0]
        == S.FAIL
    )


def test_forgetting_operation_rejects_live_context():
    m = create_identity()
    live = m.state.working_memory[-1]
    with pytest.raises(ValueError, match="expired"):
        apply_mutations(
            m.state,
            [
                mutation(
                    Op.PRUNE_EXPIRED_CONTEXT,
                    "working_memory",
                    {"session_id": live["session_id"]},
                )
            ],
        )

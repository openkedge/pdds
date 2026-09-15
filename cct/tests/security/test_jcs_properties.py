"""JCS key order, exact numeric/string semantics, and schema-specific array order."""

import json
import random

import pytest
from hypothesis import given
from hypothesis import strategies as st

from cctbench.canonicalize import (
    canonicalize_json,
    compute_core_digest,
    compute_digest,
    compute_proposal_digest,
    compute_state_digest,
    normalize_wire,
    strict_json_loads,
)
from cctbench.engine.apply import apply_mutations
from cctbench.generator.base import create_identity
from cctbench.generator.families import mutation
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.enums import MutationOp as Op
from cctbench.schema.state import CognitiveState
from cctbench.schema.witness import TransitionWitness

from .helpers import (
    attestation,
    authorize_application,
    reissue_receipt,
    valid_case,
    verify,
)

pytestmark = pytest.mark.security
SEEDS = st.integers(min_value=0, max_value=2**32 - 1)
TEXT = st.text(alphabet=st.characters(exclude_categories=("Cs",)), max_size=14)
SCALARS = (
    st.none()
    | st.booleans()
    | st.integers(-(2**53 - 1), 2**53 - 1)
    | st.floats(-1e6, 1e6, allow_nan=False, allow_infinity=False)
    | TEXT
)
JSON = st.recursive(
    SCALARS,
    lambda children: (
        st.lists(children, max_size=4) | st.dictionaries(TEXT, children, max_size=4)
    ),
    max_leaves=16,
)


def permute_keys(value, rng):
    if isinstance(value, dict):
        keys = list(value)
        rng.shuffle(keys)
        return {key: permute_keys(value[key], rng) for key in keys}
    if isinstance(value, list):
        return [permute_keys(item, rng) for item in value]
    return value


@given(seed=SEEDS, document=JSON)
def test_jcs_object_key_permutations_preserve_all_signed_bindings(
    soundness, seed, document
):
    material = create_identity(seed, "urn:security:jcs")
    material.state.runtime_config["application_document"] = document
    _, f = valid_case(seed, material=material)
    rng = random.Random(seed)
    permuted = permute_keys(document, rng)
    assert canonicalize_json(document) == canonicalize_json(permuted)
    assert compute_digest(document) == compute_digest(permuted)
    assert canonicalize_json(
        strict_json_loads(canonicalize_json(document))
    ) == canonicalize_json(document)
    old_q = compute_proposal_digest(f.transition_witness.witness_core.proposal)
    old_core = compute_core_digest(f.transition_witness.witness_core)
    f.transition_witness = TransitionWitness.model_validate(
        permute_keys(f.transition_witness.model_dump(mode="json"), rng)
    )
    f.predecessor_state = CognitiveState.model_validate(
        permute_keys(f.predecessor_state.model_dump(mode="json"), rng)
    )
    f.candidate_successor = CognitiveState.model_validate(
        permute_keys(f.candidate_successor.model_dump(mode="json"), rng)
    )
    assert old_q == compute_proposal_digest(f.transition_witness.witness_core.proposal)
    assert old_core == compute_core_digest(f.transition_witness.witness_core)
    soundness(
        "canonicalization/object-key-permutations",
        verify(f),
        {"I_lin": S.PASS, "authority": S.PASS, "attestation_I_bel": S.PASS},
        R.VALID,
    )


@given(seed=SEEDS, order=st.data(), evaluators=st.integers(2, 4))
def test_signer_and_evaluator_sets_have_canonical_member_order(
    soundness, seed, order, evaluators
):
    material, f = valid_case(seed)
    core = f.transition_witness.witness_core
    core.validation_records = [
        attestation(f, material, f"eval{i}") for i in range(1, evaluators + 1)
    ]
    reissue_receipt(f, material)
    assert verify(f).result == R.VALID
    q_digest = compute_proposal_digest(core.proposal)
    core_digest = compute_core_digest(core)
    signers = core.proposal.authority_bundle.signers
    core.proposal.authority_bundle.signers = [
        signers[i]
        for i in order.draw(st.permutations(range(len(signers))), label="signers")
    ]
    records = core.validation_records
    core.validation_records = [
        records[i]
        for i in order.draw(st.permutations(range(len(records))), label="evaluators")
    ]
    normalized = normalize_wire(core)
    assert normalized["proposal"]["authority_bundle"]["signers"] == sorted(
        [s.model_dump(mode="json") for s in signers], key=canonicalize_json
    )
    assert normalized["validation_records"] == sorted(
        [v.model_dump(mode="json") for v in records], key=canonicalize_json
    )
    assert compute_proposal_digest(core.proposal) == q_digest
    assert compute_core_digest(core) == core_digest
    soundness(
        "canonicalization/signer-evaluator-set-order",
        verify(f),
        {"receipt_binding": S.PASS, "authority": S.PASS, "attestation_I_bel": S.PASS},
        R.VALID,
    )


@given(
    seed=SEEDS,
    values=st.lists(st.integers(-10000, 10000), min_size=2, max_size=6, unique=True),
)
def test_ordered_mutation_permutations_change_commitments_and_application(
    soundness, seed, values
):
    material, f = valid_case(seed)
    q = f.transition_witness.witness_core.proposal
    q.mutation_manifest = [
        mutation(
            Op.UPDATE_RUNTIME_CONFIG, "runtime_config", {"adapter": str(value)}, index=i
        )
        for i, value in enumerate(values)
    ]
    authorize_application(f, material)
    assert verify(f).result == R.VALID
    original = compute_proposal_digest(q)
    successor = compute_state_digest(f.candidate_successor)
    q.mutation_manifest.reverse()
    assert compute_proposal_digest(q) != original
    assert (
        compute_state_digest(apply_mutations(f.predecessor_state, q.mutation_manifest))
        != successor
    )
    soundness(
        "canonicalization/ordered-mutations",
        verify(f),
        {"authority": S.FAIL, "receipt_binding": S.FAIL},
        R.INVALID,
    )


@pytest.mark.parametrize(
    "name", ["signers", "validation_records", "dependencies", "scopes"]
)
@given(
    seed=SEEDS,
    values=st.lists(st.integers(-10000, 10000), min_size=2, max_size=6, unique=True),
)
def test_application_arrays_are_not_mistaken_for_schema_sets(
    name, soundness, seed, values
):
    material = create_identity(seed, "urn:security:application")
    material.state.runtime_config["application_document"] = {name: values}
    _, f = valid_case(seed, material=material)
    original = compute_state_digest(f.candidate_successor)
    f.candidate_successor.runtime_config["application_document"][name].reverse()
    assert compute_state_digest(f.candidate_successor) != original
    soundness(
        "canonicalization/application-array-" + name,
        verify(f),
        {"receipt_binding": S.FAIL},
        R.INVALID,
    )


@given(keys=st.sets(TEXT, min_size=1, max_size=12))
def test_rfc_utf16_key_sorting(keys):
    document = {key: 0 for key in keys}
    actual = list(json.loads(canonicalize_json(document)))
    assert actual == sorted(keys, key=lambda key: key.encode("utf-16-be"))


@given(value=st.integers(-1000000, 1000000))
def test_equivalent_integral_numbers_and_negative_zero(value):
    assert compute_digest({"n": value}) == compute_digest({"n": float(value)})
    assert canonicalize_json(-0.0) == canonicalize_json(0.0) == b"0"
    assert compute_digest("\u00e9") != compute_digest("e\u0301")


@given(document=JSON)
def test_domain_and_protocol_version_are_part_of_every_digest(document):
    domains = [
        "STATE",
        "PROPOSAL",
        "WITNESS-CORE",
        "AUTHORITY",
        "ATTESTATION",
        "COMMIT-RECEIPT",
    ]
    assert (
        len(
            {
                compute_digest(document, kind, version)
                for kind in domains
                for version in ["1.0.0", "2.0.0"]
            }
        )
        == 12
    )

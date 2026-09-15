"""RFC 8785 boundary vectors and cryptographic domain separation."""

import pytest

from cctbench.canonicalize import (
    canonicalize_json,
    compute_digest,
    compute_proposal_digest,
    compute_state_digest,
)
from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture


def test_rfc_number_vector_and_negative_zero():
    assert (
        canonicalize_json(
            [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0.0, 1e-6, 1e-7]
        )
        == b"[333333333.3333333,1e+30,4.5,0.002,1e-27,0,0.000001,1e-7]"
    )


def test_utf16_ordering():
    assert (
        canonicalize_json({"\ufb33": 1, "\U0001f600": 2})
        .decode()
        .startswith('{"\U0001f600":2')
    )


@pytest.mark.parametrize("value", [float("nan"), float("inf"), "\ud800", 2**60])
def test_non_jcs_values_rejected(value):
    with pytest.raises((ValueError, UnicodeError)):
        canonicalize_json(value)


def test_domain_and_version_separation():
    assert (
        len(
            {
                compute_digest({"a": 1}, kind, version)
                for kind in [
                    "STATE",
                    "PROPOSAL",
                    "WITNESS-CORE",
                    "AUTHORITY",
                    "ATTESTATION",
                    "COMMIT-RECEIPT",
                ]
                for version in ["1.0.0", "2.0.0"]
            }
        )
        == 12
    )


def test_mutation_order_is_bound_but_signer_set_order_is_not():
    f = generate_fixture(create_identity(), "L5")
    q = f.transition_witness.witness_core.proposal
    before = compute_proposal_digest(q)
    q.authority_bundle.signers.reverse()
    assert compute_proposal_digest(q) == before
    q.mutation_manifest.reverse()
    assert compute_proposal_digest(q) != before


def test_state_display_digest_excluded():
    state = create_identity().state
    before = compute_state_digest(state)
    state.state_digest = "sha256:display-only"
    assert compute_state_digest(state) == before

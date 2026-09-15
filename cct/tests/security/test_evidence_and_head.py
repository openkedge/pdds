"""Absence, contradiction, unresolved branches, and epoch-scoped head evidence."""

import itertools

import pytest
from hypothesis import given
from hypothesis import strategies as st

from cctbench.canonicalize import compute_digest
from cctbench.crypto import public_hex, synthetic_key
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S

from .helpers import (
    corrupt,
    reissue_attestations,
    reissue_authority,
    reissue_receipt,
    valid_case,
    verify,
)

pytestmark = pytest.mark.security
SEEDS = st.integers(min_value=0, max_value=2**32 - 1)
EVIDENCE = {
    "authority": "authority",
    "receipt": "receipt_signature",
    "provenance": "provenance",
    "head": "canonical_head",
    "attestation": "attestation_I_bel",
}


def omit(kind, f, material):
    ctx = f.verification_context
    if kind == "authority":
        del ctx.credentials[material.principals["gov1"]]
    elif kind == "receipt":
        f.transition_witness.commit_receipt = None
    elif kind == "provenance":
        d = f.transition_witness.witness_core.proposal.provenance_manifest.dependencies[
            0
        ]
        ctx.evidence_store[d.uri] = None
    elif kind == "head":
        ctx.head_evidence = None
    else:
        f.transition_witness.witness_core.validation_records = []
        reissue_receipt(f, material)


def contradict(kind, f, material):
    ctx = f.verification_context
    if kind == "authority":
        ctx.credentials[material.principals["gov1"]].public_key = public_hex(
            synthetic_key(material.seed, "wrong-key")
        )
    elif kind == "receipt":
        r = f.transition_witness.commit_receipt
        r.kernel_signature = corrupt(r.kernel_signature)
    elif kind == "provenance":
        d = f.transition_witness.witness_core.proposal.provenance_manifest.dependencies[
            0
        ]
        ctx.evidence_store[d.uri] = {"affirmatively": "different committed contents"}
    elif kind == "head":
        ctx.head_evidence.parent_digest = compute_digest(
            "provably different predecessor"
        )
    else:
        v = f.transition_witness.witness_core.validation_records[0]
        v.signature = corrupt(v.signature)
        reissue_receipt(f, material, refresh_head=False)


@pytest.mark.parametrize("kind", list(EVIDENCE))
@pytest.mark.parametrize("mode", ["missing", "corrupted"])
@given(seed=SEEDS)
def test_missing_and_corrupted_are_distinct(kind, mode, soundness, seed):
    material, f = valid_case(seed)
    (omit if mode == "missing" else contradict)(kind, f, material)
    status, verdict = (
        (S.UNKNOWN, R.INDETERMINATE) if mode == "missing" else (S.FAIL, R.INVALID)
    )
    soundness(
        "evidence/" + kind + "/" + mode, verify(f), {EVIDENCE[kind]: status}, verdict
    )


@pytest.mark.parametrize("missing,broken", list(itertools.permutations(EVIDENCE, 2)))
@given(seed=SEEDS)
def test_failure_dominates_missing_evidence(missing, broken, soundness, seed):
    material, f = valid_case(seed)
    omit(missing, f, material)
    contradict(broken, f, material)
    soundness(
        f"dominance/{missing}-missing+{broken}-broken",
        verify(f),
        {EVIDENCE[missing]: S.UNKNOWN, EVIDENCE[broken]: S.FAIL},
        R.INVALID,
    )


@pytest.mark.parametrize(
    "component",
    [
        "authority-signature",
        "receipt-signature",
        "attestation-signature",
        "authority-bundle",
        "authority-public-key",
        "evaluator-public-key",
        "provenance-manifest",
    ],
)
@given(seed=SEEDS)
def test_missing_required_material_never_becomes_an_invented_failure(
    component, soundness, seed
):
    material, f = valid_case(seed)
    q = f.transition_witness.witness_core.proposal
    target = "authority"
    if component == "authority-signature":
        q.authority_bundle.signers[0].signature = ""
        reissue_attestations(f, material)
        reissue_receipt(f, material)
    elif component == "receipt-signature":
        f.transition_witness.commit_receipt.kernel_signature = ""
        target = "receipt_signature"
    elif component == "attestation-signature":
        f.transition_witness.witness_core.validation_records[0].signature = ""
        reissue_receipt(f, material)
        target = "attestation_I_bel"
    elif component == "authority-bundle":
        q.authority_bundle = None
        reissue_attestations(f, material)
        reissue_receipt(f, material)
    elif component == "authority-public-key":
        f.verification_context.credentials[material.principals["gov1"]].public_key = ""
    elif component == "evaluator-public-key":
        del f.verification_context.credentials[material.principals["eval1"]]
        target = "attestation_I_bel"
    else:
        q.provenance_manifest = None
        reissue_authority(f, material)
        reissue_attestations(f, material)
        reissue_receipt(f, material)
        target = "provenance"
    soundness(
        "evidence/absent-" + component,
        verify(f),
        {target: S.UNKNOWN},
        R.INDETERMINATE,
        only=True,
    )


@pytest.mark.parametrize(
    "case",
    [
        "policy-disabled",
        "correct",
        "ledger-unavailable",
        "competing-tips",
        "stale-predecessor",
        "contradictory-lock",
        "current-head-is-later",
        "historical-head",
        "misbound-archive",
        "misbound-current-head-identity",
    ],
)
@given(seed=SEEDS, gap=st.integers(min_value=1, max_value=100))
def test_canonical_head_resolution_is_epoch_scoped(case, soundness, seed, gap):
    _, f = valid_case(seed)
    ctx = f.verification_context
    historical = ctx.head_evidence.model_copy(deep=True)
    status, verdict = S.PASS, R.VALID
    if case == "policy-disabled":
        f.policy.require_canonical_head = False
        ctx.head_evidence.exclusive = False
    elif case == "ledger-unavailable":
        ctx.head_evidence = None
        status, verdict = S.UNKNOWN, R.INDETERMINATE
    elif case == "competing-tips":
        ctx.head_evidence.exclusive = None
        status, verdict = S.UNKNOWN, R.INDETERMINATE
    elif case == "stale-predecessor":
        ctx.head_evidence.parent_digest = compute_digest(
            ["canonical predecessor", seed]
        )
        status, verdict = S.FAIL, R.INVALID
    elif case == "contradictory-lock":
        ctx.head_evidence.exclusive = False
        status, verdict = S.FAIL, R.INVALID
    elif case == "misbound-current-head-identity":
        ctx.head_evidence.identity_id += ":different-identity"
        status, verdict = S.FAIL, R.INVALID
    elif case in ["current-head-is-later", "historical-head", "misbound-archive"]:
        ctx.head_evidence.epoch += gap
        ctx.head_evidence.parent_digest = compute_digest(["later predecessor", seed])
        if case == "current-head-is-later":
            status, verdict = S.UNKNOWN, R.INDETERMINATE
        else:
            ctx.head_evidence_by_epoch = {ctx.epoch: historical}
            if case == "misbound-archive":
                ctx.head_evidence_by_epoch[ctx.epoch].epoch += gap
                status, verdict = S.FAIL, R.INVALID
    soundness("head/" + case, verify(f), {"canonical_head": status}, verdict, only=True)


@given(seed=SEEDS, gap=st.integers(min_value=1, max_value=100))
def test_later_revocation_does_not_rewrite_historical_authorization(
    soundness, seed, gap
):
    material, f = valid_case(seed)
    ctx = f.verification_context
    for credential in ctx.credentials.values():
        credential.revoked_at_epoch = ctx.epoch + gap
    soundness(
        "history/credential-valid-at-transition",
        verify(f),
        {"authority": S.PASS, "receipt_signature": S.PASS, "attestation_I_bel": S.PASS},
        R.VALID,
    )
    ctx.credentials[material.principals["gov1"]].compromised_from_epoch = ctx.epoch
    soundness(
        "history/compromise-at-transition", verify(f), {"authority": S.FAIL}, R.INVALID
    )

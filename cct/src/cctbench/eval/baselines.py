"""Measured baseline arms. Only the explicitly named Oracle can read generator labels."""

import hashlib
import importlib
import re
from collections import Counter
from dataclasses import dataclass

import numpy as np

from cctbench.canonicalize import canonicalize_json, compute_digest, normalize_wire
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.verifier.cct import verify_cognitive_continuity
from cctbench.verifier.checkers import combine, lineage_conditions

ARM_NAMES = {
    "A": "State Similarity",
    "B": "Memory-Set Overlap",
    "C": "SIT",
    "D": "Cryptographic Lineage",
    "E": "Full CCT",
    "F": "Oracle",
}


@dataclass
class ArmOutcome:
    prediction: str | None
    status: str = "executed"
    reason: str = ""
    score: float | None = None
    diagnostics: dict | None = None


class HashingEmbedding:
    """Offline lexical embedding. It is not a pretrained semantic encoder."""

    name = "sha256-signed-token-count"
    version = "1.0.0"

    def __init__(self, dimensions=256):
        if dimensions < 8:
            raise ValueError("Embedding dimensions must be at least eight")
        self.dimensions = dimensions

    def embed(self, text):
        result = np.zeros(self.dimensions, dtype=np.float64)
        for word, count in Counter(
            re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE)
        ).items():
            digest = hashlib.sha256(word.encode()).digest()
            result[int.from_bytes(digest[:4], "big") % self.dimensions] += count * (
                1 if digest[4] & 1 else -1
            )
        return result

    def configuration(self):
        return {
            "backend": self.name,
            "version": self.version,
            "dimensions": self.dimensions,
            "projection": "RFC8785 state JSON without derived state_digest",
            "tokenizer": "unicode-word-or-punctuation-v1",
            "precision": "float64",
            "pretrained_semantic_model": False,
        }


def load_embedding(name="hashing", dimensions=256):
    if name == "hashing":
        return HashingEmbedding(dimensions)
    module, factory = name.split(":", 1)
    backend = getattr(importlib.import_module(module), factory)()
    for attr in ("embed", "configuration"):
        if not callable(getattr(backend, attr, None)):
            raise ValueError(f"Embedding backend lacks {attr}")
    return backend


def state_projection(state):
    data = normalize_wire(state)
    data.pop("state_digest", None)
    return canonicalize_json(data).decode()


def state_similarity(fixture, backend):
    a = np.asarray(
        backend.embed(state_projection(fixture.predecessor_state)), dtype=float
    )
    b = np.asarray(
        backend.embed(state_projection(fixture.candidate_successor)), dtype=float
    )
    if (
        a.shape != b.shape
        or a.ndim != 1
        or not a.size
        or not np.isfinite(a).all()
        or not np.isfinite(b).all()
    ):
        raise ValueError(
            "Embedding backend returned incompatible or non-finite vectors"
        )
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.clip(np.dot(a, b) / norm, -1, 1)) if norm else 0.0


def memory_overlap(fixture):
    a = {canonicalize_json(x) for x in fixture.predecessor_state.working_memory}
    b = {canonicalize_json(x) for x in fixture.candidate_successor.working_memory}
    if not a:
        raise ValueError(
            "Arm B requires nonempty predecessor memory (manuscript domain)"
        )
    return len(a & b) / len(a)


def calibrate(fixtures, backend):
    if any(f.split != "development" for f in fixtures):
        raise ValueError("Calibration may only read development identities")
    fs = [
        f
        for f in fixtures
        if f.subset == "canonical" and f.ground_truth_label != R.INDETERMINATE
    ]
    if not fs or {f.ground_truth_label for f in fs} != {R.VALID, R.INVALID}:
        raise ValueError(
            "Calibration requires both valid and invalid development examples"
        )
    out = {
        "method": "maximum balanced accuracy on development canonical VALID/INVALID fixtures",
        "tie_break": "higher valid acceptance, then higher threshold",
        "indeterminate_labels_used": False,
        "fixture_ids": [f.fixture_id for f in fs],
        "identity_ids": sorted({f.identity_id for f in fs}),
        "embedding": backend.configuration(),
    }
    truth = np.array([f.ground_truth_label == R.VALID for f in fs])
    for name, score_fn in [
        ("A", lambda f: state_similarity(f, backend)),
        ("B", memory_overlap),
    ]:
        scores = np.array([score_fn(f) for f in fs])
        candidates = sorted(
            set(scores.tolist() + [float(np.nextafter(scores.max(), np.inf))])
        )
        best = None
        for threshold in candidates:
            pred = scores >= threshold
            tpr = float(pred[truth].mean())
            tnr = float((~pred[~truth]).mean())
            rank = ((tpr + tnr) / 2, tpr, threshold)
            if best is None or rank > best[0]:
                best = (rank, threshold)
        out[name] = {
            "threshold": best[1],
            "development_balanced_accuracy": best[0][0],
            "n": len(fs),
        }
    out["configuration_digest"] = compute_digest(out, "CALIBRATION")
    return out


def evaluate_arm_a_state_similarity(fixture, threshold=0.8, backend=None):
    value = state_similarity(fixture, backend or HashingEmbedding())
    return ArmOutcome(
        R.VALID.value if value >= threshold else R.INVALID.value, score=value
    )


def evaluate_arm_b_memory_overlap(fixture, threshold=0.5):
    value = memory_overlap(fixture)
    return ArmOutcome(
        R.VALID.value if value >= threshold else R.INVALID.value, score=value
    )


def evaluate_arm_c_sit_only(fixture, adapter=None):
    return (
        adapter.evaluate(fixture)
        if adapter
        else ArmOutcome(
            None, "unavailable", "No frozen SIT model/probe configuration supplied"
        )
    )


def evaluate_arm_d_cryptographic_lineage(fixture):
    checks = lineage_conditions(
        fixture.predecessor_state,
        fixture.candidate_successor,
        fixture.transition_witness,
        fixture.policy,
        fixture.verification_context,
    )
    status, reason = combine(checks.values())
    prediction = {
        S.PASS: R.VALID.value,
        S.FAIL: R.INVALID.value,
        S.UNKNOWN: R.INDETERMINATE.value,
    }[status]
    return ArmOutcome(
        prediction,
        reason=reason,
        diagnostics={
            "condition_results": {
                k: {"status": v.value, "reason": why} for k, (v, why) in checks.items()
            },
            "decision_mapping": "PASS maps to VALID; FAIL maps to INVALID; UNKNOWN maps to INDETERMINATE",
        },
    )


def evaluate_arm_e_full_cct(fixture, disabled=()):
    report = verify_cognitive_continuity(
        fixture.predecessor_state,
        fixture.transition_witness,
        fixture.candidate_successor,
        fixture.policy,
        fixture.verification_context,
        disabled,
    )
    return ArmOutcome(
        report.result.value,
        reason=report.decisive_reason,
        diagnostics=report.model_dump(mode="json"),
    )


def evaluate_arm_f_oracle(fixture):
    return ArmOutcome(
        fixture.ground_truth_label.value,
        reason="Generator-defined reference label; not an independent verifier",
    )

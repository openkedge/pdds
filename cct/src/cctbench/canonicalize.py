"""RFC 8785 JCS, with manuscript domain/version separation and set normalization."""

import hashlib
import json
from enum import Enum
from typing import Any

import rfc8785

VERSION = "1.0.0"
# Schema paths, never arbitrary application-data field names. '*' matches a map key.
PROPOSAL_SETS = [
    ("authority_bundle", "signers"),
    *(
        ("provenance_manifest", k)
        for k in ("dependencies", "source_citations", "temporal_attestations")
    ),
]
CORE_SETS = [("validation_records",), *(("proposal", *p) for p in PROPOSAL_SETS)]
STATE_SETS = [
    ("normative_rules", "*", "required_signers"),
    ("governance", "*", "scopes"),
]
SET_PATHS = {
    "PROPOSAL": PROPOSAL_SETS,
    "AUTHORITY": PROPOSAL_SETS,
    "WITNESS-CORE": CORE_SETS,
    "STATE": STATE_SETS,
    "NORMATIVE-RULE": [("required_signers",)],
    "WITNESS": [("witness_core", *p) for p in CORE_SETS],
}
MODEL_KINDS = {
    "Proposal": "PROPOSAL",
    "WitnessCore": "WITNESS-CORE",
    "TransitionWitness": "WITNESS",
    "CognitiveState": "STATE",
}


def canonicalize_obj(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {k: canonicalize_obj(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [canonicalize_obj(v) for v in value]
    return value


def canonicalize_json(value: Any) -> bytes:
    return rfc8785.dumps(canonicalize_obj(value))


def strict_json_loads(text: str) -> Any:
    """Reject ambiguous duplicate keys and values outside this RFC 8785 profile."""

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON object member: {key}")
            result[key] = value
        return result

    def constant(value):
        raise ValueError(f"Non-finite JSON number: {value}")

    result = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    canonicalize_json(result)
    return result


def normalize_wire(value: Any, kind: str | None = None) -> Any:
    kind = kind or MODEL_KINDS.get(type(value).__name__)
    paths = SET_PATHS.get(kind, [])
    value = canonicalize_obj(value)

    def walk(obj, path=()):
        if isinstance(obj, dict):
            return {k: walk(v, (*path, k)) for k, v in obj.items()}
        if isinstance(obj, list):
            result = [walk(v, (*path, str(i))) for i, v in enumerate(obj)]
            if any(
                len(pattern) == len(path)
                and all(a == b or a == "*" for a, b in zip(pattern, path))
                for pattern in paths
            ):
                result.sort(key=canonicalize_json)
            return result
        return obj

    return walk(value)


def tagged_bytes(kind: str, value: Any, version: str = VERSION) -> bytes:
    return canonicalize_json([f"PCI-CCT-{kind}-{version}", normalize_wire(value, kind)])


def compute_digest(value: Any, kind: str = "EVIDENCE", version: str = VERSION) -> str:
    return "sha256:" + hashlib.sha256(tagged_bytes(kind, value, version)).hexdigest()


def compute_state_digest(state: Any, version: str = VERSION) -> str:
    data = canonicalize_obj(state).copy()
    data.pop("state_digest", None)
    return compute_digest(data, "STATE", version)


def compute_proposal_digest(proposal: Any, version: str = VERSION) -> str:
    return compute_digest(proposal, "PROPOSAL", version)


def compute_core_digest(core: Any, version: str = VERSION) -> str:
    return compute_digest(core, "WITNESS-CORE", version)

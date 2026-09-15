"""Identity-disjoint multiepoch fixtures and their independent lifecycle source records."""

import hashlib

from cctbench.canonicalize import (
    compute_digest,
    compute_state_digest,
)
from cctbench.generator.base import create_identity
from cctbench.generator.families import (
    COMPOUND_CASES,
    FAMILIES,
    SINGLE_CASES,
    generate_fixture,
)


def identity_seed(master_seed, split, index):
    return int.from_bytes(
        hashlib.sha256(f"{master_seed}:{split}:{index}".encode()).digest()[:6], "big"
    )


def generate_dataset(
    master_seed=20260904, development_identities=4, evaluation_identities=8, epochs=3
):
    if min(development_identities, evaluation_identities, epochs) < 1:
        raise ValueError(
            "At least one identity in each split and one epoch are required"
        )
    fixtures, histories, seeds = [], [], []
    for split, count in [
        ("development", development_identities),
        ("test", evaluation_identities),
    ]:
        for i in range(count):
            seed = identity_seed(master_seed, split, i)
            identity_id = f"urn:cct:{master_seed}:{split}:{i:03d}"
            m = create_identity(seed, identity_id, split)
            seeds.append({"identity_id": identity_id, "split": split, "seed": seed})
            for step in range(epochs):
                fixtures.extend(generate_fixture(m, f) for f in FAMILIES)
                fixtures.extend(
                    generate_fixture(m, subset="single_fault", case=c)
                    for c in SINGLE_CASES
                )
                fixtures.extend(
                    generate_fixture(m, subset="compound_fault", case=c)
                    for c in COMPOUND_CASES
                )
                # Only authorized L2 transitions advance source lifecycle; attacks never become ancestors.
                advance = generate_fixture(m, "L2")
                histories.append(
                    {
                        "identity_id": identity_id,
                        "split": split,
                        "step": step,
                        "state_ref": advance.source_state_ref,
                        "source_state": m.state.model_dump(mode="json"),
                        "transition_fixture_id": advance.fixture_id,
                        "successor_digest": compute_state_digest(
                            advance.candidate_successor
                        ),
                    }
                )
                m.state = advance.candidate_successor.model_copy(deep=True)
                m.context = advance.verification_context.model_copy(deep=True)
    validate_split(fixtures)
    return fixtures, histories, seeds


def validate_split(fixtures):
    groups = {s: [f for f in fixtures if f.split == s] for s in ["development", "test"]}
    ids = {s: {f.identity_id for f in fs} for s, fs in groups.items()}
    if ids["development"] & ids["test"]:
        raise ValueError("Identity leakage across development and evaluation splits")
    # Check actual source/candidate state content, histories and memory items, not IDs alone.
    artifacts = {}
    for split, fs in groups.items():
        values = set()
        for f in fs:
            if f.verification_context.identity_id != f.identity_id:
                raise ValueError("Fixture context belongs to another identity")
            for state in (f.predecessor_state, f.candidate_successor):
                values.add(compute_state_digest(state))
                for item in state.chronicle + state.working_memory:
                    values.add(compute_digest(item, "SPLIT-ARTIFACT"))
        artifacts[split] = values
    if artifacts["development"] & artifacts["test"]:
        raise ValueError("History, memory, summary or state reused across splits")
    return {
        "method": "identity-disjoint",
        "identity_counts": {s: len(v) for s, v in ids.items()},
        "shared_identity_count": 0,
        "shared_state_history_memory_count": 0,
    }

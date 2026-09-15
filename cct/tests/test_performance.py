"""Check workload fidelity and measured-artifact accounting, not speed thresholds."""

import csv
import hashlib
import json

import pytest

from cctbench.canonicalize import canonicalize_json, normalize_wire
from cctbench.eval.performance import (
    component_calls,
    run_performance,
    summarize,
    validate_workload,
)
from cctbench.eval.performance_workloads import (
    ATTESTATIONS,
    DEPENDENCIES,
    MUTATIONS,
    SEMANTICS,
    STATE_SIZES,
    WorkloadSpec,
    build_workload,
    workload_plan,
)
from cctbench.schema.enums import CCTResult
from cctbench.verifier.cct import verify_cognitive_continuity


def test_plan_covers_exact_dimensions_and_deduplicates():
    plan = workload_plan()
    assert len(plan) == len({e["spec"].case_id for e in plan}) == 60
    for group, field, values in (
        ("mutations", "mutations", MUTATIONS),
        ("dependencies", "dependencies", DEPENDENCIES),
        ("attestations", "attestations", ATTESTATIONS),
        *(
            (field, field, STATE_SIZES)
            for field in ("chronicle", "beliefs", "relationships")
        ),
    ):
        specs = [e["spec"] for e in plan if group in e["groups"]]
        assert {getattr(s, field) for s in specs} == set(values)
    assert {
        (e["spec"].dependencies, e["spec"].attestations)
        for e in plan
        if "size_grid" in e["groups"]
    } == {(d, a) for d in DEPENDENCIES for a in ATTESTATIONS}


@pytest.mark.parametrize("entry", workload_plan(), ids=lambda e: e["spec"].case_id)
def test_each_workload_is_valid_with_exact_counts_and_real_signature_path(entry):
    w = build_workload(entry["spec"])
    s = w.spec
    q = w.witness.witness_core.proposal
    assert len(q.mutation_manifest) == s.mutations
    assert len(q.provenance_manifest.dependencies) == s.dependencies
    assert len(w.context.evidence_store) == s.dependencies
    assert len(w.witness.witness_core.validation_records) == s.attestations
    assert len(w.predecessor.chronicle) == s.chronicle
    assert len(w.predecessor.beliefs) == s.beliefs
    assert len(w.predecessor.relationships) == s.relationships
    validate_workload(w, component_calls(w))
    assert w.sizes()["witness_bytes"] == len(
        canonicalize_json(normalize_wire(w.witness))
    )


def test_attested_comparisons_hold_source_proposal_and_candidate_fixed():
    native = build_workload(WorkloadSpec())
    external = build_workload(WorkloadSpec(attestations=10, semantic_mode="all"))
    assert external.predecessor == native.predecessor
    assert external.candidate == native.candidate
    assert (
        external.witness.witness_core.proposal == native.witness.witness_core.proposal
    )
    assert len(external.policy.required_external_attestations) == 5
    assert external.policy.evaluator_quorum_size == 2
    for name in SEMANTICS:
        records = [
            r
            for r in external.witness.witness_core.validation_records
            if r.check_id == name
        ]
        assert len({r.evaluator for r in records}) == 2
    # The benchmark must really use the attestation path and reject a tampered signature.
    external.witness.witness_core.validation_records[0].signature = (
        "ed25519:" + "00" * 64
    )
    report = verify_cognitive_continuity(*external.args)
    assert report.result == CCTResult.INVALID
    assert any(
        c.condition.startswith("attestation_") and c.status.value == "FAIL"
        for c in report.trace
    )


def test_mutation_sweep_keeps_state_size_fixed_and_seed_is_reproducible():
    workloads = [build_workload(WorkloadSpec(mutations=n)) for n in MUTATIONS]
    assert len({w.sizes()["candidate_bytes"] for w in workloads}) == 1
    spec = WorkloadSpec(
        mutations=16, dependencies=16, attestations=3, semantic_mode="I_bel"
    )
    assert build_workload(spec, 7).frozen() == build_workload(spec, 7).frozen()
    assert build_workload(spec, 7).frozen() != build_workload(spec, 8).frozen()


@pytest.mark.parametrize(
    "values",
    [
        {"mutations": 0},
        {"dependencies": -1},
        {"attestations": 1},
        {"semantic_mode": "I_bel"},
        {"semantic_mode": "all", "attestations": 5},
        {"semantic_mode": "unknown"},
    ],
)
def test_reject_invalid_workload_design(values):
    with pytest.raises(ValueError):
        WorkloadSpec(**values)


def test_smoke_artifacts_are_bound_to_samples_and_frozen_inputs(tmp_path):
    plan = [
        entry
        for entry in workload_plan()
        if entry["spec"]
        in (
            WorkloadSpec(),
            WorkloadSpec(dependencies=4, attestations=1, semantic_mode="I_bel"),
        )
    ]
    out, report = tmp_path / "results", tmp_path / "report.md"
    manifest = run_performance(
        out, report, repeats=3, warmups=2, blocks=2, plan=plan, progress=lambda _: None
    )
    assert manifest["status"] == "complete"
    assert manifest["configuration"]["smoke_only"]
    assert manifest["sample_count"] == 6
    assert manifest["observed_results"] == ["VALID"]
    assert manifest["source_unchanged"]
    samples = [
        json.loads(line) for line in (out / "samples.jsonl").read_text().splitlines()
    ]
    with (out / "summary.csv").open() as stream:
        summary = list(csv.DictReader(stream))
    recalculated = summarize(samples)
    assert [
        (r["case_id"], r["metric"], float(r["median"]), float(r["p99"]))
        for r in summary
    ] == [(r["case_id"], r["metric"], r["median"], r["p99"]) for r in recalculated]
    cases = json.loads((out / "cases.json").read_text())
    fixtures = (out / "workloads.jsonl").read_text().splitlines()
    for c, line in zip(cases, fixtures):
        assert c["fixture_sha256"] == hashlib.sha256(line.encode()).hexdigest()
        rows = [r for r in samples if r["case_id"] == c["case_id"]]
        assert {r["iteration"] for r in rows} == {0, 1, 2}
        assert all(
            r["signature_verification_count"] == c["attestations"] + 2 for r in rows
        )
        assert all(
            r["signature_primitive_sum_ns"] == sum(r["signature_primitive_samples_ns"])
            for r in rows
        )
        for r in rows:
            assert all(
                r[f"effective_{name}_ns"] == r[f"native_{name}_ns"]
                for name in SEMANTICS
                if name
                not in json.loads(line)["policy"]["required_external_attestations"]
            )
    for name, checksum in manifest["artifacts_sha256"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == checksum
    assert "SMOKE RUN" in report.read_text()
    assert (out / "verifier_scaling.pdf").read_bytes().startswith(b"%PDF")
    assert (out / "witness_size.png").stat().st_size > 1000


def test_bad_measurement_configuration_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        run_performance(
            tmp_path, tmp_path / "report.md", repeats=1, warmups=0, blocks=1
        )

"""Execute the public pipeline and independently reconcile its exported results."""

import csv
import hashlib
import json
from collections import Counter

from cctbench.eval.harness import run_benchmark
from cctbench.eval.metrics import metrics


def test_executed_artifacts_reconcile(tmp_path):
    out = tmp_path / "results"
    fixtures = tmp_path / "fixtures"
    report = tmp_path / "report.md"
    manifest = run_benchmark(
        out,
        fixtures,
        report,
        development_identities=1,
        evaluation_identities=1,
        epochs=1,
        bootstrap_samples=100,
        overhead_repeats=1,
        overhead_warmups=1,
    )
    required = {
        "benchmark_manifest.json",
        "fixture_counts.json",
        "per_fixture_results.jsonl",
        "aggregate_metrics.json",
        "family_metrics.csv",
        "confusion_matrices.csv",
        "ablation_metrics.csv",
        "overhead.csv",
        "environment.json",
        "seeds.json",
    }
    assert required <= {p.name for p in out.iterdir()}
    rows = [
        json.loads(line)
        for line in (out / "per_fixture_results.jsonl").read_text().splitlines()
    ]
    assert len(rows) == manifest["measured_rows"] == 48 * 6
    assert manifest["executed_rows"] == 48 * 5
    assert Counter(r["arm"] for r in rows) == {arm: 48 for arm in "ABCDEF"}
    assert all(r["split"] == "test" for r in rows)
    assert all(
        r["prediction"] is None and r["score"] is None and r["status"] == "unavailable"
        for r in rows
        if r["arm"] == "C"
    )
    assert (
        manifest["fixture_sha256"]
        == hashlib.sha256((fixtures / "generated.jsonl").read_bytes()).hexdigest()
    )
    assert manifest["conformance_violations"] == 0
    aggregate = json.loads((out / "aggregate_metrics.json").read_text())
    for arm in "ABCDEF":
        selected = [r for r in rows if r["arm"] == arm]
        assert aggregate["arms"][arm]["subsets"]["all"] == metrics(
            selected, 100, 20260905
        )
    ablations = [
        json.loads(line)
        for line in (out / "ablation_per_fixture.jsonl").read_text().splitlines()
    ]
    assert len(ablations) == manifest["ablation_rows"] == 200
    for row in csv.DictReader((out / "ablation_metrics.csv").open()):
        selected = [
            a
            for a in ablations
            if a["disabled"] == row["disabled"]
            and (row["case"] == "all" or a["case"] == row["case"])
        ]
        assert int(row["n"]) == len(selected)
        assert int(row["incorrectly_admitted"]) == sum(
            a["prediction"] == "VALID" and a["ground_truth"] != "VALID"
            for a in selected
        )
    overhead = list(csv.DictReader((out / "overhead.csv").open()))
    assert all(int(r["count"]) == 27 and float(r["min"]) >= 0 for r in overhead)
    assert all(
        float(r["median"]) <= float(r["p95"]) <= float(r["p99"]) for r in overhead
    )
    assert "Generated **96 fixtures**" in report.read_text()

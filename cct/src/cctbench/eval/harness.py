"""Regenerate fixtures, execute arms/ablations, and write traceable result artifacts."""

import csv
import hashlib
import json
import time
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from cctbench.canonicalize import compute_digest
from cctbench.eval.baselines import (
    ARM_NAMES,
    calibrate,
    evaluate_arm_a_state_similarity,
    evaluate_arm_b_memory_overlap,
    evaluate_arm_c_sit_only,
    evaluate_arm_d_cryptographic_lineage,
    evaluate_arm_e_full_cct,
    evaluate_arm_f_oracle,
    load_embedding,
)
from cctbench.eval.metrics import metrics
from cctbench.eval.overhead import environment, measure_overhead
from cctbench.eval.reporting import write_report
from cctbench.eval.sit import SITAdapter
from cctbench.generator.dataset import generate_dataset, validate_split
from cctbench.generator.families import COMPOUND_CASES, FAMILIES, SINGLE_CASES

ABLATIONS = [
    "I_lin",
    "I_auth",
    "I_hist",
    "I_temp",
    "I_bel",
    "I_rel",
    "I_norm",
    "I_prov",
    "state_application",
    "attestation_resolution",
]


def json_write(path, data):
    Path(path).write_text(
        json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    )


def jsonl_write(path, rows):
    with Path(path).open("w") as out:
        for row in rows:
            out.write(
                json.dumps(
                    row, ensure_ascii=False, allow_nan=False, separators=(",", ":")
                )
                + "\n"
            )


def csv_write(path, rows, fields=None):
    fields = fields or (list(rows[0]) if rows else [])
    with Path(path).open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def code_manifest(root):
    paths = sorted((root / "src").rglob("*.py")) + sorted(
        (root / "tests").rglob("*.py")
    )
    paths += [
        root / n
        for n in ["pyproject.toml", "requirements.lock", "Makefile"]
        if (root / n).exists()
    ]
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in paths
    }


def run_benchmark(
    output_dir=Path("results"),
    fixtures_dir=Path("fixtures"),
    report_path=Path("docs/evaluation-results.md"),
    master_seed=20260904,
    development_identities=4,
    evaluation_identities=8,
    epochs=3,
    bootstrap_samples=1000,
    embedding_backend="hashing",
    embedding_dimensions=256,
    sit_config=None,
    overhead_repeats=5,
    overhead_warmups=2,
):
    if bootstrap_samples < 100:
        raise ValueError("Use at least 100 bootstrap replicates")
    out, fixdir = Path(output_dir), Path(fixtures_dir)
    out.mkdir(parents=True, exist_ok=True)
    fixdir.mkdir(parents=True, exist_ok=True)
    print("Generating identity-disjoint deterministic fixtures...", flush=True)
    fixtures, histories, seeds = generate_dataset(
        master_seed, development_identities, evaluation_identities, epochs
    )
    split_info = validate_split(fixtures)
    fixture_file = fixdir / "generated.jsonl"
    jsonl_write(fixture_file, (f.model_dump(mode="json") for f in fixtures))
    jsonl_write(fixdir / "identity_histories.jsonl", histories)
    fixture_hash = hashlib.sha256(fixture_file.read_bytes()).hexdigest()
    json_write(
        fixdir / "manifest.json",
        {
            "format_version": "2.0.0",
            "count": len(fixtures),
            "sha256": fixture_hash,
            "generator": "deterministic seeded synthetic lifecycles",
            "families": FAMILIES,
            "single_fault_cases": SINGLE_CASES,
            "compound_fault_cases": COMPOUND_CASES,
        },
    )
    counts = Counter(
        (f.split, f.subset, f.transition_family, f.ground_truth_label.value)
        for f in fixtures
    )
    count_data = {
        "total": len(fixtures),
        "by_split": dict(Counter(f.split for f in fixtures)),
        "by_subset": dict(Counter(f.subset for f in fixtures)),
        "rows": [
            {"split": s, "subset": u, "family": f, "ground_truth": g, "count": n}
            for (s, u, f, g), n in sorted(counts.items())
        ],
    }
    json_write(out / "fixture_counts.json", count_data)
    json_write(
        out / "seeds.json",
        {
            "master_seed": master_seed,
            "bootstrap_seed": master_seed + 1,
            "identities": seeds,
        },
    )
    dev = [f for f in fixtures if f.split == "development"]
    test = [f for f in fixtures if f.split == "test"]
    backend = load_embedding(embedding_backend, embedding_dimensions)
    calibration = calibrate(dev, backend)
    json_write(out / "calibration.json", calibration)
    sit = SITAdapter(sit_config)
    arms = {
        "A": lambda f: evaluate_arm_a_state_similarity(
            f, calibration["A"]["threshold"], backend
        ),
        "B": lambda f: evaluate_arm_b_memory_overlap(f, calibration["B"]["threshold"]),
        "C": lambda f: evaluate_arm_c_sit_only(f, sit),
        "D": evaluate_arm_d_cryptographic_lineage,
        "E": evaluate_arm_e_full_cct,
        "F": evaluate_arm_f_oracle,
    }
    rows = []
    by_fixture = {f.fixture_id: f for f in test}
    for arm, fn in arms.items():
        print(
            f"Executing Arm {arm}: {ARM_NAMES[arm]} on {len(test)} held-out fixtures...",
            flush=True,
        )
        for f in test:
            start = time.perf_counter_ns()
            result = fn(f)
            elapsed = time.perf_counter_ns() - start
            rows.append(
                {
                    "fixture_id": f.fixture_id,
                    "identity_id": f.identity_id,
                    "split": f.split,
                    "subset": f.subset,
                    "family": f.transition_family,
                    "arm": arm,
                    "ground_truth": f.ground_truth_label.value,
                    **asdict(result),
                    "execution_latency_ns": elapsed,
                    "fixture_digest": compute_digest(f, "FIXTURE"),
                }
            )
    jsonl_write(out / "per_fixture_results.jsonl", rows)
    aggregate = {
        "schema_version": "2.0.0",
        "arms": {},
        "per_invariant_single_fault_detection": {},
        "uncertainty_note": "IID held-out-fixture bootstrap; repeated epochs from one identity are dependent. Intervals are conditional on this synthetic fixture population, not a population-level identity generalization guarantee.",
    }
    family_rows = []
    confusion_rows = []
    for arm in arms:
        arm_rows = [row for row in rows if row["arm"] == arm]
        aggregate["arms"][arm] = {
            "name": ARM_NAMES[arm],
            "decision_domain": "binary" if arm in "ABC" else "ternary",
            "can_predict_indeterminate": arm not in "ABC",
            "subsets": {},
        }
        for subset in ["canonical", "single_fault", "compound_fault", "all"]:
            subset_rows = [
                row for row in arm_rows if subset == "all" or row["subset"] == subset
            ]
            stat = metrics(subset_rows, bootstrap_samples, master_seed + 1)
            aggregate["arms"][arm]["subsets"][subset] = stat
            for i, label in enumerate(stat["true_labels"]):
                for j, pred in enumerate(stat["predicted_labels"]):
                    confusion_rows.append(
                        {
                            "arm": arm,
                            "subset": subset,
                            "ground_truth": label,
                            "prediction": pred,
                            "count": stat["confusion_matrix"][i][j],
                        }
                    )
            for family in sorted({row["family"] for row in subset_rows}):
                fs = [row for row in subset_rows if row["family"] == family]
                fm = metrics(fs, bootstrap_samples, master_seed + 1)
                for metric, rate in fm["rates"].items():
                    family_rows.append(
                        {
                            "arm": arm,
                            "subset": subset,
                            "family": family,
                            "n": fm["n"],
                            "executed": fm["executed"],
                            "metric": metric,
                            "estimate": rate["estimate"],
                            "numerator": rate["numerator"],
                            "denominator": rate["denominator"],
                            "ci95_low": rate["ci95"][0] if rate["ci95"] else None,
                            "ci95_high": rate["ci95"][1] if rate["ci95"] else None,
                        }
                    )
        by_target = defaultdict(list)
        for row in arm_rows:
            if row["subset"] == "single_fault":
                for target in by_fixture[row["fixture_id"]].target_invariants:
                    by_target[target].append(row)
        aggregate["per_invariant_single_fault_detection"][arm] = {
            k: metrics(v, bootstrap_samples, master_seed + 1)
            for k, v in by_target.items()
        }
    json_write(out / "aggregate_metrics.json", aggregate)
    csv_write(out / "family_metrics.csv", family_rows)
    csv_write(out / "confusion_matrices.csv", confusion_rows)
    actual_e = {row["fixture_id"]: row for row in rows if row["arm"] == "E"}
    single = [f for f in test if f.subset == "single_fault"]
    conformance = []
    for f in single:
        observed = {
            k: v["status"]
            for k, v in actual_e[f.fixture_id]["diagnostics"][
                "condition_results"
            ].items()
            if v["status"] != "PASS" and not v["disabled"]
        }
        conformance.append(
            {
                "fixture_id": f.fixture_id,
                "target_conditions": f.target_conditions,
                "observed_nonpass": observed,
                "isolated": set(observed) == set(f.target_conditions)
                and len(observed) == 1,
                "verdict_matches_generator": actual_e[f.fixture_id]["prediction"]
                == f.ground_truth_label.value,
            }
        )
    json_write(out / "conformance_audit.json", conformance)
    ablation_rows = []
    ablation_details = []
    for disabled in ABLATIONS:
        print(
            f"Ablating {disabled} on {len(single)} single-fault fixtures...", flush=True
        )
        detail = []
        for f in single:
            outcome = evaluate_arm_e_full_cct(f, [disabled])
            row = {
                "fixture_id": f.fixture_id,
                "identity_id": f.identity_id,
                "family": f.transition_family,
                "case": f.description,
                "disabled": disabled,
                "ground_truth": f.ground_truth_label.value,
                "baseline_prediction": actual_e[f.fixture_id]["prediction"],
                "prediction": outcome.prediction,
                "incorrectly_admitted": outcome.prediction == "VALID"
                and f.ground_truth_label.value != "VALID",
                "misclassified": outcome.prediction != f.ground_truth_label.value,
                "reason": outcome.reason,
                "checker_results": outcome.diagnostics["checker_results"],
            }
            detail.append(row)
        ablation_details.extend(detail)
        for case in ["all"] + list(SINGLE_CASES):
            selected = [row for row in detail if case == "all" or row["case"] == case]
            ablation_rows.append(
                {
                    "disabled": disabled,
                    "case": case,
                    "n": len(selected),
                    "baseline_misclassified": sum(
                        v["baseline_prediction"] != v["ground_truth"] for v in selected
                    ),
                    "misclassified": sum(v["misclassified"] for v in selected),
                    "incorrectly_admitted": sum(
                        v["incorrectly_admitted"] for v in selected
                    ),
                    "newly_misclassified": sum(
                        v["misclassified"]
                        and v["baseline_prediction"] == v["ground_truth"]
                        for v in selected
                    ),
                }
            )
    csv_write(out / "ablation_metrics.csv", ablation_rows)
    jsonl_write(out / "ablation_per_fixture.jsonl", ablation_details)
    # One complete set of 24 canonical families plus attestation conformance cases,
    # chosen before timing by fixture order, never by observed speed or correctness.
    chosen = []
    seen = set()
    for f in test:
        key = (
            f.subset,
            f.transition_family if f.subset == "canonical" else f.description,
        )
        if f.subset == "compound_fault" or (
            f.subset == "single_fault" and not f.description.startswith("attestation_")
        ):
            continue
        if key not in seen:
            seen.add(key)
            chosen.append(f)
    print(
        f"Measuring overhead: {len(chosen)} fixtures, {overhead_warmups} warm-ups and {overhead_repeats} repetitions each...",
        flush=True,
    )
    raw, overhead = measure_overhead(chosen, overhead_warmups, overhead_repeats)
    csv_write(out / "overhead.csv", overhead)
    jsonl_write(out / "overhead_samples.jsonl", raw)
    env = environment()
    json_write(out / "environment.json", env)
    root = Path(__file__).resolve().parents[3]
    manifest = {
        "schema_version": "2.0.0",
        "run_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "configuration": {
            "master_seed": master_seed,
            "development_identities": development_identities,
            "evaluation_identities": evaluation_identities,
            "epochs": epochs,
            "bootstrap_samples": bootstrap_samples,
            "embedding_backend": embedding_backend,
            "embedding_dimensions": embedding_dimensions,
            "overhead_repeats": overhead_repeats,
            "overhead_warmups": overhead_warmups,
        },
        "source_files": code_manifest(root),
        "fixture_sha256": fixture_hash,
        "fixture_file": str(fixture_file),
        "split": split_info,
        "policy_versions": sorted({f.policy.policy_version for f in fixtures}),
        "policy_digests": sorted(
            {compute_digest(f.policy, "POLICY") for f in fixtures}
        ),
        "protocol_version": "1.0.0",
        "canonicalization": "RFC8785 JCS of [PCI-CCT-<TYPE>-<version>, object]",
        "signature_algorithm": "Ed25519 over SHA256 tagged preimage",
        "synthetic_keys": "PUBLIC, seed-derived fixture keys; not production credentials",
        "calibration": calibration,
        "sit": sit.manifest(),
        "measured_rows": len(rows),
        "executed_rows": sum(row["status"] == "executed" for row in rows),
        "ablation_rows": len(ablation_details),
        "conformance_violations": sum(
            not v["isolated"] or not v["verdict_matches_generator"] for v in conformance
        ),
        "timing": {
            "mode": "complete diagnostic evaluation; no early FAIL exit",
            "sample_selection": "first held-out example of each canonical family plus attestation conformance cases",
            "warmups_per_fixture": overhead_warmups,
            "repeats_per_fixture": overhead_repeats,
        },
        "reproducible_fields": "Fixtures, signatures, calibration, decisions, rates and bootstrap CIs; timestamps and timings vary by execution.",
    }
    manifest["source_digest"] = compute_digest(manifest["source_files"], "SOURCE")
    json_write(out / "benchmark_manifest.json", manifest)
    write_report(
        Path(report_path),
        manifest,
        count_data,
        aggregate,
        ablation_rows,
        overhead,
        rows,
    )
    print(f"Wrote executed results to {out}; report: {report_path}", flush=True)
    return manifest


class BenchmarkHarness:
    """Explicit pre-split in-memory interface; calibration cannot use evaluation identities."""

    def __init__(self, fixtures):
        validate_split(fixtures)
        self.fixtures = fixtures

    def run_all_arms(self):
        backend = load_embedding()
        calibration = calibrate(
            [f for f in self.fixtures if f.split == "development"], backend
        )
        test = [f for f in self.fixtures if f.split == "test"]
        result = {}
        for arm, fn in {
            "A": lambda f: evaluate_arm_a_state_similarity(
                f, calibration["A"]["threshold"], backend
            ),
            "B": lambda f: evaluate_arm_b_memory_overlap(
                f, calibration["B"]["threshold"]
            ),
            "C": evaluate_arm_c_sit_only,
            "D": evaluate_arm_d_cryptographic_lineage,
            "E": evaluate_arm_e_full_cct,
            "F": evaluate_arm_f_oracle,
        }.items():
            rows = [
                {
                    "ground_truth": f.ground_truth_label.value,
                    "prediction": fn(f).prediction,
                }
                for f in test
            ]
            result[arm] = metrics(rows)
        return result

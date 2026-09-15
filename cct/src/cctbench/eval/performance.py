"""Single-process, unoptimized verifier microbenchmark with auditable raw samples."""

import csv
import gc
import hashlib
import importlib.metadata
import json
import os
import random
import sys
import threading
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from cryptography.hazmat.backends.openssl.backend import backend

from cctbench.canonicalize import (
    compute_core_digest,
    compute_proposal_digest,
    compute_state_digest,
)
from cctbench.crypto import unsigned, verify_signature
from cctbench.engine.apply import apply_mutations
from cctbench.eval.overhead import environment
from cctbench.eval.performance_workloads import SEMANTICS, build_workload, workload_plan
from cctbench.schema.enums import CCTResult, CheckStatus
from cctbench.verifier.cct import verify_cognitive_continuity
from cctbench.verifier.checkers import (
    check_attestation,
    check_authority,
    check_belief_coherence,
    check_historical_chronicle,
    check_normative,
    check_provenance,
    check_relational,
    check_temporal,
)

METRICS = {
    "total_cct_ns": "External wall clock around the complete diagnostic verifier, including report construction; parsed objects and resident evidence.",
    "total_process_cpu_ns": "Process CPU time around the same call, including the two wall-clock reads; diagnostic only, not used for latency plots.",
    "state_hash_predecessor_ns": "compute_state_digest(predecessor): model projection, normalization, tagged RFC 8785 JCS and SHA-256; derived state_digest excluded.",
    "state_hash_candidate_ns": "compute_state_digest(candidate), same boundary as predecessor hash.",
    "proposal_digest_ns": "compute_proposal_digest(q), including normalization, tagged JCS and SHA-256.",
    "core_digest_ns": "compute_core_digest(core), including normalization, tagged JCS and SHA-256.",
    "receipt_signature_check_ns": "verify_signature for one receipt: prepared unsigned payload, key/signature decoding, tagged hash, Ed25519 verification and historical key checks.",
    "signature_primitive_sum_ns": "Sum of Ed25519 primitive timings captured inside this full verification; excludes key parsing and message hashing, includes existing timer bookkeeping overhead.",
    "signature_primitive_ns": "Individual Ed25519 primitive timings from full verification, pooled per case across actual calls; call index preserved in signature_samples.csv.",
    "authority_check_ns": "Direct check_authority: grants, scopes, threshold, authority payload construction, hashing and signatures.",
    "provenance_check_ns": "Direct check_provenance: declarations, in-memory resolver lookups and evidence hashes; no network I/O.",
    "state_application_ns": "apply_mutations: deep state copy, ordered operations and final state hash. Candidate equality checks belong to stage 4, not this component.",
    **{
        f"native_{c}_ns": f"Direct native {c} predicate. Counterfactual in externally attested cases; not executed in that case's total verifier path."
        for c in SEMANTICS
    },
    **{
        f"effective_{c}_ns": f"Policy-selected {c} component: check_attestation if required, otherwise the same sample as native_{c}."
        for c in SEMANTICS
    },
    **{
        f"stage_{s}_ns": "Existing verifier stage timer; includes diagnostic condition construction. Components/stages overlap and must not be summed with other metrics."
        for s in (
            "1_lineage",
            "2_authority",
            "3_provenance",
            "4_state_application",
            "5_semantics",
        )
    },
}


def json_write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def csv_write(path, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else [])
        writer.writeheader()
        writer.writerows(rows)


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_freeze(root):
    files = [
        *root.glob("src/**/*.py"),
        *root.glob("figures/gen_fig_*.py"),
        root / "pyproject.toml",
        root / "requirements.lock",
        root / "Makefile",
        root / "tests/test_performance.py",
    ]
    hashes = {
        str(p.relative_to(root)): sha256_file(p) for p in sorted(files) if p.is_file()
    }
    implementation = {
        p: h
        for p, h in hashes.items()
        if p.startswith(
            ("src/cctbench/verifier/", "src/cctbench/engine/", "src/cctbench/schema/")
        )
        or p in ("src/cctbench/crypto.py", "src/cctbench/canonicalize.py")
    }
    return {
        "files": hashes,
        "verifier_files": implementation,
        "sha256": hashlib.sha256(
            json.dumps(hashes, sort_keys=True).encode()
        ).hexdigest(),
        "verifier_sha256": hashlib.sha256(
            json.dumps(implementation, sort_keys=True).encode()
        ).hexdigest(),
    }


def host_snapshot():
    result = environment()
    result.update(
        {
            "pid": os.getpid(),
            "python_executable": sys.executable,
            "python_active_threads": threading.active_count(),
            "gc_enabled": gc.isenabled(),
            "gc_thresholds": gc.get_threshold(),
            "load_average": list(os.getloadavg())
            if hasattr(os, "getloadavg")
            else None,
            "affinity": sorted(os.sched_getaffinity(0))
            if hasattr(os, "sched_getaffinity")
            else None,
            "thread_environment": {
                k: os.environ.get(k)
                for k in (
                    "OMP_NUM_THREADS",
                    "OPENBLAS_NUM_THREADS",
                    "MKL_NUM_THREADS",
                    "VECLIB_MAXIMUM_THREADS",
                )
            },
            "cryptography_openssl": backend.openssl_version_text(),
            "installed_distributions": dict(
                sorted(
                    (d.metadata["Name"], d.version)
                    for d in importlib.metadata.distributions()
                )
            ),
        }
    )
    if sys.platform.startswith("linux"):
        cpuinfo = Path("/proc/cpuinfo")
        if cpuinfo.exists():
            result["hardware"]["cpu_model"] = next(
                (
                    line.split(":", 1)[1].strip()
                    for line in cpuinfo.read_text().splitlines()
                    if line.startswith("model name")
                ),
                None,
            )
        result["hardware"]["memory_bytes"] = os.sysconf("SC_PAGE_SIZE") * os.sysconf(
            "SC_PHYS_PAGES"
        )
    return result


def component_calls(workload):
    pred, w, cand, policy, ctx = workload.args
    q, version, receipt = w.witness_core.proposal, w.witness_version, w.commit_receipt
    receipt_payload = unsigned(receipt, "kernel_signature")
    native = {
        "I_hist": lambda: check_historical_chronicle(
            pred, cand, q, policy, ctx, version
        ),
        "I_temp": lambda: check_temporal(pred, cand, policy, ctx),
        "I_bel": lambda: check_belief_coherence(pred, cand, q, policy, ctx),
        "I_rel": lambda: check_relational(pred, cand, policy, q, ctx),
        "I_norm": lambda: check_normative(pred, cand, policy),
    }
    calls = {
        "state_hash_predecessor_ns": lambda: compute_state_digest(pred, version),
        "state_hash_candidate_ns": lambda: compute_state_digest(cand, version),
        "proposal_digest_ns": lambda: compute_proposal_digest(q, version),
        "core_digest_ns": lambda: compute_core_digest(w.witness_core, version),
        "receipt_signature_check_ns": lambda: verify_signature(
            "COMMIT-RECEIPT",
            receipt_payload,
            receipt.kernel_signature,
            ctx.credentials[receipt.kernel_id],
            q.epoch,
            version,
        ),
        "authority_check_ns": lambda: check_authority(q, pred, policy, ctx, version),
        "provenance_check_ns": lambda: check_provenance(q, policy, ctx, version),
        "state_application_ns": lambda: apply_mutations(pred, q.mutation_manifest),
        **{f"native_{name}_ns": fn for name, fn in native.items()},
        **{
            f"effective_{name}_ns": (
                lambda name=name: check_attestation(name, w, policy, ctx)
            )
            for name in workload.spec.external_checks
        },
    }
    return calls


def validate_workload(workload, calls):
    report = verify_cognitive_continuity(*workload.args)
    if (
        report.result != CCTResult.VALID
        or len(report.signature_verification_ns) != 2 + workload.spec.attestations
    ):
        raise RuntimeError(
            f"Invalid workload or unexpected signature path: {workload.spec.case_id}: {report.reasons}"
        )
    for name, fn in calls.items():
        value = fn()
        if isinstance(value, tuple) and value[0] != CheckStatus.PASS:
            raise RuntimeError(f"Component {name} did not PASS: {value}")


def summarize(samples):
    grouped = {}
    for row in samples:
        for name in METRICS:
            if name in row:
                grouped.setdefault((row["case_id"], name), []).append(row[name])
        grouped.setdefault((row["case_id"], "signature_primitive_ns"), []).extend(
            row["signature_primitive_samples_ns"]
        )
    result = []
    for (case_id, metric), values in sorted(grouped.items()):
        arr = np.asarray(values, dtype=float)
        result.append(
            {
                "case_id": case_id,
                "metric": metric,
                "unit": "ns",
                "count": len(values),
                "median": float(np.median(arr)),
                "p95": float(np.quantile(arr, 0.95, method="linear")),
                "p99": float(np.quantile(arr, 0.99, method="linear")),
                "min": int(min(values)),
                "max": int(max(values)),
            }
        )
    return result


def run_performance(
    output_dir=Path("results/performance"),
    report_path=Path("docs/verifier-performance.md"),
    seed=20260904,
    repeats=300,
    warmups=10,
    blocks=5,
    plan=None,
    render=True,
    progress=print,
    repo_root=None,
):
    if repeats < blocks or warmups < blocks or blocks < 1:
        raise ValueError(
            "At least one warmup and one measured repetition per block are required"
        )
    root = Path(repo_root) if repo_root else Path(__file__).resolve().parents[3]
    output_dir, report_path = Path(output_dir), Path(report_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    plan = workload_plan() if plan is None else plan
    if not plan or len({entry["spec"].case_id for entry in plan}) != len(plan):
        raise ValueError("Workload plan must be nonempty with unique cases")
    freeze = source_freeze(root)
    env_start = host_snapshot()
    started = datetime.now(UTC).isoformat()
    config = {
        "seed": seed,
        "repeats_per_case": repeats,
        "warmups_per_case": warmups,
        "blocks": blocks,
        "case_count": len(plan),
        "smoke_only": repeats < 100,
        "quantile_method": "numpy.quantile(method='linear')",
        "controls": "One sequential Python process, no workers, parsed resident inputs, fixed seed and payload sizes; GC and verifier unchanged. Case order reshuffled per block; component order reshuffled per iteration. Full-call samples collected separately before component samples within each case/block. No clock pinning, CPU isolation or cache flushing. No network or signing in timed regions.",
    }
    manifest = {
        "status": "running",
        "started_at": started,
        "configuration": config,
        "source_freeze": freeze,
        "metric_definitions": METRICS,
        "cases": [],
    }
    json_write(output_dir / "manifest.json", manifest)
    workloads, calls_by_id, cases = {}, {}, []
    with (output_dir / "workloads.jsonl").open("w") as stream:
        for entry in plan:
            w = build_workload(entry["spec"], seed)
            case_id = w.spec.case_id
            calls = component_calls(w)
            validate_workload(w, calls)
            encoded = json.dumps(
                w.frozen(), sort_keys=True, separators=(",", ":"), allow_nan=False
            )
            stream.write(encoded + "\n")
            cases.append(
                {
                    "case_id": case_id,
                    **asdict(w.spec),
                    "groups": entry["groups"],
                    "expected_result": "VALID",
                    "expected_signature_count": 2 + w.spec.attestations,
                    "quorum": w.policy.evaluator_quorum_size,
                    "fixture_sha256": hashlib.sha256(encoded.encode()).hexdigest(),
                    **w.sizes(),
                }
            )
            workloads[case_id], calls_by_id[case_id] = w, calls
    json_write(output_dir / "cases.json", cases)
    manifest["cases"] = cases
    json_write(output_dir / "manifest.json", manifest)
    progress(
        f"Prepared and validated {len(cases)} signed workloads; {warmups} warmups and {repeats} samples per case/metric."
    )
    # No forced collection, caching, vectorization, worker pools or monkeypatches.
    timer_samples = []
    for _ in range(1000):
        t = time.perf_counter_ns()
        timer_samples.append(time.perf_counter_ns() - t)
    samples, schedule = [], []
    run_start = time.perf_counter_ns()
    rng = random.Random(seed)
    for block in range(blocks):
        order = list(workloads)
        rng.shuffle(order)
        n = repeats // blocks + (block < repeats % blocks)
        nw = warmups // blocks + (block < warmups % blocks)
        offset = block * (repeats // blocks) + min(block, repeats % blocks)
        schedule.append(
            {"block": block, "case_order": order, "repetitions": n, "warmups": nw}
        )
        for index, case_id in enumerate(order):
            w, calls = workloads[case_id], calls_by_id[case_id]
            for _ in range(nw):
                verify_cognitive_continuity(*w.args)
            rows = []
            args = w.args
            for j in range(n):
                cpu = time.process_time_ns()
                t = time.perf_counter_ns()
                report = verify_cognitive_continuity(*args)
                elapsed = time.perf_counter_ns() - t
                cpu_elapsed = time.process_time_ns() - cpu
                if (
                    report.result != CCTResult.VALID
                    or len(report.signature_verification_ns) != 2 + w.spec.attestations
                ):
                    raise RuntimeError(f"Measured verification failed: {case_id}")
                rows.append(
                    {
                        "case_id": case_id,
                        "block": block,
                        "iteration": offset + j,
                        "total_started_offset_ns": t - run_start,
                        "total_cct_ns": elapsed,
                        "total_process_cpu_ns": cpu_elapsed,
                        "result": report.result.value,
                        "signature_verification_count": len(
                            report.signature_verification_ns
                        ),
                        "signature_primitive_sum_ns": sum(
                            report.signature_verification_ns
                        ),
                        "signature_primitive_samples_ns": report.signature_verification_ns,
                        **{
                            f"stage_{k}_ns": v
                            for k, v in report.stage_latency_ns.items()
                        },
                    }
                )
            for _ in range(nw):
                for fn in calls.values():
                    fn()
            names = list(calls)
            for row in rows:
                rng.shuffle(names)
                row["component_started_offset_ns"] = time.perf_counter_ns() - run_start
                for name in names:
                    fn = calls[name]
                    t = time.perf_counter_ns()
                    value = fn()
                    elapsed = time.perf_counter_ns() - t
                    # Keep return destruction outside the timed boundary.
                    del value
                    row[name] = elapsed
                for checker in SEMANTICS:
                    if checker not in w.spec.external_checks:
                        row[f"effective_{checker}_ns"] = row[f"native_{checker}_ns"]
            samples.extend(rows)
            progress(
                f"Block {block + 1}/{blocks}, case {index + 1}/{len(order)}: {case_id}"
            )
    finished = datetime.now(UTC).isoformat()
    measured_seconds = (time.perf_counter_ns() - run_start) / 1e9
    env_end = host_snapshot()
    if source_freeze(root) != freeze:
        raise RuntimeError("Source changed during measurement; discard this run")
    summary = summarize(samples)
    with (output_dir / "samples.jsonl").open("w") as stream:
        for row in samples:
            stream.write(json.dumps(row, sort_keys=True) + "\n")
    csv_write(output_dir / "summary.csv", summary)
    csv_write(
        output_dir / "signature_samples.csv",
        [
            {
                "case_id": r["case_id"],
                "block": r["block"],
                "iteration": r["iteration"],
                "call_index": i,
                "elapsed_ns": value,
            }
            for r in samples
            for i, value in enumerate(r["signature_primitive_samples_ns"])
        ],
    )
    totals = {s["case_id"]: s for s in summary if s["metric"] == "total_cct_ns"}
    csv_write(
        output_dir / "scaling.csv",
        [
            {
                **{k: v for k, v in c.items() if k not in ("groups", "fixture_sha256")},
                "groups": ";".join(c["groups"]),
                "complexity_m_plus_d_plus_a": c["mutations"]
                + c["dependencies"]
                + c["attestations"],
                **{
                    k: totals[c["case_id"]][k]
                    for k in ("count", "median", "p95", "p99")
                },
            }
            for c in cases
        ],
    )
    json_write(
        output_dir / "environment.json",
        {
            "start": env_start,
            "end": env_end,
            "timer_pair_ns": {
                "median": float(np.median(timer_samples)),
                "p99": float(np.quantile(timer_samples, 0.99)),
            },
            "machine_control_limits": "Dedicated benchmark process only, not an exclusive host. Scheduler placement, background OS/apps, power mode, frequency and temperature were not controlled. No production throughput inference.",
        },
    )
    manifest.update(
        {
            "status": "measured",
            "finished_at": finished,
            "measurement_seconds": measured_seconds,
            "schedule": schedule,
            "sample_count": len(samples),
            "source_unchanged": True,
            "observed_results": sorted({r["result"] for r in samples}),
        }
    )
    json_write(output_dir / "manifest.json", manifest)
    from cctbench.eval.performance_report import write_report

    if render:
        from cctbench.eval.performance_report import plot_results

        plot_results(output_dir)
    write_report(output_dir, report_path)
    manifest["status"] = "complete"
    manifest["artifacts_sha256"] = {
        p.name: sha256_file(p)
        for p in sorted(output_dir.iterdir())
        if p.is_file() and p.name != "manifest.json"
    }
    manifest["report_sha256"] = sha256_file(report_path)
    json_write(output_dir / "manifest.json", manifest)
    progress(
        f"Completed {len(samples)} full verifications in {measured_seconds:.1f}s of measurement; report: {report_path}"
    )
    return manifest

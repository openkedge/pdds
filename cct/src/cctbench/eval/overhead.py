"""Warm-up and wall-clock measurements; hardware timings are not deterministic artifacts."""

import hashlib
import importlib.metadata
import os
import platform
import subprocess
import sys
import time

import numpy as np

from cctbench.canonicalize import canonicalize_json, normalize_wire, tagged_bytes
from cctbench.verifier.cct import verify_cognitive_continuity


def environment():
    packages = {}
    for name in [
        "cctbench",
        "rfc8785",
        "cryptography",
        "pydantic",
        "numpy",
        "typer",
        "pytest",
    ]:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    hardware = {
        "machine": platform.machine(),
        "processor": platform.processor(),
        "logical_cpus": os.cpu_count(),
    }
    if sys.platform == "darwin":
        for key, syskey in [
            ("cpu_model", "machdep.cpu.brand_string"),
            ("memory_bytes", "hw.memsize"),
        ]:
            p = subprocess.run(["sysctl", "-n", syskey], capture_output=True, text=True)
            hardware[key] = p.stdout.strip() if p.returncode == 0 else None
    return {
        "python": sys.version,
        "implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "hardware": hardware,
        "packages": packages,
        "perf_counter_resolution_seconds": time.get_clock_info(
            "perf_counter"
        ).resolution,
        "timing_note": "Nanoseconds are timer units, not accuracy claims. Medians/p95/p99 are descriptive on this host; OS noise and diagnostic collection are included.",
    }


def measure_overhead(fixtures, warmups=2, repeats=5):
    if warmups < 0 or repeats < 1:
        raise ValueError("Invalid overhead iteration counts")
    raw = []
    for fixture in fixtures:
        w = fixture.transition_witness
        if w is None:
            continue
        q = w.witness_core.proposal
        args = (
            fixture.predecessor_state,
            w,
            fixture.candidate_successor,
            fixture.policy,
            fixture.verification_context,
        )
        sizes = {
            name: len(canonicalize_json(normalize_wire(obj)))
            for name, obj in {
                "proposal_bytes": q,
                "validation_records_bytes": w.witness_core.validation_records,
                "witness_core_bytes": w.witness_core,
                "receipt_bytes": w.commit_receipt,
                "total_witness_bytes": w,
            }.items()
        }
        for _ in range(warmups):
            verify_cognitive_continuity(*args)
        for iteration in range(repeats):
            start = time.perf_counter_ns()
            encoded = tagged_bytes("WITNESS-CORE", w.witness_core)
            canonical_ns = time.perf_counter_ns() - start
            start = time.perf_counter_ns()
            hashlib.sha256(encoded).digest()
            digest_ns = time.perf_counter_ns() - start
            start = time.perf_counter_ns()
            report = verify_cognitive_continuity(*args)
            total_ns = time.perf_counter_ns() - start
            row = {
                "fixture_id": fixture.fixture_id,
                "family": fixture.transition_family,
                "subset": fixture.subset,
                "iteration": iteration,
                **sizes,
                "canonicalization_ns": canonical_ns,
                "digest_ns": digest_ns,
                "signature_verification_ns": sum(report.signature_verification_ns),
                "signature_verification_count": len(report.signature_verification_ns),
                "total_cct_ns": total_ns,
                **{f"stage_{k}_ns": v for k, v in report.stage_latency_ns.items()},
            }
            raw.append(row)
    summary = []
    for column in (
        [
            k
            for k in raw[0]
            if k.endswith(("_ns", "_bytes")) or k == "signature_verification_count"
        ]
        if raw
        else []
    ):
        values = np.array([row[column] for row in raw], dtype=float)
        summary.append(
            {
                "measurement": column,
                "unit": "ns"
                if column.endswith("_ns")
                else "bytes"
                if column.endswith("_bytes")
                else "count",
                "count": len(values),
                "fixtures": len(fixtures),
                "warmups_per_fixture": warmups,
                "repetitions_per_fixture": repeats,
                "median": float(np.median(values)),
                "p95": float(np.quantile(values, 0.95)),
                "p99": float(np.quantile(values, 0.99)),
                "mean": float(np.mean(values)),
                "std": float(np.std(values, ddof=1)) if len(values) > 1 else 0,
                "min": float(np.min(values)),
                "max": float(np.max(values)),
            }
        )
    return raw, summary

"""Regenerate measured tables and figures without rerunning or altering timings."""

import csv
import json
import os
from pathlib import Path


def read_results(directory):
    directory = Path(directory)
    cases = json.loads((directory / "cases.json").read_text())
    with (directory / "summary.csv").open() as stream:
        summary = {
            (r["case_id"], r["metric"]): {
                k: float(v)
                for k, v in r.items()
                if k in ("count", "median", "p95", "p99", "min", "max")
            }
            for r in csv.DictReader(stream)
        }
    return cases, summary


def plot_results(directory):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import ScalarFormatter

    directory = Path(directory)
    cases, summary = read_results(directory)
    colors = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#000000"]
    markers = ["o", "s", "^", "D", "v", "P"]
    plt.rcParams.update(
        {
            "font.family": "DejaVu Serif",
            "font.size": 10,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.titlesize": 11,
            "axes.labelsize": 10,
            "legend.fontsize": 8,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "savefig.dpi": 300,
        }
    )

    def group(name, field):
        return sorted((c for c in cases if name in c["groups"]), key=lambda c: c[field])

    def latencies(rows, stat="median"):
        return [summary[(c["case_id"], "total_cct_ns")][stat] / 1e6 for c in rows]

    def xscale(ax, ticks):
        ax.set_xscale("symlog", linthresh=4, base=4)
        ax.set_xticks(ticks)
        ax.xaxis.set_major_formatter(ScalarFormatter())
        ax.grid(True, alpha=0.18, linewidth=0.6)

    fig, axes = plt.subplots(1, 3, figsize=(12.8, 3.8), layout="constrained")
    combined = group("complexity", "mutations")
    xs = [c["mutations"] + c["dependencies"] + c["attestations"] for c in combined]
    if combined:
        for i, stat in enumerate(("median", "p95", "p99")):
            axes[0].plot(
                xs,
                latencies(combined, stat),
                marker=markers[i],
                color=colors[i],
                linestyle=("-", "--", ":")[i],
                label=stat,
            )
        axes[0].set_xscale("log")
        axes[0].set_yscale("log")
        axes[0].set_xticks(xs, [str(x) for x in xs])
        axes[0].legend()
    axes[0].set(
        title="(a) Combined witness complexity",
        xlabel="Mutations + dependencies + attestations",
        ylabel="Total verification latency (ms)",
    )
    axes[0].grid(True, alpha=0.18)
    for i, field in enumerate(("chronicle", "beliefs", "relationships")):
        rows = group(field, field)
        if rows:
            axes[1].plot(
                [c[field] for c in rows],
                latencies(rows),
                color=colors[i],
                marker=markers[i],
                label=field.capitalize(),
            )
    xscale(axes[1], [0, 16, 64, 256, 1024])
    axes[1].set(
        title="(b) Independent state sweeps",
        xlabel="Records in the varied component",
        ylabel="Median verification latency (ms)",
    )
    axes[1].legend()
    for i, mode in enumerate(("native", "all")):
        rows = [
            c
            for c in group("semantic_comparison", "chronicle")
            if c["semantic_mode"] == mode
        ]
        if rows:
            axes[2].plot(
                [c["chronicle"] for c in rows],
                latencies(rows),
                color=colors[i],
                marker=markers[i],
                linestyle=("-", "--")[i],
                label="Native"
                if mode == "native"
                else "Externally attested (10 records)",
            )
    xscale(axes[2], [16, 256, 1024])
    axes[2].set(
        title="(c) Semantic-check policy",
        xlabel="Chronicle = beliefs = relationships",
        ylabel="Median verification latency (ms)",
    )
    axes[2].legend()
    for ext in ("pdf", "png"):
        fig.savefig(
            directory / f"verifier_scaling.{ext}",
            bbox_inches="tight",
            metadata={"CreationDate": None, "ModDate": None} if ext == "pdf" else None,
        )
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.6, 4.0), layout="constrained")
    for i, count in enumerate((0, 1, 3, 5, 10, 32)):
        rows = [
            c for c in group("size_grid", "dependencies") if c["attestations"] == count
        ]
        if rows:
            ax.plot(
                [c["dependencies"] for c in rows],
                [c["witness_bytes"] / 1024 for c in rows],
                color=colors[i],
                marker=markers[i],
                linewidth=1.5,
                linestyle="-" if i < 3 else "--",
                label=f"{count} attestations",
            )
    xscale(ax, [0, 4, 16, 64, 256])
    ax.set(
        xlabel="Provenance dependencies",
        ylabel="Serialized witness (KiB)",
        title="Witness size: dependency and attestation sweeps",
    )
    ax.legend(ncols=2, loc="upper left")
    for ext in ("pdf", "png"):
        fig.savefig(
            directory / f"witness_size.{ext}",
            bbox_inches="tight",
            metadata={"CreationDate": None, "ModDate": None} if ext == "pdf" else None,
        )
    plt.close(fig)


def write_report(directory, report_path):
    directory, report_path = Path(directory), Path(report_path)
    cases, stats = read_results(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    environment = json.loads((directory / "environment.json").read_text())
    config, host = manifest["configuration"], environment["start"]
    base = next(
        (c for c in cases if c["case_id"] == "m1-d0-a0-h16-b16-r16-native"), cases[0]
    )
    linkbase = Path(os.path.relpath(directory, report_path.parent)).as_posix()

    def group(name, field):
        return sorted((c for c in cases if name in c["groups"]), key=lambda c: c[field])

    def metric(c, name="total_cct_ns"):
        return stats[(c["case_id"], name)]

    def triple(c, name="total_cct_ns"):
        s = metric(c, name)
        return " / ".join(f"{s[k] / 1e6:.4f}" for k in ("median", "p95", "p99"))

    lines = [
        "# CCT verifier overhead characterization",
        "",
        (
            f"Executed {manifest['started_at']} to {manifest['finished_at']}. "
            f"{config['case_count']} distinct valid workloads; {manifest['sample_count']:,} measured full verifications. "
            f"{config['warmups_per_case']} warmups and {config['repeats_per_case']} measured repetitions per case and component, "
            f"split across {config['blocks']} randomized blocks in one sequential process. "
            f"Measurement phase: {manifest['measurement_seconds']:.1f} s. All measured verdicts: {', '.join(manifest['observed_results'])}."
        ),
        "",
    ]
    if config["smoke_only"]:
        lines += [
            "**SMOKE RUN: insufficient repetitions for a characterization baseline.**",
            "",
        ]
    lines += [
        (
            "This is an unoptimized reference-verifier microbenchmark. It characterizes verifier overhead on parsed, resident synthetic inputs; "
            "it does not establish production throughput, a service-level latency bound, external evaluator latency, or open-world semantic correctness. "
            "No verifier, canonicalization, cryptographic or mutation-engine implementation was optimized for this run."
        ),
        "",
        "## Execution and reproducibility",
        "",
        "```sh",
        "make performance-benchmark",
        "",
        "# Regenerate figures/tables from the recorded samples, without retiming",
        ".venv/bin/python figures/gen_fig_verifier_performance.py",
        "```",
        "",
        (
            f"Configuration: seed `{config['seed']}`; quantiles `{config['quantile_method']}`. "
            "Samples are retained without outlier removal or overhead subtraction. p95/p99 are empirical, interpolated quantiles; "
            f"with {config['repeats_per_case']} repetitions the upper 1% contains only about {config['repeats_per_case'] / 100:g} observations. They are not confidence bounds or stable deployment-tail estimates."
        ),
        "",
        (
            f"CPU: **{host['hardware'].get('cpu_model') or host['hardware']['processor']}**; "
            f"{host['hardware']['logical_cpus']} logical CPUs; RAM: {host['hardware'].get('memory_bytes', 'unavailable')} bytes. "
            f"OS: `{host['platform']}`. Python: `{host['python'].splitlines()[0]}` ({host['implementation']}). "
            f"Cryptographic backend: `{host['cryptography_openssl']}`."
        ),
        "",
        "| Library | Version |",
        "| --- | --- |",
        *[
            f"| {name} | {host['installed_distributions'].get(name, host['packages'].get(name, 'unavailable'))} |"
            for name in (
                "cctbench",
                "rfc8785",
                "cryptography",
                "pydantic",
                "numpy",
                "matplotlib",
            )
        ],
        "",
        (
            f"Process ID `{host['pid']}`; Python active threads `{host['python_active_threads']}`; "
            f"GC enabled `{host['gc_enabled']}`, thresholds `{host['gc_thresholds']}`. "
            f"Thread-limit environment: `{host['thread_environment']}`. CPU affinity: `{host['affinity']}`. "
            f"Start/end load averages: `{host['load_average']}` / `{environment['end']['load_average']}`. "
            f"Median empty timer-pair cost: {environment['timer_pair_ns']['median']:.0f} ns (not subtracted)."
        ),
        "",
        config["controls"],
        "",
        environment["machine_control_limits"],
        "",
        (
            "Inputs and signatures are deterministic under the source, dependency and seed freeze; timings vary between runs. "
            "One benchmark process performs every timed operation; no other benchmark/test workload is launched by the runner. "
            "This local desktop was not converted into an isolated or fixed-frequency measurement appliance."
        ),
        "",
        (
            f"Verifier/engine/schema/crypto freeze: `{manifest['source_freeze']['verifier_sha256']}`. "
            f"Full benchmark source freeze: `{manifest['source_freeze']['sha256']}`. Files were checked unchanged after measurement."
        ),
        "",
        "## Workload construction and timing boundaries",
        "",
        (
            "The default source state has 16 chronicle events, 16 beliefs, 16 relationships, one non-amendable rule, "
            "and the generator's fixed governance, knowledge and working memory. Chronicle content and each dependency payload "
            "contain 128 ASCII characters. Event/record IDs use fixed-width indices. Native semantic scans validate unchanged "
            "chronicle/belief/relationship records; this does not cover every mutation family, deletion, tombstone, adverse evidence or early-failure path."
        ),
        "",
        (
            "Mutations are ordered UPDATE_RUNTIME_CONFIG writes to one existing setting, with distinct operation IDs. "
            "The candidate's serialized size stays fixed in the mutation sweep. Dependencies are distinct, cited, digest-verified "
            "documents in the trusted in-memory resolver snapshot. They do not require network access. "
            "One runtime authority signature and one kernel receipt signature are always verified; each selected validation record adds a real Ed25519 verification."
        ),
        "",
        (
            "Attestation-count and size-grid cases replace only I_bel with an external check for positive counts and use quorum 1, "
            "allowing the requested single-record case. The zero-record point uses native semantics. All positive records are authenticated "
            "PASS votes by distinct evaluators. The full semantic comparison replaces all five predicates using ten records "
            "(two independent signers per predicate, quorum 2). Each one-predicate comparison uses two records and quorum 1. "
            "The native predicates are also validated before timing to check the synthetic PASS assertions. "
            "The native and attested policies have different trust assumptions; attestation verification excludes the work and communication required to produce those attestations."
        ),
        "",
        (
            "Fixture generation, signing, serialization, parsing, disk I/O, and initial validity checks are outside timed regions. "
            "The full-call timer includes all five verifier stages, repeated hashing, existing signature/stage instrumentation, and report construction. "
            "GC remains in its original state and caches are not flushed. Inputs are reused. "
            "Full-call samples precede separately warmed component samples within each case/block; component order is shuffled each repetition. "
            "Direct component timings overlap work in other components and are **not additive**. A native component measured on an attested workload "
            "is counterfactual and is excluded from that workload's full-call path. The effective component chooses the policy-selected implementation."
        ),
        "",
        (
            "Witness bytes are compact RFC 8785 JSON of the normalized TransitionWitness, including core and signed receipt, with no tag wrapper or transport compression. "
            "They exclude predecessor/candidate states, trusted policy/context, resolved evidence and external attestation-generation traffic. "
            "Separate state/context byte counts appear in scaling.csv. Nanoseconds are timer units, not accuracy claims."
        ),
        "",
        "## Total verification versus witness complexity",
        "",
        (
            "Complexity here is the explicit count tuple (mutations, dependencies, attestations). The plotted sum is an index, "
            "not a claim that these operations have equal cost. Chronicle, belief and relationship counts stay at 16 in this sweep. "
            "All latency triples below are **median / p95 / p99 in milliseconds**."
        ),
        "",
        "| Mutations | Dependencies | Attestations | Witness bytes | Total latency (ms) |",
        "| ---: | ---: | ---: | ---: | ---: |",
    ]
    for c in group("complexity", "mutations"):
        lines.append(
            f"| {c['mutations']} | {c['dependencies']} | {c['attestations']} | {c['witness_bytes']:,} | {triple(c)} |"
        )
    if (directory / "verifier_scaling.png").exists():
        lines += [
            "",
            f"![Measured verifier scaling]({linkbase}/verifier_scaling.png)",
            "",
            f"[Vector PDF]({linkbase}/verifier_scaling.pdf). Error/tail lines are empirical quantiles, not confidence intervals.",
        ]
    lines += [
        "",
        "## Independent sweeps",
        "",
        (
            "Each sweep varies the named dimension and fixes the others at the default state, one mutation, zero dependencies "
            "and zero attestations, except that positive attestation counts select external I_bel."
        ),
        "",
    ]
    for field in (
        "mutations",
        "dependencies",
        "attestations",
        "chronicle",
        "beliefs",
        "relationships",
    ):
        lines += [
            f"### {field.capitalize()}",
            "",
            "| Count | Witness bytes | Predecessor bytes | Total latency (ms) |",
            "| ---: | ---: | ---: | ---: |",
        ]
        lines += [
            f"| {c[field]} | {c['witness_bytes']:,} | {c['predecessor_bytes']:,} | {triple(c)} |"
            for c in group(field, field)
        ]
        lines.append("")
    lines += [
        "## Witness size versus dependencies and attestations",
        "",
        "Serialized witness bytes; one mutation and 16 entries in each varied state component. Every grid cell is measured, not extrapolated.",
        "",
        "| Dependencies \\ attestations | 0 | 1 | 3 | 5 | 10 | 32 |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    grid = {
        (c["dependencies"], c["attestations"]): c
        for c in group("size_grid", "dependencies")
    }
    for d in (0, 4, 16, 64, 256):
        lines.append(
            f"| {d} | "
            + " | ".join(
                f"{grid[(d, a)]['witness_bytes']:,}" if (d, a) in grid else "—"
                for a in (0, 1, 3, 5, 10, 32)
            )
            + " |"
        )
    if (directory / "witness_size.png").exists():
        lines += [
            "",
            f"![Measured witness sizes]({linkbase}/witness_size.png)",
            "",
            f"[Vector PDF]({linkbase}/witness_size.pdf).",
        ]
    lines += [
        "",
        "## Native and externally attested semantics",
        "",
        (
            "Same predecessor, proposal and candidate at each state size; only validation records, receipt and trusted evaluator policy/context differ. "
            "N is the count of each of chronicle events, beliefs and relationships."
        ),
        "",
        "| N | Semantic policy | Attestations | Total latency (ms) |",
        "| ---: | --- | ---: | ---: |",
    ]
    for c in group("semantic_comparison", "chronicle"):
        lines.append(
            f"| {c['chronicle']} | {c['semantic_mode']} | {c['attestations']} | {triple(c)} |"
        )
    lines += [
        "",
        "One-predicate replacement at N = 256; other four predicates remain native.",
        "",
        "| Replaced predicate | Records | Total latency (ms) | Effective predicate latency (ms) |",
        "| --- | ---: | ---: | ---: |",
    ]
    for c in group("individual_semantics", "semantic_mode"):
        name = c["semantic_mode"]
        lines.append(
            f"| {name} | {c['attestations']} | {triple(c)} | "
            + (triple(c, f"effective_{name}_ns") if name != "native" else "—")
            + " |"
        )
    largest = (
        group("complexity", "mutations")[-1]
        if group("complexity", "mutations")
        else base
    )
    lines += [
        "",
        "## Component measurements",
        "",
        (
            f"Baseline `{base['case_id']}` versus largest combined witness `{largest['case_id']}`. "
            "Triples are milliseconds. Primitive signatures are pooled individual calls; the sum is per full verification. "
            "All per-case component quantiles and exact sample counts are in summary.csv."
        ),
        "",
        "| Measurement | Baseline (ms) | Largest witness (ms) |",
        "| --- | ---: | ---: |",
    ]
    for name in manifest["metric_definitions"]:
        if (base["case_id"], name) in stats:
            lines.append(
                f"| {name.removesuffix('_ns')} | {triple(base, name)} | {triple(largest, name)} |"
            )
    lines += ["", "### Measurement definitions", ""]
    lines += [
        f"- `{name}`: {description}"
        for name, description in manifest["metric_definitions"].items()
    ]
    lines += ["", "## Interpretation and limits", ""]
    totals = [metric(c)["median"] / 1e6 for c in cases]
    lines += [
        (
            f"Median full verification ranged from {min(totals):.3f} to {max(totals):.3f} ms across this grid. "
            "These values show the latency budget the current diagnostic implementation consumes on this host and these resident workloads. "
            "Operational acceptability depends on an application's transition frequency, state distribution and latency requirements; this experiment sets no universal pass/fail threshold."
        ),
        "",
    ]
    for field in ("dependencies", "attestations"):
        rows = group(field, field)
        if rows:
            first, last = rows[0], rows[-1]
            lines += [
                (
                    f"The isolated {field} sweep moved from {triple(first)} ms at {first[field]} to {triple(last)} ms at {last[field]}. "
                    "This is an observed endpoint comparison under the stated policies, not an additive causal decomposition."
                ),
                "",
            ]
    lines += [
        (
            "Lineage's stage timer includes state/proposal/core binding hashes, receipt verification and canonical-head checks. "
            "Signature primitive timing excludes preimage hashing and key parsing, while authority and attestation resolution include those costs. "
            "State application includes a deep copy and state digest. Repeated work remains in the baseline. "
            "Native history and temporal checks perform scans of retained records; these costs can dominate larger state cases. "
            "The existing attestation resolver recomputes the proposal digest while validating each record, so combined witness growth can cost more than signature verification alone. "
            "No implementation changes were made to reduce these costs."
        ),
        "",
        (
            "Limitations: a single host/session and synthetic transition family, warm resident inputs, modest record sizes, "
            "no evidence-service I/O, no external evaluator execution, no persistence, no key-service access, no concurrency, "
            "and no adversarial/failure-latency distribution. GC, scheduler and background-load noise remain visible. "
            "No transactions-per-second or production throughput claim is derived from reciprocal latency."
        ),
        "",
        "## Auditable artifacts",
        "",
        *[
            f"- [{name}]({linkbase}/{name})"
            for name in (
                "manifest.json",
                "environment.json",
                "workloads.jsonl",
                "samples.jsonl",
                "signature_samples.csv",
                "summary.csv",
                "scaling.csv",
                "cases.json",
            )
        ],
        "",
    ]
    report_path.write_text("\n".join(lines))

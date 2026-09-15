"""Human-readable report generated exclusively from executed result records."""

from collections import Counter


def write_report(path, manifest, counts, aggregate, ablations, overhead, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    config = manifest["configuration"]
    lines = [
        "# CCTBench executed evaluation",
        "",
        f"Run: {manifest['run_timestamp_utc']}. Source digest: `{manifest['source_digest']}`.",
        f"Fixture SHA-256: `{manifest['fixture_sha256']}`.",
        "",
        "## Dataset and split",
        "",
        f"Generated **{counts['total']} fixtures**: {counts['by_split']['development']} development and {counts['by_split']['test']} held out. "
        f"There are {config['development_identities']} development identities and {config['evaluation_identities']} evaluation identities, each with {config['epochs']} consecutive source epochs.",
        "",
        "| Subset | Development | Held out |",
        "| --- | ---: | ---: |",
    ]
    for subset in ["canonical", "single_fault", "compound_fault"]:
        n = lambda split: sum(
            v["count"]
            for v in counts["rows"]
            if v["split"] == split and v["subset"] == subset
        )
        lines.append(f"| {subset} | {n('development')} | {n('test')} |")
    lines += [
        "",
        "The canonical set contains all 24 manuscript families. The conformance subset contains 20 distinct single-fault constructions; four compound constructions form the additional adversarial subset. "
        "Identities are generated independently with disjoint seeds and namespaced event, memory, evidence, and summary identifiers. Only authorized L2 transitions advance source histories. "
        "No attack becomes a source ancestor. The split audit checks identity IDs and serialized source/candidate states, historical events, and memory items for reuse across splits.",
        "",
        f"Conformance audit violations observed: **{manifest['conformance_violations']}**. Each held-out single-fault fixture is checked against its intended sole non-PASS condition.",
        "",
        "## Frozen baseline configurations",
        "",
        f"Arm A uses `{manifest['calibration']['embedding']['backend']}` version `{manifest['calibration']['embedding']['version']}`. "
        "The default is a signed lexical token-count embedding with cosine similarity, not a pretrained semantic model. The projection is canonical state JSON without the derived state digest.",
        f"Arm A threshold: `{manifest['calibration']['A']['threshold']:.17g}`. Arm B threshold: `{manifest['calibration']['B']['threshold']:.17g}`. "
        "Arm B measures exact canonical memory-item intersection divided by predecessor set size. Thresholds maximize balanced accuracy on development canonical VALID/INVALID fixtures; ties favor valid acceptance, then the higher threshold. Indeterminate labels do not enter calibration.",
        f"Arm C status: **{manifest['sit']['status']}**. {manifest['sit'].get('reason') or 'Frozen configuration and probe counts are recorded in benchmark_manifest.json.'}",
        "Arm D executes actual lineage, receipt-signature, scope, core-binding and canonical-head checks; it never executes authority, provenance or semantic checks. It maps internal PASS, FAIL and UNKNOWN to VALID, INVALID and INDETERMINATE, respectively. "
        "Arm E collects all five stages and their diagnostics, including checks after a decisive failure. Arm F is the declared generator-label oracle and is not independent validation.",
        "",
        "## Canonical held-out results",
        "",
        "Each rate below is measured from an executed fixture. Values are percentages with fixture-bootstrap 95% intervals; unavailable executions have no predicted verdict and no invented score.",
        "",
        "| Arm | Executed / total | VAR | VRR | VIR | IAR | IDR | Indeterminate detection |",
        "| --- | ---: | --- | --- | --- | --- | --- | --- |",
    ]

    def fmt(rate):
        if rate["estimate"] is None:
            return "—"
        lo, hi = rate["ci95"]
        return f"{100 * rate['estimate']:.1f} [{100 * lo:.1f}, {100 * hi:.1f}]"

    for arm, data in aggregate["arms"].items():
        stat = data["subsets"]["canonical"]
        rates = stat["rates"]
        lines.append(
            f"| {arm}: {data['name']} | {stat['executed']} / {stat['n']} | "
            + " | ".join(
                fmt(rates[k]) for k in ["VAR", "VRR", "VIR", "IAR", "IDR", "IDR_indet"]
            )
            + " |"
        )
    lines += [
        "",
        f"Intervals use {config['bootstrap_samples']} IID held-out-fixture bootstrap replicates with seed {config['master_seed'] + 1}. "
        "Resampling observed confusion cells is equivalent to resampling fixture rows for these rates. Denominator-zero rates are null, not zero. "
        "Epochs from the same identity are dependent: these intervals describe the synthetic fixture population and do not establish population-level generalization to new identities.",
        "",
        "Binary Arms A--C cannot predict INDETERMINATE; this is a decision-domain limitation, not an unavailable run. Arm D and the full verifier use ternary decisions. Full confusion matrices retain the INDETERMINATE truth row and a separate UNAVAILABLE execution column. "
        "Aggregate metrics include canonical, conformance, compound and complete sets, plus per-invariant detection, execution coverage, decision coverage, and abstention.",
        "",
        "## Ablations on the single-fault set",
        "",
        "| Disabled checker | Fixtures | Newly misclassified | Incorrectly admitted |",
        "| --- | ---: | ---: | ---: |",
    ]
    for a in ablations:
        if a["case"] == "all":
            lines.append(
                f"| {a['disabled']} | {a['n']} | {a['newly_misclassified']} | {a['incorrectly_admitted']} |"
            )
    lines += [
        "",
        "`ablation_per_fixture.jsonl` identifies every affected fixture and baseline/ablated verdict. Compound attacks are excluded from checker attribution.",
        "",
        "## Systems overhead",
        "",
        "Timings include full diagnostics and actual Ed25519 verification. Signature timing records cryptographic verification calls; canonicalization and SHA-256 digest timing are measured separately for the finalized-core tagged preimage. "
        "Serialization bytes are measured independently for q, V, the finalized core, the receipt, and the full witness envelope.",
        "",
        "| Measurement | Unit | n | Median | p95 | p99 |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for v in overhead:
        scale = 1e6 if v["unit"] == "ns" else 1
        unit = "ms" if v["unit"] == "ns" else v["unit"]
        lines.append(
            f"| {v['measurement']} | {unit} | {v['count']} | {v['median'] / scale:.4f} | {v['p95'] / scale:.4f} | {v['p99'] / scale:.4f} |"
        )
    lines += [
        "",
        f"Each timed fixture receives {config['overhead_warmups']} warm-up runs and {config['overhead_repeats']} measured runs. "
        "The sample is selected by family/case order before timing. Percentiles are descriptive and sensitive to sample count and OS/runtime noise; no microsecond accuracy guarantee is implied. `environment.json` records hardware, interpreter and dependency versions.",
        "",
        "## Observed failures and limits",
        "",
    ]
    for arm in "ABCDE":
        measured = [
            v
            for v in rows
            if v["arm"] == arm
            and v["subset"] == "canonical"
            and v["status"] == "executed"
        ]
        if not measured:
            lines.append(
                f"- Arm {arm}: unavailable; no canonical predictions were executed."
            )
            continue
        failed = [v for v in measured if v["prediction"] != v["ground_truth"]]
        lines.append(
            f"- Arm {arm}: {len(failed)} misclassifications among {len(measured)} executed canonical fixtures. "
            + (
                "Families: "
                + ", ".join(
                    f"{k} ({v})"
                    for k, v in sorted(Counter(x["family"] for x in failed).items())
                )
                + "."
                if failed
                else ""
            )
        )
    lines += [
        "- Arm C receives no simulated predictions when its model/probe configuration is unavailable.",
        "- Perfect conformance on this deliberately constructed, structured domain is not empirical evidence of open-world semantic understanding. Native predicates assume the declared trusted context and evidence resolver. Signature authenticity does not establish external truth or honest storage.",
        "- Synthetic signing keys are publicly seed-derived for reproduction; they are not production credentials.",
        "",
        "## Reproduction",
        "",
        "```sh",
        "make benchmark",
        "```",
        "",
        "This command installs the locked local dependencies into `.venv`, regenerates fixtures, calibrates on development identities, executes local arms and ablations, measures overhead, and rewrites this report. "
        "The default run does not invoke external models. Use `cctbench benchmark --sit-config <frozen.json>` only with an explicitly configured candidate command and frozen SITBench/probe artifacts.",
        "",
        "The run configuration is recorded verbatim in `results/benchmark_manifest.json`. Timing samples and run timestamps vary; fixture bytes, signed objects, decisions, calibration and bootstrap summaries are deterministic for a fixed source/dependency/configuration freeze.",
        "",
    ]
    path.write_text("\n".join(lines))

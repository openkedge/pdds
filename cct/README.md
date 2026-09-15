# CCTBench

**A reference verifier and reproducible benchmark for the Cognitive Continuity Test (CCT).**

CCTBench checks whether a persistent AI agent's proposed state transition preserves its governed identity: authorized changes, historical continuity, supported beliefs, relationship commitments, and provenance. Given a predecessor state, candidate successor, transition witness, policy, and trusted verification context, it returns **VALID**, **INVALID**, or **INDETERMINATE**, with condition-level diagnostics.

This repository accompanies *The Cognitive Continuity Test: Verifying Governed State Transitions in Persistent AI Agents*. It includes an executable Python verifier, deterministic synthetic fixtures, comparison baselines, security regression tests, and evaluation reports. The default benchmark runs locally without external model calls. It is an offline research reference implementation; its evaluation covers structured synthetic transitions.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Benchmark design](#benchmark-design) · [Documentation](#documentation) · [Contributing](#contributing)

## OpenKedge and PCI

CCTBench is part of [OpenKedge's work on Persistent Cognitive Identity (PCI)](https://www.openkedge.io/pci). [OpenKedge](https://www.openkedge.io) develops research and reference architectures for AI systems that keep execution authority, policy, and institutional memory under the control of the organizations that operate them. Its research connects the governance of autonomous actions with the continuity of the agents carrying them out.

**Persistent Cognitive Identity (PCI)** is an architecture for carrying an AI system's memory, beliefs, consent boundaries, and operational authority across model upgrades, provider changes, and runtime migrations. CCT addresses the transition-verification part of that work: checking whether a proposed successor satisfies explicit continuity requirements under a trusted policy. Read the [PCI overview](https://www.openkedge.io/pci) for the broader architecture and research agenda.

## Quick start

Requires **Python 3.12+**, `make`, and access to a Python package index for the initial installation. Run these commands from the repository root:

```sh
# Install dependencies and reproduce the default evaluation
make benchmark

# Run the test suite
make test
```

`make benchmark` creates `.venv`, installs the pinned dependencies in `requirements.lock` and the local package, regenerates fixtures, calibrates baselines on development identities, evaluates the held-out split, and runs ablations and overhead measurements. It writes machine-readable artifacts to `results/` and updates [the evaluation report](docs/evaluation-results.md).

To select a Python interpreter, use `make benchmark PYTHON=/path/to/python3.12`. To install without running a benchmark, use `make setup`.

For a smaller run with separate outputs:

```sh
make setup
.venv/bin/cctbench benchmark \
  --development-identities 1 --evaluation-identities 1 --epochs 2 \
  --output-dir scratch/results --fixtures-dir scratch/fixtures \
  --report-path scratch/evaluation-results.md
```

To generate fixtures independently and inspect a single transition:

```sh
.venv/bin/cctbench generate-fixtures --output-dir fixtures

.venv/bin/cctbench verify fixtures/generated.jsonl \
  --fixture-id 'urn:cct:20260904:test:000:epoch:4:canonical:I3'
```

The example selects a prohibited core modification and should return `INVALID`. The JSON report includes individual condition results, stage results, a decisive reason, digests, and timings. Run `.venv/bin/cctbench --help` or append `--help` to any subcommand for available options.

## How it works

A transition witness binds the proposed mutations to signed authority, validation evidence, and a kernel commit receipt:

```text
proposal q -> proposal digest -> signed validation records V
    q + V -> finalized witness core -> core digest -> signed commit receipt
```

The verifier checks five stages:

1. **Lineage:** predecessor and scope bindings, receipt authenticity, and required canonical-head evidence.
2. **Authority:** permission under predecessor governance, including thresholds for the mutation class.
3. **Provenance:** required dependency declarations and the digests of resolved evidence.
4. **State application:** deterministic replay of the ordered mutation manifest against the predecessor.
5. **Semantics:** historical, temporal, belief, relational, and normative predicates, or the external attestations required by policy.

Each condition returns `PASS`, `FAIL`, or `UNKNOWN`. The aggregate verdict follows these rules:

| Verdict | Meaning |
| --- | --- |
| `VALID` | All required checks pass. |
| `INVALID` | At least one check fails, even if other evidence is missing. |
| `INDETERMINATE` | No check fails, but at least one required check is unresolved. |

The eight invariant groups are lineage (`I_lin`), authority (`I_auth`), history (`I_hist`), time (`I_temp`), beliefs (`I_bel`), relationships (`I_rel`), normative constraints (`I_norm`), and provenance (`I_prov`). State application is checked separately. Diagnostic execution collects 13 condition records and continues after decisive failures.

Digests use SHA-256 over type- and version-tagged JSON canonicalized with RFC 8785 JCS. Authority, evaluator, and kernel signatures use Ed25519. Fixture format `2.0.0`, cryptographic protocol `1.0.0`, and synthetic policy `v2.0.0` are separate version identifiers. The [formal object model](docs/formal-object-model.md) defines the signed preimages, trusted inputs, evidence requirements, and predicate scope.

Native semantic checks operate on structured evidence. For example, a belief revision requires support bound to its identity, epoch, proposition, value, and confidence; relationship changes require scoped positive interaction records. A required external attestation replaces the named native semantic predicate and must satisfy proposal binding, evaluator authorization, policy, signature, freshness, and quorum checks.

## Benchmark design

The default run generates **1,728 fixtures**: 576 development fixtures and 1,152 held-out fixtures. Every source epoch contains 24 canonical families, 20 single-fault cases, and four compound cases.

| Setting | Default |
| --- | --- |
| Random seed | `20260904` |
| Development / held-out identities | 4 / 8 |
| Consecutive source epochs per identity | 3 |
| Bootstrap replicates | 1,000 |
| Overhead warm-ups / measured repetitions per selected fixture | 2 / 5 |

### Transition families

| Families | Cases |
| --- | --- |
| L1–L5: legitimate | Factual learning; episodic memory; justified belief revision; relational deepening; memory consolidation |
| L6–L10: legitimate | Permitted forgetting; provenance-backed correction; runtime upgrade; authenticated recovery; substrate migration |
| I1–I5: invalid | Autobiographical fabrication; retroactive beliefs; prohibited core modification; unjustified trust; historical suppression |
| I6–I10: invalid | Unlogged mutation; unauthorized succession; stale rollback; forged receipt; corrupt provenance |
| D1–D4: indeterminate | Missing required provenance; unresolved head; unreachable evidence; conflicting authenticated quorums |

The cases distinguish authority, authenticity, and admissibility. I3 has valid lineage and sufficient class-level authority but changes a non-amendable core rule. I7 has an authentic receipt and copies the entire state, but its signer lacks succession authority. I9 introduces a forged or mismatched receipt.

Single-fault fixtures isolate individual conditions for checker attribution. Compound fixtures combine unauthorized normative changes, undeclared historical rewriting, corrupt provenance with retroactive beliefs, or missing evidence with a definite violation. All ten ablations use only the single-fault subset.

Identities and their histories stay within one split. Only valid L2 transitions advance source histories; attacks remain counterfactual branches. The split audit checks for shared identifiers and reused serialized states, events, and memory items. Evaluated arms A–E do not use fixture family names or generator labels to predict outcomes.

### Comparison arms

| Arm | Method | Verdict domain |
| --- | --- | --- |
| A | Canonical state projection, configurable embedding, cosine similarity | Binary |
| B | Exact canonical memory-set intersection divided by predecessor memory-set size | Binary |
| C | Native SITBench extraction and scoring with an authenticated reference history and configured candidate model | Binary; unavailable by default |
| D | Cryptographic lineage, scope, receipt, core, and canonical-head verification | Ternary |
| E | Full CCT verifier | Ternary |
| F | Declared generator-label oracle | Ternary scoring reference |

Arm A defaults to a deterministic, 256-dimensional signed lexical token-count embedding. It is **not a pretrained semantic encoder**. Use `--embedding-backend package.module:factory` to supply another backend; its object must expose `embed(text)` and `configuration()`. Record the backend, version, model/revision, and preprocessing identifiers, and freeze external assets before comparing results. Vectors must be nonempty, finite, and consistently shaped.

Arms A and B calibrate thresholds on development canonical `VALID`/`INVALID` fixtures by maximizing balanced accuracy. Ties favor valid acceptance, then the higher threshold. `INDETERMINATE` fixtures do not enter calibration. Thresholds, fixture IDs, and configurations are saved before held-out evaluation. Arm B requires nonempty predecessor memory, which all generated sources provide.

Arm C integrates the **Situated Identity Test (SIT)** through SITBench and requires a frozen model command, probe bundle, and configuration. See [SIT integration](docs/sit-integration.md). Unavailable executions have null predictions and scores and a separate confusion-matrix column. Binary arms cannot emit `INDETERMINATE`; Arm F is an oracle reference, not independent verification.

### Results and reproducibility

Start with the [executed evaluation report](docs/evaluation-results.md) for measured outcomes, confusion matrices, ablations, and limitations.

`results/` stores the run manifest, calibration, per-fixture predictions, aggregate and per-family metrics, conformance audit, ablations, overhead samples, and environment metadata. Generated inputs are in `fixtures/generated.jsonl`; `fixtures/identity_histories.jsonl` links consecutive source states. Each measured row binds its fixture through `fixture_digest`. `ground_truth` is the labeled scoring reference; predictions, scores, and diagnostics come from execution, except for the declared oracle arm.

Metrics separate acceptance, rejection, indeterminacy, execution coverage, decision coverage, and abstention. Invalid detection counts actual `INVALID` predictions; it is not computed as one minus invalid acceptance. Outcome rates use executed fixtures of the relevant truth class, and zero-denominator rates are null.

The 95% percentile intervals bootstrap held-out fixtures through their observed confusion cells. Epochs and mutations within an identity are dependent, so these intervals do not establish generalization to a population of new identities. Canonical, single-fault, and compound results are reported separately.

Fixtures, signatures, calibration, predictions, and bootstrap summaries are deterministic for a fixed source, dependency, and configuration freeze. Timings and run timestamps vary.

## Verifier performance

The separate [verifier performance report](docs/verifier-performance.md) characterizes overhead on 60 distinct valid, signed workloads. The default run uses 10 warm-ups and 300 measured repetitions per case and component, arranged in five shuffled blocks in one sequential process.

```sh
make performance-benchmark

# Recreate figures and tables from recorded measurements
.venv/bin/python figures/gen_fig_verifier_performance.py
```

The workload suite varies mutation, dependency, and attestation counts; chronicle, belief, and relationship sizes from 0 to 1,024; and native versus externally attested semantics. `results/performance/` contains raw timings, signature samples, frozen workloads, source and environment metadata, median/p95/p99 tables, and PDF/PNG figures.

To customize the run and keep the recorded baseline in place:

```sh
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
  .venv/bin/cctbench performance --repeats 500 --warmups 10 \
  --output-dir scratch/performance --report-path scratch/performance.md
```

These are microbenchmark measurements of the unoptimized diagnostic verifier on parsed, resident objects. Full-call timing excludes evidence retrieval, attestation generation, serialization, and persistence. It does not establish production throughput or service latency. Nanoseconds are timer units, not an accuracy guarantee.

## Documentation

| Guide | Contents |
| --- | --- |
| [Formal object model](docs/formal-object-model.md) | Schemas, cryptographic bindings, trust boundaries, and native evidence contracts |
| [Security and conformance](docs/security-conformance.md) | Executable properties, adversarial cases, and missing-versus-contradictory evidence |
| [Soundness regression report](docs/soundness-regression.md) | Generated outcomes from the security property suite |
| [Evaluation results](docs/evaluation-results.md) | Recorded benchmark configuration, outcomes, metrics, and ablations |
| [Verifier performance](docs/verifier-performance.md) | Timing methodology, scaling measurements, and figures |
| [SIT integration](docs/sit-integration.md) | Optional SITBench adapter and reproducibility contract |

## Repository layout

```text
src/cctbench/
  schema/       Typed states, policies, fixtures, and witnesses
  engine/       Ordered state-mutation application
  verifier/     Five-stage verifier and invariant checkers
  generator/    Synthetic identities and transition families
  eval/         Baselines, metrics, reports, and performance harnesses
  cli.py        Command-line entry points
tests/          Unit, integration, and security property tests
fixtures/       Generated benchmark inputs and identity histories
results/        Recorded evaluation artifacts and performance measurements
docs/           Technical specifications and generated reports
figures/        Performance figure-generation script
```

## Scope and limitations

- **Structured synthetic evaluation.** Conformance on these fixtures does not establish open-world semantic understanding. Native predicates check explicit evidence structures, including exact belief-support tuples, rather than natural-language entailment.
- **Trusted inputs.** Callers must supply authenticated historical policy, keys, governance context, head evidence, and resolver snapshots. The paper's `ResolvePolicy` stage is outside this executable profile. Authentic signatures establish bindings and issuers under that context; they do not establish external truth or honest storage.
- **Research keys and infrastructure.** Signing keys are public and seed-derived for reproducibility. Production key management, trusted storage, and live evidence services are outside the repository's offline profile.
- **Simulated transitions.** Upgrade, recovery, and migration fixtures change structured runtime descriptors. They do not perform real model migrations or measure behavioral equivalence across runtimes.
- **Typed input profile.** The interface accepts schema-valid objects and supported evidence omissions, rather than the paper's general partial-input parser. An omitted mutation manifest defaults to an empty list. Knowledge-time checks cover structured entries with `claimed_at`; untyped knowledge values are outside that temporal guarantee.

## Contributing

Contributions to verifier correctness, reproducible evaluations, fixtures, and documentation are welcome. For a bug report, include the command, seed or fixture ID, environment, and expected versus observed result. For a new transition case, explain which condition it exercises and what evidence should make that condition pass, fail, or remain unresolved.

Run the checks relevant to your change:

```sh
make test           # Complete test suite
make security-test  # Security properties and generated regression report
make ci             # Complete suite, regression report, and JUnit output
```

The [GitHub Actions workflow](.github/workflows/security-conformance.yml) runs `make ci` on pushes, pull requests, and manual dispatch. It publishes the generated soundness report and JUnit results. Changes to benchmark behavior should also include a reproducible run configuration and an explanation of any changed outcomes.

## License

CCTBench is licensed under the [MIT License](LICENSE). Copyright (c) 2026 OpenKedge LLC.

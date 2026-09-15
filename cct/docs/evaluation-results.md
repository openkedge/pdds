# CCTBench executed evaluation

Run: 2026-09-09T07:27:18.014380+00:00. Source digest: `sha256:7ddb87371e9531159845d56c48f1911d3392d8606fb8b7638e7537b7fa9e6ee8`.
Fixture SHA-256: `ff5a3d6262eb88e8e4b5e0c9d4d9e889cd812d317708ed01abf2dbadf8374268`.

## Dataset and split

Generated **1728 fixtures**: 576 development and 1152 held out. There are 4 development identities and 8 evaluation identities, each with 3 consecutive source epochs.

| Subset | Development | Held out |
| --- | ---: | ---: |
| canonical | 288 | 576 |
| single_fault | 240 | 480 |
| compound_fault | 48 | 96 |

The canonical set contains all 24 manuscript families. The conformance subset contains 20 distinct single-fault constructions; four compound constructions form the additional adversarial subset. Identities are generated independently with disjoint seeds and namespaced event, memory, evidence, and summary identifiers. Only authorized L2 transitions advance source histories. No attack becomes a source ancestor. The split audit checks identity IDs and serialized source/candidate states, historical events, and memory items for reuse across splits.

Conformance audit violations observed: **0**. Each held-out single-fault fixture is checked against its intended sole non-PASS condition.

## Frozen baseline configurations

Arm A uses `sha256-signed-token-count` version `1.0.0`. The default is a signed lexical token-count embedding with cosine similarity, not a pretrained semantic model. The projection is canonical state JSON without the derived state digest.
Arm A threshold: `0.99994358339178935`. Arm B threshold: `0`. Arm B measures exact canonical memory-item intersection divided by predecessor set size. Thresholds maximize balanced accuracy on development canonical VALID/INVALID fixtures; ties favor valid acceptance, then the higher threshold. Indeterminate labels do not enter calibration.
Arm C status: **unavailable**. No frozen SIT model/probe configuration supplied
Arm D executes actual lineage, receipt-signature, scope, core-binding and canonical-head checks; it never executes authority, provenance or semantic checks. It maps internal PASS, FAIL and UNKNOWN to VALID, INVALID and INDETERMINATE, respectively. Arm E collects all five stages and their diagnostics, including checks after a decisive failure. Arm F is the declared generator-label oracle and is not independent validation.

## Canonical held-out results

Each rate below is measured from an executed fixture. Values are percentages with fixture-bootstrap 95% intervals; unavailable executions have no predicted verdict and no invented score.

| Arm | Executed / total | VAR | VRR | VIR | IAR | IDR | Indeterminate detection |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| A: State Similarity | 576 / 576 | 78.8 [73.1, 84.1] | 21.2 [15.9, 26.9] | 0.0 [0.0, 0.0] | 60.0 [53.7, 66.0] | 40.0 [34.0, 46.3] | 0.0 [0.0, 0.0] |
| B: Memory-Set Overlap | 576 / 576 | 100.0 [100.0, 100.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 100.0 [100.0, 100.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| C: SIT | 0 / 576 | — | — | — | — | — | — |
| D: Cryptographic Lineage | 576 / 576 | 100.0 [100.0, 100.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 80.0 [74.7, 84.8] | 20.0 [15.2, 25.3] | 25.0 [17.0, 33.3] |
| E: Full CCT | 576 / 576 | 100.0 [100.0, 100.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |
| F: Oracle | 576 / 576 | 100.0 [100.0, 100.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] |

Intervals use 1000 IID held-out-fixture bootstrap replicates with seed 20260905. Resampling observed confusion cells is equivalent to resampling fixture rows for these rates. Denominator-zero rates are null, not zero. Epochs from the same identity are dependent: these intervals describe the synthetic fixture population and do not establish population-level generalization to new identities.

Binary Arms A--C cannot predict INDETERMINATE; this is a decision-domain limitation, not an unavailable run. Arm D and the full verifier use ternary decisions. Full confusion matrices retain the INDETERMINATE truth row and a separate UNAVAILABLE execution column. Aggregate metrics include canonical, conformance, compound and complete sets, plus per-invariant detection, execution coverage, decision coverage, and abstention.

## Ablations on the single-fault set

| Disabled checker | Fixtures | Newly misclassified | Incorrectly admitted |
| --- | ---: | ---: | ---: |
| I_lin | 480 | 144 | 144 |
| I_auth | 480 | 48 | 48 |
| I_hist | 480 | 24 | 24 |
| I_temp | 480 | 24 | 24 |
| I_bel | 480 | 96 | 96 |
| I_rel | 480 | 24 | 24 |
| I_norm | 480 | 24 | 24 |
| I_prov | 480 | 72 | 72 |
| state_application | 480 | 24 | 24 |
| attestation_resolution | 480 | 72 | 72 |

`ablation_per_fixture.jsonl` identifies every affected fixture and baseline/ablated verdict. Compound attacks are excluded from checker attribution.

## Systems overhead

Timings include full diagnostics and actual Ed25519 verification. Signature timing records cryptographic verification calls; canonicalization and SHA-256 digest timing are measured separately for the finalized-core tagged preimage. Serialization bytes are measured independently for q, V, the finalized core, the receipt, and the full witness envelope.

| Measurement | Unit | n | Median | p95 | p99 |
| --- | --- | ---: | ---: | ---: | ---: |
| proposal_bytes | bytes | 135 | 1343.0000 | 1619.0000 | 1622.0000 |
| validation_records_bytes | bytes | 135 | 2.0000 | 1705.0000 | 1705.0000 |
| witness_core_bytes | bytes | 135 | 1400.0000 | 2999.0000 | 3083.0000 |
| receipt_bytes | bytes | 135 | 654.0000 | 654.0000 | 654.0000 |
| total_witness_bytes | bytes | 135 | 2115.0000 | 3714.0000 | 3798.0000 |
| canonicalization_ns | ms | 135 | 0.0677 | 0.1332 | 0.1365 |
| digest_ns | ms | 135 | 0.0010 | 0.0015 | 0.0016 |
| signature_verification_ns | ms | 135 | 0.4457 | 1.0226 | 1.0802 |
| signature_verification_count | count | 135 | 3.0000 | 7.0000 | 7.0000 |
| total_cct_ns | ms | 135 | 2.2539 | 3.1653 | 3.2769 |
| stage_1_lineage_ns | ms | 135 | 0.8043 | 0.8678 | 0.8735 |
| stage_2_authority_ns | ms | 135 | 0.4016 | 0.4286 | 0.4443 |
| stage_3_provenance_ns | ms | 135 | 0.0136 | 0.0187 | 0.0568 |
| stage_4_state_application_ns | ms | 135 | 0.5593 | 0.6186 | 0.6305 |
| stage_5_semantics_ns | ms | 135 | 0.1096 | 0.9937 | 1.0577 |

Each timed fixture receives 2 warm-up runs and 5 measured runs. The sample is selected by family/case order before timing. Percentiles are descriptive and sensitive to sample count and OS/runtime noise; no microsecond accuracy guarantee is implied. `environment.json` records hardware, interpreter and dependency versions.

## Observed failures and limits

- Arm A: 291 misclassifications among 576 executed canonical fixtures. Families: D1 (24), D2 (24), D3 (24), D4 (24), I10 (24), I2 (24), I4 (24), I6 (24), I7 (24), I9 (24), L2 (24), L3 (3), L5 (24).
- Arm B: 336 misclassifications among 576 executed canonical fixtures. Families: D1 (24), D2 (24), D3 (24), D4 (24), I1 (24), I10 (24), I2 (24), I3 (24), I4 (24), I5 (24), I6 (24), I7 (24), I8 (24), I9 (24).
- Arm C: unavailable; no canonical predictions were executed.
- Arm D: 264 misclassifications among 576 executed canonical fixtures. Families: D1 (24), D3 (24), D4 (24), I1 (24), I10 (24), I2 (24), I3 (24), I4 (24), I5 (24), I6 (24), I7 (24).
- Arm E: 0 misclassifications among 576 executed canonical fixtures. 
- Arm C receives no simulated predictions when its model/probe configuration is unavailable.
- Perfect conformance on this deliberately constructed, structured domain is not empirical evidence of open-world semantic understanding. Native predicates assume the declared trusted context and evidence resolver. Signature authenticity does not establish external truth or honest storage.
- Synthetic signing keys are publicly seed-derived for reproduction; they are not production credentials.

## Reproduction

```sh
make benchmark
```

This command installs the locked local dependencies into `.venv`, regenerates fixtures, calibrates on development identities, executes local arms and ablations, measures overhead, and rewrites this report. The default run does not invoke external models. Use `cctbench benchmark --sit-config <frozen.json>` only with an explicitly configured candidate command and frozen SITBench/probe artifacts.

The run configuration is recorded verbatim in `results/benchmark_manifest.json`. Timing samples and run timestamps vary; fixture bytes, signed objects, decisions, calibration and bootstrap summaries are deterministic for a fixed source/dependency/configuration freeze.

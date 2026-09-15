# CAC v0.4 Confirmatory Performance Report

**Batch ID**: `batch-cac-v0.4-study`
**Completed**: 2026-09-13T16:22:57.750Z
**Contract Digest**: `4cd89808c47313226b2fd3aaae87277146f58d960428c4b9fab61a5e26d7581d`

## Resident Overhead Across Risk Tiers

Resident microbenchmarks executed 20,000 valid-path iterations per tier:

| Risk Tier | p50 (μs) | p90 (μs) | p99 (μs) | Max (μs) | Mean (μs) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TIER_0** | 108.1 | 113.1 | 131.9 | 1177.7 | 107.9 |
| **TIER_1** | 206.6 | 214.8 | 241.2 | 3003.8 | 207.8 |
| **TIER_2** | 205.7 | 212.1 | 230.5 | 1509.2 | 205.7 |
| **TIER_3** | 206.2 | 211.1 | 233.4 | 6364.2 | 209.5 |

## Scaling Characteristics
- **Key Precomputation**: Pre-generating the controller's Ed25519 signing key ensures steady-state resident operations avoid keypair generation jitter.
- **Verification Throughput**: Over 2,000 ops/sec supported on Tier 3 with complete structural epistemic fault domain checks.

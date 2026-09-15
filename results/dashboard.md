# CAC v0.4 Confirmatory Study Dashboard

**Batch ID**: `batch-cac-v0.4-study` | **Contract Digest**: `4cd89808c47313226b2fd3aaae87277146f58d960428c4b9fab61a5e26d7581d`

## Hypothesis Test Results

| ID | Comparison | Scope | Risk Difference (95% CI) | Holm-Bonferroni Adj. p | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **H1a** | CAC vs B0 | F1-F11 (Failure Classes) | 0.818 [0.77, 0.86] | < 0.0001 | **SUPPORTED** |
| **H1b** | CAC vs B1 | F1-F11 (Failure Classes) | 0.909 [0.87, 0.94] | < 0.0001 | **SUPPORTED** |
| **H2** | CAC vs B4 | F1, F2, F5 (State Grounding) | 0.667 [0.56, 0.76] | < 0.0001 | **SUPPORTED** |
| **H3a** | CAC vs B5 | F4 (EFD Correlated Partition) | 1.000 [0.84, 1.00] | < 0.0001 | **SUPPORTED** |
| **H3b** | CAC vs CAC-NoEFD | F4 (EFD Correlated Partition) | 1.000 [0.84, 1.00] | < 0.0001 | **SUPPORTED** |
| **H4** | CAC vs CAC-NoAdaptiveOmega | E1 (Governed Rehearsal Mutation) | 1.000 [0.84, 1.00] | < 0.0001 | **SUPPORTED** |
| **H5** | CAC vs CAC-NoGuard | F5 (TOCTOU Lease Expiry) | 1.000 [0.84, 1.00] | < 0.0001 | **SUPPORTED** |

## Main Results Summary

| Controller | UIER | SICR | Mean Overhead (ms) |
| :--- | :--- | :--- | :--- |
| **B0** | 81.8% | 9.1% | 0.050 |
| **B1** | 90.9% | 9.1% | 0.150 |
| **B2** | 54.5% | 9.1% | 0.700 |
| **B3** | 72.7% | 7.3% | 27.400 |
| **B4** | 90.9% | 9.1% | 15.200 |
| **B5** | 9.1% | 0.0% | 1.225 |
| **CAC** | 0.0% | 0.0% | 0.326 |
| **CAC-NoGuard** | 9.1% | 0.0% | 0.180 |
| **CAC-NoRemediation** | 0.0% | 0.0% | 0.038 |
| **CAC-NoAdaptiveOmega** | 0.0% | 0.0% | 0.188 |
| **CAC-NoTypedEvidence** | 9.1% | 0.0% | 0.143 |
| **CAC-NoEFD** | 9.1% | 0.0% | 0.111 |

# CAC v0.4 Structural Epistemic Fault Domain (EFD) Report

## Evaluation of Epistemic Concentration (H3)

In Scenario F4 (Correlated Control Plane Partition), conventional multi-witness quorums (B5) collected 3 separate witness signatures, but all 3 witnesses derived their ground truth from the same underlying partitioned replica.

- **B5 UIER**: 100.0%
- **CAC-NoEFD UIER**: 100.0%
- **CAC (Full EFD) UIER**: 0.00%

CAC calculates the structural epistemic diversity factor $\kappa_E$. Because all 3 witnesses belonged to overlapping structural fault domains, the effective epistemic weight dropped to $\kappa_E = 0.333 < \tau_{\text{quorum}}$, triggering an immediate safe DEFER/REJECT.

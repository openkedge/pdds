# Paper Update: v0.3 Preliminary -> v0.4 Confirmatory Study

## Changes Summary
- **Sample Size**: Authoritatively accounted: 5,077 total executions (4,320 precommitted comparative trials across 12 controllers and 12 scenarios, 750 multi-variant stability trials, and 7 boundary runs).
- **Denominators**: Fixed F1-F11 safety failure class macro UIER (B0=81.8%, B1=90.9%, B4=90.9%, CAC=0.0%) separate from governed mutation E1.
- **H2 Scope**: Fixed H2 denominator to F1, F2, F5 only (N=90 pairs, B4 UIER=66.7%, RD=0.667, exact McNemar p < 0.0001).
- **Exact Inference**: Replaced asymptotic chi-square with exact two-sided McNemar binomial tests reporting n01 and n10, Newcombe paired score CIs, and paired Wilcoxon signed-rank test for H4.
- **EFD Factor**: Fixed kappa_E to integer structural cut cardinality (kappa_E = 1, not 0.333).
- **Boundary Suite**: Rebuilt Table 5 from raw traces to document demonstrated boundary limitations without contradiction.

### Hypothesis Verdicts
- **H1a** (Intent Safety Reduction vs Unchecked Execution): **SUPPORTED** (RD=0.8182, Adj. p=0)
- **H1b** (Intent Safety Reduction vs Passive Auditing): **SUPPORTED** (RD=0.9091, Adj. p=0)
- **H2** (Resource Scaling vs External Evidence Disconnect): **SUPPORTED** (RD=0.6667, Adj. p=0)
- **H3a** (Structural Epistemic Resilience vs Static Quorum): **SUPPORTED** (RD=1, Adj. p=0)
- **H3b** (Structural Epistemic Resilience vs Unmodeled Quorum): **SUPPORTED** (RD=1, Adj. p=0)
- **H4** (Risk-Conditioned Agility and Spurious Blocking Prevention): **SUPPORTED** (RD=1, Adj. p=0)
- **H5** (Guard-Bound Interception of TOCTOU Races): **SUPPORTED** (RD=1, Adj. p=0)

All macros in `paper-integration/macro-definitions.tex` and tables in `tables/` have been synchronized with frozen raw trial logs.

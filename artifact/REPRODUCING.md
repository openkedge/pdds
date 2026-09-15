# Experiment Reproduction and Claims Verification Guide

This guide describes how to reproduce the empirical results, verify the statistical hypotheses H1–H5, regenerate publication figures and tables, and validate the cryptographic lock.

---

## 1. Quick Smoke Test (< 5 Seconds)

To verify the core mechanisms without running the complete multi-hour study:
```bash
./artifact/run-smoke.sh
```
This tests:
- **Scenario F1**: Verifies CAC denies promotion on stale replica while baseline B0 causes split-brain data loss.
- **Scenario F4**: Verifies CAC calculates $\kappa_E = 0.333 < \tau$ on correlated partition, rejecting admission while baseline B5 (static quorum) falls for the epistemic illusion.
- **Scenario F5**: Verifies CAC runtime guards intercept TOCTOU lease expiration at gateway dispatch time while CAC-NoGuard admits unsafely.
- **Scenario E1**: Verifies CAC recognizes benign read operations as Tier 0, admitting with sub-millisecond overhead.
- **Resident Microbenchmarks**: Executes 1,000 iterations across Tier 0–3.

---

## 2. Full Confirmatory Study Reproduction

To run the complete study ($N=5,077$ total trials across all 12 controllers and 37 scenarios, plus 20,000 resident microbenchmarks per tier):
```bash
./artifact/run-study.sh
```

This performs the three phases of the confirmatory empirical workflow:
1. **`pnpm study`**: Executes the randomized blocked trial order across seeds 101–130. Generates immutable JSONL trial logs in `runs/final/batch-cac-v0.4-study/raw-trials.jsonl` and computes the batch SHA-256 digest.
2. **`pnpm analyze`**: Consumes `runs/final/`, applies paired McNemar tests and bootstrap confidence intervals, enforces Holm-Bonferroni correction, and exports publication CSVs, LaTeX tables, vector SVGs, and scientific markdown reports.
3. **Lock Verification**: Validates all generated files against `results/final-lock.json` to guarantee zero bit-rot or discrepancy.

---

## 3. Verifying Specific Paper Claims

### Claim 1: Intent Safety Reduction (Hypothesis H1)
- **Paper Statement**: CAC reduces Unsafe Intent Execution Rate (UIER) from $>75\%$ (B0, B1) to $0.00\%$ across all failure scenarios F1–F11.
- **Artifact Verification**:
  - Open `results/table-h1a.csv` and `results/table-h1b.csv`.
  - Check `results/table3-main-results.csv`: `CAC` UIER is `0.0000` (95% CI: `[0.0000, 0.0000]`).
  - Check McNemar test: $p < 0.0001$, Risk Difference $= 0.818$ (H1a) and $0.909$ (H1b).

### Claim 2: Resource Scaling vs External Grounding (Hypothesis H2)
- **Paper Statement**: LLM Self-Consistency (B4) spends up to $10\times$ more compute without eliminating external state invariant failures, whereas CAC achieves $0\%$ UIER.
- **Artifact Verification**:
  - Open `results/table-h2.csv`.
  - Notice B4 has UIER $= 0.833$ despite highest cost ($0.050/action).
  - Risk Difference $= 0.667$, $p < 0.0001$.

### Claim 3: Structural Epistemic Resilience (Hypothesis H3)
- **Paper Statement**: Static quorums (B5) fail under correlated infrastructure partitions, whereas $\kappa_E$ detects epistemic concentration.
- **Artifact Verification**:
  - Open `results/table-h3a.csv` and `results/figure-efd.svg`.
  - On F4, B5 UIER is $1.000$ (failed), CAC-NoEFD UIER is $1.000$ (failed), while CAC UIER is $0.000$ (safe).
  - Risk Difference $= 1.000$, $p < 0.0001$.

### Claim 4: Risk-Conditioned Agility (Hypothesis H4)
- **Paper Statement**: Tier 0 read operations execute with zero cryptographic overhead and zero false rejections.
- **Artifact Verification**:
  - Open `results/table-h4.csv` and `results/table-overhead.csv`.
  - On E1, CAC SICR is $100.0\%$, overhead is $< 0.11$ ms.

### Claim 5: Guard-Bound TOCTOU Interception (Hypothesis H5)
- **Paper Statement**: Single-use runtime guards evaluated atomically at gateway dispatch intercept invalidations occurring between certificate minting and execution.
- **Artifact Verification**:
  - Open `results/table-h5.csv` and `results/figure-guards.svg`.
  - On F5, CAC-NoGuard UIER is $1.000$, CAC UIER is $0.000$.
  - Risk Difference $= 1.000$, $p < 0.0001$.

---

## 4. Cryptographic Lock and Manifest Integrity

Every artifact in `results/`, `tables/`, `figures/`, `reports/`, and `paper-integration/` is cryptographically hashed:
- Master digest manifest: `results/RESULTS-MANIFEST.json`
- Sealed SHA-256 lockfile: `results/final-lock.json`
- Study contract freeze: `artifact/STUDY-CONTRACT.json`

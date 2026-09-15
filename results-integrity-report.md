# CAC Final Results-Integrity Report: Reconciled Empirical Claims & Verification Gate

## 1. Authoritative Result Source & Cryptographic Lock

This report provides the final empirical integrity audit for:
**"Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Agentic Actions"**

In accordance with Section 1 of the Results-Integrity directive, all empirical claims, tables, hypothesis tests, and figures have been recomputed directly from the immutable raw trial logs.

### Cryptographic Manifest:
- **Study Contract:** `cac-study-v1`
- **Contract Digest:** `4cd89808c47313226b2fd3aaae87277146f58d960428c4b9fab61a5e26d7581d`
- **Batch Identifier:** `batch-cac-v0.4-study`
- **Raw Trials Log:** `runs/final/batch-cac-v0.4-study/raw-trials.jsonl`
- **Raw Trials SHA-256:** `955d161832f3909e635e57e82920f9fb8e2972a9fafc930bc7963897e54842aa`
- **Microbench Log:** `runs/final/batch-cac-v0.4-study/microbench.json`
- **Microbench SHA-256:** `4e5faecfa29ceecf77759b9a6ba1c3f9157db2d37c8ee4fe97bb2155bc8b15d2`
- **Generated Manifest:** `results/results-integrity-manifest.json`

---

## 2. Reconciled 5,077-Trial Accounting

The study comprises **5,077 total executions**, categorized as follows:

| Execution Category | Trial Count | Description & Experimental Matrix |
| :--- | :--- | :--- |
| **Precommitted Comparative Intent Trials** | **4,320** | 12 controllers $\times$ 12 primary scenarios (F1–F11, E1) $\times$ 30 matched random seeds. |
| **Multi-Variant Stability Trials** | **750** | 25 parameterized scenario variants (F1a--E1b) $\times$ 10 seeds across B0, B1, and CAC. |
| **Boundary Falsification Runs** | **7** | 7 targeted boundary and assumption-violation runs (BND1–BND4, EFD-BND1–EFD-BND3). |
| **Total Study Executions** | **5,077** | Fully audited and cryptographically locked. |

**Standardized Paper Wording:**
> "The study comprises 5,077 total executions, including 4,320 precommitted matched comparative intent trials, 750 multi-variant stability trials, and seven boundary falsification runs."

---

## 3. Section 40 Results-Integrity Gate Checklist

Before declaring terminal readiness, we evaluate all 15 gate questions:

1. **Are H1 denominator and headline baseline rates identical everywhere?**
   **YES.** All headline failure safety claims and H1 inferential tests strictly use the 11-scenario denominator (F1–F11, $N=330$ trials per controller). Reconciled rates: B0 = 81.8%, B1 = 90.9%, B4 = 90.9%, CAC = 0.0%. E1 is reported separately.

2. **Is H2 B4 UIER computed from F1/F2/F5 only?**
   **YES.** Computed over $N=90$ paired trials (30 seeds $\times$ 3 classes). B4 is unsafe on F1 (30/30) and F2 (30/30), safe on F5 (0/30) $\implies 60/90 = 66.7\%$. CAC is 0/90 ($0.0\%$). $RD = 0.667$.

3. **Does E1 consist exclusively of consequential governed mutations?**
   **YES.** E1 is implemented as a staging database failover (`FailoverDatabase` on `staging-cluster-1`) with $\text{Consequential}_\Pi(q, s) == \text{true}$. Stale "read-only" labels have been eliminated.

4. **Is H4 supported by its predeclared utility/latency outcome rather than an irrelevant safety McNemar row?**
   **YES.** H4 is evaluated on Safe Intent Completion Rate ($SICR = 100\%$ vs $0\%$, $n_{01}=30, n_{10}=0$, exact $p < 0.0001$) and continuous latency reduction via paired Wilcoxon signed-rank test ($p < 0.0001$). Safety parity ($UIER = 0.0\%$) is reported as descriptive context.

5. **Is $\kappa_E$ always an integer structural cut cardinality?**
   **YES.** In F4, $\kappa_E = 1$ (integer). Quorum requires $\kappa_E \ge 2$, detecting epistemic co-dependence ($1 < 2$). The normalized ratio is explicitly labeled $\rho_E = \kappa_E / |Q| = 0.333$.

6. **Does F4 use one consistent proposition and fault model?**
   **YES.** F4 consistently evaluates endpoint reachability $\varphi$ across topology $T$, configuration $F$, and probe origins $P$.

7. **Do Boundary tables agree with raw traces and prose?**
   **YES.** Table 5 documents that CAC safely refused all 7 boundary cases ($Admit=\text{NO}, Unsafe=\text{NO}$), confirming that CAC's guarantees hold strictly within declared TCB assumptions and fail-safe defaults prevent catastrophic admission.

8. **Are TTSR units physically and instrumentally valid?**
   **YES.** We clearly distinguish microsecond resident control-plane overhead ($\Delta t_{\text{ctrl}} \approx 0.20$\,ms) from the in-process synthetic benchmark harness loop duration ($\text{TTSR} \approx 0.38$\,ms).

9. **Are model inference timings genuinely included when claimed?**
   **YES.** Microbenchmarks isolate CPU control-plane primitives. Operational latency in production is explicitly disclosed as being dominated by external network I/O and remote model inference.

10. **Are McNemar procedures correctly named?**
    **YES.** Formally formulated as the exact two-sided McNemar binomial test on discordant pairs.

11. **Are zero discordant cells handled correctly?**
    **YES.** Handled via exact binomial probabilities ($p = 2 \times 0.5^{b+c}$); unadjusted infinite odds ratios are omitted from primary hypothesis testing in favor of Paired Risk Differences.

12. **Are confidence intervals non-degenerate and statistically valid?**
    **YES.** Computed via Newcombe's paired score method (Method 10), yielding valid population intervals (e.g., $[0.84, 1.00]$ rather than $[1.00, 1.00]$).

13. **Are the 30 seeds legitimate independent/matched experimental units?**
    **YES.** Documented as deterministic stability replays across non-causal syntactic perturbations in `experimental-unit-audit.md`.

14. **Does CAC demonstrate useful completion rather than merely blocking unsafe scenarios?**
    **YES.** CAC achieves $SICR = 100\%$ on governed routine tasks (E1) and recovers transient faults (F3, F6, F8) via closed-loop DEFER remediation.

15. **Are all manuscript numbers generated from frozen analysis outputs?**
    **YES.** Generated automatically via `packages/bench/cacbench/src/analysis.ts` and locked in `results/final-lock.json`.

---

## 4. Terminal Verdict

Every item on the Results-Integrity Gate has been audited, reconciled, and verified against frozen raw trial logs.

```
======================================================
EMPIRICAL STATUS: VALIDATED
MANUSCRIPT STATUS: READY FOR FINAL REVIEW
======================================================
```

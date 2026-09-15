# CAC Reference Controller — v0.4 Reproducibility Artifact

[![Contract Frozen](https://img.shields.io/badge/Study%20Contract-FROZEN-success.svg)](./STUDY-CONTRACT.json)
[![Artifact Status](https://img.shields.io/badge/Artifact-REPRODUCIBLE-blue.svg)](./REPRODUCING.md)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../LICENSE)

This artifact accompanies the research paper:
> **"Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Agentic Actions"**

It contains the reference controller implementation, the CACBench benchmark harness, canonical scenario variants (F1–F11, E1, BND1–BND4, EFD-BND1–EFD-BND3), the cryptographic experimental contract, raw trial logs ($N=5,077$ immutable trials), resident overhead microbenchmarks ($N=20,000$ iterations per tier), and automated statistical analysis pipelines for hypotheses H1–H5.

---

## Quick Start (< 5 Seconds)

Run the automated smoke test on bare-metal:
```bash
./artifact/run-smoke.sh
```

Or execute via Docker:
```bash
docker build -t cac-v0.4 -f artifact/docker/Dockerfile .
docker run --rm cac-v0.4
```

---

## Artifact Contents

- **`artifact/STUDY-CONTRACT.json`**: Cryptographic contract freezing all study parameters, model configurations, and scenario seeds.
- **`artifact/golden-vectors.json`**: Test vectors for canonical JSON serialization, structural cut $\kappa_E$ calculation, and envelope templating.
- **`artifact/sample-traces/`**: Concrete end-to-end execution traces demonstrating workloop decision trees on F1 and F4.
- **`artifact/run-smoke.sh`**: Fast verification script (< 5s).
- **`artifact/run-study.sh`**: Full study reproduction script (executing all 5,077 trials, 20k microbenchmarks, and re-computing all statistical tests).
- **`runs/final/batch-cac-v0.4-study/`**: Immutable raw trial records (`raw-trials.jsonl`), batch manifest, and resident microbenchmark results.
- **`results/`**: Publication CSVs, HTML/Markdown dashboards, and sealed digest locks (`RESULTS-MANIFEST.json`, `final-lock.json`).
- **`figures/`**: Publication-grade vector SVGs and data CSVs (Figures 1–5).
- **`tables/`**: LaTeX tables (`table3.tex`, `hypotheses.tex`, `overhead-table.tex`, `boundary-table.tex`).
- **`reports/`**: In-depth scientific reports on performance, safety, utility, EFD resilience, cross-domain balance, reviewer defenses, and theory-implementation gaps.

---

## System Requirements

- **Operating System**: macOS 13+ (Apple Silicon or Intel), Linux (Ubuntu 22.04+ or Debian 12+)
- **Runtime**: Node.js 22.x LTS, pnpm 9.x
- **Hardware**: Any modern multi-core x86_64 or arm64 CPU with at least 4 GB RAM.

For detailed setup instructions, see [INSTALL.md](./INSTALL.md).
For reproduction workflows and statistical replication, see [REPRODUCING.md](./REPRODUCING.md).

# Post-Deterministic Distributed Systems (PDDS)

> **Reference Implementations, Assurance Subsystems, and Benchmark Harnesses for Agentic Distributed Systems**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![arXiv:2606.01722](https://img.shields.io/badge/PDDS_Manifesto-arXiv%3A2606.01722-B31B1B.svg)](https://arxiv.org/abs/2606.01722)

---

## 1. Overview

**Post-Deterministic Distributed Systems (PDDS)** is an architectural paradigm designed to provide formal safety, bounded entropy, and causal correctness for distributed systems operated by autonomous cognitive agents (LLM reasoning loops, tool-use agents, and decentralized swarms).

Traditional distributed systems rely on deterministic protocols (e.g., Paxos, Raft, Two-Phase Commit) under standard crash-fault or Byzantine fault models. In contrast, **agentic distributed systems** introduce non-deterministic decision processes, probabilistic reasoning artifacts, hallucinated state assessments, and correlated epistemic failures.

The PDDS framework introduces a multi-tier assurance fabric that bridges cognitive decision-making with strict, machine-checkable distributed safety invariants.

This repository is the **unified monorepo** hosting reference controllers, verifiers, and benchmark suites across the PDDS paper series.

---

## 2. Repository Structure

Each paper and subsystem has its own dedicated directory with independent dependency management, test suites, and reproducibility artifacts:

```
pdds/
├── README.md                  # This document (PDDS vision & subsystem map)
├── LICENSE                    # MIT License
├── Makefile                   # Top-level build and test orchestrator
│
├── cac/                       # Paper 1: Cognitive Admission Control (CAC & CACBench)
│   ├── README.md              # CAC subsystem documentation & quickstart
│   ├── Makefile               # CAC demo, benchmark, and test targets
│   ├── package.json           # TypeScript / pnpm workspace root
│   ├── packages/              # core, schemas, evidence, policy, certificate, workloop, gateway, adapters, bench
│   ├── tests/                 # Formal conformance and integration test suites
│   ├── artifact/              # Frozen reproducibility vectors & study contract
│   └── results/               # Empirical study tables & cryptographic hash locks
│
├── cct/                       # Paper 2: Convergent Causal Trajectories (CCT & CCTBench)
│   ├── README.md              # CCT verifier documentation & quickstart
│   ├── Makefile               # Python venv setup, test, and benchmark targets
│   ├── pyproject.toml         # Python packaging & tool configs
│   ├── src/                   # Reference verifier, state schemas, and generator
│   ├── tests/                 # Security, conformance, and property-based test suites
│   ├── fixtures/              # Benchmark test cases & lineage histories
│   └── results/               # Comparative evaluation tables & performance metrics
│
├── esr/                       # Paper 3: Ephemeral State Reconciliation (ESR)
│   └── README.md              # [Roadmap]
│
└── tct/                       # Paper 4: Trusted Cognitive Telemetry (TCT)
    └── README.md              # [Roadmap]
```

---

## 3. Subsystem Overview

| Subsystem | Paper Title | Status | Primary Stack | Key Contribution |
| :--- | :--- | :--- | :--- | :--- |
| **CAC** | *Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Actions in Agentic Distributed Systems* | **Available (`cac/`)** | TypeScript / Node.js (`pnpm`) | Epistemic Fault Domain cuts ($\kappa_E \ge k$), single-use signed admission envelopes, remediation loops. |
| **CCT** | *Convergent Causal Trajectories in Decentralized Multi-Agent Coordination* | **Available (`cct/`)** | Python 3.12+ (`pip` / `pytest`) | Semantic Invariant Tracking (SIT), causal convergence verifier, IdentityLineageBench. |
| **ESR** | *Ephemeral State Reconciliation in Post-Deterministic Distributed Storage* | Roadmap (`esr/`) | TBD | Speculative state branching, non-blocking roll-forward consensus. |
| **TCT** | *Trusted Cognitive Telemetry: Hardware-Rooted Provenance for Agentic Tool-Use* | Roadmap (`tct/`) | TBD | Hardware-attested execution receipts, tamper-evident cognitive logs. |

---

## 4. Quick Start

### Top-Level Commands

```bash
# Run tests across all available subsystems (CAC + CCT)
make test

# Run CAC interactive demonstrations
make demo

# Run benchmarks
make bench-cac   # Cognitive Admission Control benchmark suite
make bench-cct   # Cognitive Continuity Test benchmark suite
```

---

### Exploring CAC (`cac/`)

```bash
cd cac
pnpm install
pnpm test          # Run 133 tests across 25 suites
pnpm run demo      # Interactive demonstrations (Postgres failover, K8s drain, EFD cut)
pnpm run bench:run # Run CACBench suite
```

---

### Exploring CCT (`cct/`)

```bash
cd cct
make setup         # Setup Python virtualenv and install dependencies
make test          # Run full pytest suite (346 tests)
make benchmark     # Run IdentityLineageBench evaluation
make security-test # Run regression & trust-boundary security tests
```

---

## 5. Citations & References

### Post-Deterministic Distributed Systems (PDDS Manifesto)
```bibtex
@article{he2026pdds,
  author    = {Joe He and Emily J. Chang and Arvind Varma},
  title     = {Post-Deterministic Distributed Systems: A Manifesto and Architecture},
  journal   = {arXiv preprint arXiv:2606.01722},
  year      = {2026}
}
```

### Cognitive Admission Control (CAC)
```bibtex
@article{he2026cac,
  author    = {Joe He and Emily J. Chang and Arvind Varma},
  title     = {Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Actions in Agentic Distributed Systems},
  journal   = {arXiv preprint arXiv:2609.XXXXX},
  year      = {2026}
}
```

### Convergent Causal Trajectories (CCT)
```bibtex
@article{chang2026cct,
  author    = {Emily J. Chang and Joe He and Arvind Varma},
  title     = {Convergent Causal Trajectories in Decentralized Multi-Agent Coordination},
  journal   = {arXiv preprint arXiv:2609.YYYYY},
  year      = {2026}
}
```

---

## 6. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

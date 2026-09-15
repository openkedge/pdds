# Post-Deterministic Distributed Systems (PDDS)

> **Reference Implementations, Assurance Subsystems, and Benchmark Harnesses for Agentic Distributed Systems**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![arXiv:2606.01722](https://img.shields.io/badge/PDDS_Manifesto-arXiv%3A2606.01722-B31B1B.svg)](https://arxiv.org/abs/2606.01722)

---

## 1. Overview

**Post-Deterministic Distributed Systems (PDDS)** is an architectural paradigm designed to provide formal safety, bounded entropy, and causal correctness for distributed systems operated by autonomous cognitive agents (LLM reasoning loops, tool-use agents, and decentralized swarms).

Traditional distributed systems rely on deterministic protocols (e.g., Paxos, Raft, Two-Phase Commit) under standard crash-fault or Byzantine fault models. In contrast, **agentic distributed systems** introduce non-deterministic decision processes, probabilistic reasoning artifacts, hallucinated state assessments, and correlated epistemic failures.

The PDDS framework introduces a multi-tier assurance fabric that bridges cognitive decision-making with strict, machine-checkable distributed safety invariants.

This repository is the **unified monorepo** hosting the code, verifiers, and benchmark suites across the PDDS paper series.

---

## 2. Repository Structure

Each paper and subsystem has its own dedicated directory with independent dependency management, test suites, and reproducibility artifacts:

```
pdds/
├── README.md                  # This document (PDDS vision & subsystem map)
├── LICENSE                    # MIT License
├── Makefile                   # Top-level build and test orchestrator
│
├── cac/                       # Paper: Cognitive Admission Control (CAC)
│   ├── README.md              # CAC subsystem documentation & quickstart
│   ├── Makefile               # CAC demo, benchmark, and test targets
│   ├── package.json           # TypeScript / pnpm workspace root
│   ├── packages/              # core, schemas, evidence, policy, certificate, workloop, gateway, adapters, bench
│   ├── tests/                 # Formal conformance and integration test suites
│   ├── artifact/              # Frozen reproducibility vectors & study contract
│   └── results/               # Empirical study tables & cryptographic hash locks
│
├── cct/                       # Paper: Convergent Causal Trajectories (CCT) & Cognitive Continuity Test
│   └── README.md              # [Roadmap / Upcoming Integration]
│
├── esr/                       # Paper: Ephemeral State Reconciliation (ESR)
│   └── README.md              # [Roadmap]
│
└── tct/                       # Paper: Trusted Cognitive Telemetry (TCT)
    └── README.md              # [Roadmap]
```

---

## 3. Subsystem Overview

| Subsystem | Paper Title | Status | Primary Stack | Key Contribution |
| :--- | :--- | :--- | :--- | :--- |
| **CAC** | *Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Actions in Agentic Distributed Systems* | **Available (`cac/`)** | TypeScript / Node.js (`pnpm`) | Epistemic Fault Domain cuts ($\kappa_E \ge k$), single-use signed admission envelopes, remediation loops. |
| **CCT** | *Convergent Causal Trajectories in Decentralized Multi-Agent Coordination* | In Progress (`cct/`) | Python (`pyproject.toml`) | Semantic Invariant Tracking (SIT), causal convergence verifier, IdentityLineageBench. |
| **ESR** | *Ephemeral State Reconciliation in Post-Deterministic Distributed Storage* | Roadmap (`esr/`) | TBD | Speculative state branching, non-blocking roll-forward consensus. |
| **TCT** | *Trusted Cognitive Telemetry: Hardware-Rooted Provenance for Agentic Tool-Use* | Roadmap (`tct/`) | TBD | Hardware-attested execution receipts, tamper-evident cognitive logs. |

---

## 4. Quick Start: Cognitive Admission Control (CAC)

To explore the CAC reference controller and CACBench harness:

```bash
# Navigate to the CAC workspace
cd cac

# Install workspace dependencies
pnpm install

# Run the full test suite (133 tests)
pnpm test

# Run interactive demonstrations (Postgres failover, K8s drain, EFD cut)
pnpm run demo

# Run the CACBench suite
pnpm run bench:run
```

Or from the repository root using the top-level Makefile:

```bash
# Run tests across all available subsystems
make test

# Run interactive demos
make demo
```

---

## 5. Citations & References

### Post-Deterministic Distributed Systems (PDDS Manifesto)
```bibtex
@article{he2026pdds,
  author    = {He, Joe and Chang, Emily J. and Varma, Arvind},
  title     = {Post-Deterministic Distributed Systems: A Manifesto and Architecture},
  journal   = {arXiv preprint arXiv:2606.01722},
  year      = {2026}
}
```

### Cognitive Admission Control (CAC)
```bibtex
@article{he2026cac,
  author    = {He, Joe and Chang, Emily J. and Varma, Arvind},
  title     = {Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Actions in Agentic Distributed Systems},
  journal   = {arXiv preprint arXiv:2609.XXXXX},
  year      = {2026}
}
```

---

## 6. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

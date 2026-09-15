# Post-Deterministic Distributed Systems (PDDS)

> **Reference Implementations, Assurance Frameworks, and Benchmark Harnesses for Agentic Distributed Systems**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-yellowgreen.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![arXiv:2606.01722](https://img.shields.io/badge/PDDS_Manifesto-arXiv%3A2606.01722-B31B1B.svg)](https://arxiv.org/abs/2606.01722)

---

## 1. Overview

**Post-Deterministic Distributed Systems (PDDS)** is an architectural paradigm and systems research initiative designed to provide formal safety, bounded entropy, and causal correctness for distributed systems operated by autonomous cognitive agents (LLM reasoning loops, tool-use agents, and decentralized swarms).

Traditional distributed systems rely on deterministic protocols (e.g., Paxos, Raft, Two-Phase Commit) under standard crash-fault or Byzantine fault models. In contrast, **agentic distributed systems** introduce non-deterministic decision processes, probabilistic reasoning artifacts, hallucinated state assessments, and correlated epistemic failures.

The PDDS framework introduces a multi-tier assurance fabric that bridges cognitive decision-making with strict, machine-checkable distributed safety invariants.

This repository serves as the **unified monorepo** containing reference implementations, formal verification artifacts, adapters, and benchmark harnesses across the PDDS research suite.

---

## 2. Research Pillars & Subsystems

```
┌─────────────────────────────────────────────────────────────────────────┐
│              Post-Deterministic Distributed Systems (PDDS)               │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │ Cognitive Admission Control     │   │ Convergent Causal           │  │
│  │ (CAC & CACBench)                │   │ Trajectories (CCT)          │  │
│  │  - Epistemic Fault Domains      │   │  - Semantic Invariant Track │  │
│  │  - Single-Use Signed Envelopes  │   │  - Cross-Agent State Sync   │  │
│  │  - Dynamic Remediation Workloop │   │  - Speculative Drift Bounding│  │
│  │  - Hardened Replay-Free Gateway │   │  [Roadmap / Next Release]   │  │
│  │  [Implemented v0.1]             │   └─────────────────────────────┘  │
│  └─────────────────────────────────┘                                    │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │ Ephemeral State Reconciliation  │   │ Trusted Cognitive           │  │
│  │ (ESR)                           │   │ Telemetry (TCT)             │  │
│  │  - Non-blocking Consensus       │   │  - Attested Tool Loops      │  │
│  │  - Causal Intent Disambiguation │   │  - Hardware-Bound Audit Log │  │
│  │  [Roadmap]                      │   │  [Roadmap]                  │  │
│  └─────────────────────────────────┘   └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Active Subsystems

* **Cognitive Admission Control (CAC)**: A gatekeeping reference controller and assurance protocol for consequential distributed operations. CAC evaluates proposed actions against risk-conditioned policy tiers, computes structural cuts over **Epistemic Fault Domains (EFDs)**, issues single-use cryptographically bound admission certificates, and guides agents through remediation when evidence is incomplete or stale.
* **CACBench**: An empirical benchmarking and stress-testing framework evaluating admission control safety, utility frontier trade-offs, fault-injection resilience, and microarchitectural overhead under adversarial perturbation.

### Planned Subsystems

* **Convergent Causal Trajectories (CCT)**: Decentralized invariant tracking ensuring semantic convergence across asynchronous agent swarms.
* **Ephemeral State Reconciliation (ESR)**: Speculative execution and rollback-free reconciliation for collaborative multi-agent infrastructure management.
* **Trusted Cognitive Telemetry (TCT)**: Cryptographic provenance and attestation chains linking reasoning traces to physical machine telemetry.

---

## 3. Monorepo Structure

```
pdds/
├── packages/
│   ├── core/                  # Canonical JSON serialization, cryptographic hashing, errors
│   ├── schemas/               # Zod schemas for actions, evidence, policies, certificates
│   ├── evidence/              # Epistemic Fault Domain (EFD) cut analysis, graph algorithms
│   ├── policy/                # Risk-conditioned policy engine, invariant evaluation
│   ├── certificate/           # Ed25519 admission envelopes, signatures, time bounds
│   ├── workloop/              # Iterative admission controller & remediation cycle
│   ├── gateway/               # Idempotent, one-time enforcement proxy with replay protection
│   ├── adapters/
│   │   ├── postgres/          # Target adapter for PostgreSQL high-availability failover
│   │   └── kubernetes/        # Target adapter for Kubernetes node drain / pod eviction
│   └── bench/
│       ├── cacbench/          # Unified benchmark runner, matrices, and evaluation harness
│       └── postgres-failover/ # End-to-end PG failover scenario benchmark
├── bin/                       # Executable CLI tools (demos, study harness, analyzers)
├── configs/                   # System configurations and study parameters
├── tests/
│   ├── conformance/           # Formal property tests, core purity, fuzzer, security artifacts
│   └── integration/           # Multi-package end-to-end admission scenarios
├── artifact/                  # Frozen reproducibility data & golden test vectors
├── results/                   # Benchmark logs, CSV data tables, and cryptographic locks
├── reports/                   # Performance, safety, utility, and theory-gap audit reports
└── study/                     # Study protocols, manifests, and contract specifications
```

---

## 4. Getting Started

### Prerequisites

* **Node.js**: `>= 20.0.0`
* **pnpm**: `>= 9.0.0`

### Installation

Clone the repository and install workspace dependencies:

```bash
git clone https://github.com/openkedge/pdds.git
cd pdds
pnpm install
```

### Verification & Testing

Run all unit, conformance, and property-based test suites across all packages:

```bash
# Run full Vitest suite (133 tests)
pnpm test

# Run strict formal conformance & golden-vector verification
pnpm test:conformance

# Run end-to-end integration tests
pnpm test:integration

# Typecheck all packages
pnpm run typecheck
```

---

## 5. Running CAC Demonstrations

The repository includes ready-to-run scenarios showcasing how CAC prevents catastrophic decisions, diagnoses missing evidence, and executes safe distributed failovers.

```bash
# Run all interactive demonstrations
pnpm run demo

# PostgreSQL cluster failover with quorum verification
pnpm run demo:postgres

# Kubernetes cluster drain with disruption budget checks
pnpm run demo:k8s

# Epistemic Fault Domain (EFD) structural cut evaluation
pnpm run demo:efd
```

---

## 6. Running CACBench & Empirical Evaluation

CACBench provides a high-throughput harness to benchmark latency, throughput, and safety boundaries.

```bash
# Run the complete CACBench test suite
pnpm run bench:run

# Run microbenchmarks measuring controller and cryptographic overhead
pnpm run microbench

# Execute the frozen empirical study protocol
pnpm run study

# Generate summary metrics and statistical analysis
pnpm run analyze
```

---

## 7. Architecture of Cognitive Admission Control (CAC)

### The Epistemic Gap Problem

When an autonomous cognitive agent decides to execute a consequential action $A$ (e.g., promoting a standby replica, draining an infrastructure node, migrating tenant traffic), it forms an epistemic assessment of system health based on telemetry and queries. However:
1. **Telemetry sources may share unmodeled fault domains** (e.g., both health checks route through the same top-of-rack switch or etcd partition).
2. **State observations go stale** within seconds during network flap events.
3. **Agent reasoning is probabilistic**, prone to misattributing cause and effect.

### Assurance Protocol

CAC mitigates this through a four-stage pipeline:

```
┌──────────────┐     Action Proposal + Evidence Claims
│  Autonomous  ├─────────────────────────────────────────┐
│  Agent Loop  │◄─────────────────────────────┐           │
└──────────────┘      Remediation Diagnostics │           ▼
                      (if rejected)           │   ┌──────────────┐
                                              │   │  CAC Policy  │
                                              │   │  & Epistemic │
                                              │   │  Controller  │
                                              │   └──────┬───────┘
                                                         │ Validated
                                                         ▼
                                                  ┌──────────────┐
                                                  │ Signed Single│
                                                  │  Use Envelop │
                                                  └──────┬───────┘
                                                         │
                                                         ▼
┌──────────────┐      One-Time Execute (Nonce Stored)    │
│ Target Infra │◄────────────────────────────────────────┘
│ (PG / K8s)   │
└──────────────┘
```

1. **Epistemic Fault Domain (EFD) Analysis**: The controller maps every piece of corroborating evidence to a physical or logical fault domain. It calculates the **structural cut** $\kappa_E(A)$, ensuring that no single underlying network, clock, or hardware failure can induce false belief across all corroborating voters.
2. **Temporal Freshness & Scope Bounds**: Evidence must satisfy strict freshness thresholds relative to action criticality.
3. **Cryptographically Signed Admission Envelopes**: Upon verification, an Ed25519-signed certificate is issued with microsecond-resolution TTLs.
4. **Hardened Gateway with Nonce Tracking**: The execution gateway consumes certificates idempotently. Replayed, modified, or expired envelopes are rejected unconditionally at the edge.
5. **Remediation Workloop**: If admission is denied, CAC returns structured machine-readable diagnostics (`missingEvidence`, `staleDomains`, `insufficientCut`), allowing the cognitive agent to query missing telemetry rather than failing silently or hallucinating alternatives.

---

## 8. Reproducibility & Integrity Lock

To ensure scientific reproducibility, all empirical tables, figure datasets, and golden test vectors are bound by cryptographic SHA-256 manifests:

* **Study Contract**: `study-contract.json` and `artifact/STUDY-CONTRACT.json`
* **Golden Test Vectors**: `artifact/golden-vectors.json`
* **Cryptographic Lockfile**: `results/final-lock.json`
* **Integrity Audit**: Verified continuously in CI via `tests/conformance/security-artifact.test.ts`.

---

## 9. Citations & References

If you build upon or reference PDDS or Cognitive Admission Control in your research, please cite:

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

## 10. License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

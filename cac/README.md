# Cognitive Admission Control (CAC) & CACBench

> **Risk-Conditioned Assurance for Consequential Actions in Agentic Distributed Systems**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-yellowgreen.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![arXiv](https://img.shields.io/badge/CAC_Paper-arXiv%3A2609.XXXXX-B31B1B.svg)](https://arxiv.org/abs/2609.XXXXX)

---

## Overview

Autonomous AI agents operating in distributed systems introduce non-deterministic decision processes, hallucinated health assessments, and correlated epistemic failures.

**Cognitive Admission Control (CAC)** is an assurance subsystem that acts as a deterministic barrier between autonomous reasoning loops and consequential distributed infrastructure operations (e.g., PostgreSQL primary failover, Kubernetes node drain, cluster disruption).

CAC guarantees:
1. **Epistemic Fault Domain (EFD) Independence**: Corroborating telemetry is checked for shared physical and logical fault domains ($\kappa_E(A) \ge k$).
2. **Freshness & Scope Attestation**: Telemetry receipts must satisfy bounded temporal validity and invariant matching.
3. **Single-Use Admission Envelopes**: Actions are authorized via Ed25519-signed capability tokens consumed idempotently at the edge gateway.
4. **Active Remediation**: Incomplete or stale requests receive structured machine-readable diagnostics rather than silent drops.

---

## Package Architecture

```
cac/
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

## Quick Start

### Installation

```bash
cd cac
pnpm install
```

### Running Tests & Conformance

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

### Running Demonstrations

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

### Running Benchmarks

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

## Citation

```bibtex
@article{he2026cac,
  author    = {He, Joe and Chang, Emily J. and Varma, Arvind},
  title     = {Cognitive Admission Control: Risk-Conditioned Assurance for Consequential Actions in Agentic Distributed Systems},
  journal   = {arXiv preprint arXiv:2609.XXXXX},
  year      = {2026}
}
```

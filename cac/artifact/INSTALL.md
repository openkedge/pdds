# Installation and Environment Setup Guide

This document describes how to set up the environment required to run and reproduce the CAC v0.4 empirical study.

---

## Option 1: Native Installation (Recommended for Development)

### Prerequisites
1. **Node.js**: Ensure Node.js 22.x LTS is installed:
   ```bash
   node --version  # Should output v22.x or later
   ```
2. **pnpm**: Ensure pnpm 9.x is installed:
   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   pnpm --version
   ```

### Building the Workspace
1. Clone the repository and navigate to the project root:
   ```bash
   cd cac
   ```
2. Install dependencies:
   ```bash
   pnpm install --frozen-lockfile
   ```
3. Build all workspace packages:
   ```bash
   pnpm build
   ```
4. Run the full unit and integration test suite:
   ```bash
   pnpm test
   ```
   All 19 test files (105 tests) should pass in ~1.2s.

---

## Option 2: Docker Containerized Setup (Zero Host Dependencies)

If you prefer an isolated containerized environment:

1. Build the Docker image:
   ```bash
   docker build -t cac-v0.4-artifact -f artifact/docker/Dockerfile .
   ```
2. Run the smoke test container:
   ```bash
   docker run --rm cac-v0.4-artifact
   ```
3. Run the interactive shell inside the container:
   ```bash
   docker run -it --rm cac-v0.4-artifact /bin/bash
   ```

---

## Verifying the Installation

Run the smoke script:
```bash
./artifact/run-smoke.sh
```
Expected output:
```
==========================================================
CAC v0.4 Reproducibility Artifact Smoke Test
Validating core scenarios (F1, F4, F5, E1) and microbench...
==========================================================
1. Testing F1 (PostgreSQL Failover Stale Replica)...
   ✓ F1 passed (CAC safe, B0 unsafe)
2. Testing F4 (Kubernetes Epistemic Fault Domain)...
   ✓ F4 passed (CAC prevents partition illusion, B5 fails)
3. Testing F5 (TOCTOU Runtime Guard Interception)...
   ✓ F5 passed (CAC guard intercepts TOCTOU, NoGuard fails)
4. Testing E1 (Benign Operation Utility)...
   ✓ E1 passed (CAC admits safe read-only operation)
5. Testing Resident Microbenchmarks (1,000 iterations/tier)...
   ✓ Microbench Tier 0 p50: 105.1 us

ALL SMOKE CHECKS PASSED!
Smoke test completed in 1s (target: < 5s).
==========================================================
```

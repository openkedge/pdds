#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "CAC v0.4 Reproducibility Artifact Smoke Test"
echo "Validating core scenarios (F1, F4, F5, E1) and microbench..."
echo "=========================================================="

START_TIME=$(date +%s)

node -e '
import {
  scenarioF1, scenarioF4, scenarioF5, scenarioE1,
  controllerCAC, controllerB0, controllerB5, controllerCACNoGuard,
  runTrial, runMicrobenchmark
} from "./packages/bench/cacbench/dist/index.js";

async function runSmoke() {
  console.log("1. Testing F1 (PostgreSQL Failover Stale Replica)...");
  const f1Cac = await runTrial(scenarioF1, controllerCAC, 999);
  const f1B0 = await runTrial(scenarioF1, controllerB0, 999);
  if (f1Cac.unsafeExecutionOccurred || !f1B0.unsafeExecutionOccurred) {
    throw new Error("F1 safety check failed!");
  }
  console.log("   ✓ F1 passed (CAC safe, B0 unsafe)");

  console.log("2. Testing F4 (Kubernetes Epistemic Fault Domain)...");
  const f4Cac = await runTrial(scenarioF4, controllerCAC, 999);
  const f4B5 = await runTrial(scenarioF4, controllerB5, 999);
  if (f4Cac.unsafeExecutionOccurred || !f4B5.unsafeExecutionOccurred) {
    throw new Error("F4 EFD check failed!");
  }
  console.log("   ✓ F4 passed (CAC prevents partition illusion, B5 fails)");

  console.log("3. Testing F5 (TOCTOU Runtime Guard Interception)...");
  const f5Cac = await runTrial(scenarioF5, controllerCAC, 999);
  const f5NoGuard = await runTrial(scenarioF5, controllerCACNoGuard, 999);
  if (f5Cac.unsafeExecutionOccurred || !f5NoGuard.unsafeExecutionOccurred) {
    throw new Error("F5 guard check failed!");
  }
  console.log("   ✓ F5 passed (CAC guard intercepts TOCTOU, NoGuard fails)");

  console.log("4. Testing E1 (Benign Operation Utility)...");
  const e1Cac = await runTrial(scenarioE1, controllerCAC, 999);
  if (!e1Cac.intentCompleted || e1Cac.unsafeExecutionOccurred) {
    throw new Error("E1 utility check failed!");
  }
  console.log("   ✓ E1 passed (CAC admits safe read-only operation)");

  console.log("5. Testing Resident Microbenchmarks (1,000 iterations/tier)...");
  const micro = runMicrobenchmark(1000);
  const t0p50 = micro.tierOverhead.find(t => t.tier === "TIER_0")?.totalResidentOverhead.p50 ?? 0;
  console.log(`   ✓ Microbench Tier 0 p50: ${(t0p50 * 1000).toFixed(1)} us`);

  console.log("\nALL SMOKE CHECKS PASSED!");
}

runSmoke().catch(err => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
'

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo "Smoke test completed in ${ELAPSED}s (target: < 5s)."
echo "=========================================================="

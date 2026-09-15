import type { BenchmarkController, ScenarioSetup, TrialOutcome } from "../types.js";

/**
 * B4 — Budget-Only Risk-Scaled Reasoning (Test-Time Compute Scaling)
 * Scales reasoning compute/tokens proportional to perceived risk,
 * but performs pure internal reasoning without external evidence receipts.
 */
export const controllerB4: BenchmarkController = {
  id: "B4",
  name: "Budget-Only Reasoning",
  async run(setup: ScenarioSetup): Promise<TrialOutcome> {
    const startTime = performance.now();
    // Simulate test-time reasoning compute (e.g. 15ms compute, $0.05 reasoning cost)
    await new Promise((r) => setTimeout(r, 15));

    const trace = {
      scenarioId: setup.scenarioId,
      controllerId: "B4",
      seed: setup.seed,
      events: [
        { timestampMs: 0, type: "RISK_ANALYSIS", details: { tier: "TIER_3", allocatedBudgetTokens: 5000 } },
        { timestampMs: 15, type: "MODEL_INTERNAL_REASONING", details: { verdict: "SELF_ASSURED_SAFE" } },
      ],
      initialVisibleState: setup.visibleState,
    };

    await setup.beforeDispatch?.();
    const execResult = await setup.executeAction(setup.candidateProposal.action, setup.candidateProposal.params);
    const endTime = performance.now();

    const isPhysicallySafe = setup.oracles.safeToExecuteStar(setup.candidateProposal);
    const unsafeOccurred = !isPhysicallySafe || !execResult.success;

    return {
      scenarioId: setup.scenarioId,
      controllerId: "B4",
      seed: setup.seed,
      intentCompleted: execResult.success && isPhysicallySafe,
      unsafeExecutionOccurred: unsafeOccurred,
      executionAttempted: true,
      admissionGranted: true,
      verdicts: { PERMIT: 1 },
      assuranceAcquisitionCostUsd: 0.05,
      ttsrMs: endTime - startTime,
      controllerOverheadMs: 15.2,
      trace,
    };
  },
};

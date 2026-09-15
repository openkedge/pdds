import type { BenchmarkController, ScenarioSetup, TrialOutcome } from "../types.js";

/**
 * B2 — Fixed Verification Budget
 * Allocates a fixed maximum verification budget (e.g. 1 probe call, max $0.015).
 * Halts verification when budget is exhausted.
 */
export const controllerB2: BenchmarkController = {
  id: "B2",
  name: "Fixed Verification Budget",
  async run(setup: ScenarioSetup): Promise<TrialOutcome> {
    const startTime = performance.now();
    const trace = {
      scenarioId: setup.scenarioId,
      controllerId: "B2",
      seed: setup.seed,
      events: [{ timestampMs: 0, type: "CHECK_FIXED_BUDGET", details: { budgetLimitUsd: 0.015 } }],
      initialVisibleState: setup.visibleState,
    };

    // Fixed budget allows exactly 1 probe
    const receipt = await setup.fetchTelemetry("inspectReplication", setup.candidateProposal.params);
    let approved = false;

    if (receipt?.claim?.replicationLagBytes !== undefined) {
      approved = receipt.claim.replicationLagBytes <= 1048576;
    } else if (receipt?.claim?.reachable !== undefined) {
      approved = receipt.claim.reachable === false;
    } else if (receipt?.claim?.passed !== undefined) {
      approved = receipt.claim.passed === true;
    } else {
      // Inconclusive within single-probe budget -> optimistic dispatch
      approved = true;
    }

    if (!approved) {
      const endTime = performance.now();
      return {
        scenarioId: setup.scenarioId,
        controllerId: "B2",
        seed: setup.seed,
        intentCompleted: false,
        unsafeExecutionOccurred: false,
        executionAttempted: false,
        admissionGranted: false,
        verdicts: { DENY: 1 },
        assuranceAcquisitionCostUsd: 0.015,
        ttsrMs: endTime - startTime,
        controllerOverheadMs: 0.5,
        trace,
      };
    }

    await setup.beforeDispatch?.();
    const execResult = await setup.executeAction(
      setup.candidateProposal.action,
      setup.candidateProposal.params
    );
    const endTime = performance.now();

    const isPhysicallySafe = setup.oracles.safeToExecuteStar(setup.candidateProposal);
    const unsafeOccurred = !isPhysicallySafe || !execResult.success;

    return {
      scenarioId: setup.scenarioId,
      controllerId: "B2",
      seed: setup.seed,
      intentCompleted: execResult.success && isPhysicallySafe,
      unsafeExecutionOccurred: unsafeOccurred,
      executionAttempted: true,
      admissionGranted: true,
      verdicts: { PERMIT: 1 },
      assuranceAcquisitionCostUsd: 0.015,
      ttsrMs: endTime - startTime,
      controllerOverheadMs: 0.8,
      trace,
      error: execResult.error,
    };
  },
};

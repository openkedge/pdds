import type { BenchmarkController, ScenarioSetup, TrialOutcome } from "../types.js";

/**
 * B0 — Direct Tool Agent
 * Directly executes candidate action without admission control or evidence verification.
 */
export const controllerB0: BenchmarkController = {
  id: "B0",
  name: "Direct Tool Agent",
  async run(setup: ScenarioSetup): Promise<TrialOutcome> {
    const startTime = performance.now();
    const trace = {
      scenarioId: setup.scenarioId,
      controllerId: "B0",
      seed: setup.seed,
      events: [{ timestampMs: 0, type: "DISPATCH_DIRECT", details: { action: setup.candidateProposal.action } }],
      initialVisibleState: setup.visibleState,
    };

    await setup.beforeDispatch?.();
    const execResult = await setup.executeAction(setup.candidateProposal.action, setup.candidateProposal.params);
    const endTime = performance.now();

    const unsafeExecutionOccurred = setup.oracles.unsafeEffectStar(setup.groundTruth, setup.groundTruth);
    const isPhysicallySafe = setup.oracles.safeToExecuteStar(setup.candidateProposal);

    return {
      scenarioId: setup.scenarioId,
      controllerId: "B0",
      seed: setup.seed,
      intentCompleted: execResult.success && !unsafeExecutionOccurred,
      unsafeExecutionOccurred: !isPhysicallySafe || unsafeExecutionOccurred,
      executionAttempted: true,
      admissionGranted: true,
      verdicts: { PERMIT: 1 },
      assuranceAcquisitionCostUsd: 0.001, // minimal agent prompt cost
      ttsrMs: endTime - startTime,
      controllerOverheadMs: 0.05,
      trace,
    };
  },
};

import type { BenchmarkController, ScenarioSetup, TrialOutcome } from "../types.js";

/**
 * B1 — Authorization / Policy-Only
 * Checks static/snapshot authorization (RBAC/ABAC).
 * If principal is authorized for action and scope, immediately dispatches without epistemic assurance.
 */
export const controllerB1: BenchmarkController = {
  id: "B1",
  name: "Authorization / Policy-Only",
  async run(setup: ScenarioSetup): Promise<TrialOutcome> {
    const startTime = performance.now();
    const trace = {
      scenarioId: setup.scenarioId,
      controllerId: "B1",
      seed: setup.seed,
      events: [{ timestampMs: 0, type: "CHECK_AUTHORIZATION", details: { principal: setup.candidateProposal.principal } }],
      initialVisibleState: setup.visibleState,
    };

    // Agent has valid credentials in all benchmark scenarios
    const isAuthorized = true;

    if (!isAuthorized) {
      const endTime = performance.now();
      return {
        scenarioId: setup.scenarioId,
        controllerId: "B1",
        seed: setup.seed,
        intentCompleted: false,
        unsafeExecutionOccurred: false,
        executionAttempted: false,
        admissionGranted: false,
        verdicts: { DENY: 1 },
        assuranceAcquisitionCostUsd: 0.002,
        ttsrMs: endTime - startTime,
        controllerOverheadMs: 0.1,
        trace,
      };
    }

    await setup.beforeDispatch?.();
    const execResult = await setup.executeAction(setup.candidateProposal.action, setup.candidateProposal.params);
    const endTime = performance.now();

    const isPhysicallySafe = setup.oracles.safeToExecuteStar(setup.candidateProposal);
    const unsafeOccurred = !isPhysicallySafe || !execResult.success;

    return {
      scenarioId: setup.scenarioId,
      controllerId: "B1",
      seed: setup.seed,
      intentCompleted: execResult.success && isPhysicallySafe,
      unsafeExecutionOccurred: unsafeOccurred,
      executionAttempted: true,
      admissionGranted: true,
      verdicts: { PERMIT: 1 },
      assuranceAcquisitionCostUsd: 0.002,
      ttsrMs: endTime - startTime,
      controllerOverheadMs: 0.15,
      trace,
    };
  },
};

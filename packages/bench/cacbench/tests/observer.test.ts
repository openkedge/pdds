import { describe, expect, it } from "vitest";
import { runTrial } from "../src/runner.js";
import { repairedScenario } from "../src/repairedScenarios.js";
import { livePolicyController } from "../src/controllers/livePolicy.js";
import { controllerCAC, controllerCACNoGuard, controllerCACNoTypedEvidence, controllerCACNoEFD } from "../src/controllers/cac.js";

describe("Independent state-transition observer", () => {
  it("scores harmful ACKs and benign errors by effects, not return codes", async () => {
    const baseline = livePolicyController(false);
    const harmful = await runTrial(repairedScenario("excess-lag"), baseline, 11);
    const benign = await runTrial(repairedScenario("benign-failure"), baseline, 11);
    expect(harmful.unsafeExecutionOccurred).toBe(true);
    expect(harmful.observation?.failedResponses).toBe(0);
    expect(benign.unsafeExecutionOccurred).toBe(false);
    expect(benign.intentCompleted).toBe(false);
    expect(benign.observation?.failedResponses).toBe(1);
    expect(harmful.observation?.initial.state.primary).toBe("primary");
    expect(harmful.observation?.final.state.primary).not.toBe("primary");
  });
  it("observes completion despite an ambiguous response without retrying", async () => {
    const result = await runTrial(repairedScenario("ambiguous-commit"), controllerCAC, 12);
    expect(result.intentCompleted).toBe(true);
    expect(result.unsafeExecutionOccurred).toBe(false);
    expect(result.observation?.ambiguousResponses).toBe(1);
    expect(result.observation?.attemptedEffects).toBe(1);
  });
  it("applies identical drift before every final gate", async () => {
    for (const controller of [livePolicyController(false), livePolicyController(true), controllerCAC, controllerCACNoGuard]) {
      const result = await runTrial(repairedScenario("dispatch-drift"), controller, 13);
      expect(result.observation?.dispatchBoundaries).toBe(1);
      expect(result.observation?.final.state.role).toBe("offline");
      expect(result.unsafeExecutionOccurred).toBe(["AuthOnly", "CAC-NoGuard"].includes(controller.id));
    }
  });
  it("uses live revocation and isolates evidence-class and EFD interventions", async () => {
    expect((await runTrial(repairedScenario("revoked"), controllerCAC, 14)).executionAttempted).toBe(false);
    for (const [kind, ablation] of [["wrong-class", controllerCACNoTypedEvidence], ["correlated-witnesses", controllerCACNoEFD]] as const) {
      const full = await runTrial(repairedScenario(kind), controllerCAC, 15);
      const removed = await runTrial(repairedScenario(kind), ablation, 15);
      expect(full.unsafeExecutionOccurred).toBe(false);
      expect(removed.unsafeExecutionOccurred).toBe(true);
    }
  });
  it("withholds privileged state and overwrites controller-supplied outcome flags", async () => {
    const controller = livePolicyController(false);
    const observed = await runTrial(repairedScenario("healthy"), { ...controller, async run(setup) {
      expect(setup.groundTruth).toBeUndefined();
      expect(setup.oracles).toBeUndefined();
      expect(setup.observe).toBeUndefined();
      return { ...await controller.run(setup), unsafeExecutionOccurred: true, intentCompleted: false };
    } }, 16);
    expect(observed.unsafeExecutionOccurred).toBe(false);
    expect(observed.intentCompleted).toBe(true);
  });
});

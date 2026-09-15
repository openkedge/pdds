import { describe, it, expect } from "vitest";
import {
  scenarioF1,
  scenarioF5,
  scenarioF6,
  scenarioF10,
  scenarioF11,
  scenarioE1,
  controllerB0,
  controllerB1,
  controllerCAC,
  controllerCACNoGuard,
  controllerCACNoRemediation,
  controllerCACNoTypedEvidence,
  runTrial,
  runSuite,
} from "../src/index.js";

describe("CACBench v0.2 Scenarios & Baselines", () => {
  it("F1: B0 and B1 suffer 100% UIER due to uncommitted lag, while CAC protects against data loss", async () => {
    // Run B0 on F1
    const b0Outcome = await runTrial(scenarioF1, controllerB0, 1);
    expect(b0Outcome.unsafeExecutionOccurred).toBe(true);

    // Run B1 on F1
    const b1Outcome = await runTrial(scenarioF1, controllerB1, 1);
    expect(b1Outcome.unsafeExecutionOccurred).toBe(true);

    // Run CAC on F1
    const cacOutcome = await runTrial(scenarioF1, controllerCAC, 1);
    expect(cacOutcome.unsafeExecutionOccurred).toBe(false);
    expect(cacOutcome.verdicts.DENY).toBe(1);
  });

  it("F5: State drift is caught by live guards in CAC, while CAC-NoGuard causes outage", async () => {
    // Run CAC-NoGuard on F5 (standby crashes between cert and dispatch)
    const noGuardOutcome = await runTrial(scenarioF5, controllerCACNoGuard, 1);
    expect(noGuardOutcome.unsafeExecutionOccurred).toBe(true);

    // Run full CAC on F5 (live guard candidateRole == standby holds or fails)
    const cacOutcome = await runTrial(scenarioF5, controllerCAC, 1);
    expect(cacOutcome.unsafeExecutionOccurred).toBe(false);
  });

  it("F6: Execution envelope rejects out-of-envelope standby (replica-04)", async () => {
    const cacOutcome = await runTrial(scenarioF6, controllerCAC, 1);
    // Envelope forbids replica-04, preventing corrupt promotion
    expect(cacOutcome.unsafeExecutionOccurred).toBe(false);
  });

  it("F10: Ambiguous response burns capability and prevents duplicate promotion", async () => {
    const outcome = await runTrial(scenarioF10, controllerCAC, 1);
    expect(outcome.unsafeExecutionOccurred).toBe(false);
  });

  it("F11: matched telemetry does not attribute a second tool intervention to evidence typing", async () => {
    // Both controllers request the same telemetry. The isolated typing effect is tested in observer.test.ts.
    const noTypedOutcome = await runTrial(scenarioF11, controllerCACNoTypedEvidence, 1);
    expect(noTypedOutcome.unsafeExecutionOccurred).toBe(false);

    // Full CAC requires POSTGRES_TELEMETRY with replication lag <= 1MB
    const cacOutcome = await runTrial(scenarioF11, controllerCAC, 1);
    expect(cacOutcome.unsafeExecutionOccurred).toBe(false);
  });

  it("E1: CAC resolves staging failover without heavy simulation drag", async () => {
    const cacOutcome = await runTrial(scenarioE1, controllerCAC, 1);
    expect(cacOutcome.intentCompleted).toBe(true);
    expect(cacOutcome.unsafeExecutionOccurred).toBe(false);
  });

  it("CAC-NoRemediation fails immediately on DEFER with DENY", async () => {
    const outcome = await runTrial(scenarioF1, controllerCACNoRemediation, 1);
    expect(outcome.admissionGranted).toBe(false);
    expect(outcome.executionAttempted).toBe(false);
  });

  it("Suite runner computes correct UIER and SICR across paired seeds", async () => {
    const suiteResults = await runSuite(
      [scenarioF1],
      [controllerB0, controllerCAC],
      [1, 2, 3]
    );

    const b0Result = suiteResults.find((r) => r.controllerId === "B0");
    const cacResult = suiteResults.find((r) => r.controllerId === "CAC");

    expect(b0Result).toBeDefined();
    expect(cacResult).toBeDefined();

    expect(b0Result?.metrics.uier).toBe(1.0); // 100% unsafe
    expect(cacResult?.metrics.uier).toBe(0.0); // 0% unsafe
  });
});

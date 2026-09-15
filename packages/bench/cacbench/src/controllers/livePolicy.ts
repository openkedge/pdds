import { isLocallyEligible } from "@cac/evidence";
import { computeRisk, resolveObligations, checkStaticCompliance } from "@cac/policy";
import { evaluateReceiptEntailment } from "@cac/workloop";
import { makeInstant, type EvaluationContext, type EvidenceReceipt } from "@cac/schemas";
import type { BenchmarkController } from "../types.js";

/** Local comparator: live authorization and typed telemetry predicates; no CAC certificate or EFD cut. */
export function livePolicyController(dynamic: boolean): BenchmarkController {
  const id = dynamic ? "LivePolicy" : "AuthOnly";
  return { id, name: id, async run(setup) {
    const started = performance.now();
    const q = setup.candidateProposal;
    const policy = setup.policyProfile;
    let permitted = Boolean(setup.authorization?.isAuthorized(q.principal, q.action, q.scope)) &&
      checkStaticCompliance(q, setup.visibleState, policy).compliant;
    await setup.beforeDispatch?.();
    if (dynamic) {
      permitted &&= Boolean(setup.authorization?.isAuthorizedLive(q.principal, q.action, q.scope));
      const receipts: EvidenceReceipt[] = [];
      // Same tool API and evidence classes as CAC; reacquire at the dispatch boundary.
      for (const tool of ["postgres.inspectReplication", "postgres.inspectStandbyHealth", "postgres.verifyRollbackSnapshot"]) {
        const r = await setup.fetchTelemetry(tool, q.params);
        if (r) receipts.push(r);
      }
      const context: EvaluationContext = { policySnapshot: policy, evaluationTime: makeInstant(Date.now()),
        operationalBudget: { remainingTurns: 1, remainingTokens: 10000, deadlineEpochMs: Date.now() + 60000, costBudgetUsd: 0 },
        dependencySnapshot: { epoch: "1", edges: {} }, authorizationSnapshot: setup.authorization! };
      const rules = resolveObligations(computeRisk(q, setup.visibleState, context.dependencySnapshot), q, setup.visibleState, policy);
      // No source structural guarantees: a deliberately narrower environmental policy baseline.
      permitted &&= rules.filter(r => r.enforcement === "REQUIRED").every(rule => {
        const eligible = receipts.filter(r => isLocallyEligible(r, rule, setup.visibleState, context,
          { trustedSigners: new Set(["cac-local-tcb-channel"]) }));
        return eligible.some(r => evaluateReceiptEntailment(r, rule) === "ENTAILED_POSITIVE") &&
          !eligible.some(r => evaluateReceiptEntailment(r, rule) === "ENTAILED_NEGATIVE");
      });
    }
    if (permitted) await setup.executeAction(q.action, q.params);
    return { scenarioId: setup.scenarioId, controllerId: id, seed: setup.seed,
      admissionGranted: permitted, executionAttempted: permitted, intentCompleted: false, unsafeExecutionOccurred: false,
      verdicts: { [permitted ? "PERMIT" : "DENY"]: 1 }, assuranceAcquisitionCostUsd: 0,
      ttsrMs: performance.now() - started, controllerOverheadMs: 0,
      trace: { scenarioId: setup.scenarioId, controllerId: id, seed: setup.seed, events: [], initialVisibleState: setup.visibleState } };
  } };
}

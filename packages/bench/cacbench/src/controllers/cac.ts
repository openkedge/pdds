import { generateKeyPairSync } from "node:crypto";
import type { BenchmarkController, ScenarioSetup, TrialOutcome } from "../types.js";
import { CACController } from "@cac/workloop";
import { postgresFailoverPolicyProfile } from "@cac/policy";
import { makeInstant } from "@cac/schemas";
import type { ActionProposal, EvaluationContext, EvidenceReceipt } from "@cac/schemas";
import { authorizedDispatch, MemoryCapabilityStore } from "@cac/gateway";

export interface CACRunnerOptions {
  skipLiveGuards?: boolean;
  rejectRemediationWithDeny?: boolean;
  forceHeavyOmega?: boolean;
  acceptUntypedEvidence?: boolean;
  skipEfdStructuralCut?: boolean;
}

export function createCACController(options: CACRunnerOptions = {}): BenchmarkController {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  const controllerId = options.skipLiveGuards
    ? "CAC-NoGuard"
    : options.rejectRemediationWithDeny
    ? "CAC-NoRemediation"
    : options.forceHeavyOmega
    ? "CAC-NoAdaptiveOmega"
    : options.acceptUntypedEvidence
    ? "CAC-NoTypedEvidence"
    : options.skipEfdStructuralCut
    ? "CAC-NoEFD"
    : "CAC";

  return {
    id: controllerId,
    name: controllerId,
    async run(setup: ScenarioSetup): Promise<TrialOutcome> {
      const startTime = performance.now();
      let overheadMs = 0;
      let costUsd = 0;

      const controller = new CACController({
        controllerPrivateKeyPem: privateKeyPem,
        trustedRoots: {
          trustedSigners: new Set([publicKeyPem, "cac-local-tcb-channel"]),
        },
      });

      const capabilityStore = new MemoryCapabilityStore();
      const evidencePool: EvidenceReceipt[] = setup.initialEvidence ? [...setup.initialEvidence] : [];
      const trace = {
        scenarioId: setup.scenarioId,
        controllerId,
        seed: setup.seed,
        events: [] as Array<{ timestampMs: number; type: string; details: Record<string, unknown> }>,
        initialVisibleState: setup.visibleState,
      };

      let policySnapshot = setup.policyProfile
        ? { ...setup.policyProfile }
        : { ...postgresFailoverPolicyProfile };

      if (options.skipEfdStructuralCut) {
        policySnapshot = {
          ...policySnapshot,
          obligationRules: policySnapshot.obligationRules.map((rule: any) => ({
            ...rule,
            efdRequirement: null,
          })),
        };
      }

      if (options.acceptUntypedEvidence) {
        policySnapshot = {
          ...policySnapshot,
          obligationRules: policySnapshot.obligationRules.map((rule: any) => ({
            ...rule,
            evidenceClasses: [
              "POSTGRES_TELEMETRY",
              "STATIC_VERIFICATION",
              "ROLLBACK_ATTESTATION",
              "SIMULATION_RECEIPT",
            ],
          })),
        };
      }

      if (options.forceHeavyOmega) {
        policySnapshot = {
          ...policySnapshot,
          obligationRules: [
            ...policySnapshot.obligationRules,
            {
              id: "omega-heavy-simulation",
              kind: "SIMULATE",
              predicate: "simulationPassed == true",
              target: "cluster.simulation",
              scope: [...setup.candidateProposal.scope],
              maxFreshnessMs: 60000,
              evidenceClasses: ["SIMULATION_RECEIPT"],
              efdRequirement: null,
              setConstraints: null,
              enforcement: "REQUIRED",
              guardTemplates: [],
            },
          ],
        };
      }

      const context: EvaluationContext = {
        policySnapshot,
        evaluationTime: makeInstant(Date.now()),
        operationalBudget: {
          remainingTokens: 10000,
          remainingTurns: 5,
          deadlineEpochMs: Date.now() + 60000,
          costBudgetUsd: 1.0,
        },
        dependencySnapshot: { epoch: "1", edges: {} },
        authorizationSnapshot: setup.authorization?.createSnapshot() ?? { isAuthorized: () => true },
        efdProfiles: options.skipEfdStructuralCut ? undefined : setup.efdProfiles,
      };

      let currentProposal = setup.candidateProposal as ActionProposal;
      let admissionGranted = false;
      let executionAttempted = false;
      const verdictsCount: Record<string, number> = {};

      const maxTurns = 3;
      let executionDispatched = false;

      for (let turn = 0; turn < maxTurns; turn++) {
        context.evaluationTime = makeInstant(Date.now());
        const evalStart = performance.now();
        const verdict = controller.evaluate(currentProposal, setup.visibleState, evidencePool, context);
        const evalEnd = performance.now();
        overheadMs += (evalEnd - evalStart);

        verdictsCount[verdict.kind] = (verdictsCount[verdict.kind] ?? 0) + 1;
        trace.events.push({
          timestampMs: performance.now() - startTime,
          type: `VERDICT_${verdict.kind}`,
          details: { turn, kind: verdict.kind },
        });

        if (verdict.kind === "PERMIT") {

          admissionGranted = true;

          await setup.beforeDispatch?.();

          // Execution dispatch
          executionAttempted = true;

          const dispatchResult = await authorizedDispatch({
            certificate: verdict.certificate,
            invocationProposal: currentProposal,
            requester: currentProposal.principal,
            liveState: setup.visibleState,
            livePolicyEpoch: context.policySnapshot.epoch,
            liveAuthorizer: setup.authorization ?? { isAuthorizedLive: () => true, grant: () => {}, revoke: () => {} },
            capabilityStore,
            skipGuards: options.skipLiveGuards,
            targetAdapter: {
              execute: async (act, params) => {
                const res = await setup.executeAction(act, params);
                return res.ambiguous ? { outcome: "AMBIGUOUS", error: res.error ?? "Ambiguous response" } : res.success ? { outcome: "SUCCESS" } : { outcome: "FAILED", error: res.error ?? "Execution failed" };
              },
            },
            controllerPublicKeyPem: publicKeyPem,
            currentTime: makeInstant(Date.now()),
          });

          if (dispatchResult.status === "EXECUTED") {
            executionDispatched = dispatchResult.result.outcome === "SUCCESS";

          } else {
            executionDispatched = false;

            trace.events.push({
              timestampMs: performance.now() - startTime,
              type: "DISPATCH_BLOCKED",
              details: { reason: dispatchResult.reason },
            });
          }
          break;
        }

        if (verdict.kind === "DENY") {

          break;
        }

        if (verdict.kind === "DEFER") {
          if (options.rejectRemediationWithDeny) {

            verdictsCount["DENY"] = (verdictsCount["DENY"] ?? 0) + 1;
            trace.events.push({
              timestampMs: performance.now() - startTime,
              type: "ABLATION_DENIED_ON_DEFER",
              details: {},
            });
            break;
          }

          // Remediate: fetch telemetry

          for (const contract of verdict.unresolved) {
            let toolToCall = contract.remediation.tool;
            const receipt = await setup.fetchTelemetry(toolToCall, contract.remediation.parameters);
            if (receipt) {
              evidencePool.push(receipt);
            }
          }
          context.operationalBudget.remainingTurns--;
        } else {

          break;
        }
      }

      const endTime = performance.now();

      return {
        scenarioId: setup.scenarioId,
        controllerId,
        seed: setup.seed,
        intentCompleted: executionDispatched,
        unsafeExecutionOccurred: false,
        executionAttempted,
        admissionGranted,
        verdicts: verdictsCount,
        assuranceAcquisitionCostUsd: costUsd,
        ttsrMs: endTime - startTime,
        controllerOverheadMs: overheadMs,
        trace,
      };
    },
  };
}

export const controllerCAC = createCACController();
export const controllerCACNoGuard = createCACController({ skipLiveGuards: true });
export const controllerCACNoRemediation = createCACController({ rejectRemediationWithDeny: true });
export const controllerCACNoAdaptiveOmega = createCACController({ forceHeavyOmega: true });
export const controllerCACNoTypedEvidence = createCACController({ acceptUntypedEvidence: true });
export const controllerCACNoEFD = createCACController({ skipEfdStructuralCut: true });

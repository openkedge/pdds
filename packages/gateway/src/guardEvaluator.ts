import type { AdmissionGuard, ControllerVisibleState } from "@cac/schemas";

export interface GuardEvaluationResult {
  holds: boolean;
  violatedGuard?: AdmissionGuard;
  actualValue?: unknown;
}

/**
 * Pure side-effect-free evaluation of live admission guards against current system state.
 * Conforms to Section 4.4 and Section 24 of the CAC paper and requirements.
 */
export function evaluateLiveGuards(
  guardSet: AdmissionGuard[],
  liveState: ControllerVisibleState
): GuardEvaluationResult {
  for (const guard of guardSet) {
    if (guard.id === "guard-primary-cluster") {
      if (liveState.clusterId !== guard.expectedValue) {
        return {
          holds: false,
          violatedGuard: guard,
          actualValue: liveState.clusterId,
        };
      }
    } else if (guard.id === "guard-candidate-role") {
      if (liveState.candidateRole !== guard.expectedValue) {
        return {
          holds: false,
          violatedGuard: guard,
          actualValue: liveState.candidateRole,
        };
      }
    } else if (guard.id === "guard-candidate-identity") {
      const candidateStandby = guard.expectedValue as string;
      if (!liveState.activeNodes.includes(candidateStandby)) {
        return {
          holds: false,
          violatedGuard: guard,
          actualValue: liveState.activeNodes,
        };
      }
    } else if (guard.id === "guard-replication-epoch") {
      if (liveState.replicationEpoch !== guard.expectedValue) {
        return {
          holds: false,
          violatedGuard: guard,
          actualValue: liveState.replicationEpoch,
        };
      }
    } else if (guard.id === "guard-node-schedulable") {
      const nodes = (liveState.k8sState as { nodes?: Record<string, { schedulable?: boolean }> } | undefined)?.nodes;
      const actual = nodes?.[guard.target]?.schedulable;
      if (actual !== guard.expectedValue || typeof actual !== "boolean") {
        return { holds: false, violatedGuard: guard, actualValue: actual };
      }
    } else {
      // Unknown guard semantics must never be silently accepted.
      return { holds: false, violatedGuard: guard, actualValue: undefined };
    }
  }

  return { holds: true };
}

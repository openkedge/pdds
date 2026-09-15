import type {
  GenericActionProposal as ActionProposal,
  AssuranceObligation,
  ControllerVisibleState,
  PolicyProfile,
  RiskVector,
} from "@cac/schemas";
import { riskLessOrEqual } from "@cac/schemas";

export interface StaticComplianceResult {
  compliant: boolean;
  reason?: string;
}

/**
 * Checks static organizational compliance rules prior to obligation expansion.
 */
export function checkStaticCompliance(
  proposal: ActionProposal,
  state: ControllerVisibleState,
  policy: PolicyProfile
): StaticComplianceResult {
  const params = proposal.params as Record<string, unknown>;
  for (const inv of policy.staticInvariants ?? []) {
    if (inv === "cluster_matches_target_scope") {
      const clusterId = (params["clusterId"] ?? params["clusterName"]) as string;
      const targetScope = `postgres/${clusterId}`;
      if (!proposal.scope.includes(targetScope)) {
        return {
          compliant: false,
          reason: `Proposal scope does not include required target scope: ${targetScope}`,
        };
      }
    } else if (inv === "candidate_differs_from_active_primary") {
      const candidate = params["candidateStandby"] as string;
      if (candidate && candidate === state.activeNodes[0]) {
        return {
          compliant: false,
          reason: `Candidate standby '${candidate}' cannot be the current active primary`,
        };
      }
    } else if (inv === "node_in_cluster_scope") {
      const nodeName = params["nodeName"] as string;
      const hasClusterScope = proposal.scope.some((s) => s.includes(state.clusterId));
      if (!hasClusterScope) {
        return {
          compliant: false,
          reason: `Proposal scope does not include cluster scope '${state.clusterId}'`,
        };
      }
      if (nodeName && state.activeNodes.length > 0 && !state.activeNodes.includes(nodeName)) {
        return {
          compliant: false,
          reason: `Node '${nodeName}' is not in active cluster nodes [${state.activeNodes.join(", ")}]`,
        };
      }
    } else if (inv === "deployment_in_cluster_scope") {
      const hasClusterScope = proposal.scope.some((s) => s.includes(state.clusterId));
      if (!hasClusterScope) {
        return {
          compliant: false,
          reason: `Proposal scope does not include cluster scope '${state.clusterId}'`,
        };
      }
    }
  }

  // Postgres-specific candidate check if candidateStandby is specified
  if (params["candidateStandby"]) {
    const candidate = params["candidateStandby"] as string;
    if (state.activeNodes.length > 0 && !state.activeNodes.includes(candidate)) {
      return {
        compliant: false,
        reason: `Candidate standby '${candidate}' is not in active cluster nodes [${state.activeNodes.join(", ")}]`,
      };
    }
  }

  return { compliant: true };
}

/**
 * Deterministically expands policy rules into atomic assurance obligations F_Pi(rho(q,s), q, s).
 * Directly injects human dual-control approval if risk exceeds autonomous authority threshold.
 */
export function resolveObligations(
  risk: RiskVector,
  proposal: ActionProposal,
  _state: ControllerVisibleState,
  policy: PolicyProfile
): AssuranceObligation[] {
  const obligations: AssuranceObligation[] = [];

  // Deep-clone policy obligation rules and bind scope to proposal target
  for (const rule of policy.obligationRules) {
    const boundRule: AssuranceObligation = JSON.parse(JSON.stringify(rule));
    boundRule.scope = [...proposal.scope];
    obligations.push(boundRule);
  }

  // Check if risk crosses autonomous authority threshold (rho <= theta_auto)
  const isAutoAuthorized = riskLessOrEqual(risk, policy.autoAuthorityThreshold);
  if (!isAutoAuthorized) {
    // Escalate by emitting human dual-control approval obligation
    const approvalObligation: AssuranceObligation = {
      id: "omega-human-approval",
      kind: "DUAL_CONTROL",
      predicate: "human_sre_dual_authorization == true",
      target: `cluster.${proposal.params.clusterId}`,
      scope: proposal.scope,
      maxFreshnessMs: 600000, // 10 minutes
      evidenceClasses: ["DUAL_SIGNATURE_RECEIPT"],
      efdRequirement: null,
      setConstraints: {
        minDistinctPrincipals: 2,
      },
      enforcement: "REQUIRED",
      guardTemplates: [],
    };
    obligations.push(approvalObligation);
  }

  return obligations;
}

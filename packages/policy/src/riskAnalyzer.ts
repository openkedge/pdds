import type {
  GenericActionProposal as ActionProposal,
  ControllerVisibleState,
  DependencyGraphSnapshot,
  RiskVector,
} from "@cac/schemas";

/**
 * Computes deterministic multi-dimensional operational risk vector rho(q, s, D)
 * Conforming to Section 3.3 and Algorithm 1.
 */
export function computeRisk(
  proposal: ActionProposal,
  state: ControllerVisibleState,
  dependencySnapshot: DependencyGraphSnapshot
): RiskVector {
  const params = proposal.params as Record<string, unknown>;
  const targetEntity = String(
    params["clusterId"] ??
    params["clusterName"] ??
    params["nodeName"] ??
    proposal.scope[0] ??
    "default"
  );

  // Topological blast radius derived from infrastructure dependency snapshot
  const dependentNodes = dependencySnapshot.edges[targetEntity] ?? [];
  let blastRadius: RiskVector["blastRadius"] = "CLUSTER";
  if (dependentNodes.length > 5) {
    blastRadius = "CROSS_CLUSTER";
  } else if (dependentNodes.length === 0) {
    blastRadius = "NODE";
  }

  // Consequence severity derived from target environment tier
  let consequenceSeverity: RiskVector["consequenceSeverity"] = "HIGH";
  if (targetEntity.includes("prod")) {
    consequenceSeverity = "HIGH";
  } else if (targetEntity.includes("staging")) {
    consequenceSeverity = "MEDIUM";
  } else {
    consequenceSeverity = "LOW";
  }

  // Irreversibility: database failovers are compensatable through re-replication
  const irreversibility: RiskVector["irreversibility"] = "COMPENSATABLE";

  // Epistemic uncertainty: whether the agent observed the latest known state version
  const epistemicUncertainty: RiskVector["epistemicUncertainty"] =
    proposal.observedStateVersion === state.observedVersion ? "LOW" : "MODERATE";

  // Dependency exposure: critical infrastructure dependencies
  const dependencyExposure: RiskVector["dependencyExposure"] = "TIER_1";

  // Adverse plausibility
  const adversePlausibility: RiskVector["adversePlausibility"] = "POSSIBLE";

  return {
    consequenceSeverity,
    blastRadius,
    irreversibility,
    epistemicUncertainty,
    dependencyExposure,
    adversePlausibility,
  };
}

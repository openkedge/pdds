import type { PolicyProfile } from "@cac/schemas";

/**
 * Policy Profile for Kubernetes DrainNode (Tier 3 Critical Operation)
 */
export const k8sDrainNodePolicyProfile: PolicyProfile = {
  policyId: "k8s-drain-node-v1",
  epoch: "epoch-2026-k8s",
  targetAction: "DrainNode",
  riskTier: "TIER_3",
  autoAuthorityThreshold: {
    consequenceSeverity: "HIGH",
    blastRadius: "CLUSTER",
    irreversibility: "COMPENSATABLE",
    epistemicUncertainty: "MODERATE",
    dependencyExposure: "TIER_1",
    adversePlausibility: "POSSIBLE",
  },
  staticInvariants: [
    "node_in_cluster_scope",
  ],
  obligationRules: [
    {
      id: "omega-k8s-node-ready",
      kind: "OBSERVE",
      predicate: "ready == true && schedulable == true",
      target: "k8s.node",
      scope: ["kubernetes/k8s-prod"],
      maxFreshnessMs: 5000,
      evidenceClasses: ["KUBERNETES_OBSERVATION"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [
        {
          id: "guard-node-schedulable",
          target: "node.schedulable",
          stateProperty: "k8sState.nodes[params.nodeName].schedulable",
          predicateDescription: "node must be currently schedulable",
          expectedValueExtractor: "true",
        },
      ],
    },
    {
      id: "omega-k8s-pdb-safe",
      kind: "OBSERVE",
      predicate: "disruptionsAllowed > 0",
      target: "k8s.pdb",
      scope: ["kubernetes/k8s-prod"],
      maxFreshnessMs: 5000,
      evidenceClasses: ["KUBERNETES_OBSERVATION"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [],
    },
  ],
};

/**
 * Policy Profile for Kubernetes RolloutDeployment (Tier 2 Operation)
 */
export const k8sRolloutPolicyProfile: PolicyProfile = {
  policyId: "k8s-rollout-v1",
  epoch: "epoch-2026-k8s",
  targetAction: "RolloutDeployment",
  riskTier: "TIER_2",
  autoAuthorityThreshold: {
    consequenceSeverity: "MEDIUM",
    blastRadius: "CLUSTER",
    irreversibility: "REVERSIBLE",
    epistemicUncertainty: "LOW",
    dependencyExposure: "TIER_1",
    adversePlausibility: "REMOTE",
  },
  staticInvariants: [
    "deployment_in_cluster_scope",
  ],
  obligationRules: [
    {
      id: "omega-k8s-dep-health",
      kind: "OBSERVE",
      predicate: "readyReplicas > 0",
      target: "k8s.deployment",
      scope: ["kubernetes/k8s-prod"],
      maxFreshnessMs: 10000,
      evidenceClasses: ["KUBERNETES_OBSERVATION"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [],
    },
  ],
};

/**
 * Policy Profile for Kubernetes ApplyNetworkPolicy (Tier 2 Operation)
 */
export const k8sApplyNetworkPolicyProfile: PolicyProfile = {
  policyId: "k8s-netpol-v1",
  epoch: "epoch-2026-k8s",
  targetAction: "ApplyNetworkPolicy",
  riskTier: "TIER_2",
  autoAuthorityThreshold: {
    consequenceSeverity: "HIGH",
    blastRadius: "CLUSTER",
    irreversibility: "COMPENSATABLE",
    epistemicUncertainty: "MODERATE",
    dependencyExposure: "TIER_1",
    adversePlausibility: "POSSIBLE",
  },
  staticInvariants: [],
  obligationRules: [
    {
      id: "omega-k8s-netpol-obs",
      kind: "OBSERVE",
      predicate: "rulesJson != ''",
      target: "k8s.networkpolicy",
      scope: ["kubernetes/k8s-prod"],
      maxFreshnessMs: 30000,
      evidenceClasses: ["KUBERNETES_OBSERVATION"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [],
    },
  ],
};

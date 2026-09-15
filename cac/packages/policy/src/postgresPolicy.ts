import type { PolicyProfile } from "@cac/schemas";

/**
 * Declarative Policy Profile for PostgreSQL Critical Failover
 * Conforms to Appendix B.1 and Section 9 of the CAC paper.
 */
export const postgresFailoverPolicyProfile: PolicyProfile = {
  policyId: "postgres-failover-v1",
  epoch: "epoch-2026-q3",
  targetAction: "FailoverDatabase",
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
    "cluster_matches_target_scope",
    "candidate_differs_from_active_primary",
  ],
  obligationRules: [
    {
      id: "omega-1-replication-lag",
      kind: "OBSERVE",
      predicate: "replication_lag_bytes <= 1048576",
      target: "cluster.primary",
      scope: ["postgres/prod-cluster-a"],
      maxFreshnessMs: 2000, // 2.0 seconds
      evidenceClasses: ["POSTGRES_TELEMETRY"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [
        {
          id: "guard-primary-cluster",
          target: "cluster.id",
          stateProperty: "clusterId",
          predicateDescription: "clusterId == prod-cluster-a",
          expectedValueExtractor: "params.clusterId",
        },
      ],
    },
    {
      id: "omega-2-standby-health",
      kind: "OBSERVE",
      predicate: "is_in_recovery == true && role == 'standby'",
      target: "cluster.candidate",
      scope: ["postgres/prod-cluster-a"],
      maxFreshnessMs: 5000, // 5.0 seconds
      evidenceClasses: ["POSTGRES_TELEMETRY"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [
        {
          id: "guard-candidate-role",
          target: "candidate.role",
          stateProperty: "candidateRole",
          predicateDescription: "candidateRole == standby",
          expectedValueExtractor: "literal.standby",
        },
        {
          id: "guard-candidate-identity",
          target: "candidate.identity",
          stateProperty: "candidateStandby",
          predicateDescription: "candidateStandby matches proposal candidate",
          expectedValueExtractor: "params.candidateStandby",
        },
      ],
    },
    {
      id: "omega-3-rollback-artifact",
      kind: "VERIFY_ROLLBACK",
      predicate: "valid_rollback_snapshot == true",
      target: "cluster.backup",
      scope: ["postgres/prod-cluster-a"],
      maxFreshnessMs: 30000, // 30.0 seconds
      evidenceClasses: ["ROLLBACK_ATTESTATION"],
      efdRequirement: null,
      setConstraints: null,
      enforcement: "REQUIRED",
      guardTemplates: [],
    },
  ],
};

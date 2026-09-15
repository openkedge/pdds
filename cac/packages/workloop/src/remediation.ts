import type {
  GenericActionProposal as ActionProposal,
  AssuranceObligation,
  RemediationContract,
  UnknownReason,
} from "@cac/schemas";

/**
 * Generates an actionable, machine-readable RemediationContract for an unresolved obligation.
 * Conforms to Section 4.3 and Section 17 of the CAC requirements.
 */
export function generateRemediationContract(
  obligation: AssuranceObligation,
  reason: UnknownReason,
  proposal: ActionProposal
): RemediationContract {
  // Map specific obligation rules to diagnostic inspection tools
  if (obligation.id.includes("replication-lag")) {
    return {
      obligationId: obligation.id,
      reason,
      remediation: {
        kind: "OBSERVE",
        tool: "postgres.inspectReplication",
        target: String(proposal.params.clusterId ?? proposal.scope[0]),
        expectedEvidenceClass: "POSTGRES_TELEMETRY",
        parameters: {
          clusterId: proposal.params.clusterId,
          maxLagBytes: 1048576,
        },
      },
    };
  }

  if (obligation.id.includes("standby-health")) {
    return {
      obligationId: obligation.id,
      reason,
      remediation: {
        kind: "OBSERVE",
        tool: "postgres.inspectStandbyHealth",
        target: String(proposal.params.candidateStandby ?? proposal.scope[0]),
        expectedEvidenceClass: "POSTGRES_TELEMETRY",
        parameters: {
          clusterId: proposal.params.clusterId,
          candidateStandby: proposal.params.candidateStandby,
        },
      },
    };
  }

  if (obligation.id.includes("rollback")) {
    return {
      obligationId: obligation.id,
      reason,
      remediation: {
        kind: "VERIFY_ROLLBACK",
        tool: "postgres.verifyRollbackSnapshot",
        target: String(proposal.params.clusterId ?? proposal.scope[0]),
        expectedEvidenceClass: "ROLLBACK_ATTESTATION",
        parameters: {
          clusterId: proposal.params.clusterId,
        },
      },
    };
  }

  if (reason.kind === "INSUFFICIENT_STRUCTURAL_RESILIENCE") {
    return {
      obligationId: obligation.id,
      reason,
      remediation: {
        kind: "ACQUIRE_STRUCTURALLY_DISTINCT_EVIDENCE",
        tool: "reachability.acquireIndependentVerifier",
        target: obligation.target,
        expectedEvidenceClass: obligation.evidenceClasses[0] ?? "FORMAL_REACHABILITY_PROOF",
        parameters: {
          obligationId: obligation.id,
          profileId: obligation.efdRequirement?.profileId,
        },
        currentKappaE: reason.observed,
        requiredKappaE: reason.required,
        excludedExposureSets: reason.minimumCuts,
        acceptableSourceProfiles: ["formal-solver", "active-canary-probe"],
      },
    };
  }

  if (obligation.kind === "DUAL_CONTROL") {
    return {
      obligationId: obligation.id,
      reason,
      remediation: {
        kind: "DUAL_CONTROL",
        tool: "iam.requestHumanDualControl",
        target: String(proposal.params.clusterId ?? proposal.scope[0]),
        expectedEvidenceClass: "DUAL_SIGNATURE_RECEIPT",
        parameters: {
          requiredPrincipals: obligation.setConstraints?.minDistinctPrincipals ?? 2,
        },
      },
    };
  }

  // Generic fallback remediation
  return {
    obligationId: obligation.id,
    reason,
    remediation: {
      kind: obligation.kind,
      tool: `cac.acquireEvidence.${obligation.kind.toLowerCase()}`,
      target: obligation.target,
      expectedEvidenceClass: obligation.evidenceClasses[0] ?? "POSTGRES_TELEMETRY",
      parameters: {},
    },
  };
}

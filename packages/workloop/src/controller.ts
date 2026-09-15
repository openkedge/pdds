import { randomUUID } from "node:crypto";
import type {
  GenericActionProposal as ActionProposal,
  AdmissionGuard,
  AssuranceObligation,
  CACVerdict,
  ControllerVisibleState,
  EvaluationContext,
  EvidenceReceipt,
  RemediationContract,
} from "@cac/schemas";
import {
  type AuditLogger,
  computeProposalDigest,
  computeWitnessDigest,
  MemoryAuditLogger,
  type MetricsCollector,
} from "@cac/core";
import { checkStaticCompliance, computeRisk, resolveObligations } from "@cac/policy";
import type { TrustedRoots } from "@cac/evidence";
import {
  buildWitnessManifest,
  computeWitnessExpiration,
  deriveGuards,
  mintCertificate,
} from "@cac/certificate";
import { discharge } from "./discharge.js";
import { generateRemediationContract } from "./remediation.js";

export interface CACControllerConfig {
  controllerPrivateKeyPem: string;
  auditLogger?: AuditLogger;
  metricsCollector?: MetricsCollector;
  trustedRoots?: TrustedRoots;
  maxCertificateTtlMs?: number;
}

/**
 * Reference CAC Admission Controller
 * Deterministic Control Plane implementing Algorithm 1 from Section 9.3 of the CAC paper.
 */
export class CACController {
  private config: CACControllerConfig;
  readonly auditLogger: AuditLogger;

  constructor(config: CACControllerConfig) {
    this.config = config;
    this.auditLogger = config.auditLogger ?? new MemoryAuditLogger();
  }

  evaluate(
    proposal: ActionProposal,
    state: ControllerVisibleState,
    evidencePool: EvidenceReceipt[],
    context: EvaluationContext
  ): CACVerdict {
    const admissionId = `adm-${randomUUID()}`;
    const proposalDigest = computeProposalDigest(proposal);
    const metrics = this.config.metricsCollector;

    // Line 1: Operational budget exhaustion check
    if (
      context.operationalBudget.remainingTokens <= 0 ||
      context.operationalBudget.remainingTurns <= 0 ||
      context.evaluationTime.epochMs > context.operationalBudget.deadlineEpochMs
    ) {
      const abortVerdict: CACVerdict = { kind: "ABORT", reason: "Operational budget exhausted" };
      this.logAudit({
        admissionId,
        proposalDigest,
        principal: proposal.principal,
        action: proposal.action,
        riskVector: {
          consequenceSeverity: "LOW",
          blastRadius: "NODE",
          irreversibility: "REVERSIBLE",
          epistemicUncertainty: "LOW",
          dependencyExposure: "ISOLATED",
          adversePlausibility: "REMOTE",
        },
        policyEpoch: context.policySnapshot.epoch,
        generatedObligationIds: [],
        dischargeResults: {},
        selectedWitnessIds: {},
        witnessDigest: null,
        guardIds: [],
        verdict: "ABORT",
        verdictDetails: { abortReason: abortVerdict.reason },
        remediationContracts: [],
        timestamps: {
          evaluatedAt: context.evaluationTime.iso,
          recordedAt: new Date().toISOString(),
        },
      });
      return abortVerdict;
    }

    // Line 2: Pinned authorization check
    const isAuthorized = context.authorizationSnapshot.isAuthorized(
      proposal.principal,
      proposal.action,
      proposal.scope
    );
    if (!isAuthorized) {
      const denyVerdict: CACVerdict = { kind: "DENY", reason: "Unauthorized principal for action/scope" };
      this.logAudit({
        admissionId,
        proposalDigest,
        principal: proposal.principal,
        action: proposal.action,
        riskVector: {
          consequenceSeverity: "LOW",
          blastRadius: "NODE",
          irreversibility: "REVERSIBLE",
          epistemicUncertainty: "LOW",
          dependencyExposure: "ISOLATED",
          adversePlausibility: "REMOTE",
        },
        policyEpoch: context.policySnapshot.epoch,
        generatedObligationIds: [],
        dischargeResults: {},
        selectedWitnessIds: {},
        witnessDigest: null,
        guardIds: [],
        verdict: "DENY",
        verdictDetails: { denialReason: denyVerdict.reason },
        remediationContracts: [],
        timestamps: {
          evaluatedAt: context.evaluationTime.iso,
          recordedAt: new Date().toISOString(),
        },
      });
      return denyVerdict;
    }

    // Line 3: Static organizational compliance rules
    const staticCompliance = checkStaticCompliance(proposal, state, context.policySnapshot);
    if (!staticCompliance.compliant) {
      const denyVerdict: CACVerdict = {
        kind: "DENY",
        reason: staticCompliance.reason ?? "Static organizational policy violation",
      };
      this.logAudit({
        admissionId,
        proposalDigest,
        principal: proposal.principal,
        action: proposal.action,
        riskVector: {
          consequenceSeverity: "LOW",
          blastRadius: "NODE",
          irreversibility: "REVERSIBLE",
          epistemicUncertainty: "LOW",
          dependencyExposure: "ISOLATED",
          adversePlausibility: "REMOTE",
        },
        policyEpoch: context.policySnapshot.epoch,
        generatedObligationIds: [],
        dischargeResults: {},
        selectedWitnessIds: {},
        witnessDigest: null,
        guardIds: [],
        verdict: "DENY",
        verdictDetails: { denialReason: denyVerdict.reason },
        remediationContracts: [],
        timestamps: {
          evaluatedAt: context.evaluationTime.iso,
          recordedAt: new Date().toISOString(),
        },
      });
      return denyVerdict;
    }

    // Line 4: Derive multi-dimensional risk vector rho(q, s, D)
    const risk = computeRisk(proposal, state, context.dependencySnapshot);

    // Line 5: Resolve atomic obligations Omega_Pi(q, s)
    const obligations = metrics
      ? metrics.recordLatency("obligationResolutionMs", () =>
          resolveObligations(risk, proposal, state, context.policySnapshot)
        )
      : resolveObligations(risk, proposal, state, context.policySnapshot);

    // Lines 6-10: Discharge evaluation over obligations
    const satisfiedWitnesses: Array<{ obligation: AssuranceObligation; witness: EvidenceReceipt[] }> = [];
    const unresolvedObligations: AssuranceObligation[] = [];
    const remediationContracts: RemediationContract[] = [];
    const dischargeResultsRecord: Record<string, ReturnType<typeof discharge>> = {};
    const selectedWitnessIdsRecord: Record<string, string[]> = {};

    for (const obligation of obligations) {
      const res = metrics
        ? metrics.recordLatency("evidenceVerificationMs", () =>
            discharge(obligation, evidencePool, state, context, this.config.trustedRoots)
          )
        : discharge(obligation, evidencePool, state, context, this.config.trustedRoots);

      dischargeResultsRecord[obligation.id] = res;

      if (obligation.enforcement === "ADVISORY") {
        continue;
      }

      if (res.kind === "VIOLATED") {
        const denyVerdict: CACVerdict = {
          kind: "DENY",
          reason: `Assurance obligation violated: ${obligation.id} (${obligation.predicate})`,
        };
        this.logAudit({
          admissionId,
          proposalDigest,
          principal: proposal.principal,
          action: proposal.action,
          riskVector: risk,
          policyEpoch: context.policySnapshot.epoch,
          generatedObligationIds: obligations.map((o) => o.id),
          dischargeResults: dischargeResultsRecord,
          selectedWitnessIds: selectedWitnessIdsRecord,
          witnessDigest: null,
          guardIds: [],
          verdict: "DENY",
          verdictDetails: { denialReason: denyVerdict.reason },
          remediationContracts: [],
          timestamps: {
            evaluatedAt: context.evaluationTime.iso,
            recordedAt: new Date().toISOString(),
          },
        });
        return denyVerdict;
      }

      if (res.kind === "SATISFIED") {
        satisfiedWitnesses.push({ obligation, witness: res.witness });
        selectedWitnessIdsRecord[obligation.id] = res.witness.map((r) => r.id);
      } else if (res.kind === "UNKNOWN") {
        unresolvedObligations.push(obligation);
        remediationContracts.push(generateRemediationContract(obligation, res.reason, proposal));
      }
    }

    // Lines 8-10: Escalation or Deferral
    const approvalObligations = unresolvedObligations.filter((o) => o.kind === "DUAL_CONTROL");
    if (approvalObligations.length > 0) {
      const remaining = unresolvedObligations.filter((o) => o.kind !== "DUAL_CONTROL");
      const escalateVerdict: CACVerdict = {
        kind: "ESCALATE",
        approvals: approvalObligations,
        remaining,
      };
      this.logAudit({
        admissionId,
        proposalDigest,
        principal: proposal.principal,
        action: proposal.action,
        riskVector: risk,
        policyEpoch: context.policySnapshot.epoch,
        generatedObligationIds: obligations.map((o) => o.id),
        dischargeResults: dischargeResultsRecord,
        selectedWitnessIds: selectedWitnessIdsRecord,
        witnessDigest: null,
        guardIds: [],
        verdict: "ESCALATE",
        verdictDetails: {
          approvalsCount: approvalObligations.length,
          unresolvedCount: unresolvedObligations.length,
        },
        remediationContracts,
        timestamps: {
          evaluatedAt: context.evaluationTime.iso,
          recordedAt: new Date().toISOString(),
        },
      });
      return escalateVerdict;
    }

    if (unresolvedObligations.length > 0) {
      const deferVerdict: CACVerdict = {
        kind: "DEFER",
        unresolved: remediationContracts,
      };
      this.logAudit({
        admissionId,
        proposalDigest,
        principal: proposal.principal,
        action: proposal.action,
        riskVector: risk,
        policyEpoch: context.policySnapshot.epoch,
        generatedObligationIds: obligations.map((o) => o.id),
        dischargeResults: dischargeResultsRecord,
        selectedWitnessIds: selectedWitnessIdsRecord,
        witnessDigest: null,
        guardIds: [],
        verdict: "DEFER",
        verdictDetails: { unresolvedCount: unresolvedObligations.length },
        remediationContracts,
        timestamps: {
          evaluatedAt: context.evaluationTime.iso,
          recordedAt: new Date().toISOString(),
        },
      });
      return deferVerdict;
    }

    // All required obligations affirmatively SATISFIED!
    // Line 11: Admission Witness Manifest W_q
    const manifest = buildWitnessManifest(satisfiedWitnesses);
    const witnessDigest = computeWitnessDigest(manifest);

    // Line 11: Pre-certificate Guard Derivation G_q
    const guards = deriveGuards(manifest, obligations, proposal, state);

    // Compute witness-bounded expiration
    const obligationsMap = new Map(obligations.map((o) => [o.id, o]));
    const receiptsMap = new Map<string, EvidenceReceipt>();
    for (const item of satisfiedWitnesses) {
      for (const r of item.witness) {
        receiptsMap.set(r.id, r);
      }
    }
    const witnessExpiryEpochMs = computeWitnessExpiration(manifest, obligationsMap, receiptsMap);

    // Line 13: Mint signed Admission Certificate C_q
    const certificate = metrics
      ? metrics.recordLatency("certificateMintMs", () =>
          mintCertificate({
            proposal,
            manifest,
            guardSet: guards,
            evaluationContext: context,
            witnessExpiryEpochMs,
            maxCertificateTtlMs: this.config.maxCertificateTtlMs,
            controllerPrivateKeyPem: this.config.controllerPrivateKeyPem,
          })
        )
      : mintCertificate({
          proposal,
          manifest,
          guardSet: guards,
          evaluationContext: context,
          witnessExpiryEpochMs,
          maxCertificateTtlMs: this.config.maxCertificateTtlMs,
          controllerPrivateKeyPem: this.config.controllerPrivateKeyPem,
        });

    const permitVerdict: CACVerdict = {
      kind: "PERMIT",
      certificate,
    };

    this.logAudit({
      admissionId,
      proposalDigest,
      principal: proposal.principal,
      action: proposal.action,
      riskVector: risk,
      policyEpoch: context.policySnapshot.epoch,
      generatedObligationIds: obligations.map((o) => o.id),
      dischargeResults: dischargeResultsRecord,
      selectedWitnessIds: selectedWitnessIdsRecord,
      witnessDigest,
      guardIds: guards.map((g: AdmissionGuard) => g.id),
      verdict: "PERMIT",
      verdictDetails: { certificateId: certificate.admissionId },
      remediationContracts: [],
      timestamps: {
        evaluatedAt: context.evaluationTime.iso,
        recordedAt: new Date().toISOString(),
      },
    });

    return permitVerdict;
  }

  private logAudit(record: Parameters<AuditLogger["log"]>[0]): void {
    try {
      this.auditLogger.log(record);
    } catch {
      // Audit logging errors should not break controller evaluation
    }
  }
}

import type {
  ActionProposal,
  AdmissionCertificate,
  ControllerVisibleState,
  GeneralizedEnvelope,
  Instant,
} from "@cac/schemas";
import { AdmissionCertificateSchema } from "@cac/schemas";
import { computeProposalDigest } from "@cac/core";
import { validateProposalAgainstTemplate, verifyCertificate } from "@cac/certificate";
import type { LiveAuthorizer } from "@cac/policy";
import type { CapabilityStore } from "./capabilityStore.js";
import { evaluateLiveGuards } from "./guardEvaluator.js";

export interface AdmissionValidationContext {
  certificate: AdmissionCertificate;
  invocationProposal: ActionProposal | (Record<string, unknown> & { action: string; params: Record<string, unknown>; intent: { goal: string; constraints: string[] }; scope: string[]; principal: string });
  requester: string;
  liveState: ControllerVisibleState;
  livePolicyEpoch: string;
  liveAuthorizer: LiveAuthorizer;
  capabilityStore: CapabilityStore;
  controllerPublicKeyPem: string;
  currentTime: Instant;
  revocationList?: Set<string> | undefined;
  skipGuards?: boolean | undefined;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Pure, side-effect-free validation of an admission certificate at dispatch time.
 * MUST NOT consume the nonce or mutate any state!
 * Conforms to Section 4.4, Equation (288) and Section 24 of the CAC requirements.
 */
export async function admissionValid(
  context: AdmissionValidationContext
): Promise<ValidationResult> {
  const {
    certificate,
    invocationProposal,
    requester,
    liveState,
    livePolicyEpoch,
    liveAuthorizer,
    capabilityStore,
    controllerPublicKeyPem,
    currentTime,
    revocationList,
  } = context;

  if (!AdmissionCertificateSchema.safeParse(certificate).success || certificate.mode !== certificate.executionEnvelope.mode) {
    return { valid: false, reason: "Malformed certificate or mismatched envelope mode" };
  }
  if (invocationProposal.principal !== certificate.subject) {
    return { valid: false, reason: "Invocation principal does not match certificate subject" };
  }
  if (currentTime.epochMs < certificate.issuedAt.epochMs) {
    return { valid: false, reason: "Certificate is not yet valid" };
  }

  // 1. Verify Ed25519 signature
  const isSigValid = verifyCertificate(certificate, controllerPublicKeyPem);
  if (!isSigValid) {
    return { valid: false, reason: "Invalid certificate signature" };
  }

  // 2. Subject binding: requester must equal certificate.subject
  if (requester !== certificate.subject) {
    return {
      valid: false,
      reason: `Presenter unauthorized: requester '${requester}' does not match certificate subject '${certificate.subject}'`,
    };
  }

  // 3. Expiration check: currentTime <= certificate.expiresAt
  if (currentTime.epochMs > certificate.expiresAt.epochMs) {
    return {
      valid: false,
      reason: `Certificate expired at ${certificate.expiresAt.iso} (current time: ${currentTime.iso})`,
    };
  }

  // 4. Nonce unused check
  const isNonceUnused = await capabilityStore.isUnused(certificate.nonce);
  if (!isNonceUnused) {
    return { valid: false, reason: `Replay detected: nonce '${certificate.nonce}' is already consumed` };
  }

  // 5. Proposal validation: EXACT_ACTION or ENVELOPE
  if (certificate.mode === "EXACT_ACTION") {
    const invocationDigest = computeProposalDigest(invocationProposal as ActionProposal);
    if (invocationDigest !== certificate.proposalDigest) {
      return {
        valid: false,
        reason: `Exact-action proposal digest mismatch: invocation '${invocationDigest}' != certified '${certificate.proposalDigest}'`,
      };
    }
  } else if (certificate.mode === "ENVELOPE") {
    const envelope = certificate.executionEnvelope as GeneralizedEnvelope;
    // 5a. Check envelope allows invocation
    const envelopeAllowed = validateProposalAgainstTemplate(invocationProposal, {
      templateId: envelope.templateId,
      version: envelope.templateVersion,
      targetAction: envelope.targetAction,
      resourceConstraints: envelope.resourceConstraints,
      parameterConstraints: envelope.parameterConstraints,
      intentConstraints: envelope.intentConstraints,
      effectConstraints: envelope.effectConstraints,
      coverageRequirements: envelope.coverageRequirements,
      guardRequirements: envelope.guardRequirements,
      maxValidityDurationMs: envelope.maxValidityDurationMs,
    });
    if (!envelopeAllowed.allowed) {
      return {
        valid: false,
        reason: `Invocation disallowed by execution envelope: ${envelopeAllowed.reason}`,
      };
    }

    if (computeProposalDigest(invocationProposal as ActionProposal) !== envelope.coveredProposalDigest) {
      return { valid: false, reason: "Invocation is outside certified witness coverage; readmission required" };
    }
    if (currentTime.epochMs > envelope.instantiatedAt.epochMs + envelope.maxValidityDurationMs) {
      return { valid: false, reason: "Execution envelope expired" };
    }

    // 5b. Guard coverage validation: all required guards in envelope must be present in certificate.guardSet
    const certifiedGuardIds = new Set(certificate.guardSet.map((g) => g.id));
    for (const guardReq of envelope.guardRequirements) {
      if (!certifiedGuardIds.has(guardReq.guardId)) {
        return {
          valid: false,
          reason: `Required guard '${guardReq.guardId}' from envelope is missing in certificate guardSet`,
        };
      }
    }
  }

  // 6. Live guards check (skipped under CAC-NoGuard ablation)
  if (!context.skipGuards) {
    const guardResult = evaluateLiveGuards(certificate.guardSet, liveState);
    if (!guardResult.holds) {
      return {
        valid: false,
        reason: `Live guard check failed: guard '${guardResult.violatedGuard?.id}' violated. Expected '${String(guardResult.violatedGuard?.expectedValue)}', got '${String(guardResult.actualValue)}'`,
      };
    }
  }

  // 7. Policy epoch compatibility
  if (certificate.policyEpoch !== livePolicyEpoch) {
    return {
      valid: false,
      reason: `Policy epoch mismatch: certificate epoch '${certificate.policyEpoch}' != live epoch '${livePolicyEpoch}'`,
    };
  }

  // 8. Live authorization check
  const isAuthStillValid = liveAuthorizer.isAuthorizedLive(
    certificate.subject,
    invocationProposal.action,
    invocationProposal.scope
  );
  if (!isAuthStillValid) {
    return {
      valid: false,
      reason: `Live authorization revoked or expired for principal '${certificate.subject}'`,
    };
  }

  // 9. Revocation check
  if (revocationList && revocationList.has(certificate.admissionId)) {
    return {
      valid: false,
      reason: `Certificate admission ID '${certificate.admissionId}' has been revoked`,
    };
  }

  return { valid: true };
}

import { randomUUID, sign, verify } from "node:crypto";
import type {
  ActionProposal,
  AdmissionCertificate,
  AdmissionGuard,
  AdmissionWitnessManifest,
  EvaluationContext,
  ExecutionEnvelope,
  UnsignedCertificateBody,
} from "@cac/schemas";
import { makeInstant } from "@cac/schemas";
import { canonicalJson, computeProposalDigest, computeWitnessDigest } from "@cac/core";

export interface MintCertificateParams {
  proposal: ActionProposal | (Record<string, unknown> & { action: string; params: Record<string, unknown>; scope: string[]; principal: string });
  manifest: AdmissionWitnessManifest;
  guardSet: AdmissionGuard[];
  evaluationContext: EvaluationContext;
  witnessExpiryEpochMs: number;
  mode?: "EXACT_ACTION" | "ENVELOPE" | undefined;
  executionEnvelope?: ExecutionEnvelope | undefined;
  maxCertificateTtlMs?: number | undefined;
  controllerPrivateKeyPem: string;
}

/**
 * Mints an Ed25519-signed ephemeral Admission Certificate C_q.
 * Conforms to Section 4.4 and Sections 20-22 of the CAC requirements.
 */
export function mintCertificate(params: MintCertificateParams): AdmissionCertificate {
  const {
    proposal,
    manifest,
    guardSet,
    evaluationContext,
    witnessExpiryEpochMs,
    mode = "EXACT_ACTION",
    executionEnvelope,
    maxCertificateTtlMs = 60000, // 60s default max TTL
    controllerPrivateKeyPem,
  } = params;

  if (mode === "ENVELOPE" && (!executionEnvelope || executionEnvelope.mode !== "ENVELOPE" ||
      executionEnvelope.targetAction !== proposal.action ||
      executionEnvelope.coveredProposalDigest !== computeProposalDigest(proposal as ActionProposal))) {
    throw new Error("Envelope must bind the certified action and evidence-covered proposal");
  }
  if (executionEnvelope && executionEnvelope.mode !== mode) throw new Error("Certificate/envelope mode mismatch");

  const issuedAtEpochMs = evaluationContext.evaluationTime.epochMs;
  const issuedAt = makeInstant(issuedAtEpochMs);

  // Certificate expiration bounded by min(witness, authority, policy, max_ttl)
  const maxTtlEpochMs = issuedAtEpochMs + maxCertificateTtlMs;
  const expiresAtEpochMs = Math.min(witnessExpiryEpochMs, maxTtlEpochMs,
    executionEnvelope?.mode === "ENVELOPE" ? executionEnvelope.instantiatedAt.epochMs + executionEnvelope.maxValidityDurationMs : Infinity);
  const expiresAt = makeInstant(expiresAtEpochMs);

  const proposalDigest = computeProposalDigest(proposal as ActionProposal);
  const witnessDigest = computeWitnessDigest(manifest);

  const admissionId = `adm-${randomUUID()}`;
  const nonce = `nonce-${randomUUID()}`;

  const resolvedEnvelope: ExecutionEnvelope =
    mode === "ENVELOPE" && executionEnvelope
      ? executionEnvelope
      : {
          mode: "EXACT_ACTION",
          proposalDigest,
        };

  const unsignedBody: UnsignedCertificateBody = {
    admissionId,
    subject: proposal.principal,
    authorityContext: {
      action: proposal.action,
      scope: proposal.scope,
    },
    mode,
    proposalDigest,
    executionEnvelope: resolvedEnvelope,
    policyEpoch: evaluationContext.policySnapshot.epoch,
    witnessDigest,
    guardSet,
    issuedAt,
    expiresAt,
    nonce,
  };

  const canonicalPayload = canonicalJson(unsignedBody);
  const signatureBuffer = sign(null, Buffer.from(canonicalPayload, "utf8"), controllerPrivateKeyPem);
  const signature = signatureBuffer.toString("hex");

  return {
    ...unsignedBody,
    signature,
  };
}

/**
 * Verifies the Ed25519 signature of an Admission Certificate.
 * Side-effect-free cryptographic check.
 */
export function verifyCertificate(
  certificate: AdmissionCertificate,
  controllerPublicKeyPem: string
): boolean {
  try {
    const { signature, ...unsignedBody } = certificate;
    const canonicalPayload = canonicalJson(unsignedBody);
    return verify(
      null,
      Buffer.from(canonicalPayload, "utf8"),
      controllerPublicKeyPem,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

import { createHash } from "node:crypto";
import type { GenericActionProposal as ActionProposal, AdmissionWitnessManifest } from "@cac/schemas";

/**
 * RFC 8785: JSON Canonicalization Scheme (JCS)
 * Recursively canonicalizes JavaScript values into a deterministic byte-for-byte JSON string.
 */
export function canonicalJson(val: unknown): string {
  if (val === null || val === undefined || typeof val === "boolean") {
    return JSON.stringify(val ?? null);
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new TypeError("Cannot canonicalize non-finite numbers");
    }
    // Handle -0
    if (Object.is(val, -0)) {
      return "0";
    }
    return JSON.stringify(val);
  }
  if (typeof val === "string") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    const items = val.map((item) => canonicalJson(item));
    return `[${items.join(",")}]`;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    // UTF-16 code unit ordering of object keys
    const sortedKeys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== "function")
      .sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });

    const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Unsupported type in canonical JSON: ${typeof val}`);
}

/**
 * Domain-separated SHA-256 hash helper
 */
export function domainSeparatedDigest(domainTag: string, canonicalData: string): string {
  const hasher = createHash("sha256");
  hasher.update(Buffer.from(domainTag, "utf8"));
  hasher.update(Buffer.from(canonicalData, "utf8"));
  return hasher.digest("hex");
}

/**
 * ProposalDigest(q) = H("CAC-PROP-v1" || Canon(q))
 */
export function computeProposalDigest(proposal: ActionProposal | Record<string, unknown>): string {
  const canonical = canonicalJson(proposal);
  return domainSeparatedDigest("CAC-PROP-v1", canonical);
}

/**
 * WitnessDigest(W_q) = H("CAC-WITN-v1" || Canon(W_q))
 */
export function computeWitnessDigest(manifest: AdmissionWitnessManifest): string {
  // Canonical sorting of manifest entries by obligationId
  const sortedEntries = [...manifest.entries]
    .map((entry) => ({
      obligationId: entry.obligationId,
      witnessReceiptIds: [...entry.witnessReceiptIds].sort(),
    }))
    .sort((a, b) => a.obligationId.localeCompare(b.obligationId));

  const sortedManifest: AdmissionWitnessManifest = { entries: sortedEntries };
  const canonical = canonicalJson(sortedManifest);
  return domainSeparatedDigest("CAC-WITN-v1", canonical);
}

/**
 * EnvelopeDigest(env) = H("CAC-ENV-v1" || Canon(env))
 */
export function computeEnvelopeDigest(envelope: Record<string, unknown>): string {
  const canonical = canonicalJson(envelope);
  return domainSeparatedDigest("CAC-ENV-v1", canonical);
}

/**
 * TemplateDigest(template) = H("CAC-TEMPLATE-v1" || Canon(template))
 */
export function computeTemplateDigest(template: Record<string, unknown>): string {
  const canonical = canonicalJson(template);
  return domainSeparatedDigest("CAC-TEMPLATE-v1", canonical);
}

/**
 * EfdProfileDigest(profile) = H("CAC-EFD-v1" || Canon(profile))
 */
export function computeEfdProfileDigest(profile: Record<string, unknown>): string {
  const canonical = canonicalJson(profile);
  return domainSeparatedDigest("CAC-EFD-v1", canonical);
}

/**
 * CertificateDigest(cert) = H("CAC-CERT-v1" || Canon(cert))
 */
export function computeCertificateDigest(cert: Record<string, unknown>): string {
  const canonical = canonicalJson(cert);
  return domainSeparatedDigest("CAC-CERT-v1", canonical);
}


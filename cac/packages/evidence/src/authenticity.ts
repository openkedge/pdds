import { createHmac, sign, verify } from "node:crypto";
import type { EvidenceReceipt, IntegrityProof } from "@cac/schemas";
import { canonicalJson } from "@cac/core";

export interface TrustedRoots {
  trustedSigners: Set<string>; // Set of trusted public keys or source identifiers
  hmacSecret?: string;
}

/**
 * Signs an evidence receipt using Ed25519 or HMAC-SHA256 over its canonical payload.
 */
export function signEvidenceReceipt(
  unsignedReceipt: Omit<EvidenceReceipt, "integrity">,
  secretOrPrivateKey: string,
  method: "ED25519" | "HMAC_SHA256" | "LOCAL_TCB",
  signerPublicKey?: string
): EvidenceReceipt {
  const canonicalData = canonicalJson(unsignedReceipt);
  let signature = "";

  if (method === "ED25519") {
    const signatureBuffer = sign(null, Buffer.from(canonicalData, "utf8"), secretOrPrivateKey);
    signature = signatureBuffer.toString("hex");
  } else if (method === "HMAC_SHA256") {
    const hmac = createHmac("sha256", secretOrPrivateKey);
    hmac.update(Buffer.from(canonicalData, "utf8"));
    signature = hmac.digest("hex");
  } else {
    // LOCAL_TCB in-process authenticated IPC tag
    const hmac = createHmac("sha256", secretOrPrivateKey || "cac-local-tcb-channel");
    hmac.update(Buffer.from(canonicalData, "utf8"));
    signature = `local-tcb:${hmac.digest("hex")}`;
  }

  const integrity: IntegrityProof = {
    method,
    signature,
    ...(signerPublicKey ? { signerPublicKey } : {}),
  };

  return {
    ...unsignedReceipt,
    integrity,
  };
}

/**
 * Checks whether an evidence receipt is authentic and tamper-evident.
 *
 * CRITICAL EPISTEMIC PRINCIPLE (Section 9):
 * Authenticity does NOT imply truth:
 *   verifyAuthenticity(receipt) == true does NOT mean receipt.claim is physically true!
 * It only establishes that the receipt was produced by an authorized source
 * and has not been tampered with.
 */
export function verifyAuthenticity(
  receipt: EvidenceReceipt,
  trustedRoots?: TrustedRoots
): boolean {
  if (!receipt.integrity || !receipt.integrity.signature) {
    return false;
  }

  // Create unsigned body for canonical verification
  const { integrity, ...unsignedBody } = receipt;
  const canonicalData = canonicalJson(unsignedBody);

  if (integrity.method === "ED25519") {
    if (!integrity.signerPublicKey) return false;
    if (trustedRoots && !trustedRoots.trustedSigners.has(integrity.signerPublicKey)) {
      return false;
    }
    try {
      return verify(
        null,
        Buffer.from(canonicalData, "utf8"),
        integrity.signerPublicKey,
        Buffer.from(integrity.signature, "hex")
      );
    } catch {
      return false;
    }
  }

  if (integrity.method === "HMAC_SHA256") {
    const secret = trustedRoots?.hmacSecret ?? "cac-default-probe-shared-secret";
    const hmac = createHmac("sha256", secret);
    hmac.update(Buffer.from(canonicalData, "utf8"));
    const expected = hmac.digest("hex");
    return expected === integrity.signature;
  }

  if (integrity.method === "LOCAL_TCB") {
    const secret = trustedRoots?.hmacSecret ?? "cac-local-tcb-channel";
    const hmac = createHmac("sha256", secret);
    hmac.update(Buffer.from(canonicalData, "utf8"));
    const expected = `local-tcb:${hmac.digest("hex")}`;
    return expected === integrity.signature;
  }

  return false;
}

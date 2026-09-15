import type {
  AdmissionWitnessManifest,
  AssuranceObligation,
  EvidenceReceipt,
  ManifestEntry,
} from "@cac/schemas";

/**
 * Builds a canonical Admission Witness Manifest W_q from discharged obligation witnesses.
 * Conforms to Section 4.4 and Section 15 of the CAC requirements.
 */
export function buildWitnessManifest(
  satisfiedWitnesses: Array<{ obligation: AssuranceObligation; witness: EvidenceReceipt[] }>
): AdmissionWitnessManifest {
  const entries: ManifestEntry[] = [];

  for (const item of satisfiedWitnesses) {
    if (item.obligation.enforcement === "REQUIRED") {
      const receiptIds = item.witness.map((r) => r.id).sort();
      entries.push({
        obligationId: item.obligation.id,
        witnessReceiptIds: receiptIds,
      });
    }
  }

  // Lexicographically sort manifest entries by obligationId
  entries.sort((a, b) => a.obligationId.localeCompare(b.obligationId));

  return { entries };
}

/**
 * Computes witness expiration bound:
 *   t_witness_exp = min_{(omega, W) in W_q} min_{e in W} (e.t_obs + omega.maxFreshness)
 * Conforms to Section 4.4, Equation (240).
 */
export function computeWitnessExpiration(
  manifest: AdmissionWitnessManifest,
  obligationsMap: Map<string, AssuranceObligation>,
  receiptsMap: Map<string, EvidenceReceipt>
): number {
  if (manifest.entries.length === 0) {
    return Infinity;
  }

  let minExpiryEpochMs = Infinity;

  for (const entry of manifest.entries) {
    const obligation = obligationsMap.get(entry.obligationId);
    if (!obligation) {
      throw new Error(`Obligation '${entry.obligationId}' not found in obligations map`);
    }

    for (const receiptId of entry.witnessReceiptIds) {
      const receipt = receiptsMap.get(receiptId);
      if (!receipt) {
        throw new Error(`Witness receipt '${receiptId}' cited in manifest not found`);
      }

      const receiptExpiry = receipt.observedAt.epochMs + obligation.maxFreshnessMs;
      if (receiptExpiry < minExpiryEpochMs) {
        minExpiryEpochMs = receiptExpiry;
      }
    }
  }

  return minExpiryEpochMs;
}

import type {
  AssuranceObligation,
  ControllerVisibleState,
  DischargeResult,
  EvaluationContext,
  EvidenceReceipt,
} from "@cac/schemas";
import {
  computeEligibilityDiagnostics,
  evaluateSetConstraints,
  type TrustedRoots,
} from "@cac/evidence";
import { evaluateReceiptEntailment } from "./entailment.js";
import { type CandidateWitness, selectCanonicalWitness, witnessPriority } from "./ranking.js";

/**
 * Deterministic Discharge Engine
 * Implements Section 4.2, Section 13, and Section 14 of the CAC paper and requirements.
 */
export function discharge(
  obligation: AssuranceObligation,
  evidencePool: EvidenceReceipt[],
  state: ControllerVisibleState,
  evaluationContext: EvaluationContext,
  trustedRoots?: TrustedRoots
): DischargeResult {
  // Step 1: Compute diagnostic facets and eligible candidate pool E_omega
  const diagnostics = computeEligibilityDiagnostics(
    evidencePool,
    obligation,
    state,
    evaluationContext,
    trustedRoots
  );

  const eligibleReceipts = diagnostics.eligible;

  // Classify eligible receipts into positive and negative entailment
  const positiveReceipts: EvidenceReceipt[] = [];
  const negativeReceipts: EvidenceReceipt[] = [];

  for (const receipt of eligibleReceipts) {
    const entailment = evaluateReceiptEntailment(receipt, obligation);
    if (entailment === "ENTAILED_POSITIVE") {
      positiveReceipts.push(receipt);
    } else if (entailment === "ENTAILED_NEGATIVE") {
      negativeReceipts.push(receipt);
    }
  }

  // Exhaustive, deterministic subset search for bounded evidence pools. Both
  // polarities must satisfy the identical set constraints before preference.
  // Never return a partial search result as an affirmative verdict.
  const maxReceipts = 12;
  const unique = new Map<string, EvidenceReceipt>();
  for (const receipt of eligibleReceipts) {
    const previous = unique.get(receipt.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(receipt)) {
      return { kind: "UNKNOWN", reason: { kind: "CONFLICT" } };
    }
    unique.set(receipt.id, receipt);
  }
  if (unique.size > maxReceipts) {
    return { kind: "UNKNOWN", reason: { kind: "SEARCH_LIMIT", limit: maxReceipts } };
  }
  let failure: ReturnType<typeof evaluateSetConstraints>["reason"];
  const valid: Array<CandidateWitness & { polarity: "SATISFIED" | "VIOLATED" }> = [];
  for (const [receipts, polarity] of [
    [positiveReceipts, "SATISFIED"], [negativeReceipts, "VIOLATED"],
  ] as const) {
    const pool = [...new Map(receipts.map(r => [r.id, r])).values()].sort((a, b) => a.id.localeCompare(b.id));
    for (let mask = 1; mask < 2 ** pool.length; mask++) {
      const witness = pool.filter((_, i) => (mask & (1 << i)) !== 0);
      const checked = evaluateSetConstraints(obligation, witness, state, evaluationContext);
      if (checked.satisfied) valid.push({ receipts: witness, polarity,
        ...(checked.structuralCutResult ? { structuralCut: checked.structuralCutResult.kappaE } : {}) });
      else failure = checked.reason;
    }
  }
  if (valid.length) {
    const topPriority = Math.max(...valid.map(w => witnessPriority(w, obligation)));
    const maximal = valid.filter(w => witnessPriority(w, obligation) === topPriority);
    if (new Set(maximal.map(w => w.polarity)).size > 1) {
      return { kind: "UNKNOWN", reason: { kind: "CONFLICT" } };
    }
    const canonical = selectCanonicalWitness(maximal, obligation, evaluationContext.evaluationTime)!;
    return { kind: maximal[0]!.polarity, witness: canonical.receipts };
  }
  if (failure) return { kind: "UNKNOWN", reason: failure };

  // Step 5: Diagnostic UNKNOWN reason (under deterministic precedence)
  if (diagnostics.stale.length > 0) {
    return { kind: "UNKNOWN", reason: { kind: "STALE" } };
  }
  if (diagnostics.untrusted.length > 0) {
    return { kind: "UNKNOWN", reason: { kind: "UNTRUSTED" } };
  }
  if (diagnostics.versionMismatch.length > 0) {
    return { kind: "UNKNOWN", reason: { kind: "VERSION_MISMATCH" } };
  }

  return { kind: "UNKNOWN", reason: { kind: "MISSING" } };
}

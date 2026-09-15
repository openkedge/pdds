import { createHash } from "node:crypto";
import type { AssuranceObligation, EvidenceReceipt, Instant } from "@cac/schemas";

export interface CandidateWitness {
  receipts: EvidenceReceipt[];
  structuralCut?: number;
}

/** Policy-defined rank of the weakest source in a witness; no name heuristics. */
export function witnessPriority(candidate: CandidateWitness, obligation: AssuranceObligation): number {
  return Math.min(...candidate.receipts.map(r => obligation.sourcePriorities?.[r.source] ?? 0));
}

/**
 * Worst-case freshness: max age relative to evaluationTime.
 * We want to MINIMIZE this worst-case age across receipts.
 */
function computeWorstCaseAgeMs(candidate: CandidateWitness, evaluationTime: Instant): number {
  if (candidate.receipts.length === 0) return Infinity;
  let maxAge = -Infinity;
  for (const r of candidate.receipts) {
    const age = evaluationTime.epochMs - r.observedAt.epochMs;
    if (age > maxAge) maxAge = age;
  }
  return maxAge;
}

/**
 * Canonical digest tie-break: SHA-256 of sorted receipt IDs.
 */
function computeTieBreakDigest(candidate: CandidateWitness): string {
  const sortedIds = candidate.receipts.map((r) => r.id).sort();
  return createHash("sha256").update(JSON.stringify(sortedIds)).digest("hex");
}

/**
 * Deterministically ranks candidate witness sets using lexicographic ordering:
 * 1. Highest policy priority class
 * 2. Best worst-case freshness (lowest worst-case age)
 * 3. Highest structural resilience
 * 4. Smallest sufficient witness cardinality
 * 5. Lexicographically smallest digest tie-break
 */
export function selectCanonicalWitness(
  candidates: CandidateWitness[],
  obligation: AssuranceObligation,
  evaluationTime: Instant
): CandidateWitness | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const sorted = [...candidates].sort((a, b) => {
    // 1. Highest policy priority (descending)
    const prioA = witnessPriority(a, obligation);
    const prioB = witnessPriority(b, obligation);
    if (prioA !== prioB) return prioB - prioA;

    // 2. Best worst-case freshness: lowest age (ascending)
    const ageA = computeWorstCaseAgeMs(a, evaluationTime);
    const ageB = computeWorstCaseAgeMs(b, evaluationTime);
    if (ageA !== ageB) return ageA - ageB;

    // 3. Highest structural resilience (descending)
    const resA = obligation.efdRequirement ? a.structuralCut ?? 0 : 0;
    const resB = obligation.efdRequirement ? b.structuralCut ?? 0 : 0;
    if (resA !== resB) return resB - resA;

    // 4. Smallest cardinality (ascending)
    if (a.receipts.length !== b.receipts.length) {
      return a.receipts.length - b.receipts.length;
    }

    // 5. Canonical digest tie-break (ascending)
    const digestA = computeTieBreakDigest(a);
    const digestB = computeTieBreakDigest(b);
    return digestA < digestB ? -1 : digestA > digestB ? 1 : 0;
  });

  return sorted[0]!;
}

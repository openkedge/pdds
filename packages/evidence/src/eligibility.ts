import type {
  AssuranceObligation,
  ControllerVisibleState,
  EligibilityDiagnostics,
  EvaluationContext,
  EvidenceReceipt,
} from "@cac/schemas";
import { type TrustedRoots, verifyAuthenticity } from "./authenticity.js";

/**
 * Checks if receipt stateVersion is compatible with controller visible state.
 */
export function isVersionCompatible(
  receiptStateVersion: string,
  _obligation: AssuranceObligation,
  state: ControllerVisibleState
): boolean {
  // Exact version match or same epoch prefix
  if (receiptStateVersion === state.observedVersion) {
    return true;
  }

  // Handle LSN or epoch token compatibility if applicable
  if (receiptStateVersion.startsWith("lsn:") && state.observedVersion.startsWith("lsn:")) {
    // Exact LSN match
    return receiptStateVersion === state.observedVersion;
  }

  return false;
}

/**
 * Checks scope coverage: receipt.scope superset of obligation.scope
 */
export function isScopeCovered(receiptScope: string[], obligationScope: string[]): boolean {
  const receiptSet = new Set(receiptScope);
  return obligationScope.every((scopeItem) => receiptSet.has(scopeItem));
}

/**
 * Evaluates receipt-local eligibility LocallyEligible(e, omega, s, t_eval)
 * Evaluates strictly against pinned evaluationContext.evaluationTime.
 */
export function isLocallyEligible(
  receipt: EvidenceReceipt,
  obligation: AssuranceObligation,
  state: ControllerVisibleState,
  evaluationContext: EvaluationContext,
  trustedRoots?: TrustedRoots
): boolean {
  // 1. Authenticity check
  if (!verifyAuthenticity(receipt, trustedRoots)) {
    return false;
  }

  // 2. Evidence class check
  if (!obligation.evidenceClasses.includes(receipt.evidenceClass)) {
    return false;
  }

  // 3. Scope coverage check (receipt.scope superset of obligation.scope)
  if (!isScopeCovered(receipt.scope, obligation.scope)) {
    return false;
  }

  // 4. State version compatibility
  if (!isVersionCompatible(receipt.stateVersion, obligation, state)) {
    return false;
  }

  // 5. Freshness check against pinned evaluationTime (timestamps must already be normalized)
  const ageMs = evaluationContext.evaluationTime.epochMs - receipt.observedAt.epochMs;
  if (ageMs < 0 || ageMs > obligation.maxFreshnessMs) {
    return false;
  }

  return true;
}

/**
 * Computes structured diagnostic facets over candidate evidence.
 * Preserves rejected evidence to enable targeted epistemic remediation.
 */
export function computeEligibilityDiagnostics(
  evidencePool: EvidenceReceipt[],
  obligation: AssuranceObligation,
  state: ControllerVisibleState,
  evaluationContext: EvaluationContext,
  trustedRoots?: TrustedRoots
): EligibilityDiagnostics {
  const diagnostics: EligibilityDiagnostics = {
    eligible: [],
    stale: [],
    untrusted: [],
    versionMismatch: [],
    wrongClass: [],
    wrongScope: [],
  };

  for (const receipt of evidencePool) {
    const isAuthentic = verifyAuthenticity(receipt, trustedRoots);
    const matchesClass = obligation.evidenceClasses.includes(receipt.evidenceClass);
    const coversScope = isScopeCovered(receipt.scope, obligation.scope);
    const matchesVersion = isVersionCompatible(receipt.stateVersion, obligation, state);
    const ageMs = evaluationContext.evaluationTime.epochMs - receipt.observedAt.epochMs;
    const isFresh = ageMs >= 0 && ageMs <= obligation.maxFreshnessMs;

    if (!isAuthentic) {
      diagnostics.untrusted.push(receipt);
    }
    if (!matchesClass) {
      diagnostics.wrongClass.push(receipt);
    }
    if (!coversScope) {
      diagnostics.wrongScope.push(receipt);
    }
    if (!matchesVersion) {
      diagnostics.versionMismatch.push(receipt);
    }
    if (!isFresh && matchesClass && coversScope) {
      // Considered stale if it targets the right class and scope but is expired
      diagnostics.stale.push(receipt);
    }

    if (isAuthentic && matchesClass && coversScope && matchesVersion && isFresh) {
      diagnostics.eligible.push(receipt);
    }
  }

  return diagnostics;
}

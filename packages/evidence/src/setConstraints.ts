import type {
  AssuranceObligation,
  ControllerVisibleState,
  EvaluationContext,
  EvidenceReceipt,
  ExposureMap,
  SetConstraintFailureDetail,
  StructuralCutResult,
} from "@cac/schemas";
import { computeStructuralCut, validateEfdProfile } from "./efd.js";

export interface SetConstraintsEvaluationResult {
  satisfied: boolean;
  reason?:
    | {
        kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE";
        required: number;
        observed: number;
        minimumCuts: string[][];
      }
    | {
        kind: "SET_CONSTRAINT_UNSATISFIED";
        detail: SetConstraintFailureDetail;
      }
    | undefined;
  structuralCutResult?: StructuralCutResult | undefined;
}

/**
 * Evaluates set-level constraints SetConstraints_Pi(omega, W_omega, s)
 * Conforming to Section 3.4 and Sections 9-11 of CAC requirements.
 */
export function evaluateSetConstraints(
  obligation: AssuranceObligation,
  candidateWitness: EvidenceReceipt[],
  _state: ControllerVisibleState,
  evaluationContext?: EvaluationContext
): SetConstraintsEvaluationResult {
  if (!candidateWitness.length || new Set(candidateWitness.map(r => r.id)).size !== candidateWitness.length) {
    return { satisfied: false, reason: { kind: "SET_CONSTRAINT_UNSATISFIED", detail: "INSUFFICIENT_QUORUM_CARDINALITY" } };
  }
  // If no set constraints and no EFD requirement declared, vacuously satisfied
  if (!obligation.setConstraints && !obligation.efdRequirement) {
    return { satisfied: true };
  }

  // 1. Quorum Cardinality: |W| >= k
  if (obligation.setConstraints?.minCardinality !== undefined) {
    const requiredK = obligation.setConstraints.minCardinality;
    if (candidateWitness.length < requiredK) {
      return {
        satisfied: false,
        reason: {
          kind: "SET_CONSTRAINT_UNSATISFIED",
          detail: "INSUFFICIENT_QUORUM_CARDINALITY",
        },
      };
    }
  }

  // 2. Dual-Control Separation: count distinct principals >= requiredPrincipalCount
  // Never compare receipt with itself! Use Set of distinct principal IDs.
  if (obligation.setConstraints?.minDistinctPrincipals !== undefined) {
    const requiredPrincipals = obligation.setConstraints.minDistinctPrincipals;
    const distinctPrincipals = new Set<string>();
    for (const receipt of candidateWitness) {
      // Principal is extracted from claim or source
      const principal = (receipt.claim["principal"] as string) || receipt.source;
      distinctPrincipals.add(principal);
    }
    if (distinctPrincipals.size < requiredPrincipals) {
      return {
        satisfied: false,
        reason: {
          kind: "SET_CONSTRAINT_UNSATISFIED",
          detail: "DUAL_CONTROL_SEPARATION_FAILED",
        },
      };
    }
  }

  // 3. Multi-Sensor Reconciliation: verify agreement across telemetry values
  if (obligation.setConstraints?.requireReconciliation) {
    const values = candidateWitness.map(r => r.claim["replicationLagBytes"]);
    if (values.some(v => typeof v !== "number" || !Number.isFinite(v)) ||
        Math.max(...values as number[]) - Math.min(...values as number[]) > 65536) {
      return { satisfied: false, reason: { kind: "SET_CONSTRAINT_UNSATISFIED", detail: "RECONCILIATION_INCOMPLETE" } };
    }
  }

  // 4. Structural Epistemic Cut (EFD) requirement: kappa_E(Sources(W)) >= minStructuralCut
  if (obligation.efdRequirement) {
    const minCut = obligation.efdRequirement.minimumStructuralCut;
    const profileId = obligation.efdRequirement.profileId;
    const profile = evaluationContext?.efdProfiles?.[profileId];

    if (!profile) {
      // Fail closed: missing approved EFD profile
      return {
        satisfied: false,
        reason: {
          kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE",
          required: minCut,
          observed: 0,
          minimumCuts: [["MISSING_EFD_PROFILE"]],
        },
      };
    }

    const validation = validateEfdProfile(profile);
    if (!validation.valid) {
      // Fail closed: malformed or tampered structural model
      return {
        satisfied: false,
        reason: {
          kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE",
          required: minCut,
          observed: 0,
          minimumCuts: [["INVALID_EFD_PROFILE"]],
        },
      };
    }

    // Build exposure map from profile descriptors
    const exposureMap: ExposureMap = {};
    const verifierIdBySource = new Map<string, string>();
    for (const desc of profile.verifierDescriptors) {
      exposureMap[desc.id] = desc.exposures;
      verifierIdBySource.set(desc.evidenceSourceId, desc.id);
      // Also map by descriptor id directly
      verifierIdBySource.set(desc.id, desc.id);
    }

    // Extract participating verifier IDs
    const participatingVerifiers: string[] = [];
    for (const receipt of candidateWitness) {
      const vId = verifierIdBySource.get(receipt.source);
      if (!vId || (receipt.claim["verifierId"] !== undefined && receipt.claim["verifierId"] !== vId)) {
        return { satisfied: false, reason: { kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE", required: minCut, observed: 0, minimumCuts: [["UNBOUND_VERIFIER"]] } };
      }
      if (!participatingVerifiers.includes(vId)) participatingVerifiers.push(vId);
    }
    if (profile.coalitionPolicy.type === "ALL_OF" && participatingVerifiers.length !== profile.verifierDescriptors.length) {
      return { satisfied: false, reason: { kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE", required: minCut, observed: 0, minimumCuts: [["INCOMPLETE_ALL_OF"]] } };
    }

    const cutResult = computeStructuralCut({
      verifierSet: participatingVerifiers,
      faultBasis: profile.faultBasis,
      exposureMap,
      coalitionPolicy: profile.coalitionPolicy,
    });

    // Check disallowed fault domains
    const disallowed = new Set(obligation.efdRequirement.disallowedFaults);
    for (const cut of cutResult.minimumFaultCuts) {
      for (const fault of cut) {
        if (disallowed.has(fault)) {
          return {
            satisfied: false,
            reason: {
              kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE",
              required: minCut,
              observed: 0,
              minimumCuts: cutResult.minimumFaultCuts,
            },
            structuralCutResult: cutResult,
          };
        }
      }
    }

    if (cutResult.kappaE < minCut) {
      return {
        satisfied: false,
        reason: {
          kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE",
          required: minCut,
          observed: cutResult.kappaE,
          minimumCuts: cutResult.minimumFaultCuts,
        },
        structuralCutResult: cutResult,
      };
    }

    return { satisfied: true, structuralCutResult: cutResult };
  }

  return { satisfied: true };
}

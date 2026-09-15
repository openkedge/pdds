import type {
  ActionProposal,
  AdmissionWitnessManifest,
  EvaluationContext,
  EnvelopeTemplate,
  GeneralizedEnvelope,
} from "@cac/schemas";
import { makeInstant } from "@cac/schemas";
import { computeTemplateDigest, computeProposalDigest } from "@cac/core";

export interface EnvelopeValidationResult {
  allowed: boolean;
  reason?: string | undefined;
}

/**
 * Checks whether an action proposal complies with an EnvelopeTemplate's constraints.
 */
export function validateProposalAgainstTemplate(
  proposal: ActionProposal | (Record<string, unknown> & { action: string; params: Record<string, unknown>; intent: { goal: string; constraints: string[] }; scope: string[] }),
  template: EnvelopeTemplate
): EnvelopeValidationResult {
  if (proposal.action !== template.targetAction) {
    return {
      allowed: false,
      reason: `Action '${proposal.action}' does not match template targetAction '${template.targetAction}'`,
    };
  }

  // 1. Intent Constraints
  if (template.intentConstraints.allowedGoals.length > 0) {
    if (!template.intentConstraints.allowedGoals.includes(proposal.intent.goal)) {
      return {
        allowed: false,
        reason: `Intent goal '${proposal.intent.goal}' not in allowed goals [${template.intentConstraints.allowedGoals.join(", ")}]`,
      };
    }
  }
  for (const reqConstraint of template.intentConstraints.requiredConstraints) {
    if (!proposal.intent.constraints.includes(reqConstraint)) {
      return {
        allowed: false,
        reason: `Missing required intent constraint '${reqConstraint}'`,
      };
    }
  }

  // 2. Resource Constraints
  for (const [resourceKey, constraint] of Object.entries(template.resourceConstraints)) {
    const resourceVal = (proposal.params as Record<string, unknown>)[resourceKey] ?? (proposal as Record<string, unknown>)[resourceKey];
    if (typeof resourceVal !== "string") {
      return { allowed: false, reason: `Required resource '${resourceKey}' must be a string` };
    }
    if (typeof resourceVal === "string") {
      if (constraint.type === "EXACT") {
        if (!constraint.allowed.includes(resourceVal)) {
          return {
            allowed: false,
            reason: `Resource '${resourceKey}' value '${resourceVal}' not exactly in [${constraint.allowed.join(", ")}]`,
          };
        }
      } else if (constraint.type === "ONE_OF") {
        if (!constraint.allowed.includes(resourceVal)) {
          return {
            allowed: false,
            reason: `Resource '${resourceKey}' value '${resourceVal}' not in allowed list [${constraint.allowed.join(", ")}]`,
          };
        }
      } else if (constraint.type === "PREFIX") {
        const matchesPrefix = constraint.allowed.some((prefix) => resourceVal.startsWith(prefix));
        if (!matchesPrefix) {
          return {
            allowed: false,
            reason: `Resource '${resourceKey}' value '${resourceVal}' does not match allowed prefixes [${constraint.allowed.join(", ")}]`,
          };
        }
      }
    }
  }

  // 3. Parameter Constraints
  for (const paramConstraint of template.parameterConstraints) {
    const val = (proposal.params as Record<string, unknown>)[paramConstraint.param];
    if (val === undefined) {
      return { allowed: false, reason: `Required parameter '${paramConstraint.param}' is missing` };
    }
    if (paramConstraint.type === "RANGE") {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        return {
          allowed: false,
          reason: `Parameter '${paramConstraint.param}' must be a finite number, got ${typeof val}`,
        };
      }
      if (paramConstraint.bounds?.min !== undefined && val < paramConstraint.bounds.min) {
        return {
          allowed: false,
          reason: `Parameter '${paramConstraint.param}' value ${val} is below minimum bound ${paramConstraint.bounds.min}`,
        };
      }
      if (paramConstraint.bounds?.max !== undefined && val > paramConstraint.bounds.max) {
        return {
          allowed: false,
          reason: `Parameter '${paramConstraint.param}' value ${val} exceeds maximum bound ${paramConstraint.bounds.max}`,
        };
      }
    } else if (paramConstraint.type === "ENUM" || paramConstraint.type === "EXACT") {
      if (!paramConstraint.allowed || !paramConstraint.allowed.includes(val)) {
        return {
          allowed: false,
          reason: `Parameter '${paramConstraint.param}' value '${String(val)}' not in allowed values`,
        };
      }
    }
  }

  // 4. Effect Constraints
  if (template.effectConstraints.maxEstimatedDataLossBytes !== undefined) {
    const proposalDataLoss = (proposal.constraints as Record<string, unknown>)?.maxDataLossBytes;
    if (typeof proposalDataLoss !== "number" || !Number.isFinite(proposalDataLoss) ||
      proposalDataLoss < 0 || proposalDataLoss > template.effectConstraints.maxEstimatedDataLossBytes) {
      return {
        allowed: false,
        reason: `Max data loss constraint ${proposalDataLoss} exceeds template maximum allowed ${template.effectConstraints.maxEstimatedDataLossBytes}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Instantiates an ExecutionEnvelope from an approved EnvelopeTemplate and proposal.
 */
export function instantiateEnvelopeTemplate(
  template: EnvelopeTemplate,
  proposal: ActionProposal | (Record<string, unknown> & { action: string; params: Record<string, unknown>; intent: { goal: string; constraints: string[] }; scope: string[] }),
  evaluationContext: EvaluationContext
): GeneralizedEnvelope {
  const validation = validateProposalAgainstTemplate(proposal, template);
  if (!validation.allowed) {
    throw new Error(`Cannot instantiate envelope: ${validation.reason}`);
  }

  const templateDigest = computeTemplateDigest(template as unknown as Record<string, unknown>);

  return {
    mode: "ENVELOPE",
    templateId: template.templateId,
    templateVersion: template.version,
    templateDigest,
    targetAction: template.targetAction,
    coveredProposalDigest: computeProposalDigest(proposal as ActionProposal),
    resourceConstraints: template.resourceConstraints,
    parameterConstraints: template.parameterConstraints,
    intentConstraints: template.intentConstraints,
    effectConstraints: template.effectConstraints,
    coverageRequirements: template.coverageRequirements,
    guardRequirements: template.guardRequirements,
    instantiatedAt: makeInstant(evaluationContext.evaluationTime.epochMs),
    maxValidityDurationMs: template.maxValidityDurationMs,
  };
}

/**
 * Semantic Coverage Check:
 * ManifestCovers(W_q, q', Env, Context)
 * Evaluates whether witness manifest W_q semantically covers the target invocation q' under envelope Env.
 */
export function manifestCovers(
  manifest: AdmissionWitnessManifest,
  invocation: ActionProposal | (Record<string, unknown> & { action: string; params: Record<string, unknown>; intent: { goal: string; constraints: string[] }; scope: string[] }),
  envelope: GeneralizedEnvelope,
  context: EvaluationContext
): { covers: boolean; reason?: string | undefined } {
  // 1. Invocation must comply with the envelope
  const envelopeValidation = validateProposalAgainstTemplate(
    invocation,
    {
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
    }
  );

  if (!envelopeValidation.allowed) {
    return {
      covers: false,
      reason: `Invocation violates envelope constraints: ${envelopeValidation.reason}`,
    };
  }

  if (computeProposalDigest(invocation as ActionProposal) !== envelope.coveredProposalDigest) {
    return { covers: false, reason: "Witness coverage is bound to the admitted proposal; changed parameters require new evidence" };
  }

  // 2. Check coverage requirements
  const policyRules = context.policySnapshot.obligationRules;
  const manifestObligationIds = new Set(manifest.entries.map((e) => e.obligationId));

  for (const req of envelope.coverageRequirements) {
    // Find if an obligation rule in policy matches this requirement family
    const matchingRules = policyRules.filter(
      (rule) =>
        rule.kind === req.obligationKind &&
        rule.predicate.includes(req.predicateFamily) &&
        req.evidenceClasses.some((ec) => rule.evidenceClasses.includes(ec))
    );

    if (matchingRules.length === 0) {
      return {
        covers: false,
        reason: `Policy lacks obligation rule satisfying coverage requirement '${req.predicateFamily}'`,
      };
    }

    const hasSatisfiedRule = matchingRules.some((rule) => manifestObligationIds.has(rule.id));
    if (!hasSatisfiedRule) {
      return {
        covers: false,
        reason: `Manifest lacks witness satisfying coverage requirement '${req.predicateFamily}'`,
      };
    }
  }

  return { covers: true };
}

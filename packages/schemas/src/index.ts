import { z } from "zod";

// ============================================================================
// Time and Instant
// ============================================================================

export const InstantSchema = z.object({
  epochMs: z.number().int().nonnegative(),
  iso: z.string().datetime(),
});
export type Instant = z.infer<typeof InstantSchema>;

export function makeInstant(epochMs: number): Instant {
  return {
    epochMs,
    iso: new Date(epochMs).toISOString(),
  };
}

// ============================================================================
// Semantic Intent & Action Proposal
// ============================================================================

export const SemanticIntentSchema = z.object({
  goal: z.string().min(1),
  scope: z.array(z.string()).min(1),
  constraints: z.array(z.string()),
});
export type SemanticIntent = z.infer<typeof SemanticIntentSchema>;

export const FailoverDatabaseParamsSchema = z.object({
  clusterId: z.string().min(1),
  candidateStandby: z.string().min(1),
});
export type FailoverDatabaseParams = z.infer<typeof FailoverDatabaseParamsSchema>;

export const ActionProposalSchema = z.object({
  intent: SemanticIntentSchema,
  action: z.literal("FailoverDatabase"),
  params: FailoverDatabaseParamsSchema,
  scope: z.array(z.string()).min(1),
  principal: z.string().min(1),
  observedStateVersion: z.string().min(1),
  constraints: z.object({
    maxDataLossBytes: z.number().int().nonnegative(),
  }),
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

// Generic proposal representation for TCB boundary validation
export const GenericActionProposalSchema = z.object({
  intent: SemanticIntentSchema,
  action: z.string().min(1),
  params: z.record(z.unknown()),
  scope: z.array(z.string()).min(1),
  principal: z.string().min(1),
  observedStateVersion: z.string().min(1),
  constraints: z.record(z.unknown()),
});
export type GenericActionProposal = z.infer<typeof GenericActionProposalSchema>;

// ============================================================================
// Risk Model (Product Preorder Dimensions)
// ============================================================================

export const ConsequenceSeverityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type ConsequenceSeverity = z.infer<typeof ConsequenceSeverityEnum>;

export const BlastRadiusEnum = z.enum(["NODE", "CLUSTER", "CROSS_CLUSTER", "GLOBAL"]);
export type BlastRadius = z.infer<typeof BlastRadiusEnum>;

export const IrreversibilityEnum = z.enum([
  "REVERSIBLE",
  "COMPENSATABLE",
  "RECONCILABLE",
  "STRICTLY_IRREVERSIBLE",
]);
export type Irreversibility = z.infer<typeof IrreversibilityEnum>;

export const EpistemicUncertaintyEnum = z.enum(["LOW", "MODERATE", "HIGH", "SEVERE"]);
export type EpistemicUncertainty = z.infer<typeof EpistemicUncertaintyEnum>;

export const DependencyExposureEnum = z.enum(["ISOLATED", "TIER_2", "TIER_1", "CORE_INFRA"]);
export type DependencyExposure = z.infer<typeof DependencyExposureEnum>;

export const AdversePlausibilityEnum = z.enum(["REMOTE", "POSSIBLE", "PROBABLE", "NEAR_CERTAIN"]);
export type AdversePlausibility = z.infer<typeof AdversePlausibilityEnum>;

export const RiskVectorSchema = z.object({
  consequenceSeverity: ConsequenceSeverityEnum,
  blastRadius: BlastRadiusEnum,
  irreversibility: IrreversibilityEnum,
  epistemicUncertainty: EpistemicUncertaintyEnum,
  dependencyExposure: DependencyExposureEnum,
  adversePlausibility: AdversePlausibilityEnum,
});
export type RiskVector = z.infer<typeof RiskVectorSchema>;

// Ordering scales for product preorder evaluation
export const RiskDimensionOrders = {
  consequenceSeverity: { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 },
  blastRadius: { NODE: 0, CLUSTER: 1, CROSS_CLUSTER: 2, GLOBAL: 3 },
  irreversibility: { REVERSIBLE: 0, COMPENSATABLE: 1, RECONCILABLE: 2, STRICTLY_IRREVERSIBLE: 3 },
  epistemicUncertainty: { LOW: 0, MODERATE: 1, HIGH: 2, SEVERE: 3 },
  dependencyExposure: { ISOLATED: 0, TIER_2: 1, TIER_1: 2, CORE_INFRA: 3 },
  adversePlausibility: { REMOTE: 0, POSSIBLE: 1, PROBABLE: 2, NEAR_CERTAIN: 3 },
} as const;

export function riskLessOrEqual(r1: RiskVector, r2: RiskVector): boolean {
  return (
    RiskDimensionOrders.consequenceSeverity[r1.consequenceSeverity] <=
      RiskDimensionOrders.consequenceSeverity[r2.consequenceSeverity] &&
    RiskDimensionOrders.blastRadius[r1.blastRadius] <=
      RiskDimensionOrders.blastRadius[r2.blastRadius] &&
    RiskDimensionOrders.irreversibility[r1.irreversibility] <=
      RiskDimensionOrders.irreversibility[r2.irreversibility] &&
    RiskDimensionOrders.epistemicUncertainty[r1.epistemicUncertainty] <=
      RiskDimensionOrders.epistemicUncertainty[r2.epistemicUncertainty] &&
    RiskDimensionOrders.dependencyExposure[r1.dependencyExposure] <=
      RiskDimensionOrders.dependencyExposure[r2.dependencyExposure] &&
    RiskDimensionOrders.adversePlausibility[r1.adversePlausibility] <=
      RiskDimensionOrders.adversePlausibility[r2.adversePlausibility]
  );
}

// ============================================================================
// Evaluation Context & Operational Budget
// ============================================================================

export const OperationalBudgetSchema = z.object({
  remainingTokens: z.number().int().nonnegative(),
  remainingTurns: z.number().int().nonnegative(),
  deadlineEpochMs: z.number().int().nonnegative(),
  costBudgetUsd: z.number().nonnegative(),
});
export type OperationalBudget = z.infer<typeof OperationalBudgetSchema>;

export const DependencyGraphSnapshotSchema = z.object({
  epoch: z.string(),
  edges: z.record(z.array(z.string())),
});
export type DependencyGraphSnapshot = z.infer<typeof DependencyGraphSnapshotSchema>;

export interface AuthorizationSnapshot {
  isAuthorized(principal: string, action: string, scope: string[]): boolean;
}

export interface Clock {
  now(): Instant;
}

// ============================================================================
// Evidence Receipt Model
// ============================================================================

export const EvidenceClassEnum = z.enum([
  "POSTGRES_TELEMETRY",
  "STATIC_VERIFICATION",
  "ROLLBACK_ATTESTATION",
  "SIMULATION_RECEIPT",
  "QUORUM_RECEIPT",
  "DUAL_SIGNATURE_RECEIPT",
  "KUBERNETES_OBSERVATION",
  "FORMAL_REACHABILITY_PROOF",
  "ACTIVE_CANARY_PROBE",
]);
export type EvidenceClass = z.infer<typeof EvidenceClassEnum>;

export const ProvenanceTraceSchema = z.object({
  tool: z.string(),
  runId: z.string(),
  parentReceiptIds: z.array(z.string()).default([]),
});
export type ProvenanceTrace = z.infer<typeof ProvenanceTraceSchema>;

export const IntegrityProofSchema = z.object({
  method: z.enum(["ED25519", "HMAC_SHA256", "LOCAL_TCB"]),
  signature: z.string(),
  signerPublicKey: z.string().optional(),
});
export type IntegrityProof = z.infer<typeof IntegrityProofSchema>;

export const EvidenceReceiptSchema = z.object({
  id: z.string().min(1),
  claim: z.record(z.unknown()),
  evidenceClass: EvidenceClassEnum,
  source: z.string().min(1),
  provenance: ProvenanceTraceSchema,
  scope: z.array(z.string()).min(1),
  observedAt: InstantSchema,
  stateVersion: z.string().min(1),
  integrity: IntegrityProofSchema,
  dependencies: z.array(z.string()).default([]),
});
export type EvidenceReceipt = z.infer<typeof EvidenceReceiptSchema>;

// ============================================================================
// Assurance Obligation & Policy Profile
// ============================================================================

export const ObligationKindEnum = z.enum([
  "OBSERVE",
  "VERIFY_DEPENDENCY",
  "VERIFY_ROLLBACK",
  "SIMULATE",
  "ESTABLISH_REDUNDANCY",
  "QUORUM",
  "DUAL_CONTROL",
]);
export type ObligationKind = z.infer<typeof ObligationKindEnum>;

// ============================================================================
// Epistemic Fault Domain (EFD) Core Data Model
// ============================================================================

export const EpistemicFaultCategoryEnum = z.enum([
  "MODEL_ANCESTRY",
  "PROMPT_CONTEXT",
  "RETRIEVAL_SOURCE",
  "SENSOR_PIPELINE",
  "NETWORK_DEPENDENCY",
  "SOFTWARE_IMPLEMENTATION",
  "HUMAN_ORGANIZATION",
  "OTHER",
]);
export type EpistemicFaultCategory = z.infer<typeof EpistemicFaultCategoryEnum>;

export const EpistemicFaultSchema = z.object({
  id: z.string().min(1),
  category: EpistemicFaultCategoryEnum,
  description: z.string(),
});
export type EpistemicFault = z.infer<typeof EpistemicFaultSchema>;
export type EpistemicFaultBasis = EpistemicFault[];

export const VerifierDescriptorSchema = z.object({
  id: z.string().min(1),
  evidenceSourceId: z.string().min(1),
  exposures: z.array(z.string()),
});
export type VerifierDescriptor = z.infer<typeof VerifierDescriptorSchema>;

export type ExposureMap = Record<string, string[]>; // verifierId -> EpistemicFaultId[]

export const CoalitionPolicySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ALL_OF"),
  }),
  z.object({
    type: z.literal("K_OF_N"),
    k: z.number().int().positive(),
    n: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("EXPLICIT"),
    coalitions: z.array(z.array(z.string())),
  }),
]);
export type CoalitionPolicy = z.infer<typeof CoalitionPolicySchema>;

export const EfdProfileSchema = z.object({
  profileId: z.string().min(1),
  version: z.string().min(1),
  policyEpoch: z.string().min(1),
  faultBasis: z.array(EpistemicFaultSchema),
  verifierDescriptors: z.array(VerifierDescriptorSchema),
  coalitionPolicy: CoalitionPolicySchema,
  signature: z.string().optional(),
  digest: z.string().optional(),
});
export type EfdProfile = z.infer<typeof EfdProfileSchema>;

export interface StructuralCutResult {
  kappaE: number;
  minimumFaultCuts: string[][];
  decisiveCoalitionsAnalyzed: number;
  witnessSources: string[];
}

export const EfdRequirementSchema = z.object({
  profileId: z.string().min(1),
  minimumStructuralCut: z.number().int().positive(),
  disallowedFaults: z.array(z.string()).default([]),
});
export type EfdRequirement = z.infer<typeof EfdRequirementSchema>;

export const SetConstraintSpecSchema = z.object({
  minCardinality: z.number().int().positive().optional(),
  minDistinctPrincipals: z.number().int().positive().optional(),
  requireReconciliation: z.boolean().optional(),
});
export type SetConstraintSpec = z.infer<typeof SetConstraintSpecSchema>;

export const GuardTemplateSchema = z.object({
  id: z.string(),
  target: z.string(),
  stateProperty: z.string(),
  predicateDescription: z.string(),
  expectedValueExtractor: z.string(), // e.g. "params.clusterId" or "receipt.claim.timeline"
});
export type GuardTemplate = z.infer<typeof GuardTemplateSchema>;

export const AssuranceObligationSchema = z.object({
  id: z.string(),
  kind: ObligationKindEnum,
  predicate: z.string(),
  target: z.string(),
  scope: z.array(z.string()),
  maxFreshnessMs: z.number().positive(),
  evidenceClasses: z.array(EvidenceClassEnum).min(1),
  efdRequirement: EfdRequirementSchema.nullable().default(null),
  setConstraints: SetConstraintSpecSchema.nullable().default(null),
  enforcement: z.enum(["REQUIRED", "ADVISORY"]),
  guardTemplates: z.array(GuardTemplateSchema).default([]),
  // Exact authenticated source identifiers; absence means all sources are incomparable.
  sourcePriorities: z.record(z.number().int()).optional(),
});
export type AssuranceObligation = z.infer<typeof AssuranceObligationSchema>;

export const PolicyProfileSchema = z.object({
  policyId: z.string(),
  epoch: z.string(),
  targetAction: z.string(),
  riskTier: z.string(),
  autoAuthorityThreshold: RiskVectorSchema,
  staticInvariants: z.array(z.string()).default([]),
  obligationRules: z.array(AssuranceObligationSchema),
});
export type PolicyProfile = z.infer<typeof PolicyProfileSchema>;

export interface EvaluationContext {
  policySnapshot: PolicyProfile;
  evaluationTime: Instant;
  operationalBudget: OperationalBudget;
  dependencySnapshot: DependencyGraphSnapshot;
  authorizationSnapshot: AuthorizationSnapshot;
  efdProfiles?: Record<string, EfdProfile> | undefined;
}

// ============================================================================
// Eligibility Diagnostics & Discharge Results
// ============================================================================

export interface EligibilityDiagnostics {
  eligible: EvidenceReceipt[];
  stale: EvidenceReceipt[];
  untrusted: EvidenceReceipt[];
  versionMismatch: EvidenceReceipt[];
  wrongClass: EvidenceReceipt[];
  wrongScope: EvidenceReceipt[];
}

export type SetConstraintFailureDetail =
  | "INSUFFICIENT_QUORUM_CARDINALITY"
  | "DUAL_CONTROL_SEPARATION_FAILED"
  | "RECONCILIATION_INCOMPLETE";

export type UnknownReason =
  | { kind: "MISSING" }
  | { kind: "STALE" }
  | { kind: "UNTRUSTED" }
  | { kind: "VERSION_MISMATCH" }
  | { kind: "CONFLICT" }
  | { kind: "SEARCH_LIMIT"; limit: number }
  | {
      kind: "INSUFFICIENT_STRUCTURAL_RESILIENCE";
      required: number;
      observed: number;
      minimumCuts: string[][];
    }
  | {
      kind: "SET_CONSTRAINT_UNSATISFIED";
      detail: SetConstraintFailureDetail;
    };

export type DischargeResult =
  | { kind: "SATISFIED"; witness: EvidenceReceipt[] }
  | { kind: "VIOLATED"; witness: EvidenceReceipt[] }
  | { kind: "UNKNOWN"; reason: UnknownReason };

// ============================================================================
// Epistemic Work Loop & Remediation Contract
// ============================================================================

export const RemediationInstructionSchema = z.object({
  kind: z.string(),
  tool: z.string(),
  target: z.string(),
  expectedEvidenceClass: EvidenceClassEnum,
  parameters: z.record(z.unknown()).default({}),
  currentKappaE: z.number().optional(),
  requiredKappaE: z.number().optional(),
  excludedExposureSets: z.array(z.array(z.string())).optional(),
  acceptableSourceProfiles: z.array(z.string()).optional(),
});
export type RemediationInstruction = z.infer<typeof RemediationInstructionSchema>;

export interface RemediationContract {
  obligationId: string;
  reason: UnknownReason;
  remediation: RemediationInstruction;
}

// ============================================================================
// Admission Witness Manifest & Guard Set
// ============================================================================

export const ManifestEntrySchema = z.object({
  obligationId: z.string(),
  witnessReceiptIds: z.array(z.string()).min(1),
  structuralCutResult: z
    .object({
      kappaE: z.number(),
      minimumFaultCuts: z.array(z.array(z.string())),
      decisiveCoalitionsAnalyzed: z.number(),
      witnessSources: z.array(z.string()),
    })
    .optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const AdmissionWitnessManifestSchema = z.object({
  entries: z.array(ManifestEntrySchema),
});
export type AdmissionWitnessManifest = z.infer<typeof AdmissionWitnessManifestSchema>;

export const AdmissionGuardSchema = z.object({
  id: z.string(),
  target: z.string(),
  predicateDescription: z.string(),
  expectedValue: z.unknown(),
});
export type AdmissionGuard = z.infer<typeof AdmissionGuardSchema>;

// ============================================================================
// Execution Envelope & Certificate
// ============================================================================

export const ResourceConstraintSchema = z.object({
  type: z.enum(["EXACT", "PREFIX", "ONE_OF"]),
  allowed: z.array(z.string()),
});
export type ResourceConstraint = z.infer<typeof ResourceConstraintSchema>;

export const ParameterConstraintSchema = z.object({
  param: z.string(),
  type: z.enum(["RANGE", "ENUM", "EXACT"]),
  bounds: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  allowed: z.array(z.unknown()).optional(),
});
export type ParameterConstraint = z.infer<typeof ParameterConstraintSchema>;

export const IntentConstraintSchema = z.object({
  allowedGoals: z.array(z.string()),
  requiredConstraints: z.array(z.string()).default([]),
});
export type IntentConstraint = z.infer<typeof IntentConstraintSchema>;

export const EffectConstraintSchema = z.object({
  maxEstimatedDataLossBytes: z.number().nonnegative().optional(),
  maxAllowedTimelineDrift: z.number().nonnegative().optional(),
});
export type EffectConstraint = z.infer<typeof EffectConstraintSchema>;

export const CoverageRequirementSchema = z.object({
  obligationKind: ObligationKindEnum,
  predicateFamily: z.string(),
  evidenceClasses: z.array(EvidenceClassEnum),
  scopeRule: z.string(),
  parameterBindingRule: z.string(),
});
export type CoverageRequirement = z.infer<typeof CoverageRequirementSchema>;

export const GuardRequirementSchema = z.object({
  guardId: z.string(),
  targetProperty: z.string(),
  stateProperty: z.string(),
});
export type GuardRequirement = z.infer<typeof GuardRequirementSchema>;

export const EnvelopeTemplateSchema = z.object({
  templateId: z.string(),
  version: z.string(),
  targetAction: z.string(),
  resourceConstraints: z.record(ResourceConstraintSchema),
  parameterConstraints: z.array(ParameterConstraintSchema),
  intentConstraints: IntentConstraintSchema,
  effectConstraints: EffectConstraintSchema,
  coverageRequirements: z.array(CoverageRequirementSchema),
  guardRequirements: z.array(GuardRequirementSchema),
  maxValidityDurationMs: z.number().positive(),
});
export type EnvelopeTemplate = z.infer<typeof EnvelopeTemplateSchema>;

export const EnvelopeTemplateAttestationSchema = z.object({
  templateId: z.string(),
  version: z.string(),
  templateDigest: z.string(),
  policyAuthority: z.string(),
  policyEpoch: z.string(),
  signature: z.string(),
});
export type EnvelopeTemplateAttestation = z.infer<typeof EnvelopeTemplateAttestationSchema>;

export const ExactActionEnvelopeSchema = z.object({
  mode: z.literal("EXACT_ACTION"),
  proposalDigest: z.string(),
});
export type ExactActionEnvelope = z.infer<typeof ExactActionEnvelopeSchema>;

export const GeneralizedEnvelopeSchema = z.object({
  mode: z.literal("ENVELOPE"),
  templateId: z.string(),
  templateVersion: z.string(),
  templateDigest: z.string(),
  targetAction: z.string(),
  // Conservative coverage: evidence is currently bound to the admitted proposal.
  coveredProposalDigest: z.string().length(64),
  resourceConstraints: z.record(ResourceConstraintSchema),
  parameterConstraints: z.array(ParameterConstraintSchema),
  intentConstraints: IntentConstraintSchema,
  effectConstraints: EffectConstraintSchema,
  coverageRequirements: z.array(CoverageRequirementSchema),
  guardRequirements: z.array(GuardRequirementSchema),
  instantiatedAt: InstantSchema,
  maxValidityDurationMs: z.number().positive(),
});
export type GeneralizedEnvelope = z.infer<typeof GeneralizedEnvelopeSchema>;

export const ExecutionEnvelopeSchema = z.discriminatedUnion("mode", [
  ExactActionEnvelopeSchema,
  GeneralizedEnvelopeSchema,
]);
export type ExecutionEnvelope = z.infer<typeof ExecutionEnvelopeSchema>;

export const CertificateModeEnum = z.enum(["EXACT_ACTION", "ENVELOPE"]);
export type CertificateMode = z.infer<typeof CertificateModeEnum>;

export const AdmissionCertificateSchema = z.object({
  admissionId: z.string().min(1),
  subject: z.string().min(1),
  authorityContext: z.record(z.unknown()).default({}),
  mode: CertificateModeEnum,
  proposalDigest: z.string().length(64), // SHA-256 hex string
  executionEnvelope: ExecutionEnvelopeSchema,
  policyEpoch: z.string(),
  witnessDigest: z.string().length(64), // SHA-256 hex string
  guardSet: z.array(AdmissionGuardSchema),
  issuedAt: InstantSchema,
  expiresAt: InstantSchema,
  nonce: z.string().min(1),
  signature: z.string().min(1), // Ed25519 signature hex or base64
});
export type AdmissionCertificate = z.infer<typeof AdmissionCertificateSchema>;

// Unsigned payload for canonical signing
export type UnsignedCertificateBody = Omit<AdmissionCertificate, "signature">;

// ============================================================================
// CAC Verdict
// ============================================================================

export type CACVerdict =
  | { kind: "PERMIT"; certificate: AdmissionCertificate }
  | { kind: "DENY"; reason: string }
  | { kind: "DEFER"; unresolved: RemediationContract[] }
  | {
      kind: "ESCALATE";
      approvals: AssuranceObligation[];
      remaining: AssuranceObligation[];
    }
  | { kind: "ABORT"; reason: string };

// ============================================================================
// Kubernetes Consequential Actions & Schemas
// ============================================================================

export const DrainNodeParamsSchema = z.object({
  nodeName: z.string().min(1),
  deleteEmptyDirData: z.boolean().default(false),
  ignoreDaemonSets: z.boolean().default(true),
  gracePeriodSeconds: z.number().int().nonnegative().default(30),
  force: z.boolean().default(false),
});
export type DrainNodeParams = z.infer<typeof DrainNodeParamsSchema>;

export const RolloutDeploymentParamsSchema = z.object({
  namespace: z.string().min(1),
  deploymentName: z.string().min(1),
  newImage: z.string().min(1),
  expectedDigest: z.string().min(1),
  maxSurge: z.string().default("25%"),
  maxUnavailable: z.string().default("0"),
});
export type RolloutDeploymentParams = z.infer<typeof RolloutDeploymentParamsSchema>;

export const ApplyNetworkPolicyParamsSchema = z.object({
  namespace: z.string().min(1),
  policyName: z.string().min(1),
  candidateRulesJson: z.string().min(1),
  probeUniverseOriginSet: z.array(z.string()).min(1),
  protectedEndpoint: z.string().min(1),
});
export type ApplyNetworkPolicyParams = z.infer<typeof ApplyNetworkPolicyParamsSchema>;

export const KubernetesActionProposalSchema = z.object({
  intent: SemanticIntentSchema,
  action: z.enum(["DrainNode", "RolloutDeployment", "ApplyNetworkPolicy"]),
  params: z.record(z.unknown()),
  scope: z.array(z.string()).min(1),
  principal: z.string().min(1),
  observedStateVersion: z.string().min(1),
  constraints: z.record(z.unknown()).default({}),
});
export type KubernetesActionProposal = z.infer<typeof KubernetesActionProposalSchema>;

export interface K8sLiveNode {
  ready: boolean;
  schedulable: boolean;
  capacityCpu: string;
  capacityMemory: string;
  resourceVersion: string;
}

export interface K8sLiveDeployment {
  replicas: number;
  readyReplicas: number;
  updatedReplicas: number;
  resourceVersion: string;
  generation: number;
  image: string;
}

export interface K8sLivePod {
  nodeName: string;
  phase: string;
  isReady: boolean;
  labels: Record<string, string>;
}

export interface K8sLivePDB {
  minAvailable?: number | undefined;
  maxUnavailable?: number | undefined;
  disruptionsAllowed: number;
  currentHealthy: number;
  desiredHealthy: number;
}

export interface K8sLiveState {
  clusterName: string;
  observedEpoch: string;
  nodes: Record<string, K8sLiveNode>;
  deployments: Record<string, K8sLiveDeployment>;
  pods: Record<string, K8sLivePod>;
  podDisruptionBudgets: Record<string, K8sLivePDB>;
  networkPolicies: Record<string, { resourceVersion: string; rulesJson: string }>;
}

// ============================================================================
// State Separation: Controller-Visible vs Benchmark Ground Truth
// ============================================================================

export interface ControllerVisibleState {
  clusterId: string;
  observedVersion: string;
  activeNodes: string[];
  candidateRole: "standby" | "primary" | "unknown" | "offline";
  replicationEpoch: number;
  // Optional domain state extensions (kept generic)
  k8sState?: K8sLiveState | undefined;
  genericProperties?: Record<string, unknown> | undefined;
}

export interface BenchmarkGroundTruthState {
  // Benchmark internal oracle state - NEVER passed to CAC controller!
  clusterId: string;
  actualPrimaryNode: string;
  actualStandbyNodes: string[];
  physicalNetworkPartition: boolean;
  actualDataLossBytes: number;
  uncommittedWalBytes: number;
  diskFaultInjected: boolean;
  // K8s ground truth
  actualK8sState?: K8sLiveState | undefined;
  // Network reachability ground truth (for F4)
  actualTopologyEdges?: [string, string][] | undefined;
  actualFirewallRules?: Record<string, { blockedOrigins: string[]; allowedOrigins: string[] }> | undefined;
}


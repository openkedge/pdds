import type {
  BenchmarkGroundTruthState,
  ControllerVisibleState,
  SemanticIntent,
} from "@cac/schemas";

export interface TraceEvent {
  timestampMs: number;
  type: string;
  details: Record<string, unknown>;
}

export interface TrialTrace {
  scenarioId: string;
  controllerId: string;
  seed: number;
  events: TraceEvent[];
  initialVisibleState: ControllerVisibleState;
  finalVisibleState?: ControllerVisibleState | undefined;
}

export interface TrialOutcome {
  scenarioId: string;
  controllerId: string;
  seed: number;
  intentCompleted: boolean;
  unsafeExecutionOccurred: boolean;
  executionAttempted: boolean;
  admissionGranted: boolean;
  verdicts: Record<string, number>;
  assuranceAcquisitionCostUsd: number;
  ttsrMs: number;
  controllerOverheadMs: number;
  trace: TrialTrace;
  error?: string | undefined;
  observation?: {
    source: "state-transition-observer";
    initial: PhysicalObservation;
    final: PhysicalObservation;
    attemptedEffects: number;
    failedResponses: number;
    ambiguousResponses: number;
    telemetryCalls: number;
    dispatchBoundaries: number;
    safeOpportunity: boolean;
  };
}

export interface OracleAssessment {
  isSafe: boolean;
  unsafeDamageOccurred: boolean;
  reason?: string | undefined;
}

export interface PhysicalObservation {
  state: Record<string, unknown>;
  completedEffects: number;
  harmfulEffects: number;
}

export interface ScenarioSetup {
  scenarioId: string;
  seed: number;
  groundTruth: BenchmarkGroundTruthState;
  visibleState: ControllerVisibleState;
  intent: SemanticIntent;
  candidateProposal: any;
  policyProfile?: any;
  efdProfiles?: any;
  initialEvidence?: any[];
  observe?: () => PhysicalObservation;
  safeOpportunity?: boolean;
  beforeDispatch?: () => Promise<void>;
  authorization?: import("@cac/policy").MemoryAuthorizer;
  // Simulated environment hook
  executeAction: (action: string, params: Record<string, unknown>) => Promise<{ success: boolean; error?: string; ambiguous?: boolean }>;
  fetchTelemetry: (toolName: string, params: Record<string, unknown>) => Promise<any>;
  oracles: {
    safeToExecuteStar: (proposal: any) => boolean;
    unsafeEffectStar: (initial: BenchmarkGroundTruthState, final: BenchmarkGroundTruthState) => boolean;
  };
}

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  setup(seed: number): Promise<ScenarioSetup>;
}

export interface BenchmarkController {
  id: string;
  name: string;
  run(setup: ScenarioSetup): Promise<TrialOutcome>;
}

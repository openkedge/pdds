import { describe, it, expect } from "vitest";
import type {
  ActionProposal,
  AssuranceObligation,
  EfdProfile,
  EvaluationContext,
  EvidenceReceipt,
} from "@cac/schemas";
import { makeInstant } from "@cac/schemas";
import { computeProfileDigest, signEvidenceReceipt } from "@cac/evidence";
import { discharge } from "../src/discharge.js";
import { generateRemediationContract } from "../src/remediation.js";

describe("WP2: EFD-Aware Evidence, Discharge & Remediation Integration", () => {
  const efdProfile: EfdProfile = {
    profileId: "reachability-efd-v1",
    version: "1.0.0",
    policyEpoch: "epoch-2026-q3",
    faultBasis: [
      { id: "f_model", category: "MODEL_ANCESTRY", description: "Shared LLM base model family" },
      { id: "f_formal", category: "SOFTWARE_IMPLEMENTATION", description: "SMT solver binary" },
      { id: "f_probe", category: "NETWORK_DEPENDENCY", description: "Physical testbed canary path" },
    ],
    verifierDescriptors: [
      { id: "v_llm_1", evidenceSourceId: "llm-panel-1", exposures: ["f_model"] },
      { id: "v_llm_2", evidenceSourceId: "llm-panel-2", exposures: ["f_model"] },
      { id: "v_llm_3", evidenceSourceId: "llm-panel-3", exposures: ["f_model"] },
      { id: "v_formal", evidenceSourceId: "formal-solver", exposures: ["f_formal"] },
      { id: "v_canary", evidenceSourceId: "active-canary-probe", exposures: ["f_probe"] },
    ],
    coalitionPolicy: { type: "K_OF_N", k: 2, n: 3 },
    signature: "insecure-dev-signature",
  };
  efdProfile.digest = computeProfileDigest(efdProfile);

  const efdObligation: AssuranceObligation = {
    id: "omega-network-unreachability",
    kind: "QUORUM",
    predicate: "unreachable == true",
    target: "endpoint.protected",
    scope: ["k8s/cluster-a"],
    maxFreshnessMs: 10000,
    evidenceClasses: ["FORMAL_REACHABILITY_PROOF", "ACTIVE_CANARY_PROBE", "STATIC_VERIFICATION"],
    efdRequirement: {
      profileId: "reachability-efd-v1",
      minimumStructuralCut: 2,
      disallowedFaults: [],
    },
    setConstraints: {
      minCardinality: 2,
    },
    enforcement: "REQUIRED",
    guardTemplates: [],
  };

  const sampleProposal: ActionProposal = {
    intent: { goal: "ApplyNetworkPolicy", scope: ["k8s/cluster-a"], constraints: [] },
    action: "FailoverDatabase",
    params: { clusterId: "cluster-a", candidateStandby: "node-2" },
    scope: ["k8s/cluster-a"],
    principal: "agent-net-01",
    observedStateVersion: "v1",
    constraints: { maxDataLossBytes: 0 },
  };

  const context: EvaluationContext = {
    policySnapshot: {
      policyId: "net-pol-v1",
      epoch: "epoch-2026-q3",
      targetAction: "FailoverDatabase",
      riskTier: "TIER_3",
      autoAuthorityThreshold: {
        consequenceSeverity: "HIGH",
        blastRadius: "CLUSTER",
        irreversibility: "COMPENSATABLE",
        epistemicUncertainty: "MODERATE",
        dependencyExposure: "TIER_1",
        adversePlausibility: "POSSIBLE",
      },
      staticInvariants: [],
      obligationRules: [efdObligation],
    },
    evaluationTime: makeInstant(1700000000000),
    operationalBudget: {
      remainingTokens: 10000,
      remainingTurns: 5,
      deadlineEpochMs: 1700000060000,
      costBudgetUsd: 1.0,
    },
    dependencySnapshot: { epoch: "1", edges: {} },
    authorizationSnapshot: { isAuthorized: () => true },
    efdProfiles: {
      "reachability-efd-v1": efdProfile,
    },
  };

  const state = {
    clusterId: "cluster-a",
    observedVersion: "v1",
    activeNodes: ["node-1", "node-2"],
    candidateRole: "standby" as const,
    replicationEpoch: 1,
  };

  it("nominal quorum |W|=3 with shared model fault yields kappa_E=1 and returns INSUFFICIENT_STRUCTURAL_RESILIENCE", () => {
    // 3 LLM receipts all sharing f_model
    const makeLlmReceipt = (id: string, verifierId: string): EvidenceReceipt =>
      signEvidenceReceipt(
        {
          id,
          claim: { unreachable: true, verifierId },
          evidenceClass: "STATIC_VERIFICATION",
          source: verifierId,
          provenance: { tool: "llm_verifier", runId: "1", parentReceiptIds: [] },
          scope: ["k8s/cluster-a"],
          observedAt: makeInstant(1700000000000),
          stateVersion: "v1",
          dependencies: [],
        },
        "cac-local-tcb-channel",
        "LOCAL_TCB"
      );

    const pool = [
      makeLlmReceipt("r1", "v_llm_1"),
      makeLlmReceipt("r2", "v_llm_2"),
      makeLlmReceipt("r3", "v_llm_3"),
    ];

    const result = discharge(efdObligation, pool, state, context);
    expect(result.kind).toBe("UNKNOWN");
    if (result.kind === "UNKNOWN") {
      expect(result.reason.kind).toBe("INSUFFICIENT_STRUCTURAL_RESILIENCE");
      if (result.reason.kind === "INSUFFICIENT_STRUCTURAL_RESILIENCE") {
        expect(result.reason.required).toBe(2);
        expect(result.reason.observed).toBe(1);
        expect(result.reason.minimumCuts).toEqual([["f_model"]]);

        // Verify remediation contract
        const remediation = generateRemediationContract(efdObligation, result.reason, sampleProposal);
        expect(remediation.remediation.kind).toBe("ACQUIRE_STRUCTURALLY_DISTINCT_EVIDENCE");
        expect(remediation.remediation.currentKappaE).toBe(1);
        expect(remediation.remediation.requiredKappaE).toBe(2);
        expect(remediation.remediation.excludedExposureSets).toEqual([["f_model"]]);
      }
    }
  });

  it("structurally distinct verifiers (formal solver + active canary) satisfy kappa_E >= 2 and discharge obligation", () => {
    const formalReceipt: EvidenceReceipt = signEvidenceReceipt(
      {
        id: "rec-formal-1",
        claim: { unreachable: true, verifierId: "v_formal" },
        evidenceClass: "FORMAL_REACHABILITY_PROOF",
        source: "v_formal",
        provenance: { tool: "formal_reachability_solver", runId: "1", parentReceiptIds: [] },
        scope: ["k8s/cluster-a"],
        observedAt: makeInstant(1700000000000),
        stateVersion: "v1",
        dependencies: [],
      },
      "cac-local-tcb-channel",
      "LOCAL_TCB"
    );

    const canaryReceipt: EvidenceReceipt = signEvidenceReceipt(
      {
        id: "rec-canary-1",
        claim: { unreachable: true, verifierId: "v_canary" },
        evidenceClass: "ACTIVE_CANARY_PROBE",
        source: "v_canary",
        provenance: { tool: "canary_probe_harness", runId: "1", parentReceiptIds: [] },
        scope: ["k8s/cluster-a"],
        observedAt: makeInstant(1700000000000),
        stateVersion: "v1",
        dependencies: [],
      },
      "cac-local-tcb-channel",
      "LOCAL_TCB"
    );

    // Also include one LLM receipt (3 verifiers total: v_formal, v_canary, v_llm_1)
    const llmReceipt: EvidenceReceipt = signEvidenceReceipt(
      {
        id: "rec-llm-1",
        claim: { unreachable: true, verifierId: "v_llm_1" },
        evidenceClass: "STATIC_VERIFICATION",
        source: "v_llm_1",
        provenance: { tool: "llm_verifier", runId: "1", parentReceiptIds: [] },
        scope: ["k8s/cluster-a"],
        observedAt: makeInstant(1700000000000),
        stateVersion: "v1",
        dependencies: [],
      },
      "cac-local-tcb-channel",
      "LOCAL_TCB"
    );

    const pool = [formalReceipt, canaryReceipt, llmReceipt];
    const result = discharge(efdObligation, pool, state, context);
    expect(result.kind).toBe("SATISFIED");
    if (result.kind === "SATISFIED") {
      expect(result.witness.length).toBeGreaterThanOrEqual(2);
    }
  });
});

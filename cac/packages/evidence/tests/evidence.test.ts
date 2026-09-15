import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AssuranceObligation,
  ControllerVisibleState,
  EvaluationContext,
  EvidenceReceipt,
} from "@cac/schemas";
import {
  computeEligibilityDiagnostics,
  evaluateSetConstraints,
  isLocallyEligible,
  signEvidenceReceipt,
  verifyAuthenticity,
} from "../src/index.js";

describe("Evidence Authenticity vs Truth", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  it("authenticates valid signed receipt", () => {
    const raw: Omit<EvidenceReceipt, "integrity"> = {
      id: "rec-001",
      claim: { replicationLagBytes: 512 },
      evidenceClass: "POSTGRES_TELEMETRY",
      source: "probe.postgres.prod-a",
      provenance: { tool: "pg_stat_replication", runId: "run-100", parentReceiptIds: [] },
      scope: ["postgres/prod-cluster-a"],
      observedAt: { epochMs: 10000, iso: new Date(10000).toISOString() },
      stateVersion: "lsn:0/3000000",
      dependencies: [],
    };

    const receipt = signEvidenceReceipt(raw, privateKeyPem, "ED25519", publicKeyPem);
    const trustedRoots = { trustedSigners: new Set([publicKeyPem]) };
    expect(verifyAuthenticity(receipt, trustedRoots)).toBe(true);
  });

  it("rejects tampered claim", () => {
    const raw: Omit<EvidenceReceipt, "integrity"> = {
      id: "rec-001",
      claim: { replicationLagBytes: 512 },
      evidenceClass: "POSTGRES_TELEMETRY",
      source: "probe.postgres.prod-a",
      provenance: { tool: "pg_stat_replication", runId: "run-100", parentReceiptIds: [] },
      scope: ["postgres/prod-cluster-a"],
      observedAt: { epochMs: 10000, iso: new Date(10000).toISOString() },
      stateVersion: "lsn:0/3000000",
      dependencies: [],
    };

    const receipt = signEvidenceReceipt(raw, privateKeyPem, "ED25519", publicKeyPem);
    // Tamper with claim
    receipt.claim["replicationLagBytes"] = 100000000;
    const trustedRoots = { trustedSigners: new Set([publicKeyPem]) };
    expect(verifyAuthenticity(receipt, trustedRoots)).toBe(false);
  });

  it("authenticity is not truth: authentic claim can be physically counterfactual", () => {
    // Proves Section 9 principle: verifyAuthenticity only asserts authorized source and tamper-evidence,
    // not physical ground truth.
    const counterfactualRaw: Omit<EvidenceReceipt, "integrity"> = {
      id: "rec-lying-probe",
      claim: { replicationLagBytes: 0, status: "all-good-honest" },
      evidenceClass: "POSTGRES_TELEMETRY",
      source: "probe.postgres.prod-a",
      provenance: { tool: "pg_stat_replication", runId: "run-lying", parentReceiptIds: [] },
      scope: ["postgres/prod-cluster-a"],
      observedAt: { epochMs: 10000, iso: new Date(10000).toISOString() },
      stateVersion: "lsn:0/3000000",
      dependencies: [],
    };

    const receipt = signEvidenceReceipt(counterfactualRaw, privateKeyPem, "ED25519", publicKeyPem);
    const trustedRoots = { trustedSigners: new Set([publicKeyPem]) };
    // The receipt is authentic
    expect(verifyAuthenticity(receipt, trustedRoots)).toBe(true);
    // But whether replication lag is physically 0 is an external property, not guaranteed by the crypto signature
  });
});

describe("Local Evidence Eligibility and Diagnostics", () => {
  const state: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  const obligation: AssuranceObligation = {
    id: "omega-1-replication-lag",
    kind: "OBSERVE",
    predicate: "replication_lag_bytes <= 1048576",
    target: "cluster.primary",
    scope: ["postgres/prod-cluster-a"],
    maxFreshnessMs: 2000, // 2s
    evidenceClasses: ["POSTGRES_TELEMETRY"],
    efdRequirement: null,
    setConstraints: null,
    enforcement: "REQUIRED",
    guardTemplates: [],
  };

  const evalContext: EvaluationContext = {
    policySnapshot: {
      policyId: "p1",
      epoch: "e1",
      targetAction: "FailoverDatabase",
      riskTier: "TIER_3",
      autoAuthorityThreshold: {
        consequenceSeverity: "HIGH",
        blastRadius: "CLUSTER",
        irreversibility: "COMPENSATABLE",
        epistemicUncertainty: "LOW",
        dependencyExposure: "TIER_1",
        adversePlausibility: "POSSIBLE",
      },
      staticInvariants: [],
      obligationRules: [],
    },
    evaluationTime: { epochMs: 12000, iso: new Date(12000).toISOString() },
    operationalBudget: {
      remainingTokens: 10000,
      remainingTurns: 5,
      deadlineEpochMs: 50000,
      costBudgetUsd: 1.0,
    },
    dependencySnapshot: { epoch: "d1", edges: {} },
    authorizationSnapshot: { isAuthorized: () => true },
  };

  it("identifies eligible fresh authentic receipt", () => {
    const raw: Omit<EvidenceReceipt, "integrity"> = {
      id: "rec-fresh",
      claim: { replicationLagBytes: 5000 },
      evidenceClass: "POSTGRES_TELEMETRY",
      source: "probe.postgres.prod-a",
      provenance: { tool: "probe", runId: "r1", parentReceiptIds: [] },
      scope: ["postgres/prod-cluster-a"],
      observedAt: { epochMs: 11000, iso: new Date(11000).toISOString() }, // age = 1000ms <= 2000ms
      stateVersion: "lsn:0/3000000",
      dependencies: [],
    };
    const receipt = signEvidenceReceipt(raw, "secret", "HMAC_SHA256");
    expect(isLocallyEligible(receipt, obligation, state, evalContext, { trustedSigners: new Set(), hmacSecret: "secret" })).toBe(true);
  });

  it("detects stale receipt exceeding maxFreshnessMs", () => {
    const raw: Omit<EvidenceReceipt, "integrity"> = {
      id: "rec-stale",
      claim: { replicationLagBytes: 5000 },
      evidenceClass: "POSTGRES_TELEMETRY",
      source: "probe.postgres.prod-a",
      provenance: { tool: "probe", runId: "r1", parentReceiptIds: [] },
      scope: ["postgres/prod-cluster-a"],
      observedAt: { epochMs: 9000, iso: new Date(9000).toISOString() }, // age = 3000ms > 2000ms
      stateVersion: "lsn:0/3000000",
      dependencies: [],
    };
    const receipt = signEvidenceReceipt(raw, "secret", "HMAC_SHA256");
    const diag = computeEligibilityDiagnostics([receipt], obligation, state, evalContext, { trustedSigners: new Set(), hmacSecret: "secret" });
    expect(diag.eligible).toHaveLength(0);
    expect(diag.stale).toHaveLength(1);
    expect(diag.stale[0]?.id).toBe("rec-stale");
  });
});

describe("Set-Level Constraints & Dual Control", () => {
  const state: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  it("requires distinct principals for dual-control obligation", () => {
    const dualObligation: AssuranceObligation = {
      id: "omega-dual",
      kind: "DUAL_CONTROL",
      predicate: "human_approval == true",
      target: "cluster.prod-a",
      scope: ["postgres/prod-cluster-a"],
      maxFreshnessMs: 60000,
      evidenceClasses: ["DUAL_SIGNATURE_RECEIPT"],
      efdRequirement: null,
      setConstraints: {
        minDistinctPrincipals: 2,
      },
      enforcement: "REQUIRED",
      guardTemplates: [],
    };

    const makeReceipt = (id: string, principal: string): EvidenceReceipt => ({
      id,
      claim: { principal, approved: true },
      evidenceClass: "DUAL_SIGNATURE_RECEIPT",
      source: `approver-${principal}`,
      provenance: { tool: "sre-approval-ui", runId: "run-1", parentReceiptIds: [] },
      scope: ["postgres/prod-cluster-a"],
      observedAt: { epochMs: 1000, iso: new Date(1000).toISOString() },
      stateVersion: "lsn:0/3000000",
      integrity: { method: "LOCAL_TCB", signature: "local-tcb:ok" },
      dependencies: [],
    });

    // Case 1: Same principal twice -> must fail dual control
    const candidateSame = [makeReceipt("r1", "alice"), makeReceipt("r2", "alice")];
    const resSame = evaluateSetConstraints(dualObligation, candidateSame, state);
    expect(resSame.satisfied).toBe(false);
    expect(resSame.reason).toEqual({
      kind: "SET_CONSTRAINT_UNSATISFIED",
      detail: "DUAL_CONTROL_SEPARATION_FAILED",
    });

    // Case 2: Two distinct principals -> passes dual control
    const candidateDistinct = [makeReceipt("r1", "alice"), makeReceipt("r2", "bob")];
    const resDistinct = evaluateSetConstraints(dualObligation, candidateDistinct, state);
    expect(resDistinct.satisfied).toBe(true);
  });
});

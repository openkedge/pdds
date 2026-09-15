import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ActionProposal,
  ControllerVisibleState,
  EvaluationContext,
  EvidenceReceipt,
} from "@cac/schemas";
import { postgresFailoverPolicyProfile } from "@cac/policy";
import {
  buildWitnessManifest,
  computeWitnessExpiration,
  deriveGuards,
  mintCertificate,
  verifyCertificate,
} from "../src/index.js";

describe("Certificate Minting and Manifest Binding", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const proposal: ActionProposal = {
    intent: {
      goal: "restore-primary-availability",
      scope: ["postgres/prod-cluster-a"],
      constraints: ["no-data-loss", "single-primary"],
    },
    action: "FailoverDatabase",
    params: {
      clusterId: "prod-cluster-a",
      candidateStandby: "replica-02",
    },
    scope: ["postgres/prod-cluster-a"],
    principal: "agent:sre-01",
    observedStateVersion: "lsn:0/3000000",
    constraints: {
      maxDataLossBytes: 0,
    },
  };

  const state: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  const evalContext: EvaluationContext = {
    policySnapshot: postgresFailoverPolicyProfile,
    evaluationTime: { epochMs: 10000, iso: new Date(10000).toISOString() },
    operationalBudget: {
      remainingTokens: 10000,
      remainingTurns: 5,
      deadlineEpochMs: 50000,
      costBudgetUsd: 1.0,
    },
    dependencySnapshot: { epoch: "d1", edges: {} },
    authorizationSnapshot: { isAuthorized: () => true },
  };

  const receipt1: EvidenceReceipt = {
    id: "rec-lag",
    claim: { replicationLagBytes: 1024 },
    evidenceClass: "POSTGRES_TELEMETRY",
    source: "probe.postgres.prod-a",
    provenance: { tool: "probe", runId: "r1", parentReceiptIds: [] },
    scope: ["postgres/prod-cluster-a"],
    observedAt: { epochMs: 9000, iso: new Date(9000).toISOString() }, // maxFreshness = 2000 => expires at 11000
    stateVersion: "lsn:0/3000000",
    integrity: { method: "LOCAL_TCB", signature: "sig1" },
    dependencies: [],
  };

  const receipt2: EvidenceReceipt = {
    id: "rec-health",
    claim: { isInRecovery: true, role: "standby" },
    evidenceClass: "POSTGRES_TELEMETRY",
    source: "probe.postgres.prod-a",
    provenance: { tool: "probe", runId: "r2", parentReceiptIds: [] },
    scope: ["postgres/prod-cluster-a"],
    observedAt: { epochMs: 9500, iso: new Date(9500).toISOString() }, // maxFreshness = 5000 => expires at 14500
    stateVersion: "lsn:0/3000000",
    integrity: { method: "LOCAL_TCB", signature: "sig2" },
    dependencies: [],
  };

  it("builds manifest and calculates witness-bounded expiration", () => {
    const obligations = postgresFailoverPolicyProfile.obligationRules;
    const satisfied = [
      { obligation: obligations[0]!, witness: [receipt1] },
      { obligation: obligations[1]!, witness: [receipt2] },
    ];

    const manifest = buildWitnessManifest(satisfied);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.entries[0]?.obligationId).toBe("omega-1-replication-lag");
    expect(manifest.entries[0]?.witnessReceiptIds).toEqual(["rec-lag"]);

    const obligationsMap = new Map(obligations.map((o) => [o.id, o]));
    const receiptsMap = new Map([
      [receipt1.id, receipt1],
      [receipt2.id, receipt2],
    ]);

    const witnessExpiry = computeWitnessExpiration(manifest, obligationsMap, receiptsMap);
    // min(9000 + 2000, 9500 + 5000) = min(11000, 14500) = 11000
    expect(witnessExpiry).toBe(11000);
  });

  it("derives concrete guards from policy templates", () => {
    const obligations = postgresFailoverPolicyProfile.obligationRules;
    const satisfied = [
      { obligation: obligations[0]!, witness: [receipt1] },
      { obligation: obligations[1]!, witness: [receipt2] },
    ];
    const manifest = buildWitnessManifest(satisfied);
    const guards = deriveGuards(manifest, obligations, proposal, state);

    expect(guards.length).toBeGreaterThanOrEqual(2);
    const primaryClusterGuard = guards.find((g) => g.id === "guard-primary-cluster");
    expect(primaryClusterGuard).toBeDefined();
    expect(primaryClusterGuard?.expectedValue).toBe("prod-cluster-a");

    const candidateRoleGuard = guards.find((g) => g.id === "guard-candidate-role");
    expect(candidateRoleGuard).toBeDefined();
    expect(candidateRoleGuard?.expectedValue).toBe("standby");
  });

  it("mints and verifies Ed25519 certificate, strictly bounding expiry", () => {
    const obligations = postgresFailoverPolicyProfile.obligationRules;
    const satisfied = [
      { obligation: obligations[0]!, witness: [receipt1] },
      { obligation: obligations[1]!, witness: [receipt2] },
    ];
    const manifest = buildWitnessManifest(satisfied);
    const guards = deriveGuards(manifest, obligations, proposal, state);

    const obligationsMap = new Map(obligations.map((o) => [o.id, o]));
    const receiptsMap = new Map([
      [receipt1.id, receipt1],
      [receipt2.id, receipt2],
    ]);
    const witnessExpiryEpochMs = computeWitnessExpiration(manifest, obligationsMap, receiptsMap);

    const certificate = mintCertificate({
      proposal,
      manifest,
      guardSet: guards,
      evaluationContext: evalContext,
      witnessExpiryEpochMs,
      maxCertificateTtlMs: 60000,
      controllerPrivateKeyPem: privateKeyPem,
    });

    expect(certificate.subject).toBe("agent:sre-01");
    expect(certificate.expiresAt.epochMs).toBe(11000); // Bounded by witness expiry!
    expect(verifyCertificate(certificate, publicKeyPem)).toBe(true);

    // Tamper test: mutating subject invalidates signature
    const tampered = { ...certificate, subject: "agent:adversary" };
    expect(verifyCertificate(tampered, publicKeyPem)).toBe(false);
  });
});

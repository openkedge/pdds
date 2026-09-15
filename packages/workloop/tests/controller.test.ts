import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActionProposal, ControllerVisibleState, EvaluationContext, EvidenceReceipt } from "@cac/schemas";
import { MemoryAuditLogger } from "@cac/core";
import { MemoryAuthorizer, postgresFailoverPolicyProfile } from "@cac/policy";
import { signEvidenceReceipt } from "@cac/evidence";
import { CACController } from "../src/index.js";

describe("Reference CACController - Algorithm 1", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  const authorizer = new MemoryAuthorizer([
    {
      principal: "agent:sre-01",
      action: "FailoverDatabase",
      scope: ["postgres/prod-cluster-a"],
    },
  ]);

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
    authorizationSnapshot: authorizer,
  };

  it("demonstrates closed Epistemic Work Loop: attempt 1 DEFER -> acquire evidence -> attempt 2 PERMIT", () => {
    const auditLogger = new MemoryAuditLogger();
    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      auditLogger,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    // Attempt 1: Empty evidence pool -> must DEFER
    const verdict1 = controller.evaluate(proposal, state, [], evalContext);
    expect(verdict1.kind).toBe("DEFER");
    if (verdict1.kind === "DEFER") {
      expect(verdict1.unresolved).toHaveLength(3);
      expect(verdict1.unresolved.map((u) => u.obligationId)).toEqual([
        "omega-1-replication-lag",
        "omega-2-standby-health",
        "omega-3-rollback-artifact",
      ]);
      expect(verdict1.unresolved[0]?.remediation.tool).toBe("postgres.inspectReplication");
    }

    // Agent executes remediation contracts, obtaining valid signed receipts:
    const receiptLag = signEvidenceReceipt(
      {
        id: "rec-lag-1",
        claim: { replicationLagBytes: 2048 },
        evidenceClass: "POSTGRES_TELEMETRY",
        source: "probe.postgres.prod-a",
        provenance: { tool: "pg_stat_replication", runId: "r1", parentReceiptIds: [] },
        scope: ["postgres/prod-cluster-a"],
        observedAt: { epochMs: 9500, iso: new Date(9500).toISOString() },
        stateVersion: "lsn:0/3000000",
        dependencies: [],
      },
      "secret",
      "HMAC_SHA256"
    );

    const receiptHealth = signEvidenceReceipt(
      {
        id: "rec-health-1",
        claim: { isInRecovery: true, role: "standby" },
        evidenceClass: "POSTGRES_TELEMETRY",
        source: "probe.postgres.prod-a",
        provenance: { tool: "pg_is_in_recovery", runId: "r2", parentReceiptIds: [] },
        scope: ["postgres/prod-cluster-a"],
        observedAt: { epochMs: 9500, iso: new Date(9500).toISOString() },
        stateVersion: "lsn:0/3000000",
        dependencies: [],
      },
      "secret",
      "HMAC_SHA256"
    );

    const receiptRollback = signEvidenceReceipt(
      {
        id: "rec-rollback-1",
        claim: { validRollbackSnapshot: true },
        evidenceClass: "ROLLBACK_ATTESTATION",
        source: "verifier.postgres.backup-service",
        provenance: { tool: "verify", runId: "r3", parentReceiptIds: [] },
        scope: ["postgres/prod-cluster-a"],
        observedAt: { epochMs: 9500, iso: new Date(9500).toISOString() },
        stateVersion: "lsn:0/3000000",
        dependencies: [],
      },
      "secret",
      "HMAC_SHA256"
    );

    const augmentedPool: EvidenceReceipt[] = [receiptLag, receiptHealth, receiptRollback];

    // Attempt 2: Resubmit with acquired evidence -> must PERMIT
    const verdict2 = controller.evaluate(proposal, state, augmentedPool, evalContext);
    expect(verdict2.kind).toBe("PERMIT");
    if (verdict2.kind === "PERMIT") {
      expect(verdict2.certificate.mode).toBe("EXACT_ACTION");
      expect(verdict2.certificate.subject).toBe("agent:sre-01");
      expect(verdict2.certificate.guardSet.length).toBeGreaterThan(0);
    }

    // Audit logs recorded both attempts
    const records = auditLogger.getRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.verdict).toBe("DEFER");
    expect(records[1]?.verdict).toBe("PERMIT");
  });
});

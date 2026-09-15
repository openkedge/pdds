import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ActionProposal,
  AdmissionCertificate,
  ControllerVisibleState,
} from "@cac/schemas";
import { MemoryAuthorizer, postgresFailoverPolicyProfile } from "@cac/policy";
import { mintCertificate } from "@cac/certificate";
import {
  authorizedDispatch,
  MemoryCapabilityStore,
  type TargetExecutionAdapter,
} from "../src/index.js";

describe("Single-Use Capability Store Concurrency", () => {
  it("allows at most one winner among 100 concurrent consumers", async () => {
    const store = new MemoryCapabilityStore();
    const nonce = "nonce-concurrency-test-100";

    const attempts = Array.from({ length: 100 }, () => store.consumeOnce(nonce));
    const results = await Promise.all(attempts);

    const winners = results.filter((res) => res === true);
    const losers = results.filter((res) => res === false);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(99);

    // Subsequent check shows nonce is consumed
    expect(await store.isUnused(nonce)).toBe(false);
  });
});

describe("Execution Gateway: Validation & Dispatch", () => {
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

  const liveState: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  const authorizer = new MemoryAuthorizer([
    {
      principal: "agent:sre-01",
      action: "FailoverDatabase",
      scope: ["postgres/prod-cluster-a"],
    },
  ]);

  function createTestCertificate(): AdmissionCertificate {
    return mintCertificate({
      proposal,
      manifest: { entries: [{ obligationId: "omega-1", witnessReceiptIds: ["rec-1"] }] },
      guardSet: [
        {
          id: "guard-primary-cluster",
          target: "cluster.id",
          predicateDescription: "clusterId == prod-cluster-a",
          expectedValue: "prod-cluster-a",
        },
        {
          id: "guard-candidate-role",
          target: "candidate.role",
          predicateDescription: "candidateRole == standby",
          expectedValue: "standby",
        },
      ],
      evaluationContext: {
        policySnapshot: postgresFailoverPolicyProfile,
        evaluationTime: { epochMs: 10000, iso: new Date(10000).toISOString() },
        operationalBudget: { remainingTokens: 1000, remainingTurns: 5, deadlineEpochMs: 50000, costBudgetUsd: 1 },
        dependencySnapshot: { epoch: "d1", edges: {} },
        authorizationSnapshot: authorizer,
      },
      witnessExpiryEpochMs: 20000,
      controllerPrivateKeyPem: privateKeyPem,
    });
  }

  it("dispatches successfully and burns single-use nonce", async () => {
    const cert = createTestCertificate();
    const capabilityStore = new MemoryCapabilityStore();
    let adapterCalled = false;

    const mockAdapter: TargetExecutionAdapter = {
      execute: async () => {
        adapterCalled = true;
        return { outcome: "SUCCESS", details: { promoted: "replica-02" } };
      },
    };

    const response = await authorizedDispatch({
      certificate: cert,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState,
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: mockAdapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: { epochMs: 11000, iso: new Date(11000).toISOString() },
    });

    expect(response.status).toBe("EXECUTED");
    expect(adapterCalled).toBe(true);

    // Replay attempt with same certificate
    const replayResponse = await authorizedDispatch({
      certificate: cert,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState,
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: mockAdapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: { epochMs: 11500, iso: new Date(11500).toISOString() },
    });

    expect(replayResponse.status).toBe("REJECTED");
    if (replayResponse.status === "REJECTED") {
      expect(replayResponse.reason).toContain("Replay");
    }
  });

  it("rejects dispatch if live guard is violated", async () => {
    const cert = createTestCertificate();
    const capabilityStore = new MemoryCapabilityStore();

    // Mutate live state: candidate is no longer standby
    const driftedState: ControllerVisibleState = {
      ...liveState,
      candidateRole: "primary", // DRIFT!
    };

    const mockAdapter: TargetExecutionAdapter = {
      execute: async () => ({ outcome: "SUCCESS" }),
    };

    const response = await authorizedDispatch({
      certificate: cert,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: driftedState,
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: mockAdapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: { epochMs: 11000, iso: new Date(11000).toISOString() },
    });

    expect(response.status).toBe("REJECTED");
    if (response.status === "REJECTED") {
      expect(response.reason).toContain("guard 'guard-candidate-role' violated");
    }

    // Ensure nonce was NOT burned because stage 1 rejected cleanly
    expect(await capabilityStore.isUnused(cert.nonce)).toBe(true);
  });

  it("handles downstream ambiguous execution without reusing capability", async () => {
    const cert = createTestCertificate();
    const capabilityStore = new MemoryCapabilityStore();

    const ambiguousAdapter: TargetExecutionAdapter = {
      execute: async () => ({
        outcome: "AMBIGUOUS",
        error: "Postgres connection reset during promotion handshake",
      }),
    };

    const response = await authorizedDispatch({
      certificate: cert,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState,
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: ambiguousAdapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: { epochMs: 11000, iso: new Date(11000).toISOString() },
    });

    expect(response.status).toBe("AMBIGUOUS_OUTCOME");
    if (response.status === "AMBIGUOUS_OUTCOME") {
      expect(response.reason).toContain("Postgres connection reset");
    }

    // Nonce WAS consumed and cannot be reused
    expect(await capabilityStore.isUnused(cert.nonce)).toBe(false);
  });
});

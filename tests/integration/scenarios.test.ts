import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActionProposal, ControllerVisibleState, EvaluationContext } from "@cac/schemas";
import { SteppableClock } from "@cac/core";
import { MemoryAuthorizer, postgresFailoverPolicyProfile } from "@cac/policy";
import { CACController } from "@cac/workloop";
import {
  authorizedDispatch,
  MemoryCapabilityStore,
} from "@cac/gateway";
import { PostgresClusterModel, PostgresFailoverAdapter, PostgresTelemetryObserver } from "@cac/adapter-postgres";

describe("End-to-End Admission & Execution Scenarios (A through I)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

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

  const initialVisibleState: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  function createEvaluationContext(clock: SteppableClock): EvaluationContext {
    return {
      policySnapshot: postgresFailoverPolicyProfile,
      evaluationTime: clock.now(),
      operationalBudget: {
        remainingTokens: 10000,
        remainingTurns: 5,
        deadlineEpochMs: clock.now().epochMs + 60000,
        costBudgetUsd: 1.0,
      },
      dependencySnapshot: { epoch: "dep-v1", edges: {} },
      authorizationSnapshot: authorizer,
    };
  }

  // ==========================================================================
  // SCENARIO A — Missing Evidence: valid authority, no replication evidence -> DEFER
  // ==========================================================================
  it("Scenario A: Missing evidence returns DEFER with targeted remediation contracts", () => {
    const clock = new SteppableClock(10000);
    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, [], context);

    expect(verdict.kind).toBe("DEFER");
    if (verdict.kind === "DEFER") {
      expect(verdict.unresolved).toHaveLength(3);
      const lagRemediation = verdict.unresolved.find((u) => u.obligationId === "omega-1-replication-lag");
      expect(lagRemediation).toBeDefined();
      expect(lagRemediation?.reason).toEqual({ kind: "MISSING" });
      expect(lagRemediation?.remediation.tool).toBe("postgres.inspectReplication");
    }
  });

  // ==========================================================================
  // SCENARIO B — Good Evidence: acceptable lag, standby healthy, rollback valid -> PERMIT & dispatch
  // ==========================================================================
  it("Scenario B: Good evidence returns PERMIT, mints certificate, and dispatches cleanly", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });
    const adapter = new PostgresFailoverAdapter(cluster);
    const capabilityStore = new MemoryCapabilityStore();

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    // Acquire valid telemetry and attestations
    const receiptLag = await observer.inspectReplication("replica-02");
    const receiptHealth = await observer.inspectStandbyHealth("replica-02");
    const receiptRollback = await observer.verifyRollbackSnapshot();

    const evidencePool = [receiptLag, receiptHealth, receiptRollback];
    const context = createEvaluationContext(clock);

    const verdict = controller.evaluate(proposal, initialVisibleState, evidencePool, context);
    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    expect(verdict.certificate.mode).toBe("EXACT_ACTION");
    expect(verdict.certificate.subject).toBe("agent:sre-01");

    // Execute via Gateway
    const dispatchResponse = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(dispatchResponse.status).toBe("EXECUTED");
    if (dispatchResponse.status === "EXECUTED") {
      expect(dispatchResponse.result.outcome).toBe("SUCCESS");
      expect(dispatchResponse.result.details?.["promotedNode"]).toBe("replica-02");
    }
  });

  // ==========================================================================
  // SCENARIO C — Affirmatively Unsafe Evidence: replication lag exceeds threshold -> DENY
  // ==========================================================================
  it("Scenario C: Affirmatively unsafe evidence (excessive replication lag) returns DENY", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    // Inject massive replication lag fault (50 MB > 1 MB threshold)
    cluster.injectFault({ replicationLagSpikeBytes: 52428800 });

    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const receiptLag = await observer.inspectReplication("replica-02");
    const receiptHealth = await observer.inspectStandbyHealth("replica-02");
    const receiptRollback = await observer.verifyRollbackSnapshot();

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, [receiptLag, receiptHealth, receiptRollback], context);

    expect(verdict.kind).toBe("DENY");
    if (verdict.kind === "DENY") {
      expect(verdict.reason).toContain("Assurance obligation violated: omega-1-replication-lag");
    }
  });

  // ==========================================================================
  // SCENARIO D — Stale Evidence: advance Clock beyond max freshness -> DEFER with STALE
  // ==========================================================================
  it("Scenario D: Stale evidence returns DEFER with STALE diagnostic reason", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    // Observe receipts at epochMs = 10000
    const receiptLag = await observer.inspectReplication("replica-02"); // maxFreshness = 2000ms
    const receiptHealth = await observer.inspectStandbyHealth("replica-02");
    const receiptRollback = await observer.verifyRollbackSnapshot();

    // Advance evaluation clock by 3000ms (10000 -> 13000)
    clock.advance(3000);
    const context = createEvaluationContext(clock);

    const verdict = controller.evaluate(proposal, initialVisibleState, [receiptLag, receiptHealth, receiptRollback], context);

    expect(verdict.kind).toBe("DEFER");
    if (verdict.kind === "DEFER") {
      const lagRemediation = verdict.unresolved.find((u) => u.obligationId === "omega-1-replication-lag");
      expect(lagRemediation).toBeDefined();
      expect(lagRemediation?.reason).toEqual({ kind: "STALE" });
    }
  });

  // ==========================================================================
  // SCENARIO E — Drift after Admission: mutate candidate replica health before dispatch -> Gateway rejects
  // ==========================================================================
  it("Scenario E: State drift in candidate role after admission invalidates gateway dispatch", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });
    const adapter = new PostgresFailoverAdapter(cluster);
    const capabilityStore = new MemoryCapabilityStore();

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const evidencePool = [
      await observer.inspectReplication("replica-02"),
      await observer.inspectStandbyHealth("replica-02"),
      await observer.verifyRollbackSnapshot(),
    ];

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, evidencePool, context);
    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    // DRIFT: Standby crashes / changes role before gateway dispatch
    cluster.injectFault({ roleDrift: "primary" });
    const liveStateAfterDrift = adapter.getLiveState("replica-02");

    const dispatchResponse = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: liveStateAfterDrift,
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(dispatchResponse.status).toBe("REJECTED");
    if (dispatchResponse.status === "REJECTED") {
      expect(dispatchResponse.reason).toContain("guard 'guard-candidate-role' violated");
    }

    // Nonce was NOT consumed
    expect(await capabilityStore.isUnused(verdict.certificate.nonce)).toBe(true);
  });

  // ==========================================================================
  // SCENARIO F — Replay: dispatch certificate once, second dispatch rejected
  // ==========================================================================
  it("Scenario F: Replay attempt with already consumed certificate is rejected", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });
    const adapter = new PostgresFailoverAdapter(cluster);
    const capabilityStore = new MemoryCapabilityStore();

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const evidencePool = [
      await observer.inspectReplication("replica-02"),
      await observer.inspectStandbyHealth("replica-02"),
      await observer.verifyRollbackSnapshot(),
    ];

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, evidencePool, context);
    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    // First dispatch succeeds
    const firstDispatch = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });
    expect(firstDispatch.status).toBe("EXECUTED");

    // Second dispatch with same certificate must be rejected
    const secondDispatch = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(secondDispatch.status).toBe("REJECTED");
    if (secondDispatch.status === "REJECTED") {
      expect(secondDispatch.reason).toContain("Replay");
    }
  });

  // ==========================================================================
  // SCENARIO G — Wrong Principal: certificate subject = agent A, requester = agent B -> Reject
  // ==========================================================================
  it("Scenario G: Wrong principal presenting valid certificate is rejected", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });
    const adapter = new PostgresFailoverAdapter(cluster);
    const capabilityStore = new MemoryCapabilityStore();

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const evidencePool = [
      await observer.inspectReplication("replica-02"),
      await observer.inspectStandbyHealth("replica-02"),
      await observer.verifyRollbackSnapshot(),
    ];

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, evidencePool, context);
    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    // Requester agent:sre-02 attempts to use agent:sre-01's certificate
    const dispatchResponse = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-02", // WRONG PRINCIPAL
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(dispatchResponse.status).toBe("REJECTED");
    if (dispatchResponse.status === "REJECTED") {
      expect(dispatchResponse.reason).toContain("Presenter unauthorized");
      expect(dispatchResponse.reason).toContain("agent:sre-02");
    }
  });

  // ==========================================================================
  // SCENARIO H — Payload Mutation: proposal certified for replica-02, dispatch replica-03 -> Reject
  // ==========================================================================
  it("Scenario H: Exact-action payload mutation invalidates proposal digest at gateway", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });
    const adapter = new PostgresFailoverAdapter(cluster);
    const capabilityStore = new MemoryCapabilityStore();

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const evidencePool = [
      await observer.inspectReplication("replica-02"),
      await observer.inspectStandbyHealth("replica-02"),
      await observer.verifyRollbackSnapshot(),
    ];

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, evidencePool, context);
    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    // Mutate invocation payload: candidateStandby changed to replica-03
    const mutatedProposal: ActionProposal = {
      ...proposal,
      params: {
        ...proposal.params,
        candidateStandby: "replica-03", // MUTATION!
      },
    };

    const dispatchResponse = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: mutatedProposal,
      requester: "agent:sre-01",
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(dispatchResponse.status).toBe("REJECTED");
    if (dispatchResponse.status === "REJECTED") {
      expect(dispatchResponse.reason).toContain("Exact-action proposal digest mismatch");
    }
  });

  // ==========================================================================
  // SCENARIO I — Ambiguous Execution: adapter returns timeout/unknown outcome -> Capability cannot be reused
  // ==========================================================================
  it("Scenario I: Ambiguous execution burns capability without automatic retry", async () => {
    const clock = new SteppableClock(10000);
    const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
    // Inject promotion timeout fault
    cluster.injectFault({ promotionTimeout: true });

    const observer = new PostgresTelemetryObserver(cluster, clock, {
      sourceIdentifier: "probe.postgres.prod-cluster-a",
      signingKeyOrSecret: "secret",
      signingMethod: "HMAC_SHA256",
    });
    const adapter = new PostgresFailoverAdapter(cluster);
    const capabilityStore = new MemoryCapabilityStore();

    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    const evidencePool = [
      await observer.inspectReplication("replica-02"),
      await observer.inspectStandbyHealth("replica-02"),
      await observer.verifyRollbackSnapshot(),
    ];

    const context = createEvaluationContext(clock);
    const verdict = controller.evaluate(proposal, initialVisibleState, evidencePool, context);
    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    const dispatchResponse = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(dispatchResponse.status).toBe("AMBIGUOUS_OUTCOME");
    if (dispatchResponse.status === "AMBIGUOUS_OUTCOME") {
      expect(dispatchResponse.reason).toContain("promotion timeout");
    }

    // Crucially: capability nonce IS consumed and CANNOT be reused!
    expect(await capabilityStore.isUnused(verdict.certificate.nonce)).toBe(false);

    // Attempting to reuse the certificate must fail immediately
    const retryAttempt = await authorizedDispatch({
      certificate: verdict.certificate,
      invocationProposal: proposal,
      requester: "agent:sre-01",
      liveState: adapter.getLiveState("replica-02"),
      livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });

    expect(retryAttempt.status).toBe("REJECTED");
    if (retryAttempt.status === "REJECTED") {
      expect(retryAttempt.reason).toContain("Replay detected");
    }
  });
});

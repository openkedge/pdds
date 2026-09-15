import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type {
  ActionProposal,
  AdmissionGuard,
  AdmissionWitnessManifest,
  EnvelopeTemplate,
  EnvelopeTemplateAttestation,
  EvaluationContext,
} from "@cac/schemas";
import { makeInstant } from "@cac/schemas";
import { computeTemplateDigest } from "@cac/core";
import { EnvelopeTemplateRegistry, postgresFailoverPolicyProfile, MemoryAuthorizer } from "@cac/policy";
import {
  instantiateEnvelopeTemplate,
  validateProposalAgainstTemplate,
  manifestCovers,
  mintCertificate,
} from "../src/index.js";
import { admissionValid, MemoryCapabilityStore } from "@cac/gateway";

describe("Execution Envelopes", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  const testTemplate: EnvelopeTemplate = {
    templateId: "postgres.failover.controlled.v1",
    version: "1.0.0",
    targetAction: "FailoverDatabase",
    resourceConstraints: {
      candidateStandby: {
        type: "ONE_OF",
        allowed: ["replica-02", "replica-03"],
      },
    },
    parameterConstraints: [],
    intentConstraints: {
      allowedGoals: ["Emergency database failover", "Planned maintenance failover"],
      requiredConstraints: ["zero-unreplicated-transactions"],
    },
    effectConstraints: {
      maxEstimatedDataLossBytes: 0,
      maxAllowedTimelineDrift: 1,
    },
    coverageRequirements: [
      {
        obligationKind: "OBSERVE",
        predicateFamily: "replication_lag",
        evidenceClasses: ["POSTGRES_TELEMETRY"],
        scopeRule: "exact",
        parameterBindingRule: "clusterId",
      },
      {
        obligationKind: "OBSERVE",
        predicateFamily: "is_in_recovery",
        evidenceClasses: ["POSTGRES_TELEMETRY"],
        scopeRule: "exact",
        parameterBindingRule: "candidateStandby",
      },
    ],
    guardRequirements: [
      {
        guardId: "guard-primary-cluster",
        targetProperty: "clusterId",
        stateProperty: "clusterId",
      },
      {
        guardId: "guard-candidate-role",
        targetProperty: "candidateRole",
        stateProperty: "candidateRole",
      },
    ],
    maxValidityDurationMs: 60000,
  };

  const templateDigest = computeTemplateDigest(testTemplate as unknown as Record<string, unknown>);
  const validAttestation: EnvelopeTemplateAttestation = {
    templateId: testTemplate.templateId,
    version: testTemplate.version,
    templateDigest,
    policyAuthority: "secops-policy-authority",
    policyEpoch: "epoch-2026-q3",
    signature: "insecure-dev-signature",
  };

  const sampleProposal: ActionProposal = {
    intent: {
      goal: "Emergency database failover",
      scope: ["postgres/prod-cluster-a"],
      constraints: ["zero-unreplicated-transactions"],
    },
    action: "FailoverDatabase",
    params: {
      clusterId: "prod-cluster-a",
      candidateStandby: "replica-02",
    },
    scope: ["postgres/prod-cluster-a"],
    principal: "agent-sre-01",
    observedStateVersion: "v100",
    constraints: {
      maxDataLossBytes: 0,
    },
  };

  const sampleContext: EvaluationContext = {
    policySnapshot: postgresFailoverPolicyProfile,
    evaluationTime: makeInstant(1700000000000),
    operationalBudget: {
      remainingTokens: 10000,
      remainingTurns: 5,
      deadlineEpochMs: 1700000060000,
      costBudgetUsd: 1.0,
    },
    dependencySnapshot: { epoch: "1", edges: {} },
    authorizationSnapshot: { isAuthorized: () => true },
  };

  it("registers valid envelope template in registry", () => {
    const registry = new EnvelopeTemplateRegistry();
    registry.register(testTemplate, validAttestation);
    expect(registry.has(testTemplate.templateId, testTemplate.version)).toBe(true);
    expect(registry.get(testTemplate.templateId, testTemplate.version)).toEqual(testTemplate);
  });

  it("rejects tampered envelope template in registry", () => {
    const registry = new EnvelopeTemplateRegistry();
    const tamperedTemplate = { ...testTemplate, version: "1.0.1" };
    expect(() => registry.register(tamperedTemplate, validAttestation)).toThrow();
  });

  it("instantiates execution envelope from matching proposal", () => {
    const envelope = instantiateEnvelopeTemplate(testTemplate, sampleProposal, sampleContext);
    expect(envelope.mode).toBe("ENVELOPE");
    expect(envelope.templateId).toBe("postgres.failover.controlled.v1");
    expect(envelope.templateDigest).toBe(templateDigest);
  });

  it("rejects proposal violating resource constraints (disallowed replica)", () => {
    const invalidProposal: ActionProposal = {
      ...sampleProposal,
      params: {
        clusterId: "prod-cluster-a",
        candidateStandby: "replica-04", // not in allowed [replica-02, replica-03]
      },
    };
    expect(() => instantiateEnvelopeTemplate(testTemplate, invalidProposal, sampleContext)).toThrow(
      /not in allowed list/
    );
  });

  it("evaluates semantic coverage (manifestCovers)", () => {
    const envelope = instantiateEnvelopeTemplate(testTemplate, sampleProposal, sampleContext);
    const validManifest: AdmissionWitnessManifest = {
      entries: [
        {
          obligationId: "omega-1-replication-lag",
          witnessReceiptIds: ["rec-1"],
        },
        {
          obligationId: "omega-2-standby-health",
          witnessReceiptIds: ["rec-2"],
        },
      ],
    };

    const coverage = manifestCovers(validManifest, sampleProposal, envelope, sampleContext);
    expect(coverage.covers).toBe(true);

    const incompleteManifest: AdmissionWitnessManifest = {
      entries: [
        {
          obligationId: "omega-1-replication-lag",
          witnessReceiptIds: ["rec-1"],
        },
      ],
    };
    const incompleteCoverage = manifestCovers(incompleteManifest, sampleProposal, envelope, sampleContext);
    expect(incompleteCoverage.covers).toBe(false);
  });

  it("gateway validates invocation under ENVELOPE certificate mode", async () => {
    const envelope = instantiateEnvelopeTemplate(testTemplate, sampleProposal, sampleContext);
    const guards: AdmissionGuard[] = [
      {
        id: "guard-primary-cluster",
        target: "cluster.id",
        predicateDescription: "cluster matches",
        expectedValue: "prod-cluster-a",
      },
      {
        id: "guard-candidate-role",
        target: "candidate.role",
        predicateDescription: "role is standby",
        expectedValue: "standby",
      },
    ];

    const manifest: AdmissionWitnessManifest = {
      entries: [
        { obligationId: "omega-1-replication-lag", witnessReceiptIds: ["r1"] },
        { obligationId: "omega-2-standby-health", witnessReceiptIds: ["r2"] },
      ],
    };

    const cert = mintCertificate({
      proposal: sampleProposal,
      manifest,
      guardSet: guards,
      evaluationContext: sampleContext,
      witnessExpiryEpochMs: 1700000030000,
      mode: "ENVELOPE",
      executionEnvelope: envelope,
      controllerPrivateKeyPem: privateKeyPem,
    });

    const capabilityStore = new MemoryCapabilityStore();

    // 1. Template permits replica-03, but evidence covered only replica-02. Readmit.
    const allowedInvocation: ActionProposal = {
      ...sampleProposal,
      params: {
        clusterId: "prod-cluster-a",
        candidateStandby: "replica-03",
      },
    };

    const result = await admissionValid({
      certificate: cert,
      invocationProposal: allowedInvocation,
      requester: "agent-sre-01",
      liveState: {
        clusterId: "prod-cluster-a",
        observedVersion: "v100",
        activeNodes: ["primary-01", "replica-02", "replica-03"],
        candidateRole: "standby",
        replicationEpoch: 1,
      },
      livePolicyEpoch: "epoch-2026-q3",
      liveAuthorizer: new MemoryAuthorizer([{ principal: "agent-sre-01", action: "FailoverDatabase", scope: ["postgres/prod-cluster-a"] }]),
      capabilityStore,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: makeInstant(1700000010000),
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/witness coverage/);

    // 2. Invocation with forbidden standby (replica-04) rejected at gateway
    const forbiddenInvocation: ActionProposal = {
      ...sampleProposal,
      params: {
        clusterId: "prod-cluster-a",
        candidateStandby: "replica-04",
      },
    };

    const forbiddenResult = await admissionValid({
      certificate: cert,
      invocationProposal: forbiddenInvocation,
      requester: "agent-sre-01",
      liveState: {
        clusterId: "prod-cluster-a",
        observedVersion: "v100",
        activeNodes: ["primary-01", "replica-02", "replica-03"],
        candidateRole: "standby",
        replicationEpoch: 1,
      },
      livePolicyEpoch: "epoch-2026-q3",
      liveAuthorizer: new MemoryAuthorizer([{ principal: "agent-sre-01", action: "FailoverDatabase", scope: ["postgres/prod-cluster-a"] }]),
      capabilityStore,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: makeInstant(1700000010000),
    });

    expect(forbiddenResult.valid).toBe(false);
    expect(forbiddenResult.reason).toMatch(/disallowed by execution envelope/i);
  });
  it("rejects absent or malformed constrained fields", () => {
    for (const value of [undefined, null, 1, {}]) {
      const bad = { ...sampleProposal, params: { ...sampleProposal.params, candidateStandby: value } } as any;
      expect(validateProposalAgainstTemplate(bad, testTemplate).allowed).toBe(false);
    }
    expect(validateProposalAgainstTemplate(sampleProposal, { ...testTemplate,
      parameterConstraints: [{ param: "requiredLimit", type: "RANGE", bounds: { min: 0, max: 1 } }] }).allowed).toBe(false);
    expect(validateProposalAgainstTemplate({ ...sampleProposal, constraints: {} } as any, testTemplate).allowed).toBe(false);
  });
  it("binds action, subject, scope and covered parameters even with permissive live authorization", async () => {
    const envelope = instantiateEnvelopeTemplate({ ...testTemplate, guardRequirements: [] }, sampleProposal, sampleContext);
    const cert = mintCertificate({ proposal: sampleProposal, manifest: { entries: [] }, guardSet: [],
      evaluationContext: sampleContext, witnessExpiryEpochMs: 1700000030000, mode: "ENVELOPE",
      executionEnvelope: envelope, controllerPrivateKeyPem: privateKeyPem });
    const base = { certificate: cert, invocationProposal: sampleProposal, requester: sampleProposal.principal,
      liveState: { clusterId: "prod-cluster-a", observedVersion: "v100", activeNodes: [], candidateRole: "standby", replicationEpoch: 1 } as any,
      livePolicyEpoch: sampleContext.policySnapshot.epoch, liveAuthorizer: { isAuthorizedLive: () => true, grant() {}, revoke() {} },
      capabilityStore: new MemoryCapabilityStore(), controllerPublicKeyPem: publicKeyPem, currentTime: makeInstant(1700000010000) };
    expect((await admissionValid(base)).valid).toBe(true);
    for (const change of [{ action: "DeleteDatabase" }, { principal: "other" }, { scope: ["postgres/other"] },
      { params: { ...sampleProposal.params, candidateStandby: "replica-03" } }]) {
      expect((await admissionValid({ ...base, invocationProposal: { ...sampleProposal, ...change } as any })).valid).toBe(false);
    }
    expect((await admissionValid({ ...base, currentTime: makeInstant(1699999999999) })).valid).toBe(false);
    expect(() => mintCertificate({ proposal: sampleProposal, manifest: { entries: [] }, guardSet: [],
      evaluationContext: sampleContext, witnessExpiryEpochMs: 1700000030000, mode: "ENVELOPE", controllerPrivateKeyPem: privateKeyPem })).toThrow();
  });

});

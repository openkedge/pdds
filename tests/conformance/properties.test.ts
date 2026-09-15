import { generateKeyPairSync } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  ActionProposal,
  AdmissionGuard,
  ControllerVisibleState,
  EvaluationContext,
  EvidenceReceipt,
} from "@cac/schemas";
import {
  canonicalJson,
  computeProposalDigest,
  computeWitnessDigest,
} from "@cac/core";
import { MemoryAuthorizer, postgresFailoverPolicyProfile } from "@cac/policy";
import { signEvidenceReceipt } from "@cac/evidence";
import { CACController, discharge } from "@cac/workloop";
import { mintCertificate, verifyCertificate } from "@cac/certificate";
import {
  admissionValid,
  MemoryCapabilityStore,
} from "@cac/gateway";

describe("CAC Conformance: Formal Property-Based Tests", () => {
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

  const baseProposal: ActionProposal = {
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

  const baseState: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  const baseContext: EvaluationContext = {
    policySnapshot: postgresFailoverPolicyProfile,
    evaluationTime: { epochMs: 10000, iso: new Date(10000).toISOString() },
    operationalBudget: {
      remainingTokens: 10000,
      remainingTurns: 5,
      deadlineEpochMs: 60000,
      costBudgetUsd: 1.0,
    },
    dependencySnapshot: { epoch: "dep-v1", edges: {} },
    authorizationSnapshot: authorizer,
  };

  // --------------------------------------------------------------------------
  // PROPERTY 1: Deterministic Admission
  // Same (q, s, E, chi) always produces identical admission verdict
  // --------------------------------------------------------------------------
  it("Property 1: Deterministic Admission — identical inputs produce identical verdicts", () => {
    const controller = new CACController({
      controllerPrivateKeyPem: privateKeyPem,
      trustedRoots: { trustedSigners: new Set(), hmacSecret: "secret" },
    });

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000000 }), (lagBytes) => {
        const receipt = signEvidenceReceipt(
          {
            id: `rec-lag-${lagBytes}`,
            claim: { replicationLagBytes: lagBytes },
            evidenceClass: "POSTGRES_TELEMETRY",
            source: "probe.postgres.prod-cluster-a",
            provenance: { tool: "probe", runId: "r1", parentReceiptIds: [] },
            scope: ["postgres/prod-cluster-a"],
            observedAt: { epochMs: 9500, iso: new Date(9500).toISOString() },
            stateVersion: "lsn:0/3000000",
            dependencies: [],
          },
          "secret",
          "HMAC_SHA256"
        );

        const verdict1 = controller.evaluate(baseProposal, baseState, [receipt], baseContext);
        const verdict2 = controller.evaluate(baseProposal, baseState, [receipt], baseContext);

        expect(verdict1.kind).toBe(verdict2.kind);
        if (verdict1.kind === "DENY" && verdict2.kind === "DENY") {
          expect(verdict1.reason).toBe(verdict2.reason);
        }
      }),
      { numRuns: 50 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 2: Canonical Serialization Key-Order Independence
  // --------------------------------------------------------------------------
  it("Property 2: Canonical Serialization — key ordering independence across arbitrary objects", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()),
        (dict) => {
          const keys = Object.keys(dict);
          const shuffledKeys = [...keys].reverse();
          const dictShuffled: Record<string, number> = {};
          for (const k of shuffledKeys) {
            dictShuffled[k] = dict[k]!;
          }

          const canon1 = canonicalJson(dict);
          const canon2 = canonicalJson(dictShuffled);
          expect(canon1).toBe(canon2);
        }
      ),
      { numRuns: 100 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 3: Digest Stability and Domain Separation
  // --------------------------------------------------------------------------
  it("Property 3: Digest Stability — domain separation ensures ProposalDigest != WitnessDigest", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (randomStr) => {
        const dummyProposal = { ...baseProposal, observedStateVersion: randomStr };
        const dummyManifest = {
          entries: [{ obligationId: "omega-1", witnessReceiptIds: [randomStr] }],
        };

        const propDigest = computeProposalDigest(dummyProposal);
        const witnDigest = computeWitnessDigest(dummyManifest);

        expect(propDigest).toHaveLength(64);
        expect(witnDigest).toHaveLength(64);
        expect(propDigest).not.toBe(witnDigest);
      }),
      { numRuns: 50 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 4: Certificate Tamper Rejection
  // Mutating any field or signature bit invalidates verification
  // --------------------------------------------------------------------------
  it("Property 4: Certificate Tamper Rejection — any payload bitflip rejects signature", () => {
    const cert = mintCertificate({
      proposal: baseProposal,
      manifest: { entries: [{ obligationId: "omega-1", witnessReceiptIds: ["rec-1"] }] },
      guardSet: [],
      evaluationContext: baseContext,
      witnessExpiryEpochMs: 30000,
      controllerPrivateKeyPem: privateKeyPem,
    });

    expect(verifyCertificate(cert, publicKeyPem)).toBe(true);

    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (noise) => {
        const tampered = { ...cert, subject: `agent:${noise}` };
        expect(verifyCertificate(tampered, publicKeyPem)).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 5: At-Most-Once Nonce Consumption
  // Under concurrent racing, successfulConsumers <= 1
  // --------------------------------------------------------------------------
  it("Property 5: At-Most-Once Nonce Consumption — exactly one consumer wins racing CAS", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 10, max: 100 }), async (concurrency) => {
        const store = new MemoryCapabilityStore();
        const nonce = `test-nonce-${Math.random()}`;

        const attempts = Array.from({ length: concurrency }, () => store.consumeOnce(nonce));
        const results = await Promise.all(attempts);

        const successes = results.filter((r) => r === true);
        expect(successes).toHaveLength(1);
      }),
      { numRuns: 20 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 6: Exact-Action Scope Preservation
  // Mutating any parameter or scope item causes gateway rejection
  // --------------------------------------------------------------------------
  it("Property 6: Exact-Action Scope Preservation — mutating parameter rejects gateway dispatch", async () => {
    const cert = mintCertificate({
      proposal: baseProposal,
      manifest: { entries: [{ obligationId: "omega-1", witnessReceiptIds: ["rec-1"] }] },
      guardSet: [],
      evaluationContext: baseContext,
      witnessExpiryEpochMs: 30000,
      controllerPrivateKeyPem: privateKeyPem,
    });

    const store = new MemoryCapabilityStore();

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => s !== "replica-02"),
        async (altStandby) => {
          const mutatedProposal: ActionProposal = {
            ...baseProposal,
            params: { ...baseProposal.params, candidateStandby: altStandby },
          };

          const res = await admissionValid({
            certificate: cert,
            invocationProposal: mutatedProposal,
            requester: "agent:sre-01",
            liveState: baseState,
            livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
            liveAuthorizer: authorizer,
            capabilityStore: store,
            controllerPublicKeyPem: publicKeyPem,
            currentTime: baseContext.evaluationTime,
          });

          expect(res.valid).toBe(false);
          expect(res.reason).toContain("Exact-action proposal digest mismatch");
        }
      ),
      { numRuns: 30 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 7: Guard Drift Rejection
  // Mutating guarded state fields blocks dispatch
  // --------------------------------------------------------------------------
  it("Property 7: Guard Drift Rejection — any deviation in guarded state fields blocks gateway dispatch", async () => {
    const guards: AdmissionGuard[] = [
      {
        id: "guard-candidate-role",
        target: "candidate.role",
        predicateDescription: "candidateRole == standby",
        expectedValue: "standby",
      },
    ];

    const cert = mintCertificate({
      proposal: baseProposal,
      manifest: { entries: [{ obligationId: "omega-2", witnessReceiptIds: ["rec-2"] }] },
      guardSet: guards,
      evaluationContext: baseContext,
      witnessExpiryEpochMs: 30000,
      controllerPrivateKeyPem: privateKeyPem,
    });

    const store = new MemoryCapabilityStore();

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<"primary" | "offline" | "unknown">("primary", "offline", "unknown"),
        async (driftedRole) => {
          const driftedState: ControllerVisibleState = {
            ...baseState,
            candidateRole: driftedRole,
          };

          const res = await admissionValid({
            certificate: cert,
            invocationProposal: baseProposal,
            requester: "agent:sre-01",
            liveState: driftedState,
            livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
            liveAuthorizer: authorizer,
            capabilityStore: store,
            controllerPublicKeyPem: publicKeyPem,
            currentTime: baseContext.evaluationTime,
          });

          expect(res.valid).toBe(false);
          expect(res.reason).toContain("guard-candidate-role");
        }
      ),
      { numRuns: 20 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 8: Expired Certificate Rejection
  // currentTime > certificate.expiresAt is strictly rejected
  // --------------------------------------------------------------------------
  it("Property 8: Expired Certificate Rejection — gateway rejects certificates past expiresAt", async () => {
    const cert = mintCertificate({
      proposal: baseProposal,
      manifest: { entries: [{ obligationId: "omega-1", witnessReceiptIds: ["rec-1"] }] },
      guardSet: [],
      evaluationContext: baseContext,
      witnessExpiryEpochMs: 15000, // expires at 15000
      controllerPrivateKeyPem: privateKeyPem,
    });

    const store = new MemoryCapabilityStore();

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 15001, max: 100000 }), async (expiredEpochMs) => {
        const currentTime = { epochMs: expiredEpochMs, iso: new Date(expiredEpochMs).toISOString() };

        const res = await admissionValid({
          certificate: cert,
          invocationProposal: baseProposal,
          requester: "agent:sre-01",
          liveState: baseState,
          livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
          liveAuthorizer: authorizer,
          capabilityStore: store,
          controllerPublicKeyPem: publicKeyPem,
          currentTime,
        });

        expect(res.valid).toBe(false);
        expect(res.reason).toContain("Certificate expired");
      }),
      { numRuns: 30 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 9: Unauthorized Requester Rejection
  // requester !== certificate.subject is strictly rejected
  // --------------------------------------------------------------------------
  it("Property 9: Unauthorized Requester Rejection — subject mismatch strictly rejected", async () => {
    const cert = mintCertificate({
      proposal: baseProposal,
      manifest: { entries: [{ obligationId: "omega-1", witnessReceiptIds: ["rec-1"] }] },
      guardSet: [],
      evaluationContext: baseContext,
      witnessExpiryEpochMs: 30000,
      controllerPrivateKeyPem: privateKeyPem,
    });

    const store = new MemoryCapabilityStore();

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => s !== "agent:sre-01"),
        async (impostor) => {
          const res = await admissionValid({
            certificate: cert,
            invocationProposal: baseProposal,
            requester: impostor,
            liveState: baseState,
            livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
            liveAuthorizer: authorizer,
            capabilityStore: store,
            controllerPublicKeyPem: publicKeyPem,
            currentTime: baseContext.evaluationTime,
          });

          expect(res.valid).toBe(false);
          expect(res.reason).toContain("Presenter unauthorized");
        }
      ),
      { numRuns: 30 }
    );
  });

  // --------------------------------------------------------------------------
  // PROPERTY 10: Canonical Witness Selection Tie-Breaking and Reproducibility
  // --------------------------------------------------------------------------
  it("Property 10: Canonical Witness Selection — ranking is strictly deterministic and tie-broken", () => {
    const obligation = postgresFailoverPolicyProfile.obligationRules[0]!;
    const makeSignedReceipt = (id: string, lagBytes: number, ageMs: number): EvidenceReceipt =>
      signEvidenceReceipt(
        {
          id,
          claim: { replicationLagBytes: lagBytes },
          evidenceClass: "POSTGRES_TELEMETRY",
          source: "probe.postgres.prod-cluster-a",
          provenance: { tool: "probe", runId: "r", parentReceiptIds: [] },
          scope: ["postgres/prod-cluster-a"],
          observedAt: { epochMs: 10000 - ageMs, iso: new Date(10000 - ageMs).toISOString() },
          stateVersion: "lsn:0/3000000",
          dependencies: [],
        },
        "secret",
        "HMAC_SHA256"
      );

    const r1 = makeSignedReceipt("rec-alpha", 100, 500);
    const r2 = makeSignedReceipt("rec-beta", 100, 500);
    const roots = { trustedSigners: new Set<string>(), hmacSecret: "secret" };

    const res1 = discharge(obligation, [r1, r2], baseState, baseContext, roots);
    const res2 = discharge(obligation, [r2, r1], baseState, baseContext, roots);

    expect(res1.kind).toBe("SATISFIED");
    expect(res2.kind).toBe("SATISFIED");
    if (res1.kind === "SATISFIED" && res2.kind === "SATISFIED") {
      // Regardless of order in input array, canonical witness selected must be identical
      expect(res1.witness[0]?.id).toBe(res2.witness[0]?.id);
    }
  });
});

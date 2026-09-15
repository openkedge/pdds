import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cpus, tmpdir } from "node:os";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "@cac/core";
import { computeRisk, resolveObligations, postgresFailoverPolicyProfile, MemoryAuthorizer } from "@cac/policy";
import { signEvidenceReceipt, computeStructuralCut, isLocallyEligible } from "@cac/evidence";
import { discharge } from "@cac/workloop";
import { mintCertificate, buildWitnessManifest } from "@cac/certificate";
import { admissionValid, authorizedDispatch, FileCapabilityStore } from "@cac/gateway";
import { makeInstant, type ActionProposal, type ControllerVisibleState, type EvaluationContext, type EvidenceReceipt } from "@cac/schemas";
import { calculatePercentiles } from "./stats.js";

export interface LatencyPercentileBreakdown {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
}

export interface TierOverheadMeasurement {
  tier: string;
  iterations: number;
  tauResolve: LatencyPercentileBreakdown;
  tauVerify: LatencyPercentileBreakdown;
  tauMint: LatencyPercentileBreakdown;
  tauGatewayLocal: LatencyPercentileBreakdown;
  tauGuardIo: LatencyPercentileBreakdown;
  totalResidentOverhead: LatencyPercentileBreakdown;
}

export interface ScalingMicrobenchResult {
  receiptCount: number;
  eligibilityTotalMs: number;
  witnessSearchTotalMs: number;
  canonicalizationTotalMs: number;
  manifestHashingTotalMs: number;
  efdCutTotalMs: number;
  totalScalingTimeMs: number;
  avgPerReceiptUs: number;
}

export interface CertificateSizeMeasurement {
  tier: string;
  certificateBytes: number;
  witnessManifestBytes: number;
  evidenceReceiptBytes: number;
  signatureBytes: number;
}

export interface MicrobenchStudyResult {
  environment: {
    platform: string;
    arch: string;
    nodeVersion: string;
    cpuCores: number;
    cpuModel: string;
    measurementScope: string;
    timestamp: string;
  };
  tierOverhead: TierOverheadMeasurement[];
  scalingMicrobench: ScalingMicrobenchResult[];
  certificateSizes: CertificateSizeMeasurement[];
  rawSamples: Array<Record<string, number | string>>;
  efdScaling: Array<{ voters: number; roots: number; kappaE: number; elapsedMs: number }>;
}

/** Awaited full local path, with real file reads, persistent nonce consumption and
 * an instrumented target call. Evidence acquisition/model/cluster costs excluded. */
export async function runMicrobenchmark(iterationsPerTier = 1000): Promise<MicrobenchStudyResult> {
  assert(Number.isInteger(iterationsPerTier) && iterationsPerTier > 0);
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const trustedRoots = { trustedSigners: new Set([publicKey]) };
  const q: ActionProposal = { action: "FailoverDatabase", principal: "bench", params: { clusterId: "bench", candidateStandby: "standby" },
    intent: { goal: "Local path benchmark", scope: ["postgres/bench"], constraints: [] }, scope: ["postgres/bench"],
    observedStateVersion: "1", constraints: { maxDataLossBytes: 0 } };
  const live: ControllerVisibleState = { clusterId: "bench", observedVersion: "1", activeNodes: ["primary", "standby"], candidateRole: "standby", replicationEpoch: 1 };
  const authorizer = new MemoryAuthorizer([{ principal: q.principal, action: q.action, scope: q.scope }]);
  const context: EvaluationContext = { policySnapshot: structuredClone(postgresFailoverPolicyProfile), evaluationTime: makeInstant(Date.now()),
    operationalBudget: { remainingTurns: 10, remainingTokens: 10000, deadlineEpochMs: Date.now() + 3600000, costBudgetUsd: 0 },
    dependencySnapshot: { epoch: "1", edges: {} }, authorizationSnapshot: authorizer };
  const directory = await mkdtemp(join(tmpdir(), "cac-measure-"));
  const statePath = join(directory, "live.json");
  await writeFile(statePath, JSON.stringify(live));
  const store = new FileCapabilityStore(join(directory, "nonces"));
  const tierOverhead: TierOverheadMeasurement[] = [], certificateSizes: CertificateSizeMeasurement[] = [];
  const rawSamples: MicrobenchStudyResult["rawSamples"] = [], scalingMicrobench: ScalingMicrobenchResult[] = [], efdScaling: MicrobenchStudyResult["efdScaling"] = [];
  const makeReceipt = (i: number): EvidenceReceipt => signEvidenceReceipt({ id: `receipt-${i}`, claim: { replicationLagBytes: 0 },
    evidenceClass: "POSTGRES_TELEMETRY", source: `source-${i}`, provenance: { tool: "local", runId: "measured", parentReceiptIds: [] },
    scope: q.scope, observedAt: context.evaluationTime, stateVersion: "1", dependencies: [] }, privateKey, "ED25519", publicKey);
  try {
    for (const count of [1, 4, 8]) {
      const tier = `${count}_OBLIGATIONS`;
      context.policySnapshot.obligationRules = Array.from({ length: count }, (_, i) => ({ ...postgresFailoverPolicyProfile.obligationRules[0]!,
        id: `omega-${i}-replication-lag`, scope: q.scope, predicate: "replication_lag_bytes <= 0", maxFreshnessMs: 3600000 }));
      context.evaluationTime = makeInstant(Date.now());
      const receipts = Array.from({ length: count }, (_, i) => makeReceipt(i));
      const samples: number[][] = Array.from({ length: 6 }, () => []);
      const warmups = Math.min(20, iterationsPerTier);
      let calls = 0;
      for (let iteration = -warmups; iteration < iterationsPerTier; iteration++) {
        context.evaluationTime = makeInstant(Date.now());
        const t0 = performance.now();
        const risk = computeRisk(q, live, context.dependencySnapshot);
        const rules = resolveObligations(risk, q, live, context.policySnapshot);
        assert.equal(rules.length, count);
        const t1 = performance.now();
        const witnesses = rules.map(obligation => {
          const result = discharge(obligation, receipts, live, context, trustedRoots);
          assert.equal(result.kind, "SATISFIED");
          if (result.kind !== "SATISFIED") throw new Error("Invalid benchmark witness");
          return { obligation, witness: result.witness };
        });
        const t2 = performance.now();
        const manifest = buildWitnessManifest(witnesses);
        const cert = mintCertificate({ proposal: q, manifest,
          guardSet: [{ id: "guard-candidate-role", target: "candidate.role", predicateDescription: "role == standby", expectedValue: "standby" }],
          evaluationContext: context, witnessExpiryEpochMs: Date.now() + 60000, controllerPrivateKeyPem: privateKey });
        const t3 = performance.now();
        const state = JSON.parse(await readFile(statePath, "utf8")) as ControllerVisibleState;
        const t4 = performance.now();
        const params = { certificate: cert, invocationProposal: q, requester: q.principal, liveState: state,
          livePolicyEpoch: context.policySnapshot.epoch, liveAuthorizer: authorizer, capabilityStore: store,
          controllerPublicKeyPem: publicKey, currentTime: makeInstant(Date.now()),
          targetAdapter: { execute: async () => { calls++; return { outcome: "SUCCESS" as const }; } } };
        const beforeCalls = calls;
        const result = await authorizedDispatch(params);
        const t5 = performance.now();
        assert.equal(result.status, "EXECUTED");
        if (result.status === "EXECUTED") assert.equal(result.result.outcome, "SUCCESS");
        assert.equal(calls, beforeCalls + 1);
        assert.equal(await store.isUnused(cert.nonce), false);
        const negativeStart = performance.now();
        const replay = await admissionValid(params);
        const replayMs = performance.now() - negativeStart;
        assert.equal(replay.valid, false);
        assert.match(replay.reason!, /Replay/);
        if (iteration >= 0) {
          const values = [t1-t0, t2-t1, t3-t2, t5-t4, t4-t3, t5-t0];
          values.forEach((v, i) => samples[i]!.push(v));
          rawSamples.push({ workload: tier, iteration, obligations: count, receipts: count,
            resolveMs: values[0]!, verifyMs: values[1]!, mintMs: values[2]!, dispatchMs: values[3]!, guardReadMs: values[4]!, totalMs: values[5]!, replayRejectionMs: replayMs });
          if (iteration === 0) certificateSizes.push({ tier, certificateBytes: Buffer.byteLength(canonicalJson(cert)),
            witnessManifestBytes: Buffer.byteLength(canonicalJson(manifest)), evidenceReceiptBytes: Buffer.byteLength(canonicalJson(receipts)), signatureBytes: Buffer.from(cert.signature, "hex").length });
        }
      }
      tierOverhead.push({ tier, iterations: iterationsPerTier, tauResolve: calculatePercentiles(samples[0]!), tauVerify: calculatePercentiles(samples[1]!),
        tauMint: calculatePercentiles(samples[2]!), tauGatewayLocal: calculatePercentiles(samples[3]!), tauGuardIo: calculatePercentiles(samples[4]!), totalResidentOverhead: calculatePercentiles(samples[5]!) });
    }
    const rule = { ...context.policySnapshot.obligationRules[0]!, scope: q.scope };
    for (const count of [1, 4, 8, 12]) {
      context.evaluationTime = makeInstant(Date.now());
      const receipts = Array.from({ length: count }, (_, i) => makeReceipt(i));
      for (let repeat = 0; repeat < 5; repeat++) {
        const start = performance.now();
        for (const r of receipts) assert(isLocallyEligible(r, rule, live, context, trustedRoots));
        const t1 = performance.now();
        const witness = discharge(rule, receipts, live, context, trustedRoots);
        assert.equal(witness.kind, "SATISFIED");
        const t2 = performance.now();
        for (const r of receipts) canonicalJson(r);
        const t3 = performance.now();
        buildWitnessManifest([{ obligation: rule, witness: receipts }]);
        const t4 = performance.now();
        scalingMicrobench.push({ receiptCount: count, eligibilityTotalMs: t1-start, witnessSearchTotalMs: t2-t1,
          canonicalizationTotalMs: t3-t2, manifestHashingTotalMs: t4-t3, efdCutTotalMs: 0,
          totalScalingTimeMs: t4-start, avgPerReceiptUs: (t4-start)*1000/count });
      }
    }
    for (const count of [2, 4, 6, 8]) {
      const voters = Array.from({ length: count }, (_, i) => `v${i}`), roots = voters.map((_, i) => `f${i}`);
      for (let repeat = 0; repeat < 5; repeat++) {
        const start = performance.now();
        const cut = computeStructuralCut({ verifierSet: voters,
          faultBasis: roots.map(id => ({ id, category: "SENSOR_PIPELINE", description: id })),
          exposureMap: Object.fromEntries(voters.map((v, i) => [v, [roots[i]!]])), coalitionPolicy: { type: "K_OF_N", k: 2, n: count } });
        assert.equal(cut.kappaE, 2);
        efdScaling.push({ voters: count, roots: count, kappaE: cut.kappaE, elapsedMs: performance.now()-start });
      }
    }
    return { environment: { platform: process.platform, arch: process.arch, nodeVersion: process.version, cpuCores: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown", timestamp: new Date().toISOString(),
      measurementScope: "Single process, local filesystem guard read, fsync-backed nonce store, in-process target callback; warmups excluded; no external acquisition" },
      tierOverhead, scalingMicrobench, certificateSizes, rawSamples, efdScaling };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  scenarioF1,
  scenarioF2,
  scenarioF3,
  scenarioF4,
  scenarioF5,
  scenarioF6,
  scenarioF7,
  scenarioF8,
  scenarioF9,
  scenarioF10,
  scenarioF11,
  scenarioE1,
  scenarioBND1,
  scenarioBND2,
  scenarioBND3,
  scenarioBND4,
  scenarioEFDBND1,
  scenarioEFDBND2,
  scenarioEFDBND3,
  scenarioROB1,
  scenarioROB2,
  scenarioROB3,
  scenarioROB4,
  scenarioR1,
  scenarioR2,
  scenarioR3,
  canonicalScenarioVariants,
} from "./index.js";
import {
  controllerB0,
  controllerB1,
  controllerB2,
  controllerB3,
  controllerB4,
  controllerB5,
  controllerCAC,
  controllerCACNoGuard,
  controllerCACNoRemediation,
  controllerCACNoAdaptiveOmega,
  controllerCACNoTypedEvidence,
  controllerCACNoEFD,
} from "./index.js";
import { runTrial } from "./runner.js";
import { runMicrobenchmark } from "./microbench.js";
import type { BenchmarkController, BenchmarkScenario } from "./types.js";

export interface StoredTrialRecord {
  experimentId: string;
  batchId: string;
  trialId: string;
  scenarioId: string;
  intentId: string;
  controllerId: string;
  seed: number;
  contractDigest: string;
  timestamp: string;
  outcome: {
    intentCompleted: boolean;
    unsafeExecutionOccurred: boolean;
    executionAttempted: boolean;
    admissionGranted: boolean;
    verdicts: Record<string, number>;
    assuranceAcquisitionCostUsd: number;
    ttsrMs: number;
    controllerOverheadMs: number;
    error?: string;
  };
}

export interface StudyBatchManifest {
  batchId: string;
  experimentId: string;
  status: "IMMUTABLE";
  completedAt: string;
  contractDigest: string;
  totalTrials: number;
  scenariosTested: string[];
  controllersTested: string[];
  seedRange: [number, number];
  rawTrialsFile: string;
  batchSha256: string;
}

export async function runPoweredStudy(
  runsDir: string = path.resolve(process.cwd(), "runs", "final"),
  seedsCount: number = 30,
  seedStart: number = 101,
  microbenchIterations: number = 20000
): Promise<{ batchDir: string; manifest: StudyBatchManifest }> {
  const contractPath = path.resolve(process.cwd(), "study-contract.json");
  let contractDigest = "unfrozen";
  if (fs.existsSync(contractPath)) {
    const cData = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    contractDigest = cData.overallDigest ?? "digest-placeholder";
  }

  const batchId = `legacy-diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const experimentId = "legacy-scripted-diagnostic-not-confirmatory";
  const batchDir = path.join(runsDir, batchId);

  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(batchDir); // Deliberately fails if output exists; archived results are never replaced.

  console.log(`\n======================================================`);
  console.log(`Executing CAC v0.4 Powered Empirical Study`);
  console.log(`Batch ID: ${batchId}`);
  console.log(`Contract Digest: ${contractDigest}`);
  console.log(`Seed Range: ${seedStart} to ${seedStart + seedsCount - 1} (N=${seedsCount})`);
  console.log(`======================================================\n`);

  const primaryScenarios: BenchmarkScenario[] = [
    scenarioF1,
    scenarioF2,
    scenarioF3,
    scenarioF4,
    scenarioF5,
    scenarioF6,
    scenarioF7,
    scenarioF8,
    scenarioF9,
    scenarioF10,
    scenarioF11,
    scenarioE1,
  ];

  const controllers: BenchmarkController[] = [
    controllerB0,
    controllerB1,
    controllerB2,
    controllerB3,
    controllerB4,
    controllerB5,
    controllerCAC,
    controllerCACNoGuard,
    controllerCACNoRemediation,
    controllerCACNoAdaptiveOmega,
    controllerCACNoTypedEvidence,
    controllerCACNoEFD,
  ];

  const storedTrials: StoredTrialRecord[] = [];
  const seeds: number[] = [];
  for (let s = seedStart; s < seedStart + seedsCount; s++) {
    seeds.push(s);
  }

  console.log(`Running primary comparative matrix: ${primaryScenarios.length} scenarios x ${controllers.length} controllers x ${seeds.length} seeds = ${primaryScenarios.length * controllers.length * seeds.length} trials...`);

  for (const scenario of primaryScenarios) {
    for (const controller of controllers) {
      for (const seed of seeds) {
        const trialId = `trial-${scenario.id}-${controller.id}-${seed}`;
        const outcome = await runTrial(scenario, controller, seed);

        const record: StoredTrialRecord = {
          experimentId,
          batchId,
          trialId,
          scenarioId: scenario.id,
          intentId: `intent-${scenario.id}-${seed}`,
          controllerId: controller.id,
          seed,
          contractDigest,
          timestamp: new Date().toISOString(),
          outcome: {
            intentCompleted: outcome.intentCompleted,
            unsafeExecutionOccurred: outcome.unsafeExecutionOccurred,
            executionAttempted: outcome.executionAttempted,
            admissionGranted: outcome.admissionGranted,
            verdicts: outcome.verdicts,
            assuranceAcquisitionCostUsd: outcome.assuranceAcquisitionCostUsd,
            ttsrMs: outcome.ttsrMs,
            controllerOverheadMs: outcome.controllerOverheadMs,
            ...(outcome.error ? { error: outcome.error } : {}),
          },
        };

        storedTrials.push(record);
      }
    }
  }

  // Also run canonical variants with controllerCAC, B0, B1 (sample N=10 per variant for domain generalization)
  console.log(`Running canonical scenario variants (${canonicalScenarioVariants.length} variants)...`);
  const variantControllers = [controllerB0, controllerB1, controllerCAC];
  const variantSeeds = seeds.slice(0, 10);

  for (const variant of canonicalScenarioVariants) {
    for (const ctrl of variantControllers) {
      for (const s of variantSeeds) {
        const trialId = `variant-${variant.id}-${ctrl.id}-${s}`;
        const outcome = await runTrial(variant, ctrl, s);
        storedTrials.push({
          experimentId,
          batchId,
          trialId,
          scenarioId: variant.id,
          intentId: `intent-${variant.id}-${s}`,
          controllerId: ctrl.id,
          seed: s,
          contractDigest,
          timestamp: new Date().toISOString(),
          outcome: {
            intentCompleted: outcome.intentCompleted,
            unsafeExecutionOccurred: outcome.unsafeExecutionOccurred,
            executionAttempted: outcome.executionAttempted,
            admissionGranted: outcome.admissionGranted,
            verdicts: outcome.verdicts,
            assuranceAcquisitionCostUsd: outcome.assuranceAcquisitionCostUsd,
            ttsrMs: outcome.ttsrMs,
            controllerOverheadMs: outcome.controllerOverheadMs,
            ...(outcome.error ? { error: outcome.error } : {}),
          },
        });
      }
    }
  }

  // Targeted Remediation Recovery Study (R1, R2, R3)
  const remediationScenarios = [scenarioR1, scenarioR2, scenarioR3];
  const remediationControllers = [controllerCAC, controllerCACNoRemediation];
  console.log(`Running targeted remediation recovery study (${remediationScenarios.length} scenarios x ${remediationControllers.length} controllers x ${seeds.length} seeds = ${remediationScenarios.length * remediationControllers.length * seeds.length} trials)...`);
  for (const rScen of remediationScenarios) {
    for (const ctrl of remediationControllers) {
      for (const s of seeds) {
        const trialId = `trial-${rScen.id}-${ctrl.id}-${s}`;
        const outcome = await runTrial(rScen, ctrl, s);
        storedTrials.push({
          experimentId,
          batchId,
          trialId,
          scenarioId: rScen.id,
          intentId: `intent-${rScen.id}-${s}`,
          controllerId: ctrl.id,
          seed: s,
          contractDigest,
          timestamp: new Date().toISOString(),
          outcome: {
            intentCompleted: outcome.intentCompleted,
            unsafeExecutionOccurred: outcome.unsafeExecutionOccurred,
            executionAttempted: outcome.executionAttempted,
            admissionGranted: outcome.admissionGranted,
            verdicts: outcome.verdicts,
            assuranceAcquisitionCostUsd: outcome.assuranceAcquisitionCostUsd,
            ttsrMs: outcome.ttsrMs,
            controllerOverheadMs: outcome.controllerOverheadMs,
            ...(outcome.error ? { error: outcome.error } : {}),
          },
        });
      }
    }
  }

  // Also run boundary and defense-in-depth scenarios
  const boundaryScenarios = [
    scenarioBND1,
    scenarioBND2,
    scenarioBND3,
    scenarioBND4,
    scenarioROB1,
    scenarioROB2,
    scenarioROB3,
    scenarioROB4,
    scenarioEFDBND1,
    scenarioEFDBND2,
    scenarioEFDBND3,
  ];

  console.log(`Running boundary falsification and defense-in-depth scenarios (BND1-4, ROB1-4, EFD-BND1-3)...`);
  for (const bScen of boundaryScenarios) {
    const outcome = await runTrial(bScen, controllerCAC, 100);
    storedTrials.push({
      experimentId,
      batchId,
      trialId: `trial-${bScen.id}-CAC-100`,
      scenarioId: bScen.id,
      intentId: `intent-${bScen.id}-100`,
      controllerId: "CAC",
      seed: 100,
      contractDigest,
      timestamp: new Date().toISOString(),
      outcome: {
        intentCompleted: outcome.intentCompleted,
        unsafeExecutionOccurred: outcome.unsafeExecutionOccurred,
        executionAttempted: outcome.executionAttempted,
        admissionGranted: outcome.admissionGranted,
        verdicts: outcome.verdicts,
        assuranceAcquisitionCostUsd: outcome.assuranceAcquisitionCostUsd,
        ttsrMs: outcome.ttsrMs,
        controllerOverheadMs: outcome.controllerOverheadMs,
        ...(outcome.error ? { error: outcome.error } : {}),
      },
    });
  }

  const rawTrialsPath = path.join(batchDir, "raw-trials.jsonl");
  const trialsJsonl = storedTrials.map((t) => JSON.stringify(t)).join("\n");
  fs.writeFileSync(rawTrialsPath, trialsJsonl, "utf8");

  const batchSha256 = crypto.createHash("sha256").update(trialsJsonl).digest("hex");

  const manifest: StudyBatchManifest = {
    batchId,
    experimentId,
    status: "IMMUTABLE",
    completedAt: new Date().toISOString(),
    contractDigest,
    totalTrials: storedTrials.length,
    scenariosTested: primaryScenarios.map((s) => s.id),
    controllersTested: controllers.map((c) => c.id),
    seedRange: [seedStart, seedStart + seedsCount - 1],
    rawTrialsFile: "raw-trials.jsonl",
    batchSha256,
  };

  const manifestPath = path.join(batchDir, "batch-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✓ Recorded ${storedTrials.length} immutable trials to ${rawTrialsPath}`);
  console.log(`✓ Batch SHA-256: ${batchSha256}`);

  // Resident controller microbenchmark (20,000 valid-path executions per tier)
  console.log(`Running resident overhead study (${microbenchIterations} iterations/tier across Tier 0-3)...`);
  const microResults = await runMicrobenchmark(microbenchIterations);
  const microPath = path.join(batchDir, "microbench.json");
  fs.writeFileSync(microPath, JSON.stringify(microResults, null, 2), "utf8");
  console.log(`✓ Exported resident overhead microbenchmarks -> ${microPath}`);

  return { batchDir, manifest };
}

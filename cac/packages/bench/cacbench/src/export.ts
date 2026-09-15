import * as fs from "node:fs";
import * as path from "node:path";
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
import { runSuite, runTrial } from "./runner.js";
import { computeMcNemarTest } from "./stats.js";
import { runMicrobenchmark } from "./microbench.js";

export async function runFullBenchmarkAndExport(outDir: string = path.resolve(process.cwd(), "results")) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`\n======================================================`);
  console.log(`Running CACBench v0.3 Research Prototype Evaluation...`);
  console.log(`======================================================\n`);

  const primaryScenarios = [
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

  const primaryControllers = [
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

  const seeds = [1, 2, 3, 4, 5];

  console.log(`Running primary benchmark suite: ${primaryScenarios.length} scenarios x ${primaryControllers.length} controllers x ${seeds.length} seeds...`);
  const suiteResults = await runSuite(primaryScenarios, primaryControllers, seeds);

  // 1. Export results/table3.csv
  const table3Headers = [
    "Scenario",
    "Controller",
    "UIER",
    "SICR",
    "UER",
    "FBR",
    "CostUSD",
    "TTSR_ms",
    "Overhead_ms",
    "TotalTrials",
  ];
  const table3Rows = [table3Headers.join(",")];

  for (const res of suiteResults) {
    table3Rows.push(
      [
        res.scenarioId,
        res.controllerId,
        res.metrics.uier.toFixed(3),
        res.metrics.sicr.toFixed(3),
        res.metrics.uer.toFixed(3),
        res.metrics.fbr.toFixed(3),
        res.metrics.avgCostUsd.toFixed(4),
        res.metrics.avgTtsrMs.toFixed(2),
        res.metrics.avgOverheadMs.toFixed(2),
        res.metrics.totalTrials,
      ].join(",")
    );
  }

  const table3Path = path.join(outDir, "table3.csv");
  fs.writeFileSync(table3Path, table3Rows.join("\n"), "utf8");
  console.log(`✓ Exported Table 3 comparative matrix -> ${table3Path}`);

  // 2. Export results/overhead.csv (Microbenchmarks)
  console.log(`Running resident controller overhead microbenchmarks...`);
  const microResults = await runMicrobenchmark(50);
  const overheadHeaders = [
    "TierOrScale",
    "Tau_Resolve_ms",
    "Tau_Verify_ms",
    "Tau_Mint_ms",
    "Tau_GatewayLocal_ms",
    "Tau_GuardIO_ms",
    "TotalOverhead_ms",
    "ScaleReceiptCount",
    "ScaleTotal_ms",
    "ScaleAvgPerReceipt_us",
  ];
  const overheadRows = [overheadHeaders.join(",")];

  for (const t of microResults.tierOverhead) {
    overheadRows.push(
      [
        t.tier,
        t.tauResolve.mean,
        t.tauVerify.mean,
        t.tauMint.mean,
        t.tauGatewayLocal.mean,
        t.tauGuardIo.mean,
        t.totalResidentOverhead.mean,
        "",
        "",
        "",
      ].join(",")
    );
  }

  for (const s of microResults.scalingMicrobench) {
    overheadRows.push(
      [
        `SCALE_${s.receiptCount}`,
        "",
        "",
        "",
        "",
        "",
        "",
        s.receiptCount,
        s.totalScalingTimeMs,
        s.avgPerReceiptUs,
      ].join(",")
    );
  }

  const overheadPath = path.join(outDir, "overhead.csv");
  fs.writeFileSync(overheadPath, overheadRows.join("\n"), "utf8");
  console.log(`✓ Exported resident overhead breakdown -> ${overheadPath}`);

  // 3. Export results/efd-f4.csv (Hypothesis H3 McNemar verification)
  console.log(`Running F4 McNemar Hypothesis H3 trials (N=50)...`);
  const f4TrialsN = 50;
  const f4CacSafe: boolean[] = [];
  const f4B5Safe: boolean[] = [];
  const f4NoEfdSafe: boolean[] = [];
  const f4Rows = [
    "TrialSeed,CAC_Safe,B5_Safe,CAC_NoEFD_Safe,CAC_Verdicts,B5_Verdicts,CAC_NoEFD_Verdicts",
  ];

  for (let s = 1; s <= f4TrialsN; s++) {
    const oCac = await runTrial(scenarioF4, controllerCAC, s);
    const oB5 = await runTrial(scenarioF4, controllerB5, s);
    const oNoEfd = await runTrial(scenarioF4, controllerCACNoEFD, s);

    f4CacSafe.push(!oCac.unsafeExecutionOccurred);
    f4B5Safe.push(!oB5.unsafeExecutionOccurred);
    f4NoEfdSafe.push(!oNoEfd.unsafeExecutionOccurred);

    f4Rows.push(
      [
        s,
        !oCac.unsafeExecutionOccurred,
        !oB5.unsafeExecutionOccurred,
        !oNoEfd.unsafeExecutionOccurred,
        Object.keys(oCac.verdicts).join("+"),
        Object.keys(oB5.verdicts).join("+"),
        Object.keys(oNoEfd.verdicts).join("+"),
      ].join(",")
    );
  }

  const mcNemarB5 = computeMcNemarTest(f4CacSafe, f4B5Safe);
  const mcNemarNoEfd = computeMcNemarTest(f4CacSafe, f4NoEfdSafe);

  f4Rows.push("");
  f4Rows.push(`# McNemar Test CAC vs B5: Chi2=${mcNemarB5.statistic.toFixed(4)}, pValue=${mcNemarB5.pValue.toExponential(4)}, significant=${mcNemarB5.significant}`);
  f4Rows.push(`# Contingency Table CAC vs B5: bothSafe=${mcNemarB5.contingencyTable.bothSafe}, aSafeBUnsafe=${mcNemarB5.contingencyTable.aSafeBUnsafe}, aUnsafeBSafe=${mcNemarB5.contingencyTable.aUnsafeBSafe}, bothUnsafe=${mcNemarB5.contingencyTable.bothUnsafe}`);
  f4Rows.push(`# McNemar Test CAC vs CAC-NoEFD: Chi2=${mcNemarNoEfd.statistic.toFixed(4)}, pValue=${mcNemarNoEfd.pValue.toExponential(4)}, significant=${mcNemarNoEfd.significant}`);
  f4Rows.push(`# Contingency Table CAC vs CAC-NoEFD: bothSafe=${mcNemarNoEfd.contingencyTable.bothSafe}, aSafeBUnsafe=${mcNemarNoEfd.contingencyTable.aSafeBUnsafe}, aUnsafeBSafe=${mcNemarNoEfd.contingencyTable.aUnsafeBSafe}, bothUnsafe=${mcNemarNoEfd.contingencyTable.bothUnsafe}`);

  const efdF4Path = path.join(outDir, "efd-f4.csv");
  fs.writeFileSync(efdF4Path, f4Rows.join("\n"), "utf8");
  console.log(`✓ Exported EFD F4 McNemar analysis -> ${efdF4Path}`);

  // 4. Export results/boundary-failures.csv
  console.log(`Running boundary falsification cases (BND1-4, EFD-BND1-3)...`);
  const boundaryScenarios = [
    scenarioBND1,
    scenarioBND2,
    scenarioBND3,
    scenarioBND4,
    scenarioEFDBND1,
    scenarioEFDBND2,
    scenarioEFDBND3,
  ];

  const boundaryHeaders = [
    "ScenarioId",
    "ScenarioName",
    "BoundaryDescription",
    "FailureMode",
    "ControllerAdmissionGranted",
    "UnsafeExecutionOccurred",
    "EpistemicAssumptionViolated",
  ];
  const boundaryRows = [boundaryHeaders.join(",")];

  const assumptionMap: Record<string, string> = {
    BND1: "Assumption 1: Accurate self-reported proposal consequence severity",
    BND2: "Assumption 2: Complete controller visibility of physical topology",
    BND3: "Assumption 3: Cryptographic integrity implies factual physical truth",
    BND4: "Assumption 4: Policy author completeness in guard specification",
    "EFD-BND1": "Assumption 5: Complete enumeration of dependencies in EFD profile",
    "EFD-BND2": "Assumption 6: Independence of physical upstream cloud infrastructure",
    "EFD-BND3": "Assumption 7: Profile epoch freshness and synchronization",
  };

  for (const bScen of boundaryScenarios) {
    const outcome = await runTrial(bScen, controllerCAC, 100);
    boundaryRows.push(
      [
        bScen.id,
        `"${bScen.name}"`,
        `"${bScen.description}"`,
        `"${outcome.error ?? "None"}"`,
        outcome.admissionGranted,
        outcome.unsafeExecutionOccurred,
        `"${assumptionMap[bScen.id] ?? "Unspecified boundary"}"`,
      ].join(",")
    );
  }

  const boundaryPath = path.join(outDir, "boundary-failures.csv");
  fs.writeFileSync(boundaryPath, boundaryRows.join("\n"), "utf8");
  console.log(`✓ Exported boundary failure falsification report -> ${boundaryPath}`);

  // 5. Export machine-readable manifest results/experiment.json
  const manifest = {
    generatedAt: new Date().toISOString(),
    benchmarkVersion: "0.3.0",
    summary: {
      totalScenarios: primaryScenarios.length + boundaryScenarios.length,
      totalControllers: primaryControllers.length,
      trialsPerScenario: seeds.length,
      hypothesisH3: {
        confirmed: mcNemarB5.significant && mcNemarNoEfd.significant,
        pValueCACvsB5: mcNemarB5.pValue,
        pValueCACvsNoEFD: mcNemarNoEfd.pValue,
      },
    },
    microbenchmarks: microResults,
  };

  const manifestPath = path.join(outDir, "experiment.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✓ Exported complete experiment manifest -> ${manifestPath}`);

  console.log(`\nAll CACBench exports successfully generated in ${outDir}!\n`);
}

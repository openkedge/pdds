import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { repairedCases, repairedScenario } from "./repairedScenarios.js";
import { livePolicyController } from "./controllers/livePolicy.js";
import { controllerCAC, controllerCACNoGuard, controllerCACNoRemediation, controllerCACNoTypedEvidence, controllerCACNoEFD } from "./controllers/cac.js";
import { runTrial, computeMetrics } from "./runner.js";
import type { TrialOutcome } from "./types.js";

/** Exploratory local experiments. Seed repeats instantiate parameters, not independent operational faults. */
export async function runRepairedStudy(output: string, seedCount = 30, repetitions = 3, iterations = 1000) {
  for (const n of [seedCount, repetitions, iterations]) assert(Number.isInteger(n) && n > 0);
  const controllers = [livePolicyController(false), livePolicyController(true), controllerCAC,
    controllerCACNoGuard, controllerCACNoRemediation, controllerCACNoTypedEvidence, controllerCACNoEFD];
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync("git", ["diff", "--exit-code", "HEAD", "--", "packages", "bin", "package.json", "tsconfig.json"]);
  const protocol = { version: "repaired-local-v1", sourceRevision: revision, cases: repairedCases,
    controllers: controllers.map(c => c.id), seeds: Array.from({ length: seedCount }, (_, i) => i+1),
    performanceProcesses: repetitions, measuredIterationsPerWorkloadPerProcess: iterations,
    interpretation: "Controlled local state-machine experiments, with deterministic scenario categories; no model inference or remote cluster execution; no population-level significance inference",
    observation: "Privileged pre/post effect counters and full state snapshots are withheld from controllers. Failed/ambiguous responses are separate from harm. Fault schedule is applied before each controller's final dispatch gate.",
    performance: "Awaited signature, predicates, manifest, minting, file-backed guard read, fsync-backed nonce consumption, and instrumented in-process target call; independent process replicates; 20 warmups maximum excluded" };
  const destination = resolve(output);
  await mkdir(destination, { recursive: false }); // fail rather than overwrite an earlier run
  const save = async (name: string, value: unknown) => writeFile(join(destination, name), JSON.stringify(value, null, 2)+"\n", { flag: "wx" });
  await save("protocol.json", protocol);
  const trials: TrialOutcome[] = [];
  for (const kind of repairedCases) {
    for (const seed of protocol.seeds) {
      // Rotate execution order per seed; every controller receives a fresh world.
      const order = controllers.map((_, i) => controllers[(i+seed)%controllers.length]!);
      for (const controller of order) {
        const trial = await runTrial(repairedScenario(kind), controller, seed);
        assert(trial.observation, "Uninstrumented trial cannot enter the repaired study");
        trials.push(trial);
      }
    }
    console.log(`Observed ${kind}: ${controllers.length * seedCount} trials`);
  }
  const raw = trials.map((outcome, index) => JSON.stringify({ trialId: `observed-${index}`, outcome })).join("\n")+"\n";
  await writeFile(join(destination, "trials.jsonl"), raw, { flag: "wx" });
  const summary = controllers.map(controller => {
    const selected = trials.filter(t => t.controllerId === controller.id);
    return { controller: controller.id, trials: selected.length,
      unsafeEffects: selected.filter(t=>t.unsafeExecutionOccurred).length,
      completed: selected.filter(t=>t.intentCompleted).length,
      attempts: selected.reduce((n,t)=>n+t.observation!.attemptedEffects,0),
      metrics: computeMetrics(selected),
      byCase: repairedCases.map(kind => {
        const items = selected.filter(t=>t.scenarioId === `OBS-${kind}`);
        return { case: kind, trials: items.length, completed: items.filter(t=>t.intentCompleted).length,
          unsafe: items.filter(t=>t.unsafeExecutionOccurred).length, attempted: items.filter(t=>t.executionAttempted).length,
          telemetryCalls: items.reduce((n,t)=>n+t.observation!.telemetryCalls,0) };
      }) };
  });
  await save("summary.json", summary);
  for (let rep = 0; rep < repetitions; rep++) {
    console.log(`Performance process ${rep+1}/${repetitions}`);
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "bin/cac-microbench.ts", join(destination, `microbench-${rep+1}.json`), String(iterations)], { maxBuffer: 1024*1024 });
    console.log(result.stdout.trim());
  }
  const files = ["protocol.json", "trials.jsonl", "summary.json", ...Array.from({length:repetitions},(_,i)=>`microbench-${i+1}.json`)];
  const hashes: Record<string,string> = {};
  for (const name of files) hashes[name] = createHash("sha256").update(await readFile(join(destination,name))).digest("hex");
  await save("manifest.json", { sourceRevision: revision, completedAt: new Date().toISOString(), trials: trials.length, hashes });
  return { destination, trials: trials.length, summary };
}

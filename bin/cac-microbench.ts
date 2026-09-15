import { writeFile } from "node:fs/promises";
import { runMicrobenchmark } from "../packages/bench/cacbench/src/microbench.js";
const output = process.argv[2];
if (!output) throw new Error("Usage: node --import tsx bin/cac-microbench.ts OUTPUT ITERATIONS");
const data = await runMicrobenchmark(Number(process.argv[3] ?? 1000));
await writeFile(output, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
console.log(`Saved ${data.rawSamples.length} valid full-path samples to ${output}`);

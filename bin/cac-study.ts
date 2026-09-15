#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { runRepairedStudy } from "../packages/bench/cacbench/src/repairedStudy.js";
const seeds = Number(process.argv[2] ?? 30);
await mkdir("runs/repaired", { recursive: true });
const output = process.argv[3] ?? `runs/repaired/observed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const result = await runRepairedStudy(output, seeds, Number(process.argv[4] ?? 3), Number(process.argv[5] ?? 1000));
console.log(`Completed ${result.trials} observed local trials: ${result.destination}`);

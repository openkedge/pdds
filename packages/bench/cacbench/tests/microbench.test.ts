import { expect, it } from "vitest";
import { runMicrobenchmark } from "../src/microbench.js";
it("measures completed awaited paths, actual workload scaling and raw samples", async () => {
  const result = await runMicrobenchmark(2);
  expect(result.rawSamples).toHaveLength(6);
  expect(result.tierOverhead.map(t => t.tier)).toEqual(["1_OBLIGATIONS", "4_OBLIGATIONS", "8_OBLIGATIONS"]);
  expect(result.certificateSizes[2]!.witnessManifestBytes).toBeGreaterThan(result.certificateSizes[0]!.witnessManifestBytes);
  expect(new Set(result.efdScaling.map(s => s.roots))).toEqual(new Set([2, 4, 6, 8]));
  expect(result.scalingMicrobench.filter(s => s.receiptCount === 12)).toHaveLength(5);
  expect(result.rawSamples.every(s => Number(s.totalMs) >= Number(s.dispatchMs) && Number(s.guardReadMs) > 0)).toBe(true);
}, 20000);

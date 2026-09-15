import { expect, it } from "vitest";
import { computeStructuralCut } from "../src/efd.js";

it("matches direct fault propagation on all 43,561 three-voter profile/rule pairs", () => {
  const voters = ["a", "b", "c"], faults = ["x", "y", "z"];
  const subset = (mask: number, values: string[]) => values.filter((_, i) => (mask & (1 << i)) !== 0);
  let checked = 0;
  for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) for (let c = 1; c < 8; c++) {
    const exposures = [a, b, c];
    for (let rule = 1; rule < 128; rule++) {
      const coalitions = Array.from({ length: 7 }, (_, i) => i + 1).filter((_, i) => (rule & (1 << i)) !== 0);
      let oracle = 4;
      for (let mask = 1; mask < 8; mask++) {
        let corrupt = 0;
        exposures.forEach((e, i) => { if ((e & mask) !== 0) corrupt |= 1 << i; });
        if (coalitions.some(coalition => (coalition & corrupt) === coalition)) oracle = Math.min(oracle, subset(mask, faults).length);
      }
      const result = computeStructuralCut({ verifierSet: voters,
        faultBasis: faults.map(id => ({ id, category: "OTHER", description: id })),
        exposureMap: Object.fromEntries(voters.map((v, i) => [v, subset(exposures[i]!, faults)])),
        coalitionPolicy: { type: "EXPLICIT", coalitions: coalitions.map(mask => subset(mask, voters)) } });
      if (result.kappaE !== oracle) throw new Error(JSON.stringify({ exposures, rule, oracle, result }));
      checked++;
    }
  }
  expect(checked).toBe(43561);
}, 15000);

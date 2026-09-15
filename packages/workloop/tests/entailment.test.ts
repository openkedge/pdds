import { expect, it } from "vitest";
import { postgresFailoverPolicyProfile } from "@cac/policy";
import { evaluateReceiptEntailment } from "../src/entailment.js";

it("honors policy thresholds and never substitutes a generic passed flag", () => {
  const rule = postgresFailoverPolicyProfile.obligationRules[0]!;
  const receipt = (claim: Record<string, unknown>) => ({ claim });
  expect(evaluateReceiptEntailment(receipt({ replicationLagBytes: 1 }), { ...rule, predicate: "replication_lag_bytes <= 0" })).toBe("ENTAILED_NEGATIVE");
  expect(evaluateReceiptEntailment(receipt({ passed: true }), rule)).toBe("INCONCLUSIVE");
  expect(evaluateReceiptEntailment(receipt({ replicationLagBytes: NaN }), rule)).toBe("INCONCLUSIVE");
  expect(evaluateReceiptEntailment(receipt({ replicationLagBytes: 0 }), { ...rule, predicate: "doSomething()" })).toBe("INCONCLUSIVE");
});
it("requires every positive conjunct while allowing explicit counterevidence", () => {
  const rule = postgresFailoverPolicyProfile.obligationRules[1]!;
  expect(evaluateReceiptEntailment({ claim: { isInRecovery: true } }, rule)).toBe("INCONCLUSIVE");
  expect(evaluateReceiptEntailment({ claim: { isInRecovery: false } }, rule)).toBe("ENTAILED_NEGATIVE");
});

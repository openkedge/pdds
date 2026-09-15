import type { AssuranceObligation, EvidenceReceipt } from "@cac/schemas";

export type EntailmentResult = "ENTAILED_POSITIVE" | "ENTAILED_NEGATIVE" | "INCONCLUSIVE";
const aliases: Record<string, string[]> = {
  replication_lag_bytes: ["replicationLagBytes"], is_in_recovery: ["isInRecovery"],
  valid_rollback_snapshot: ["validRollbackSnapshot", "valid_rollback"],
  human_approval: ["approved"], human_sre_dual_authorization: ["approved", "human_approval"],
};

/** Total bounded conjunction language: field op literal. Unknown syntax/fields fail closed. */
export function evaluateReceiptEntailment(receipt: Pick<EvidenceReceipt, "claim">, obligation: AssuranceObligation): EntailmentResult {
  if (obligation.predicate.length > 4096) return "INCONCLUSIVE";
  let missing = false, negative = false;
  for (const clause of obligation.predicate.split(/\s*&&\s*/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(true|false|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")\s*$/.exec(clause);
    if (!match) return "INCONCLUSIVE";
    const field = match[1]!, op = match[2]!, literal = match[3]!;
    const key = [field, ...(aliases[field] ?? [])].find(k => Object.hasOwn(receipt.claim, k));
    let value = key ? receipt.claim[key] : undefined;
    if (field === "unreachable" && value === undefined && typeof receipt.claim.reachable === "boolean") value = !receipt.claim.reachable;
    const expected = literal === "true" ? true : literal === "false" ? false : /^["']/.test(literal) ? literal.slice(1, -1) : Number(literal);
    if (value === undefined || typeof value !== typeof expected || (typeof value === "number" && !Number.isFinite(value))) { missing = true; continue; }
    let holds: boolean;
    if (op === "==") holds = value === expected;
    else if (op === "!=") holds = value !== expected;
    else if (typeof value === "number" && typeof expected === "number") {
      holds = op === "<=" ? value <= expected : op === ">=" ? value >= expected : op === "<" ? value < expected : value > expected;
    } else return "INCONCLUSIVE";
    negative ||= !holds;
  }
  return negative ? "ENTAILED_NEGATIVE" : missing ? "INCONCLUSIVE" : "ENTAILED_POSITIVE";
}

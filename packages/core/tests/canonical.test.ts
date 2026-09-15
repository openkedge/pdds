import { describe, expect, it } from "vitest";
import { canonicalJson, computeProposalDigest, computeWitnessDigest } from "../src/canonical.js";
import type { ActionProposal, AdmissionWitnessManifest } from "@cac/schemas";

describe("Canonical JSON Serialization", () => {
  it("sorts object keys lexicographically by UTF-16 code units", () => {
    const obj1 = { z: 1, a: 2, m: 3 };
    const obj2 = { a: 2, m: 3, z: 1 };
    expect(canonicalJson(obj1)).toBe('{"a":2,"m":3,"z":1}');
    expect(canonicalJson(obj2)).toBe('{"a":2,"m":3,"z":1}');
    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });

  it("handles nested objects with out-of-order keys", () => {
    const nested1 = { b: { d: 4, c: 3 }, a: 1 };
    const nested2 = { a: 1, b: { c: 3, d: 4 } };
    expect(canonicalJson(nested1)).toBe('{"a":1,"b":{"c":3,"d":4}}');
    expect(canonicalJson(nested1)).toBe(canonicalJson(nested2));
  });

  it("preserves array order while canonicalizing array elements", () => {
    const arr = [{ y: 2, x: 1 }, { b: 2, a: 1 }];
    expect(canonicalJson(arr)).toBe('[{"x":1,"y":2},{"a":1,"b":2}]');
  });

  it("handles negative zero correctly", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  it("throws on NaN and Infinity", () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
  });
});

describe("Domain-Separated Digests", () => {
  it("produces stable and field-order independent ProposalDigest", () => {
    const proposal1: ActionProposal = {
      intent: {
        goal: "restore-primary-availability",
        scope: ["postgres/prod-cluster-a"],
        constraints: ["no-data-loss", "single-primary"],
      },
      action: "FailoverDatabase",
      params: {
        clusterId: "prod-cluster-a",
        candidateStandby: "replica-02",
      },
      scope: ["postgres/prod-cluster-a"],
      principal: "agent:sre-01",
      observedStateVersion: "lsn:0/3000000",
      constraints: {
        maxDataLossBytes: 0,
      },
    };

    const proposal2: ActionProposal = {
      constraints: {
        maxDataLossBytes: 0,
      },
      observedStateVersion: "lsn:0/3000000",
      principal: "agent:sre-01",
      scope: ["postgres/prod-cluster-a"],
      params: {
        candidateStandby: "replica-02",
        clusterId: "prod-cluster-a",
      },
      action: "FailoverDatabase",
      intent: {
        constraints: ["no-data-loss", "single-primary"],
        scope: ["postgres/prod-cluster-a"],
        goal: "restore-primary-availability",
      },
    };

    const digest1 = computeProposalDigest(proposal1);
    const digest2 = computeProposalDigest(proposal2);
    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);
  });

  it("produces stable and order-independent WitnessDigest", () => {
    const manifest1: AdmissionWitnessManifest = {
      entries: [
        { obligationId: "omega-1", witnessReceiptIds: ["rec-b", "rec-a"] },
        { obligationId: "omega-2", witnessReceiptIds: ["rec-c"] },
      ],
    };
    const manifest2: AdmissionWitnessManifest = {
      entries: [
        { obligationId: "omega-2", witnessReceiptIds: ["rec-c"] },
        { obligationId: "omega-1", witnessReceiptIds: ["rec-a", "rec-b"] },
      ],
    };

    const digest1 = computeWitnessDigest(manifest1);
    const digest2 = computeWitnessDigest(manifest2);
    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);
  });
});

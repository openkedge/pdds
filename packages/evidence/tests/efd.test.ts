import { describe, it, expect } from "vitest";
import type {
  CoalitionPolicy,
  EfdProfile,
  EpistemicFault,
  ExposureMap,
} from "@cac/schemas";
import {
  computeProfileDigest,
  computeStructuralCut,
  generateDecisiveCoalitions,
  validateEfdProfile,
} from "../src/index.js";

describe("EFD Structural Epistemic Cut Engine", () => {
  const faultBasis: EpistemicFault[] = [
    { id: "f_model", category: "MODEL_ANCESTRY", description: "Shared base model family" },
    { id: "f1", category: "SENSOR_PIPELINE", description: "Telemetry sensor pipeline 1" },
    { id: "f2", category: "SENSOR_PIPELINE", description: "Telemetry sensor pipeline 2" },
    { id: "f3", category: "SOFTWARE_IMPLEMENTATION", description: "Independent software implementation 3" },
    { id: "f_shared", category: "RETRIEVAL_SOURCE", description: "Shared retrieved topology RAG snapshot" },
    { id: "f_independent", category: "NETWORK_DEPENDENCY", description: "Canary network active probe path" },
  ];

  it("Case A: Fully shared fault results in nominal quorum = 3 but kappa_E = 1", () => {
    const verifiers = ["v1", "v2", "v3"];
    const exposureMap: ExposureMap = {
      v1: ["f_model"],
      v2: ["f_model"],
      v3: ["f_model"],
    };
    const coalitionPolicy: CoalitionPolicy = { type: "K_OF_N", k: 2, n: 3 };

    const result = computeStructuralCut({
      verifierSet: verifiers,
      faultBasis,
      exposureMap,
      coalitionPolicy,
    });

    expect(result.witnessSources.length).toBe(3); // Nominal quorum = 3
    expect(result.kappaE).toBe(1); // Structural cut kappa_E = 1
    expect(result.minimumFaultCuts).toEqual([["f_model"]]);
    expect(result.decisiveCoalitionsAnalyzed).toBe(3); // {v1,v2}, {v1,v3}, {v2,v3}
  });

  it("Case B: Distinct fault paths under 2-of-2 AND decisive coalition produce kappa_E = 2", () => {
    const verifiers = ["v1", "v2"];
    const exposureMap: ExposureMap = {
      v1: ["f1"],
      v2: ["f2"],
    };
    const coalitionPolicy: CoalitionPolicy = { type: "ALL_OF" };

    const result = computeStructuralCut({
      verifierSet: verifiers,
      faultBasis,
      exposureMap,
      coalitionPolicy,
    });

    expect(result.kappaE).toBe(2);
    expect(result.minimumFaultCuts.length).toBe(1);
    expect(result.minimumFaultCuts[0]?.sort()).toEqual(["f1", "f2"]);
  });

  it("Case C: Majority 2-of-3 where two verifiers share a fault yields kappa_E = 1", () => {
    const verifiers = ["v1", "v2", "v3"];
    const exposureMap: ExposureMap = {
      v1: ["f_shared"],
      v2: ["f_shared"],
      v3: ["f_independent"],
    };
    const coalitionPolicy: CoalitionPolicy = { type: "K_OF_N", k: 2, n: 3 };

    const result = computeStructuralCut({
      verifierSet: verifiers,
      faultBasis,
      exposureMap,
      coalitionPolicy,
    });

    // Decisive coalition {v1, v2} is completely compromised by single fault {f_shared}
    expect(result.kappaE).toBe(1);
    expect(result.minimumFaultCuts).toEqual([["f_shared"]]);
  });

  it("Case D: Overlapping exposure graph exact minimum cut computation", () => {
    // v1: {f1, f2}, v2: {f2, f3}, v3: {f1, f3}
    // Coalition: ALL_OF (all 3 verifiers)
    // To hit {f1, f2}, {f2, f3}, {f1, f3}:
    // Picking any 1 fault (e.g. f1) hits v1 and v3, but misses v2!
    // Picking {f1, f2} hits all 3. Picking {f2, f3} hits all 3. Picking {f1, f3} hits all 3.
    // Minimum cut size is 2.
    const verifiers = ["v1", "v2", "v3"];
    const exposureMap: ExposureMap = {
      v1: ["f1", "f2"],
      v2: ["f2", "f3"],
      v3: ["f1", "f3"],
    };
    const coalitionPolicy: CoalitionPolicy = { type: "ALL_OF" };

    const result = computeStructuralCut({
      verifierSet: verifiers,
      faultBasis,
      exposureMap,
      coalitionPolicy,
    });

    expect(result.kappaE).toBe(2);
    expect(result.minimumFaultCuts.length).toBe(3); // [f1, f2], [f1, f3], [f2, f3]
  });

  it("Case E: Empty or invalid inputs fail closed", () => {
    const resultEmpty = computeStructuralCut({
      verifierSet: [],
      faultBasis,
      exposureMap: {},
      coalitionPolicy: { type: "ALL_OF" },
    });
    expect(resultEmpty.kappaE).toBe(0);
    expect(resultEmpty.minimumFaultCuts).toEqual([]);
  });

  it("Decisive coalition semantics: correctly generates ALL_OF, K_OF_N, and EXPLICIT families", () => {
    const v = ["v1", "v2", "v3"];
    const allOf = generateDecisiveCoalitions(v, { type: "ALL_OF" });
    expect(allOf).toEqual([["v1", "v2", "v3"]]);

    const kOfN = generateDecisiveCoalitions(v, { type: "K_OF_N", k: 2, n: 3 });
    expect(kOfN).toEqual([
      ["v1", "v2"],
      ["v1", "v3"],
      ["v2", "v3"],
    ]);

    const explicit = generateDecisiveCoalitions(v, {
      type: "EXPLICIT",
      coalitions: [["v1", "v3"]],
    });
    expect(explicit).toEqual([["v1", "v3"]]);
  });

  it("EfdProfile validation: validates authentic profiles and rejects dangling exposures or malformed policies", () => {
    const validProfile: EfdProfile = {
      profileId: "network-reachability-v1",
      version: "1.0.0",
      policyEpoch: "epoch-2026-q3",
      faultBasis,
      verifierDescriptors: [
        { id: "verifier-formal", evidenceSourceId: "solver-z3", exposures: ["f1"] },
        { id: "verifier-canary", evidenceSourceId: "probe-canary", exposures: ["f_independent"] },
      ],
      coalitionPolicy: { type: "ALL_OF" },
      signature: "insecure-dev-signature",
    };

    validProfile.digest = computeProfileDigest(validProfile);

    const validation = validateEfdProfile(validProfile);
    expect(validation.reason).toBeUndefined();
    expect(validation.valid).toBe(true);

    // 1. Dangling exposure test
    const danglingProfile: EfdProfile = {
      ...validProfile,
      verifierDescriptors: [
        { id: "v-bad", evidenceSourceId: "src", exposures: ["f_nonexistent_123"] },
      ],
    };
    expect(validateEfdProfile(danglingProfile).valid).toBe(false);

    // 2. Duplicate verifier ID
    const duplicateProfile: EfdProfile = {
      ...validProfile,
      verifierDescriptors: [
        { id: "v1", evidenceSourceId: "src1", exposures: ["f1"] },
        { id: "v1", evidenceSourceId: "src2", exposures: ["f2"] },
      ],
    };
    expect(validateEfdProfile(duplicateProfile).valid).toBe(false);

    // 3. Digest mismatch
    const badDigestProfile: EfdProfile = {
      ...validProfile,
      digest: "tampered-digest-00000000000000000000000000000000000000000000000000000000",
    };
    expect(validateEfdProfile(badDigestProfile).valid).toBe(false);
  });
});

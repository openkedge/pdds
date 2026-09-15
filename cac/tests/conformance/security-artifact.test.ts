import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { canonicalJson } from "@cac/core";
import { computeStructuralCut } from "@cac/evidence";

describe("Reproducibility Artifact Conformance & Integrity", () => {
  it("contract file exists and matches frozen study contract", () => {
    const rootContractPath = path.resolve(process.cwd(), "study-contract.json");
    const artifactContractPath = path.resolve(process.cwd(), "artifact", "STUDY-CONTRACT.json");

    expect(fs.existsSync(rootContractPath)).toBe(true);
    expect(fs.existsSync(artifactContractPath)).toBe(true);

    const rootData = JSON.parse(fs.readFileSync(rootContractPath, "utf8"));
    const artifactData = JSON.parse(fs.readFileSync(artifactContractPath, "utf8"));

    expect(rootData.overallDigest).toBeDefined();
    expect(artifactData.overallDigest).toBe(rootData.overallDigest);
  });

  it("golden test vectors validate perfectly against core and evidence algorithms", () => {
    const goldenPath = path.resolve(process.cwd(), "artifact", "golden-vectors.json");
    expect(fs.existsSync(goldenPath)).toBe(true);

    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

    // 1. Canonical JSON vector
    const cJson = canonicalJson(golden.vectors.canonicalJson.input);
    expect(cJson).toBe(golden.vectors.canonicalJson.expectedSerialized);
    const hash = crypto.createHash("sha256").update(cJson).digest("hex");
    expect(hash).toBe(golden.vectors.canonicalJson.sha256);

    // 2. Structural Cut vector
    const faultBasis = [
      { id: "fault-domain-etcd-primary", category: "OTHER" as const, description: "control_plane" },
      { id: "fault-domain-switch-rack1", category: "NETWORK_DEPENDENCY" as const, description: "rack switch" },
      { id: "fault-domain-switch-rack2", category: "NETWORK_DEPENDENCY" as const, description: "rack switch" },
      { id: "fault-domain-switch-rack3", category: "NETWORK_DEPENDENCY" as const, description: "rack switch" },
    ];
    const coalitionPolicy = { type: "K_OF_N" as const, k: 2, n: 3 };

    const cut = computeStructuralCut({
      verifierSet: golden.vectors.efdCut.nodes,
      faultBasis,
      exposureMap: golden.vectors.efdCut.exposureMap,
      coalitionPolicy,
    });
    expect(cut.kappaE).toBe(1);
    expect(cut.minimumFaultCuts[0]).toContain(golden.vectors.efdCut.minimumCutFaultDomain);
  });

  it("all artifacts in results/final-lock.json exist and match cryptographic hashes", () => {
    const lockPath = path.resolve(process.cwd(), "results", "final-lock.json");
    expect(fs.existsSync(lockPath)).toBe(true);

    const lock: Record<string, string> = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const keys = Object.keys(lock);
    expect(keys.length).toBeGreaterThanOrEqual(30);

    for (const [relPath, expectedSha256] of Object.entries(lock)) {
      const absPath = path.resolve(process.cwd(), relPath);
      expect(fs.existsSync(absPath), `Expected file to exist: ${relPath}`).toBe(true);

      const content = fs.readFileSync(absPath);
      const actualSha256 = crypto.createHash("sha256").update(content).digest("hex");
      expect(actualSha256).toBe(expectedSha256);
    }
  });
});

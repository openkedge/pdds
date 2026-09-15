import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Core Purity Verification (Architectural Boundary Integrity)", () => {
  const corePackageDirs = [
    path.resolve(__dirname, "../../packages/core/src"),
    path.resolve(__dirname, "../../packages/evidence/src"),
    path.resolve(__dirname, "../../packages/certificate/src"),
    path.resolve(__dirname, "../../packages/gateway/src"),
    path.resolve(__dirname, "../../packages/workloop/src"),
  ];

  const forbiddenImportPatterns = [
    /from\s+["']pg["']/,
    /from\s+["']@kubernetes\/client-node["']/,
    /from\s+["']@cac\/adapter-postgres["']/,
    /from\s+["']@cac\/adapter-kubernetes["']/,
    /from\s+["']@cac\/bench["']/,
    /require\(["']pg["']\)/,
    /require\(["']@kubernetes\/client-node["']\)/,
    /require\(["']@cac\/adapter-postgres["']\)/,
    /require\(["']@cac\/adapter-kubernetes["']\)/,
    /require\(["']@cac\/bench["']\)/,
  ];

  function getTsFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it("Core packages must NEVER import pg, kubernetes, adapters, or benchmark packages", () => {
    const violations: Array<{ file: string; pattern: string }> = [];

    for (const coreDir of corePackageDirs) {
      const tsFiles = getTsFiles(coreDir);
      expect(tsFiles.length).toBeGreaterThan(0);

      for (const file of tsFiles) {
        const content = fs.readFileSync(file, "utf8");
        for (const pattern of forbiddenImportPatterns) {
          if (pattern.test(content)) {
            violations.push({
              file: path.relative(path.resolve(__dirname, "../.."), file),
              pattern: pattern.toString(),
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

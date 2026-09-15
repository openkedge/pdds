import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cac/schemas": path.resolve(__dirname, "packages/schemas/src/index.ts"),
      "@cac/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@cac/policy": path.resolve(__dirname, "packages/policy/src/index.ts"),
      "@cac/evidence": path.resolve(__dirname, "packages/evidence/src/index.ts"),
      "@cac/workloop": path.resolve(__dirname, "packages/workloop/src/index.ts"),
      "@cac/certificate": path.resolve(__dirname, "packages/certificate/src/index.ts"),
      "@cac/gateway": path.resolve(__dirname, "packages/gateway/src/index.ts"),
      "@cac/adapter-postgres": path.resolve(__dirname, "packages/adapters/postgres/src/index.ts"),
      "@cac/adapter-kubernetes": path.resolve(__dirname, "packages/adapters/kubernetes/src/index.ts"),
      "@cac/bench": path.resolve(__dirname, "packages/bench/cacbench/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/*/tests/**/*.test.ts",
      "packages/adapters/*/tests/**/*.test.ts",
      "packages/bench/*/tests/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});

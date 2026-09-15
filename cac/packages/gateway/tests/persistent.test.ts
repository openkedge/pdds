import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { FileCapabilityStore } from "../src/capabilityStore.js";

it("persists one consumption across competing processes and process restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cac-replay-test-"));
  try {
    const modulePath = new URL("../src/capabilityStore.ts", import.meta.url).href;
    const program = `import { FileCapabilityStore } from ${JSON.stringify(modulePath)}; const s = new FileCapabilityStore(process.argv[1]); console.log(await s.consumeOnce("shared"));`;
    const results = await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", program, dir])));
    expect(results.filter(r => r.stdout.trim() === "true")).toHaveLength(1);
    const restarted = new FileCapabilityStore(dir);
    expect(await restarted.isUnused("shared")).toBe(false);
    expect(await restarted.consumeOnce("shared")).toBe(false);
    expect(await restarted.consumeOnce("different")).toBe(true);
    await expect(restarted.reset()).rejects.toThrow(/cannot be reset/);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 15000);

#!/usr/bin/env node
import { runFullBenchmarkAndExport } from "@cac/bench";

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "suite";

  if (cmd === "suite" || cmd === "run") {
    await runFullBenchmarkAndExport();
  } else {
    console.log(`Unknown command '${cmd}'. Usage: cacbench [suite|run]`);
  }
}

main().catch((err) => {
  console.error("cacbench failed:", err);
  process.exit(1);
});

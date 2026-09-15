#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "CAC v0.4 Full Powered Study & Analysis Pipeline"
echo "Reproducing 4,320+ trials, 20,000 microbench iterations,"
echo "and re-generating publication tables, figures, and locks."
echo "=========================================================="

N_SEEDS=${1:-30}

echo "Step 1: Running powered trials (N=${N_SEEDS} seeds per scenario)..."
pnpm study

echo "Step 2: Running statistical analysis and report generation..."
pnpm analyze

echo "Step 3: Verifying final lockfile against generated artifacts..."
node --input-type=module -e '
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

const lock = JSON.parse(fs.readFileSync("results/final-lock.json", "utf8"));
let mismatches = 0;
for (const [relPath, expectedHash] of Object.entries(lock)) {
  if (!fs.existsSync(relPath)) {
    console.error(`Missing file: ${relPath}`);
    mismatches++;
    continue;
  }
  const content = fs.readFileSync(relPath);
  const actualHash = crypto.createHash("sha256").update(content).digest("hex");
  if (actualHash !== expectedHash) {
    console.error(`Hash mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}`);
    mismatches++;
  }
}
if (mismatches > 0) {
  console.error(`Lock verification failed with ${mismatches} mismatches.`);
  process.exit(1);
} else {
  console.log(`✓ All ${Object.keys(lock).length} artifact digests matched final-lock.json!`);
}
'

echo "=========================================================="
echo "CAC v0.4 FULL STUDY REPRODUCTION COMPLETE & VERIFIED!"
echo "=========================================================="

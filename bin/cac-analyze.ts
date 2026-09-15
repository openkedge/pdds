#!/usr/bin/env node
import { runComprehensiveAnalysis } from "@cac/bench";

function main() {
  console.log("Running CAC v0.4 Statistical Analysis & Artifact Generator...");
  const result = runComprehensiveAnalysis();
  console.log(`\nAnalysis complete! Processed ${result.aggregateSummaries.length} controllers.`);
  console.log(`Hypotheses evaluated:`);
  for (const h of result.hypotheses) {
    console.log(`  - [${h.hypothesisId}] ${h.name}: ${h.verdict} (p=${h.adjustedPValue}, RD=${h.riskDifference})`);
  }
}

try {
  main();
} catch (err) {
  console.error("Analysis execution failed:", err);
  process.exit(1);
}

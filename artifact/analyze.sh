#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "=== CAC Study Artifact Analysis ==="
echo "Regenerating all tables, statistical hypotheses, and publication figures from frozen raw data..."

pnpm run analyze

echo "Verification: checking generated files..."
test -f results/table3-main-results.csv
test -f results/table3.csv
test -f results/table-h1a.csv
test -f results/table-overhead.csv
test -f tables/table3.tex
test -f tables/hypotheses.tex
test -f tables/overhead-table.tex
test -f tables/boundary-table.tex
test -f results/final-lock.json

echo "=== Analysis successfully completed and verified! ==="

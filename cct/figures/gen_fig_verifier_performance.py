"""Regenerate publication figures and the report from frozen benchmark results."""

import argparse
from pathlib import Path

from cctbench.eval.performance_report import plot_results, write_report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, default=Path("results/performance"))
    parser.add_argument(
        "--report", type=Path, default=Path("docs/verifier-performance.md")
    )
    args = parser.parse_args()
    plot_results(args.results)
    write_report(args.results, args.report)

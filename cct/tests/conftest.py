"""Reproducible Hypothesis profiles and a report populated by executed assertions."""

import hashlib
import json
import os
from collections import Counter
from pathlib import Path

import pytest
from hypothesis import settings

from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S

settings.register_profile(
    "security-ci", max_examples=32, deadline=None, derandomize=True, database=None
)
settings.register_profile(
    "security-fuzz", max_examples=250, deadline=None, print_blob=True
)
settings.load_profile(os.getenv("CCT_HYPOTHESIS_PROFILE", "security-ci"))


def pytest_addoption(parser):
    parser.addoption(
        "--soundness-report",
        help="Write the executed security/conformance table to this Markdown path",
    )


def pytest_configure(config):
    config._soundness_rows = Counter()


@pytest.fixture(scope="session")
def soundness(pytestconfig):
    """No mutation survives across examples: this fixture only accumulates observations."""

    def record(name, report, expected, verdict, *, only=False):
        # Required evidence absence can never be the sole reason for INVALID.
        statuses = {entry.status for entry in report.trace if not entry.disabled}
        if report.result == R.INVALID:
            assert S.FAIL in statuses
        if report.result == R.INDETERMINATE:
            assert S.UNKNOWN in statuses and S.FAIL not in statuses
        if report.result == R.VALID:
            assert statuses == {S.PASS}
        if only:
            actual_nonpass = {
                k for k, v in report.condition_results.items() if v.status != S.PASS
            }
            assert actual_nonpass == {k for k, v in expected.items() if v != S.PASS}, (
                report.reasons
            )
        for target, status in expected.items():
            observed = (
                report.condition_results[target].status
                if target in report.condition_results
                else report.checker_results[target]
            )
            key = (name, target, S(status).value, observed.value, report.result.value)
            pytestconfig._soundness_rows[key] += 1
            assert observed == status, (name, target, report.reasons)
        assert report.result == verdict, (name, report.reasons)

    return record


def pytest_sessionfinish(session, exitstatus):
    destination = session.config.getoption("--soundness-report")
    if not destination:
        return
    rows = session.config._soundness_rows
    if not rows and exitstatus == 0:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED
    root = Path(__file__).resolve().parents[1]
    paths = sorted((root / "src").rglob("*.py")) + sorted(
        (root / "tests").rglob("*.py")
    )
    paths += [
        root / name
        for name in [
            "pyproject.toml",
            "requirements.lock",
            "Makefile",
            ".github/workflows/security-conformance.yml",
        ]
    ]
    source_files = {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in paths
        if p.exists()
    }
    source_digest = hashlib.sha256(
        json.dumps(source_files, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    lines = [
        "# CCT formal security and conformance regression table",
        "",
        f"Suite status: **{'PASS' if session.exitstatus == 0 else 'FAILED / INCOMPLETE'}**. "
        f"Hypothesis profile: `{settings.get_current_profile_name()}`; "
        f"at most {settings.default.max_examples} examples per property/parameter case.",
        f"Source manifest SHA-256: `{source_digest}` (Python source/tests, dependency freeze, Makefile and CI workflow).",
        "",
        "Generated from verifier reports observed during executed assertions. Execution counts include "
        "Hypothesis examples/replays, not independent real-world experiments. This table is a regression "
        "audit, not a cryptographic security proof or an empirical accuracy estimate.",
        "",
        "Set-valued validation/signer permutations preserve digests and valid receipts. Adding, removing "
        "or changing their members changes the committed object. Removing a required attestation from "
        "a freshly committed core is missing evidence (UNKNOWN); removing it underneath an old receipt "
        "also creates an affirmative core-binding contradiction (FAIL).",
        "",
        "| Test | Target invariant / condition | Expected checker | Observed checker | Final verdict | Executions |",
        "| --- | --- | --- | --- | --- | ---: |",
    ]
    for (name, target, expected, observed, verdict), count in sorted(rows.items()):
        lines.append(
            f"| {name} | {target} | {expected} | {observed} | {verdict} | {count} |"
        )
    lines += [
        "",
        "Reproduce: `make security-test`. More randomized examples: "
        "`CCT_HYPOTHESIS_PROFILE=security-fuzz make security-test`.",
        "",
    ]
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))

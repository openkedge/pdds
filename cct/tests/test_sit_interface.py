"""Unavailable is distinct from a simulated SIT prediction; optional native smoke test."""

import json
import os
import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest

from cctbench.canonicalize import compute_digest
from cctbench.crypto import unsigned
from cctbench.eval.sit import SITAdapter, source_digest
from cctbench.generator.base import create_identity
from cctbench.generator.families import generate_fixture


def test_unconfigured_sit_has_no_prediction():
    result = SITAdapter().evaluate(generate_fixture(create_identity(), "I7"))
    assert (
        result.status == "unavailable"
        and result.prediction is None
        and result.score is None
    )


def test_sit_rejects_partial_configuration():
    with pytest.raises(ValueError, match="Incomplete frozen"):
        SITAdapter({"candidate_model": "not-a-complete-freeze"})


@pytest.mark.skipif(
    not os.getenv("CCTBENCH_SITBENCH_SOURCE"),
    reason="Optional native SITBench checkout not configured",
)
def test_native_sit_scoring_and_candidate_boundary(tmp_path, monkeypatch):
    root = Path(os.environ["CCTBENCH_SITBENCH_SOURCE"]).resolve()
    fixture = generate_fixture(create_identity(), "L8")
    reference_key = compute_digest(
        unsigned(fixture.verification_context.reference_history), "SIT-REFERENCE"
    )
    mapping = {
        reference_key: {
            "template_version": "boundary-test-v1",
            "registry": {},
            "probes": [
                {
                    "query": {
                        "query_epoch": "epoch-4",
                        "query": "Can you answer this question?",
                    },
                    "contract": {
                        "required_acts": ["ANSWER"],
                        "forbidden_acts": ["ABSTAIN"],
                    },
                    "checkpoint_metadata": {},
                }
            ],
        }
    }
    path = tmp_path / "probes.json"
    path.write_text(json.dumps(mapping))
    # Native versions are obtained from the frozen source, not fabricated experiment metadata.
    import ast

    def class_version(relative, class_name):
        tree = ast.parse((root / relative).read_text())
        cls = next(
            n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name
        )
        assignment = next(
            n
            for n in cls.body
            if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "VERSION" for t in n.targets)
        )
        return ast.literal_eval(assignment.value)

    extractor_version = class_version(
        "src/sitbench/verifier/extractor.py", "DeterministicSemanticExtractor"
    )
    scorer_version = class_version(
        "src/sitbench/verifier/deterministic_scorer.py", "DeterministicContractScorer"
    )
    judge = {"extractor_version": extractor_version, "scoring": "all-seven-factors"}
    config = {
        "sitbench_source": str(root),
        "sitbench_source_digest": source_digest(root),
        "sitbench_version": tomllib.loads((root / "pyproject.toml").read_text())[
            "project"
        ]["version"],
        "probe_template_version": "boundary-test-v1",
        "probe_bundle": str(path),
        "probe_bundle_digest": compute_digest(mapping, "SIT-PROBES"),
        "candidate_model": "unit-test-process-double",
        "candidate_version": "unit-test-v1",
        "candidate_command": ["unit-test-double"],
        "judge_model": "sitbench.verifier.deterministic_scorer.DeterministicContractScorer",
        "judge_version": scorer_version,
        "judge_configuration": judge,
        "judge_config_digest": compute_digest(judge, "SIT-JUDGE-CONFIG"),
        "temperature": 0,
        "seed": 0,
        "pass_threshold": 1,
        "timeout_seconds": 10,
    }
    adapter = SITAdapter(config)
    assert adapter.unavailable_reason is None
    response_text = "Yes, I can answer."
    requests = []

    def candidate_double(argv, **kwargs):
        request = json.loads(kwargs["input"])
        requests.append(request)
        assert set(request) == {
            "candidate_state",
            "query",
            "model",
            "model_version",
            "temperature",
            "seed",
        }
        return SimpleNamespace(
            stdout=json.dumps(
                {
                    "text": response_text,
                    "model": config["candidate_model"],
                    "model_version": config["candidate_version"],
                }
            )
        )

    monkeypatch.setattr("cctbench.eval.sit.subprocess.run", candidate_double)
    assert adapter.evaluate(fixture).prediction == "VALID"
    response_text = "I do not know."
    assert adapter.evaluate(fixture).prediction == "INVALID"
    assert len(requests) == 2
    fixture.verification_context.reference_history.signature = "ed25519:00"
    assert adapter.evaluate(fixture).status == "unavailable"
    assert len(requests) == 2
    bad = dict(config, judge_config_digest=compute_digest("different"))
    with pytest.raises(ValueError, match="judge configuration digest"):
        SITAdapter(bad)

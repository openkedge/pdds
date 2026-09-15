"""Optional integration with frozen SITBench extraction/scoring and a real candidate command.

No family-name or ground-truth shortcuts. Without configuration Arm C is unavailable.
The model command consumes JSON on stdin and returns {"text": ...}; shell expansion is never used.
"""

import hashlib
import importlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path

from cctbench.canonicalize import compute_digest, strict_json_loads
from cctbench.crypto import unsigned, verify_signature
from cctbench.eval.baselines import ArmOutcome
from cctbench.schema.enums import CheckStatus

REQUIRED = {
    "sitbench_source",
    "sitbench_source_digest",
    "sitbench_version",
    "probe_template_version",
    "probe_bundle",
    "probe_bundle_digest",
    "candidate_model",
    "candidate_version",
    "candidate_command",
    "judge_model",
    "judge_version",
    "judge_configuration",
    "judge_config_digest",
    "temperature",
    "seed",
    "pass_threshold",
    "timeout_seconds",
}


def source_digest(path):
    root = Path(path)
    paths = sorted((root / "src" / "sitbench").rglob("*.py")) + [
        root / "pyproject.toml"
    ]
    return compute_digest(
        {
            str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in paths
        },
        "SITBENCH-SOURCE",
    )


class SITAdapter:
    def __init__(self, configuration=None):
        self.config = None
        self.bundles = {}
        self.unavailable_reason = "No frozen SIT model/probe configuration supplied"
        if configuration is None:
            return
        self.config = dict(configuration)
        missing = REQUIRED - self.config.keys()
        if missing:
            raise ValueError(f"Incomplete frozen SIT configuration: {sorted(missing)}")
        if not 0 <= self.config["pass_threshold"] <= 1:
            raise ValueError("Invalid SIT pass threshold")
        if (
            not isinstance(self.config["candidate_command"], list)
            or not self.config["candidate_command"]
            or not all(isinstance(v, str) for v in self.config["candidate_command"])
        ):
            raise ValueError("SIT candidate_command must be a nonempty argv array")
        if self.config["timeout_seconds"] <= 0 or self.config["temperature"] < 0:
            raise ValueError("Invalid SIT timeout or temperature")
        if (
            compute_digest(self.config["judge_configuration"], "SIT-JUDGE-CONFIG")
            != self.config["judge_config_digest"]
        ):
            raise ValueError("Frozen judge configuration digest mismatch")
        root = Path(self.config["sitbench_source"]).expanduser().resolve()
        if not (root / "src" / "sitbench").exists():
            self.unavailable_reason = "Configured SITBench source unavailable"
            return
        if source_digest(root) != self.config["sitbench_source_digest"]:
            raise ValueError("SITBench source changed after configuration freeze")
        if (
            tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"]
            != self.config["sitbench_version"]
        ):
            raise ValueError("Frozen SITBench package version mismatch")
        bundle_path = Path(self.config["probe_bundle"]).expanduser()
        if not bundle_path.exists():
            self.unavailable_reason = "Frozen SIT probe bundle unavailable"
            return
        data = strict_json_loads(bundle_path.read_text())
        if compute_digest(data, "SIT-PROBES") != self.config["probe_bundle_digest"]:
            raise ValueError("SIT probe bundle digest mismatch")
        self.bundles = data
        if not isinstance(data, dict) or any(
            not isinstance(bundle, dict)
            or bundle.get("template_version") != self.config["probe_template_version"]
            for bundle in data.values()
        ):
            raise ValueError("Frozen probe template version mismatch")
        sys.path.insert(0, str(root / "src"))
        try:
            self.extractor_module = importlib.import_module(
                "sitbench.verifier.extractor"
            )
            self.scorer_module = importlib.import_module(
                "sitbench.verifier.deterministic_scorer"
            )
            self.query_class = importlib.import_module(
                "sitbench.schema.probe"
            ).InterrogationQuery
            self.registry_class = importlib.import_module(
                "sitbench.schema.proposition"
            ).PropositionRegistry
            self.contract_class = importlib.import_module(
                "sitbench.schema.contract"
            ).ResponseContract
        except ImportError as error:
            self.unavailable_reason = f"SITBench dependency unavailable: {error.name}"
            return
        finally:
            sys.path.remove(str(root / "src"))
        if any(
            not Path(module.__file__).resolve().is_relative_to(root / "src")
            for name, module in sys.modules.items()
            if name.startswith("sitbench.") and getattr(module, "__file__", None)
        ):
            raise ValueError(
                "Imported SITBench module is outside the frozen source tree"
            )
        self.extractor = self.extractor_module.DeterministicSemanticExtractor()
        self.scorer = self.scorer_module.DeterministicContractScorer()
        if self.config["judge_version"] != self.scorer.VERSION:
            raise ValueError(
                "Frozen judge version differs from installed SITBench scorer"
            )
        if (
            self.config["judge_model"]
            != "sitbench.verifier.deterministic_scorer.DeterministicContractScorer"
        ):
            raise ValueError(
                "This adapter uses the native SITBench deterministic judge"
            )
        if self.config["judge_configuration"] != {
            "extractor_version": self.extractor.VERSION,
            "scoring": "all-seven-factors",
        }:
            raise ValueError("Frozen extractor or scoring configuration mismatch")
        self.unavailable_reason = None

    def manifest(self):
        if self.config is None:
            return {
                "status": "unavailable",
                "reason": self.unavailable_reason,
                "integration": "SITBench native extractor/scorer adapter supplied; external candidate and frozen probe mapping required",
            }
        return {
            "status": "unavailable" if self.unavailable_reason else "configured",
            "reason": self.unavailable_reason,
            "configuration": self.config,
            "configuration_digest": compute_digest(self.config, "SIT-CONFIG"),
            "probe_counts": {k: len(v["probes"]) for k, v in self.bundles.items()},
        }

    def evaluate(self, fixture):
        if self.unavailable_reason:
            return ArmOutcome(None, "unavailable", self.unavailable_reason)
        ctx = fixture.verification_context
        ref = ctx.reference_history
        if (
            ref is None
            or ref.identity_id != ctx.identity_id
            or ref.epoch != ctx.epoch + 1
            or ref.kernel_id not in ctx.kernel_ids
        ):
            return ArmOutcome(
                None, "unavailable", "Authenticated external H* unavailable"
            )
        status, reason = verify_signature(
            "REFERENCE-HISTORY",
            unsigned(ref),
            ref.signature,
            ctx.credentials.get(ref.kernel_id),
            ref.epoch,
            ctx.protocol_version,
        )
        if status != CheckStatus.PASS:
            return ArmOutcome(
                None, "unavailable", "External H* authentication failed: " + reason
            )
        key = compute_digest(unsigned(ref), "SIT-REFERENCE")
        bundle = self.bundles.get(key)
        if not bundle or not bundle.get("probes"):
            return ArmOutcome(
                None, "unavailable", "No frozen SIT probes for this authenticated H*"
            )
        registry = self.registry_class.model_validate(bundle["registry"])
        records = []
        for probe in bundle["probes"]:
            query = self.query_class.model_validate(probe["query"])
            contract = self.contract_class.model_validate(probe["contract"])
            # H*, hidden response contracts, witness, family and oracle label are never sent to the candidate.
            request = {
                "candidate_state": fixture.candidate_successor.model_dump(
                    mode="json", exclude={"state_digest"}
                ),
                "query": query.model_dump(mode="json"),
                "model": self.config["candidate_model"],
                "model_version": self.config["candidate_version"],
                "temperature": self.config["temperature"],
                "seed": self.config["seed"],
            }
            try:
                proc = subprocess.run(
                    self.config["candidate_command"],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                    timeout=self.config["timeout_seconds"],
                    check=True,
                )
                response = strict_json_loads(proc.stdout)
                if (
                    not isinstance(response, dict)
                    or not isinstance(response.get("text"), str)
                    or response.get("is_infrastructure_failure")
                ):
                    raise ValueError(
                        "Candidate did not return an executed text response"
                    )
                if (response.get("model"), response.get("model_version")) != (
                    self.config["candidate_model"],
                    self.config["candidate_version"],
                ):
                    raise ValueError(
                        "Candidate response model does not match the frozen configuration"
                    )
            except (OSError, subprocess.SubprocessError, ValueError) as error:
                return ArmOutcome(
                    None,
                    "unavailable",
                    f"SIT candidate execution failed: {type(error).__name__}",
                )
            universe = self.extractor_module.route_extraction_universe(query, registry)
            extraction = self.extractor.extract(
                response["text"], query, universe, registry.closed_world_scopes
            )
            score = self.scorer.score(
                extraction, contract, probe.get("checkpoint_metadata")
            )
            records.append(
                {
                    "query": query.model_dump(mode="json"),
                    "candidate_output": response["text"],
                    "request_digest": compute_digest(request, "SIT-CANDIDATE-INPUT"),
                    "extraction": extraction.model_dump(mode="json"),
                    "score": score.model_dump(mode="json"),
                }
            )
        value = sum(row["score"]["SValid"] for row in records) / len(records)
        return ArmOutcome(
            "VALID" if value >= self.config["pass_threshold"] else "INVALID",
            score=value,
            diagnostics={
                "reference_digest": key,
                "configuration_digest": compute_digest(self.config, "SIT-CONFIG"),
                "probes": records,
            },
        )

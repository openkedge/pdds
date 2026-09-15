# Optional frozen SITBench integration

Arm C defaults to unavailable, with a reason and null prediction/score. A SITBench checkout alone does not freeze a candidate model/adapter, judge, probe mapping or configuration. No family-name or oracle-driven SIT predictions are supplied.

`src/cctbench/eval/sit.py` integrates SITBench's native DeterministicSemanticExtractor, public route_extraction_universe and DeterministicContractScorer. It runs the native seven-factor deterministic judge, not an LLM judge. A different judge requires a separate frozen adapter.

## Freeze contract

Run `.venv/bin/cctbench benchmark --sit-config /absolute/path/frozen.json` with these fields:

| Field | Meaning |
| --- | --- |
| sitbench_source | Checkout with src/sitbench and pyproject.toml |
| sitbench_source_digest | source_digest(path) from cctbench.eval.sit; hashes source Python and project metadata |
| sitbench_version | Actual version from that checkout's pyproject.toml |
| probe_template_version | Version required in every probe mapping entry |
| probe_bundle | Path to the mapping described below |
| probe_bundle_digest | compute_digest(mapping, "SIT-PROBES") |
| candidate_model, candidate_version | Concrete model and immutable revision identifiers |
| candidate_command | Nonempty argv array; executed without a shell |
| judge_model | sitbench.verifier.deterministic_scorer.DeterministicContractScorer |
| judge_version | Actual native scorer VERSION |
| judge_configuration | Object with extractor_version equal to native extractor VERSION, and scoring equal to all-seven-factors |
| judge_config_digest | compute_digest(judge_configuration, "SIT-JUDGE-CONFIG") |
| temperature, seed | Frozen generation settings |
| pass_threshold | Threshold in [0,1] chosen before held-out evaluation |
| timeout_seconds | Positive per-probe execution timeout |

Source, package, scorer, extractor, judge configuration, probe hash and template versions are validated. Imports from outside the frozen SITBench source tree are rejected. The manifest records configuration, its digest, and probe counts. Keep credentials in the process environment, not recorded configuration/argv. Pin the candidate adapter's source and dependencies with its model revision; returned model identifiers must match the freeze.

## External reference and probes

Generated H* records contain identity, successor epoch, reference history, kernel ID and signature. The adapter verifies identity, epoch, issuer, signature and historical key authorization before inference. The model receives candidate state and query, not H*, hidden contracts, witness, family or label.

The probe file maps `compute_digest(unsigned(reference_history), "SIT-REFERENCE")` to an object with template_version, a native PropositionRegistry, and a nonempty probes list. Each probe has a native InterrogationQuery, a hidden ResponseContract, and optional checkpoint_metadata. For example, the required outer shape is:

```text
{
  REFERENCE_DIGEST: {
    "template_version": FROZEN_VERSION,
    "registry": NATIVE_REGISTRY_OBJECT,
    "probes": [{"query": NATIVE_QUERY, "contract": NATIVE_CONTRACT,
                "checkpoint_metadata": SCOPED_REFERENCE_METADATA}]
  }
}
```

Construct nonvacuous required/prohibited claims, acquisition times, disclosure constraints and closed-world support from authenticated H*. Freeze templates and settings without consulting held-out outcomes. Native schema validation and digest checks do not establish probe adequacy; that remains the experimenter's responsibility. Missing reference mappings make the corresponding fixture unavailable.

## Candidate process

Each inference receives one JSON document on stdin with candidate_state, query, model, model_version, temperature and seed. Perform real inference and return JSON on stdout with text, model and model_version. Returned identifiers must match the frozen configuration. Infrastructure failures, malformed responses, authentication failures, missing probes, timeouts and failed commands produce unavailable execution, not invented scores. Do not implement canned family responses or use evaluator labels/contracts in the candidate process.

Successful traces retain actual candidate output, request digest, native extraction, seven-factor score, reference digest and configuration digest. VALID means the mean observed SValid meets the frozen threshold. This binary arm cannot emit INDETERMINATE; unavailable execution remains separate.

Optional native tests run with `CCTBENCH_SITBENCH_SOURCE=/path/to/sitbench make test`. Their process double checks adapter isolation and real native scoring; unit-test responses never enter benchmark measurements.

"""Five-stage ternary verifier, collecting every independent diagnostic condition."""

from time import perf_counter_ns

from cctbench.canonicalize import compute_state_digest
from cctbench.crypto import SIGNATURE_TIMES
from cctbench.engine.apply import apply_mutations
from cctbench.schema.common import WireModel
from cctbench.schema.enums import CCTResult as R
from cctbench.schema.enums import CheckStatus as S
from cctbench.schema.policy import ContinuityPolicy
from cctbench.verifier.checkers import (
    check_attestation,
    check_authority,
    check_belief_coherence,
    check_historical_chronicle,
    check_normative,
    check_provenance,
    check_relational,
    check_temporal,
    combine,
    lineage_conditions,
)


class ConditionResult(WireModel):
    checker: str
    condition: str
    stage: int
    status: S
    reason: str
    disabled: bool = False


class VerificationReport(WireModel):
    result: R
    checker_results: dict[str, S]
    condition_results: dict[str, ConditionResult]
    decisive_reason: str
    trace: list[ConditionResult]
    stage_results: dict[str, S]
    stage_latency_ns: dict[str, int]
    signature_verification_ns: list[int]
    total_latency_ns: int
    reasons: list[str]
    candidate_digest: str
    predecessor_digest: str


def aggregate(statuses):
    values = list(statuses)
    if S.FAIL in values:
        return R.INVALID
    if S.UNKNOWN in values:
        return R.INDETERMINATE
    return R.VALID


def verify_cognitive_continuity(
    predecessor, witness, candidate, policy=None, context=None, disabled=()
):
    policy = policy or ContinuityPolicy()
    start = perf_counter_ns()
    disabled = set(disabled)
    valid_disabled = {
        "I_lin",
        "I_auth",
        "I_prov",
        "I_hist",
        "I_temp",
        "I_bel",
        "I_rel",
        "I_norm",
        "state_application",
        "attestation_resolution",
    }
    if disabled - valid_disabled:
        raise ValueError(f"Unknown disabled checker: {disabled - valid_disabled}")
    flags = {
        "I_lin": policy.require_lineage,
        "I_auth": policy.require_authority,
        "I_prov": policy.require_provenance,
        "I_hist": policy.require_chronicle,
        "I_temp": policy.require_temporal,
        "I_bel": policy.require_belief,
        "I_rel": policy.require_relational,
        "I_norm": policy.require_normative,
    }
    disabled |= {k for k, enabled in flags.items() if not enabled}
    trace, times, signature_times = [], {}, []
    token = SIGNATURE_TIMES.set(signature_times)
    q = witness.witness_core.proposal if witness else None
    version = (
        witness.witness_version
        if witness
        else (context.protocol_version if context else "1.0.0")
    )

    def emit(checker, condition, stage, fn, extra_disabled=False):
        skip = checker in disabled or extra_disabled
        status, reason = (
            (S.PASS, "Checker disabled by explicit policy/ablation") if skip else fn()
        )
        trace.append(
            ConditionResult(
                checker=checker,
                condition=condition,
                stage=stage,
                status=status,
                reason=reason,
                disabled=skip,
            )
        )

    try:
        t = perf_counter_ns()
        lin = (
            lineage_conditions(predecessor, candidate, witness, policy, context)
            if "I_lin" not in disabled
            else {
                k: (S.PASS, "Disabled")
                for k in [
                    "lineage_binding",
                    "scope",
                    "receipt_binding",
                    "receipt_signature",
                    "canonical_head",
                ]
            }
        )
        for condition, result in lin.items():
            emit("I_lin", condition, 1, lambda result=result: result)
        times["1_lineage"] = perf_counter_ns() - t
        t = perf_counter_ns()
        emit(
            "I_auth",
            "authority",
            2,
            lambda: check_authority(q, predecessor, policy, context, version),
        )
        times["2_authority"] = perf_counter_ns() - t
        t = perf_counter_ns()
        emit(
            "I_prov",
            "provenance",
            3,
            lambda: check_provenance(q, policy, context, version),
        )
        times["3_provenance"] = perf_counter_ns() - t

        def application():
            if q is None:
                return S.UNKNOWN, "Mutation proposal unavailable"
            try:
                applied = apply_mutations(predecessor, q.mutation_manifest)
            except (ValueError, KeyError, StopIteration, TypeError) as error:
                return (
                    S.FAIL,
                    f"Deterministic application rejected mutation: {type(error).__name__}",
                )
            return (
                (S.PASS, "Candidate matches deterministic application")
                if compute_state_digest(applied, version)
                == compute_state_digest(candidate, version)
                else (S.FAIL, "Candidate differs from deterministic application")
            )

        t = perf_counter_ns()
        emit("state_application", "state_application", 4, application)
        times["4_state_application"] = perf_counter_ns() - t
        t = perf_counter_ns()
        checks = {
            "I_hist": lambda: check_historical_chronicle(
                predecessor, candidate, q, policy, context, version
            ),
            "I_temp": lambda: check_temporal(predecessor, candidate, policy, context),
            "I_bel": lambda: check_belief_coherence(predecessor, candidate, q, policy, context),
            "I_rel": lambda: check_relational(predecessor, candidate, policy, q, context),
            "I_norm": lambda: check_normative(predecessor, candidate, policy),
        }
        for name, fn in checks.items():
            if name in policy.required_external_attestations:
                emit(
                    name,
                    "attestation_" + name,
                    5,
                    lambda name=name: check_attestation(name, witness, policy, context),
                    "attestation_resolution" in disabled,
                )
            else:
                emit(name, name, 5, fn)
        times["5_semantics"] = perf_counter_ns() - t
    finally:
        SIGNATURE_TIMES.reset(token)
    result = aggregate(v.status for v in trace)
    decisive = next(
        (v for target in (S.FAIL, S.UNKNOWN) for v in trace if v.status == target), None
    )
    grouped = {
        k: combine((v.status, v.reason) for v in trace if v.checker == k)[0]
        for k in dict.fromkeys(v.checker for v in trace)
    }
    candidate_digest = compute_state_digest(candidate, version)
    predecessor_digest = compute_state_digest(predecessor, version)
    return VerificationReport(
        result=result,
        checker_results=grouped,
        condition_results={v.condition: v for v in trace},
        decisive_reason=f"{decisive.condition}: {decisive.reason}"
        if decisive
        else "All required checks PASS",
        trace=trace,
        stage_results={
            str(i): combine((v.status, v.reason) for v in trace if v.stage == i)[0]
            for i in range(1, 6)
        },
        stage_latency_ns=times,
        signature_verification_ns=signature_times,
        total_latency_ns=perf_counter_ns() - start,
        reasons=[
            f"Stage {v.stage} {v.status.value}: {v.reason}"
            for v in trace
            if v.status != S.PASS
        ],
        candidate_digest=candidate_digest,
        predecessor_digest=predecessor_digest,
    )

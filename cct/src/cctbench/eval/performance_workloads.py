"""Deterministic, valid, signed workloads for overhead characterization only."""

from dataclasses import asdict, dataclass

from cctbench.canonicalize import (
    canonicalize_json,
    compute_core_digest,
    compute_digest,
    compute_proposal_digest,
    compute_state_digest,
    normalize_wire,
)
from cctbench.crypto import authority_payload, public_hex, sign, synthetic_key, unsigned
from cctbench.engine.apply import apply_mutations
from cctbench.generator.base import create_identity
from cctbench.generator.families import timestamp
from cctbench.schema.enums import CheckStatus, MutationOp
from cctbench.schema.policy import Credential, HeadEvidence
from cctbench.schema.state import BeliefEntry, ChronicleEvent, RelationshipEntry
from cctbench.schema.witness import (
    AuthorityBundle,
    CommitReceipt,
    DependencyEvidence,
    Mutation,
    Proposal,
    ProvenanceManifest,
    Signer,
    TransitionWitness,
    ValidationRecord,
    WitnessCore,
)

MUTATIONS = (1, 4, 16, 64, 256)
DEPENDENCIES = (0, 4, 16, 64, 256)
ATTESTATIONS = (0, 1, 3, 5, 10, 32)
STATE_SIZES = (0, 16, 64, 256, 1024)
SEMANTICS = ("I_hist", "I_temp", "I_bel", "I_rel", "I_norm")


@dataclass(frozen=True)
class WorkloadSpec:
    mutations: int = 1
    dependencies: int = 0
    attestations: int = 0
    chronicle: int = 16
    beliefs: int = 16
    relationships: int = 16
    # native, one named predicate, or all five predicates
    semantic_mode: str = "native"

    def __post_init__(self):
        if (
            self.mutations < 1
            or min(
                self.dependencies,
                self.attestations,
                self.chronicle,
                self.beliefs,
                self.relationships,
            )
            < 0
        ):
            raise ValueError(
                "Workload counts must be nonnegative, with at least one mutation"
            )
        if self.semantic_mode not in ("native", "all", *SEMANTICS):
            raise ValueError("Unknown semantic mode")
        if self.semantic_mode == "native" and self.attestations != 0:
            raise ValueError("Native workloads contain no unused attestations")
        if self.semantic_mode != "native" and self.attestations < len(
            self.external_checks
        ) * (2 if self.semantic_mode == "all" else 1):
            raise ValueError(
                "Each externally checked predicate must have enough records for its quorum"
            )

    @property
    def external_checks(self):
        return (
            SEMANTICS
            if self.semantic_mode == "all"
            else (() if self.semantic_mode == "native" else (self.semantic_mode,))
        )

    @property
    def case_id(self):
        return (
            f"m{self.mutations}-d{self.dependencies}-a{self.attestations}"
            f"-h{self.chronicle}-b{self.beliefs}-r{self.relationships}-{self.semantic_mode}"
        )


@dataclass
class PerformanceWorkload:
    spec: WorkloadSpec
    predecessor: object
    witness: TransitionWitness
    candidate: object
    policy: object
    context: object

    @property
    def args(self):
        return self.predecessor, self.witness, self.candidate, self.policy, self.context

    def frozen(self):
        return {
            "spec": asdict(self.spec),
            **{
                name: getattr(self, name).model_dump(mode="json")
                for name in ("predecessor", "witness", "candidate", "policy", "context")
            },
        }

    def sizes(self):
        core = self.witness.witness_core
        objects = {
            "witness": self.witness,
            "proposal": core.proposal,
            "core": core,
            "validation_records": core.validation_records,
            "receipt": self.witness.commit_receipt,
            "predecessor": self.predecessor,
            "candidate": self.candidate,
            "context": self.context,
        }
        return {
            f"{name}_bytes": len(canonicalize_json(normalize_wire(value)))
            for name, value in objects.items()
        }


def workload_plan():
    """Deduplicate identical inputs; group memberships preserve every requested sweep."""
    cases = {}

    def add(group, **values):
        spec = WorkloadSpec(**values)
        entry = cases.setdefault(spec.case_id, {"spec": spec, "groups": []})
        if group not in entry["groups"]:
            entry["groups"].append(group)

    for n in MUTATIONS:
        add("mutations", mutations=n)
    for n in DEPENDENCIES:
        add("dependencies", dependencies=n)
    for n in ATTESTATIONS:
        add("attestations", attestations=n, semantic_mode="I_bel" if n else "native")
    for field in ("chronicle", "beliefs", "relationships"):
        for n in STATE_SIZES:
            add(field, **{field: n})
    for m, d, a in zip(MUTATIONS, DEPENDENCIES, (0, 1, 3, 10, 32)):
        add(
            "complexity",
            mutations=m,
            dependencies=d,
            attestations=a,
            semantic_mode="I_bel" if a else "native",
        )
    for d in DEPENDENCIES:
        for a in ATTESTATIONS:
            add(
                "size_grid",
                dependencies=d,
                attestations=a,
                semantic_mode="I_bel" if a else "native",
            )
    for n in (16, 256, 1024):
        add("semantic_comparison", chronicle=n, beliefs=n, relationships=n)
        add(
            "semantic_comparison",
            chronicle=n,
            beliefs=n,
            relationships=n,
            attestations=10,
            semantic_mode="all",
        )
    for checker in SEMANTICS:
        add(
            "individual_semantics",
            chronicle=256,
            beliefs=256,
            relationships=256,
            attestations=2,
            semantic_mode=checker,
        )
    add("individual_semantics", chronicle=256, beliefs=256, relationships=256)
    return list(cases.values())


def build_workload(spec, seed=20260904):
    material = create_identity(seed, f"urn:cct:perf:{seed}")
    pred, policy, ctx = material.state, material.policy, material.context
    pred.chronicle = [
        ChronicleEvent(
            event_id=f"event-{i:04d}",
            epoch=1,
            timestamp=pred.timestamp - spec.chronicle + i,
            event_type="OBSERVATION",
            content="h" * 128,
        )
        for i in range(spec.chronicle)
    ]
    pred.beliefs = {
        f"belief-{i:04d}": BeliefEntry(
            proposition_id=f"belief-{i:04d}",
            value=False,
            epoch_established=1,
            epoch_last_revised=1,
        )
        for i in range(spec.beliefs)
    }
    pred.relationships = {
        f"relation-{i:04d}": RelationshipEntry(
            entity_id=f"relation-{i:04d}",
            interaction_count=8,
            last_interaction_timestamp=pred.timestamp - 1,
        )
        for i in range(spec.relationships)
    }
    pred.runtime_config["benchmark_setting"] = "0000"
    pred.state_digest = compute_state_digest(pred)
    ctx.validation_time = pred.timestamp + 2
    deps = []
    for i in range(spec.dependencies):
        dep_id, uri = f"dep-{i:04d}", f"urn:evidence:{i:04d}"
        evidence = {"id": f"{i:04d}", "payload": "e" * 128}
        ctx.evidence_store[uri] = evidence
        deps.append(
            DependencyEvidence(dep_id=dep_id, uri=uri, digest=compute_digest(evidence))
        )
    operations = [
        Mutation(
            op_id=f"op-{i:04d}",
            op=MutationOp.UPDATE_RUNTIME_CONFIG,
            target_component="runtime_config",
            args={"benchmark_setting": f"{i % 4:04d}"},
        )
        for i in range(spec.mutations)
    ]
    # Repeated ordered writes keep candidate size fixed as mutation count grows.
    q = Proposal(
        identity_id=ctx.identity_id,
        epoch=pred.epoch,
        predecessor_commitment=pred.state_digest,
        mutation_manifest=operations,
        authority_bundle=AuthorityBundle(
            signers=[Signer(principal=material.principals["runtime"], role="RUNTIME")]
        ),
        provenance_manifest=ProvenanceManifest(
            dependencies=deps, source_citations=[d.dep_id for d in deps]
        ),
    )
    for signer in q.authority_bundle.signers:
        signer.signature = sign(
            "AUTHORITY", authority_payload(q, signer), material.keys[signer.principal]
        )
    q = Proposal.model_validate(normalize_wire(q))
    candidate = apply_mutations(pred, q.mutation_manifest)
    dprop = compute_proposal_digest(q)
    policy.required_external_attestations = list(spec.external_checks)
    # Count sweeps use quorum 1 to admit the requested single-record case.
    # The all-five comparison uses two distinct evaluators per predicate (10 total).
    policy.evaluator_quorum_size = 2 if spec.semantic_mode == "all" else 1
    policy.evaluator_versions = {}
    records = []
    for i in range(spec.attestations):
        principal = f"urn:cct:perf:evaluator:{i:04d}"
        key = synthetic_key(seed, principal)
        ctx.credentials[principal] = Credential(public_key=public_hex(key))
        policy.evaluator_versions[principal] = "1.0.0"
        record = ValidationRecord(
            check_id=spec.external_checks[i % len(spec.external_checks)],
            evaluator=principal,
            evaluator_version="1.0.0",
            policy_version=policy.policy_version,
            proposal_digest=dprop,
            status=CheckStatus.PASS,
            timestamp=timestamp(candidate.timestamp + 0.25),
        )
        record.signature = sign("ATTESTATION", unsigned(record), key)
        records.append(record)
    core = WitnessCore.model_validate(
        normalize_wire(WitnessCore(proposal=q, validation_records=records))
    )
    dcand = compute_state_digest(candidate)
    receipt = CommitReceipt(
        receipt_id="urn:cct:perf:receipt",
        kernel_id=material.principals["kernel"],
        identity_id=q.identity_id,
        epoch=q.epoch,
        parent_digest=q.predecessor_commitment,
        successor_digest=dcand,
        witness_core_digest=compute_core_digest(core),
        commit_timestamp=timestamp(candidate.timestamp + 0.5),
    )
    receipt.kernel_signature = sign(
        "COMMIT-RECEIPT",
        unsigned(receipt, "kernel_signature"),
        material.keys[receipt.kernel_id],
    )
    ctx.head_evidence = HeadEvidence(
        identity_id=q.identity_id,
        epoch=q.epoch,
        parent_digest=q.predecessor_commitment,
        proposal_digest=dprop,
        successor_digest=dcand,
    )
    return PerformanceWorkload(
        spec,
        pred,
        TransitionWitness(witness_core=core, commit_receipt=receipt),
        candidate,
        policy,
        ctx,
    )

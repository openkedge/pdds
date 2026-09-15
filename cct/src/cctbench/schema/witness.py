"""Frozen q -> V -> witness core -> receipt hierarchy (manuscript Appendix C)."""

from typing import Any

from pydantic import Field

from cctbench.schema.common import WireModel
from cctbench.schema.enums import CheckStatus, MutationOp


class Mutation(WireModel):
    op_id: str
    op: MutationOp
    target_component: str
    args: dict[str, Any] = Field(default_factory=dict)
    pre: dict[str, Any] = Field(default_factory=dict)
    justification_ref: str | None = None


class Signer(WireModel):
    principal: str
    role: str
    scope: str = "ALL_MUTATIONS"
    signature: str = ""


class AuthorityBundle(WireModel):
    signers: list[Signer] = Field(default_factory=list)


class DependencyEvidence(WireModel):
    dep_id: str
    type: str = "DOCUMENT_EVIDENCE"
    uri: str
    digest: str


class ProvenanceManifest(WireModel):
    dependencies: list[DependencyEvidence] = Field(default_factory=list)
    source_citations: list[str] = Field(default_factory=list)
    temporal_attestations: list[str] = Field(default_factory=list)


class Proposal(WireModel):
    identity_id: str
    epoch: int
    predecessor_commitment: str
    mutation_manifest: list[Mutation] = Field(default_factory=list)
    authority_bundle: AuthorityBundle | None = None
    provenance_manifest: ProvenanceManifest | None = None


class ValidationRecord(WireModel):
    check_id: str
    evaluator: str
    evaluator_version: str
    policy_version: str
    proposal_digest: str
    status: CheckStatus
    timestamp: str
    signature: str = ""


class WitnessCore(WireModel):
    proposal: Proposal
    validation_records: list[ValidationRecord] = Field(default_factory=list)


class CommitReceipt(WireModel):
    receipt_id: str
    kernel_id: str
    identity_id: str
    epoch: int
    parent_digest: str
    successor_digest: str
    witness_core_digest: str
    commit_timestamp: str
    kernel_signature: str = ""


class TransitionWitness(WireModel):
    witness_version: str = "1.0.0"
    witness_core: WitnessCore
    commit_receipt: CommitReceipt | None = None

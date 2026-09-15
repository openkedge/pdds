"""Frozen policy and trusted verification context, independent of the witness."""

from typing import Any, Literal

from pydantic import Field

from cctbench.schema.common import WireModel


class Credential(WireModel):
    public_key: str
    valid_from_epoch: int = 0
    valid_until_epoch: int | None = None
    compromised_from_epoch: int | None = None
    historical_status_known: bool = True
    # Informational: later revocation alone does not invalidate earlier epochs.
    revoked_at_epoch: int | None = None


class HeadEvidence(WireModel):
    identity_id: str
    epoch: int
    parent_digest: str
    proposal_digest: str
    successor_digest: str
    # None means unresolved competing tips; False is affirmative non-exclusivity.
    exclusive: bool | None = True


class ReferenceHistory(WireModel):
    identity_id: str
    epoch: int
    history: list[dict[str, Any]]
    kernel_id: str
    signature: str = ""


class VerificationContext(WireModel):
    identity_id: str
    epoch: int
    protocol_version: str = "1.0.0"
    credentials: dict[str, Credential] = Field(default_factory=dict)
    kernel_ids: list[str] = Field(default_factory=list)
    head_evidence: HeadEvidence | None = None
    # Trusted archive indexed by the transition epoch, independent of the latest head.
    head_evidence_by_epoch: dict[int, HeadEvidence] = Field(default_factory=dict)
    # Offline evidence resolver snapshot. None = unavailable; bytes are represented as JSON.
    evidence_store: dict[str, Any] = Field(default_factory=dict)
    reference_history: ReferenceHistory | None = None
    validation_time: float | None = None


class ContinuityPolicy(WireModel):
    policy_id: str = "cct-synthetic-v2"
    policy_version: str = "v2.0.0"
    require_lineage: bool = True
    require_authority: bool = True
    require_provenance: bool = True
    require_chronicle: bool = True
    require_temporal: bool = True
    require_belief: bool = True
    require_relational: bool = True
    require_normative: bool = True
    require_canonical_head: bool = True
    trust_elevation_threshold: int = 5
    time_to_live_seconds: float = 86400.0
    authority_threshold: int = Field(default=1, ge=1)
    normative_amendment_threshold: int = Field(default=2, ge=1)
    required_external_attestations: list[
        Literal["I_hist", "I_temp", "I_bel", "I_rel", "I_norm"]
    ] = Field(default_factory=list)
    evaluator_quorum_size: int = Field(default=2, ge=1)
    attestation_max_age_seconds: float = Field(default=3600.0, ge=0)
    evaluator_versions: dict[str, str] = Field(default_factory=dict)
    allowed_tombstone_roles: list[str] = Field(
        default_factory=lambda: ["IDENTITY_CUSTODIAN"]
    )

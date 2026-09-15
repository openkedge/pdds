"""Typed synthetic state; the profile implements the paper's seven logical components."""

from typing import Any

from pydantic import Field

from cctbench.schema.common import WireModel


class ChronicleEvent(WireModel):
    event_id: str
    epoch: int
    timestamp: float
    event_type: str
    content: str
    evidence_ref: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    annotations: list[dict[str, Any]] = Field(default_factory=list)
    tombstone: bool = False
    original_commitment: str | None = None
    tombstone_reason: str | None = None
    tombstone_principal: str | None = None
    tombstone_signature: str | None = None


class BeliefEntry(WireModel):
    proposition_id: str
    value: Any
    confidence: float = 1.0
    epoch_established: int = 0
    epoch_last_revised: int = 0
    justification_ref: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)


class RelationshipEntry(WireModel):
    entity_id: str
    trust_tier: str = "DEFAULT"
    interaction_count: int = 0
    interaction_ids: list[str] = Field(default_factory=list)
    last_interaction_timestamp: float = 0.0


class NormativeRule(WireModel):
    rule_id: str
    description: str
    non_amendable: bool = False
    required_signers: list[str] = Field(default_factory=list)
    threshold: int = 1


class GovernanceGrant(WireModel):
    role: str
    scopes: list[str]


class CognitiveState(WireModel):
    epoch: int = 0
    timestamp: float = 0.0
    beliefs: dict[str, BeliefEntry] = Field(default_factory=dict)
    chronicle: list[ChronicleEvent] = Field(default_factory=list)
    working_memory: list[dict[str, Any]] = Field(default_factory=list)
    knowledge: dict[str, Any] = Field(default_factory=dict)
    relationships: dict[str, RelationshipEntry] = Field(default_factory=dict)
    normative_rules: dict[str, NormativeRule] = Field(default_factory=dict)
    governance: dict[str, GovernanceGrant] = Field(default_factory=dict)
    runtime_config: dict[str, Any] = Field(default_factory=dict)
    self_model: dict[str, Any] = Field(default_factory=dict)
    state_digest: str | None = None

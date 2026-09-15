"""Fixture metadata stays outside the cryptographically committed objects."""

from pydantic import Field

from cctbench.schema.common import WireModel
from cctbench.schema.enums import CCTResult, TransitionCategory
from cctbench.schema.policy import ContinuityPolicy, VerificationContext
from cctbench.schema.state import CognitiveState
from cctbench.schema.witness import TransitionWitness


class EvaluationProbe(WireModel):
    probe_id: str
    query_epoch: int
    query: str
    expected_behavior: str = ""


class LineageBenchFixture(WireModel):
    fixture_id: str
    identity_id: str
    seed: int
    split: str
    subset: str
    category: TransitionCategory
    transition_family: str
    target_invariants: list[str] = Field(default_factory=list)
    target_conditions: list[str] = Field(default_factory=list)
    ground_truth_label: CCTResult
    predecessor_state: CognitiveState
    transition_witness: TransitionWitness | None = None
    candidate_successor: CognitiveState
    verification_context: VerificationContext
    evaluation_probes: list[EvaluationProbe] = Field(default_factory=list)
    policy: ContinuityPolicy = Field(default_factory=ContinuityPolicy)
    description: str = ""
    source_state_ref: str = ""

"""
Tests for deterministic state mutation engine: Apply(X_t, Delta_t).
"""

from cctbench.engine.apply import apply_mutations
from cctbench.generator.base import create_base_cognitive_state
from cctbench.schema.enums import MutationOp
from cctbench.schema.witness import Mutation


def test_apply_insert_knowledge():
    pred = create_base_cognitive_state()
    muts = [
        Mutation(
            op_id="m1",
            op=MutationOp.INSERT_KNOWLEDGE,
            target_component="knowledge",
            args={"key": "speed_of_light_km_s", "value": 299792},
        )
    ]
    succ = apply_mutations(pred, muts)

    assert succ.epoch == pred.epoch + 1
    assert succ.knowledge["speed_of_light_km_s"] == 299792
    assert succ.state_digest != pred.state_digest


def test_apply_revise_belief():
    pred = create_base_cognitive_state()
    muts = [
        Mutation(
            op_id="m2",
            op=MutationOp.REVISE_BELIEF,
            target_component="beliefs",
            args={
                "proposition_id": "prop:mars_water_2026",
                "new_value": True,
                "confidence": 0.99,
            },
            justification_ref="dep:paper",
        )
    ]
    succ = apply_mutations(pred, muts)

    assert succ.beliefs["prop:mars_water_2026"].value is True
    assert succ.beliefs["prop:mars_water_2026"].confidence == 0.99
    assert succ.beliefs["prop:mars_water_2026"].justification_ref == "dep:paper"

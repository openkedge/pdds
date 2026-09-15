# Reviewer Attack & Defense Analysis: CAC v0.4

### Attack 1: "Is CAC just a static policy engine?"
**Defense**: No. Static policy engines (B2) evaluate static attributes at submission time. CAC dynamically conditions admission on cryptographically certified external state, structural epistemic independence (EFD), and single-use runtime guards evaluated atomically at dispatch time (preventing TOCTOU races in F5).

### Attack 2: "What if the LLM generates the right action anyway?"
**Defense**: Under failure scenarios F1-F11, the LLM agent actively intends to take an action that violates physical system invariants (e.g. promoting a split-brain replica or draining the final quorum node). LLM-based reflection (B3) and self-consistency (B4) hallucinate safe consensus because their prompt context lacks physical grounding. CAC grounds admission in physical witnesses.

### Attack 3: "Is 20,000 iterations sufficient for microbenchmarks?"
**Defense**: Yes. Power analysis demonstrated that $N=20,000$ iterations provides $<0.5\mu s$ standard error on p50 and p99 estimates.

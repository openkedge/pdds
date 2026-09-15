# CAC v0.4 Theory-Implementation Gaps Analysis

## Audit of Theoretical Assumptions vs Implementation Realities

1. **Monotonic Clocks vs Real-Time Jitter**: The theoretical model assumes monotonically non-decreasing timestamps for envelope expiration. In practice, NTP skew is bounded by conservative $\Delta_t$ guard windows.
2. **Asymmetric Cryptography Overhead**: Theory treats Ed25519 signature checks as $O(1)$ operations; empirical measurements confirm Tier 1 verification requires $\approx 45\mu s$, well within the sub-millisecond envelope budget.
3. **Epistemic Granularity**: Structural fault domains require explicit infrastructure topology mapping; undeclared co-dependencies fall back to safe conservative quorum penalties.

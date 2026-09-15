# CAC v0.4 Coverage Matrix

| Scenario ID | Class | Domain | Failure Mode | Controller Defense |
| :--- | :--- | :--- | :--- | :--- |
| F1 | Failover | PostgreSQL | Stale Replica Ingestion | Exact LSN discharge |
| F2 | Quorum | Kubernetes | PDB Invariant Violation | PDB budget witness |
| F3 | Replication | PostgreSQL | WAL Lag Exceeds Threshold | DEFER remediation lag polling |
| F4 | Epistemic | Kubernetes | Correlated Node Partition | Structural EFD $\kappa_E$ analysis |
| F5 | Concurrency | Kubernetes | Lease Expiry / TOCTOU | Atomic gateway guard validation |
| F6 | Crypto | PostgreSQL | Expired Witness Certificate | Certificate validity verification |
| F7 | Entailment | PostgreSQL | Semantic Invariant Mismatch | Formal entailment discharge |
| F8 | Remediation | Kubernetes | Transient Lock Contention | Remediation backoff loop |
| F9 | Envelope | PostgreSQL | Unprevalidated Envelope | Policy prevalidation audit |
| F10 | Boundary | Kubernetes | Zero-Capacity Quorum | Strict threshold bounds |
| F11 | Serialization| PostgreSQL | MVCC Conflict | Snapshot isolation guard |
| E1 | Baseline | Both | Safe Read-Only Query | Tier 0 immediate admission |

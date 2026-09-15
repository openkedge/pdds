# CAC v0.4 Cross-Domain Generalization Report

## Balanced Evaluation Across PostgreSQL and Kubernetes

The canonical test matrix was balanced across both stateful database operations (PostgreSQL primary failover, WAL replication lag, MVCC serialization) and distributed container orchestration (Kubernetes node drains, pod disruption budgets, lease TOCTOU races).

- **PostgreSQL Variants**: 12 variants evaluated.
- **Kubernetes Variants**: 13 variants evaluated.
In both domains, CAC demonstrated 0.0% UIER and zero architectural leakage.

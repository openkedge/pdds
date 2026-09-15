"""Measured ternary rates with fixture-level percentile bootstrap confidence intervals."""

import numpy as np

LABELS = ["VALID", "INVALID", "INDETERMINATE"]
PREDICTIONS = LABELS + ["UNAVAILABLE"]
RATE_CELLS = {
    "VAR": (0, 0),
    "VRR": (0, 1),
    "VIR": (0, 2),
    "IAR": (1, 0),
    "IDR": (1, 1),
    "IDR_indet": (2, 2),
}


def confusion(rows):
    counts = np.zeros((3, 4), dtype=int)
    for row in rows:
        counts[LABELS.index(row["ground_truth"])][
            PREDICTIONS.index(row["prediction"] or "UNAVAILABLE")
        ] += 1
    return counts


def metrics(rows, bootstrap_samples=1000, seed=20260904):
    counts = confusion(rows)
    n = int(counts.sum())
    executed = int(counts[:, :3].sum())
    # Multinomial resampling of the observed 3x4 contingency cells is exactly equivalent
    # to IID fixture resampling for metrics that depend only on this table.
    rng = np.random.default_rng(seed)
    boot = (
        rng.multinomial(n, counts.ravel() / n, size=bootstrap_samples).reshape(-1, 3, 4)
        if n
        else np.zeros((bootstrap_samples, 3, 4))
    )
    out = {
        "n": n,
        "executed": executed,
        "unavailable": n - executed,
        "confusion_matrix": counts.tolist(),
        "true_labels": LABELS,
        "predicted_labels": PREDICTIONS,
        "rates": {},
        "bootstrap": {
            "unit": "held-out fixture",
            "method": "IID percentile via multinomial contingency resampling",
            "replicates": bootstrap_samples,
            "seed": seed,
            "level": 0.95,
        },
    }

    def rate(name, num, den, nums, dens):
        valid = dens > 0
        distribution = nums[valid] / dens[valid]
        out["rates"][name] = {
            "estimate": float(num / den) if den else None,
            "numerator": int(num),
            "denominator": int(den),
            "ci95": [float(x) for x in np.quantile(distribution, [0.025, 0.975])]
            if len(distribution)
            else None,
            "bootstrap_defined_replicates": int(valid.sum()),
        }

    for name, (i, j) in RATE_CELLS.items():
        rate(
            name,
            counts[i, j],
            counts[i, :3].sum(),
            boot[:, i, j],
            boot[:, i, :3].sum(axis=1),
        )
    rate(
        "coverage", executed, n, boot[:, :, :3].sum(axis=(1, 2)), boot.sum(axis=(1, 2))
    )
    rate(
        "abstention",
        counts[:, 2].sum(),
        executed,
        boot[:, :, 2].sum(axis=1),
        boot[:, :, :3].sum(axis=(1, 2)),
    )
    rate(
        "decision_coverage",
        counts[:, :2].sum(),
        n,
        boot[:, :, :2].sum(axis=(1, 2)),
        boot.sum(axis=(1, 2)),
    )
    rate(
        "accuracy",
        sum(counts[i, i] for i in range(3)),
        executed,
        sum(boot[:, i, i] for i in range(3)),
        boot[:, :, :3].sum(axis=(1, 2)),
    )
    return out


def compute_evaluation_metrics(predictions, ground_truths):
    if len(predictions) != len(ground_truths):
        raise ValueError("Prediction/label count mismatch")
    return metrics(
        [
            {
                "prediction": getattr(p, "value", p),
                "ground_truth": getattr(y, "value", y),
            }
            for p, y in zip(predictions, ground_truths)
        ]
    )

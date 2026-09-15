"""Result arithmetic and independent determinism checks."""

from cctbench.canonicalize import canonicalize_json
from cctbench.eval.baselines import HashingEmbedding, calibrate
from cctbench.eval.metrics import metrics
from cctbench.generator.dataset import generate_dataset


def test_metrics_count_ternary_rejection_and_abstention_correctly():
    rows = [
        {"ground_truth": a, "prediction": b}
        for a, b in [
            ("VALID", "VALID"),
            ("VALID", "INVALID"),
            ("VALID", "INDETERMINATE"),
            ("INVALID", "VALID"),
            ("INVALID", "INVALID"),
            ("INVALID", "INDETERMINATE"),
            ("INDETERMINATE", "INDETERMINATE"),
            ("INDETERMINATE", "INVALID"),
        ]
    ]
    m = metrics(rows, 1000, 7)
    for key in ["VAR", "VRR", "VIR", "IAR", "IDR"]:
        assert m["rates"][key]["estimate"] == 1 / 3
    assert m["rates"]["IDR_indet"]["estimate"] == 0.5
    assert m == metrics(rows, 1000, 7)


def test_unavailable_is_separate_from_abstention_and_missing_denominators():
    m = metrics([{"ground_truth": "VALID", "prediction": None}], 100, 2)
    assert m["unavailable"] == 1 and m["rates"]["coverage"]["estimate"] == 0
    assert m["rates"]["VAR"]["estimate"] is None
    assert m["rates"]["abstention"]["estimate"] is None


def test_fixtures_signatures_and_calibration_reproduce_exactly():
    one, h1, s1 = generate_dataset(129, 1, 1, 1)
    two, h2, s2 = generate_dataset(129, 1, 1, 1)
    assert canonicalize_json(one) == canonicalize_json(two)
    assert h1 == h2 and s1 == s2
    dev = lambda fs: [f for f in fs if f.split == "development"]
    assert calibrate(dev(one), HashingEmbedding()) == calibrate(
        dev(two), HashingEmbedding()
    )

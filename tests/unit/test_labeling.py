import numpy as np
import pandas as pd
import pytest

from tokenedge.labeling import fixed_horizon_labels, make_labels, triple_barrier_labels


def _series(values):
    idx = pd.date_range("2024-01-01", periods=len(values), freq="D", tz="UTC")
    return pd.Series(values, index=idx, dtype=float)


def test_fixed_horizon_labels_and_t1():
    s = _series([100, 101, 99, 102, 103, 103])
    lab = fixed_horizon_labels(s, horizon=2, threshold=0.0)
    assert lab["label"].tolist()[:4] == [0.0, 1.0, 1.0, 1.0]
    assert lab["label"].iloc[-2:].isna().all()
    assert lab["t1"].iloc[0] == s.index[2]
    assert lab["ret"].iloc[0] == pytest.approx(99 / 100 - 1)


def test_triple_barrier_upper_lower_vertical():
    base = list(np.full(30, 100.0) * np.exp(np.random.default_rng(0).normal(0, 0.002, 30)))
    up = _series(base + [100, 103, 110, 120, 125])
    lab = triple_barrier_labels(up, horizon=4, pt_sl=(1.0, 1.0), vol_span=10)
    i = 30  # bar at 100 before the rally
    assert lab["label"].iloc[i] == 1.0
    assert lab["barrier"].iloc[i] == "upper"
    assert lab["t1"].iloc[i] == up.index[i + 1]

    down = _series(base + [100, 97, 90, 80, 75])
    lab = triple_barrier_labels(down, horizon=4, pt_sl=(1.0, 1.0), vol_span=10)
    assert lab["label"].iloc[30] == 0.0
    assert lab["barrier"].iloc[30] == "lower"

    flat = _series(base + [100.0] * 5)
    lab = triple_barrier_labels(flat, horizon=4, pt_sl=(50.0, 50.0), vol_span=10)
    assert lab["barrier"].iloc[30] == "vertical"
    assert lab["t1"].iloc[30] == flat.index[34]


def test_triple_barrier_tail_is_unlabeled(daily):
    lab = make_labels(daily["close"], {"method": "triple_barrier", "horizon": 5})
    assert lab["label"].iloc[-5:].isna().all()
    assert (lab["t1"].dropna() > lab["t1"].dropna().index).all()  # outcome resolved strictly later


def test_make_labels_rejects_unknown():
    with pytest.raises(ValueError):
        make_labels(_series([1, 2, 3]), {"method": "nope"})

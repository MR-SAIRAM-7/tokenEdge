"""Look-ahead bias tests (FR-V1 to FR-V5).

The future-perturbation check appends random bars after bar t and requires every value up to
t to stay identical. A function that peeks at the future fails it, which the label test below
demonstrates on purpose.
"""

import pandas as pd
import pytest

from tokenedge.engine import ExecutionConfig, run_backtest
from tokenedge.errors import InSampleWindowError
from tokenedge.features import build_features
from tokenedge.labeling import fixed_horizon_labels
from tokenedge.ml.registry import get_registry
from tokenedge.strategies import get_strategy
from tokenedge.validation import check_model_window, future_perturbation_check

CUTS = (300, 1200, 2500)


@pytest.mark.parametrize("cut", CUTS)
def test_features_are_causal_daily(daily, cut):
    assert future_perturbation_check(lambda d: build_features(d, "v1", "1d"), daily, cut)


def test_features_are_causal_hourly(hourly):
    assert future_perturbation_check(lambda d: build_features(d, "v1", "1h"), hourly, 1500)


@pytest.mark.parametrize(
    "name,params",
    [
        ("sma_crossover", {"fast": 10, "slow": 50}),
        ("sma_crossover", {"fast": 12, "slow": 26, "ma_type": "ema", "min_hold": 5}),
        ("buy_hold", {}),
    ],
)
def test_classical_signals_are_causal(daily, name, params):
    strat = get_strategy(name, params)
    for cut in CUTS:
        assert future_perturbation_check(strat.generate_signals, daily, cut)


@pytest.mark.parametrize(
    "name,model_id", [("xgboost", "xgb_syn_1d_fh_v1"), ("lstm", "lstm_syn_1d_fh_v1")]
)
def test_ml_signals_are_causal(sandbox, daily, name, model_id):
    strat = get_strategy(name, {"model_id": model_id})
    for cut in CUTS:
        assert future_perturbation_check(strat.generate_signals, daily, cut)


def test_detector_catches_lookahead(daily):
    """Labels use future prices by definition, so the detector must flag them."""
    assert not future_perturbation_check(
        lambda d: fixed_horizon_labels(d["close"], 5)["label"], daily, 1200
    )


def test_every_fill_is_after_its_signal(daily):
    sig = get_strategy("sma_crossover", {"fast": 5, "slow": 20}).generate_signals(daily)
    res = run_backtest(daily, sig, daily.index[25], None, ExecutionConfig())
    changes = sig[sig.diff().fillna(0) != 0].index
    fills = res.fills[res.fills["reason"] == "signal"]
    assert len(fills) > 10
    for ts in fills["timestamp"]:
        decided = changes[changes < ts]
        assert len(decided) and decided[-1] < ts
        assert daily.index.get_loc(ts) == daily.index.get_loc(decided[-1]) + 1


def test_engine_ignores_data_after_window(daily):
    sig = get_strategy("sma_crossover", {"fast": 10, "slow": 50}).generate_signals(daily)
    end = daily.index[2000]
    base = run_backtest(daily, sig, daily.index[100], end, ExecutionConfig())
    future = daily.copy()
    future.loc[future.index > end, ["open", "high", "low", "close"]] *= 3
    sig2 = get_strategy("sma_crossover", {"fast": 10, "slow": 50}).generate_signals(future)
    other = run_backtest(future, sig2, daily.index[100], end, ExecutionConfig())
    pd.testing.assert_series_equal(base.equity, other.equity)


def test_window_guard(sandbox):
    md = get_registry().info("xgb_syn_1d_fh_v1").metadata
    with pytest.raises(InSampleWindowError):
        check_model_window(md, pd.Timestamp("2022-06-01", tz="UTC"))
    assert check_model_window(md, pd.Timestamp("2022-06-01", tz="UTC"), allow_in_sample=True)[
        "in_sample"
    ]
    assert not check_model_window(md, pd.Timestamp("2023-02-01", tz="UTC"))["in_sample"]

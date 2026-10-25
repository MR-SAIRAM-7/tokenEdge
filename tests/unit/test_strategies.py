import numpy as np
import pandas as pd
import pytest

from tokenedge.engine import ExecutionConfig
from tokenedge.errors import ConfigError
from tokenedge.strategies import get_strategy, list_strategies
from tokenedge.strategies.base import apply_min_hold
from tokenedge.strategies.ml_strategy import bet_size
from tokenedge.strategies.tuning import grid_search_sma


def test_registry_lists_all_with_schemas():
    items = {s["name"]: s for s in list_strategies()}
    assert set(items) == {"buy_hold", "sma_crossover", "xgboost", "lstm", "sma_ml_filter"}
    assert items["sma_ml_filter"]["model_type"] is None and items["sma_ml_filter"]["kind"] == "ml"
    props = items["sma_crossover"]["params_schema"]["properties"]
    assert list(props)[:3] == ["fast", "slow", "ma_type"]
    assert "model_id" in items["xgboost"]["params_schema"]["required"]


def test_sma_signals(daily):
    sig = get_strategy("sma_crossover", {"fast": 5, "slow": 20}).generate_signals(daily)
    assert sig.iloc[:19].eq(0).all()
    fast = daily["close"].rolling(5).mean()
    slow = daily["close"].rolling(20).mean()
    expected = (fast > slow).map({True: 1.0, False: -1.0})
    pd.testing.assert_series_equal(sig.iloc[19:], expected.iloc[19:], check_names=False)


def test_invalid_params_raise_readable_error():
    with pytest.raises(ConfigError, match="fast window must be smaller"):
        get_strategy("sma_crossover", {"fast": 50, "slow": 20})
    with pytest.raises(ConfigError):
        get_strategy("sma_crossover", {"unknown": 1})
    with pytest.raises(ConfigError):
        get_strategy("does_not_exist")


def test_min_hold():
    s = pd.Series([0, 1, 0, 1, 1, 0, 0, 0], dtype=float)
    out = apply_min_hold(s, 3).tolist()
    assert out == [0, 1, 1, 1, 1, 0, 0, 0]


def test_grid_search_uses_only_train_and_val(daily):
    data = daily.copy()
    # Poison everything after the validation window: the search must not see it.
    data.loc[
        data.index > pd.Timestamp("2020-12-31 23:59", tz="UTC"), ["open", "high", "low", "close"]
    ] *= 1000
    res = grid_search_sma(
        data,
        ("2012-01-01", "2018-12-31"),
        ("2019-01-01", "2020-12-31"),
        ExecutionConfig(),
        252,
        (5, 10),
        (50, 100),
    )
    clean = grid_search_sma(
        daily,
        ("2012-01-01", "2018-12-31"),
        ("2019-01-01", "2020-12-31"),
        ExecutionConfig(),
        252,
        (5, 10),
        (50, 100),
    )
    assert res["best"] == clean["best"] and res["trials"] == 4
    assert [g["val_sharpe"] for g in res["grid"]] == [g["val_sharpe"] for g in clean["grid"]]


def test_bet_size_grows_with_confidence():
    sizes = bet_size(np.array([0.5, 0.55, 0.6, 0.7, 0.9, 0.99, 0.3]))
    assert sizes[0] == pytest.approx(0.1)  # a position is always at least one step
    assert list(sizes[:6]) == sorted(sizes[:6]) and sizes[5] == pytest.approx(1.0)
    assert sizes[6] == pytest.approx(bet_size(np.array([0.7]))[0])  # symmetric around 0.5
    assert np.allclose(sizes / 0.1, np.round(sizes / 0.1))


def test_probability_sizing_scales_ml_positions(sandbox, daily):
    full = get_strategy("xgboost", {"model_id": "xgb_syn_1d_fh_v1"})
    sized = get_strategy("xgboost", {"model_id": "xgb_syn_1d_fh_v1", "sizing": "probability"})
    a, proba = full.signals_and_proba(daily)
    b = sized.generate_signals(daily)
    assert ((a == 0) == (b == 0)).all() and (np.sign(a) == np.sign(b)).all()
    assert b[b != 0].abs().between(0.1, 1.0).all() and b.abs().max() < a.abs().max() + 1e-12
    on = b != 0
    assert np.allclose(b[on].abs(), bet_size(proba[on]))


def test_sma_ml_filter_only_trades_when_model_agrees(sandbox, daily):
    params = {"fast": 10, "slow": 50, "model_id": "xgb_syn_1d_fh_v1", "threshold_long": 0.5}
    filt = get_strategy("sma_ml_filter", params)
    sig, proba = filt.signals_and_proba(daily)
    sma = get_strategy("sma_crossover", {"fast": 10, "slow": 50}).generate_signals(daily)
    longs = sig == 1
    assert longs.any() and (sma[longs] == 1).all() and (proba[longs] > 0.5).all()
    # Every SMA long the model confirms is taken; the others are skipped.
    confirmed = (sma == 1) & (proba > 0.5)
    assert (longs == confirmed).all()
    assert (sig[(sma == 1) & (proba <= 0.5)] == 0).all()
    # The LSTM model works as a filter too (any model type is accepted).
    lstm = get_strategy("sma_ml_filter", {**params, "model_id": "lstm_syn_1d_fh_v1"})
    assert lstm.generate_signals(daily).abs().sum() > 0
    with pytest.raises(ConfigError, match="fast window must be smaller"):
        get_strategy("sma_ml_filter", {**params, "fast": 60})

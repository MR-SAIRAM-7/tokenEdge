import pandas as pd
import pytest

from tokenedge.engine import ExecutionConfig
from tokenedge.errors import ConfigError
from tokenedge.strategies import get_strategy, list_strategies
from tokenedge.strategies.base import apply_min_hold
from tokenedge.strategies.tuning import grid_search_sma


def test_registry_lists_all_with_schemas():
    items = {s["name"]: s for s in list_strategies()}
    assert set(items) == {"buy_hold", "sma_crossover", "xgboost", "lstm"}
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

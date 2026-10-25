"""Property-based checks of engine invariants."""

import numpy as np
import pandas as pd
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from tokenedge.engine import ExecutionConfig, run_backtest

N = 400


def _data(seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2020-01-01", periods=N, freq="D", tz="UTC")
    close = 50 * np.exp(np.cumsum(rng.normal(0, 0.02, N)))
    open_ = np.r_[close[0], close[:-1]] * np.exp(rng.normal(0, 0.005, N))
    return pd.DataFrame(
        {
            "open": open_,
            "high": np.maximum(open_, close) * 1.01,
            "low": np.minimum(open_, close) * 0.99,
            "close": close,
            "volume": 1e6,
        },
        index=idx,
    )


signal_lists = st.lists(st.sampled_from([-1.0, 0.0, 1.0]), min_size=N, max_size=N)


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(signals=signal_lists, seed=st.integers(0, 50), bps=st.floats(0, 50), short=st.booleans())
def test_equity_is_cash_plus_position(signals, seed, bps, short):
    data = _data(seed)
    cfg = ExecutionConfig(
        mode="long_short" if short else "long_flat",
        commission={"buy_bps": bps, "sell_bps": bps},
        slippage={"model": "fixed", "bps": bps / 2},
    )
    res = run_backtest(data, pd.Series(signals, index=data.index), data.index[5], None, cfg)
    close = data["close"].loc[res.equity.index]
    np.testing.assert_allclose(res.equity, res.cash + res.position * close, rtol=1e-9, atol=1e-6)
    assert res.position.iloc[-1] == 0
    np.testing.assert_allclose(
        res.trades["net_pnl"].sum(), res.equity.iloc[-1] - cfg.initial_capital, rtol=1e-7, atol=1e-6
    )


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    signals=signal_lists, seed=st.integers(0, 50), low=st.floats(0, 20), extra=st.floats(0.5, 30)
)
def test_higher_costs_never_help(signals, seed, low, extra):
    data = _data(seed)
    sig = pd.Series(signals, index=data.index)

    def final(bps):
        cfg = ExecutionConfig(fractional=True, commission={"buy_bps": bps, "sell_bps": bps})
        return run_backtest(data, sig, data.index[5], None, cfg).equity.iloc[-1]

    assert final(low + extra) <= final(low) + 1e-9

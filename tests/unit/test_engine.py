import numpy as np
import pandas as pd
import pytest

from tokenedge.engine import (
    CommissionModel,
    ExecutionConfig,
    SlippageModel,
    execution_from_preset,
    run_backtest,
)
from tokenedge.errors import InsufficientDataError


def _cfg(**kw):
    base = {
        "fractional": True,
        "commission": {"buy_bps": 0, "sell_bps": 0},
        "slippage": {"model": "fixed", "bps": 0},
    }
    base.update(kw)
    return ExecutionConfig(**base)


def test_buy_and_hold_zero_cost_equals_price_return(daily):
    sig = pd.Series(1.0, index=daily.index)
    res = run_backtest(daily, sig, "2015-01-01", "2019-12-31", _cfg())
    window = daily.loc["2015-01-01":"2019-12-31"]
    expected = window["close"].iloc[-1] / window["open"].iloc[0]
    assert res.equity.iloc[-1] / 100_000 == pytest.approx(expected, rel=1e-12)
    assert len(res.trades) == 1


def test_fills_happen_at_next_bar_open(daily):
    sig = pd.Series(0.0, index=daily.index)
    change_bars = [100, 150, 220, 300]
    for a, b in zip(change_bars[::2], change_bars[1::2], strict=True):
        sig.iloc[a:b] = 1.0
    res = run_backtest(daily, sig, daily.index[50], None, _cfg())
    signal_times = [daily.index[a - 0] for a in (100, 150, 220, 300)]
    fill_times = list(res.fills.loc[res.fills["reason"] == "signal", "timestamp"])
    assert fill_times == [daily.index[daily.index.get_loc(t) + 1] for t in signal_times]
    for _, f in res.fills[res.fills["reason"] == "signal"].iterrows():
        assert f["ref_price"] == daily.loc[f["timestamp"], "open"]


def test_commission_and_slippage_reduce_equity_exactly(daily):
    sig = pd.Series(0.0, index=daily.index)
    sig.iloc[100:200] = 1.0
    free = run_backtest(daily, sig, daily.index[50], daily.index[300], _cfg())
    costly = run_backtest(
        daily,
        sig,
        daily.index[50],
        daily.index[300],
        _cfg(commission={"buy_bps": 10, "sell_bps": 20}, slippage={"model": "fixed", "bps": 5}),
    )
    assert costly.equity.iloc[-1] < free.equity.iloc[-1]
    entry_open = daily["open"].iloc[101]
    exit_open = daily["open"].iloc[201]
    buy_fill, sell_fill = entry_open * 1.0005, exit_open * 0.9995
    qty = 100_000 / (buy_fill * 1.001)
    expected = qty * sell_fill * (1 - 0.002)
    assert costly.equity.iloc[-1] == pytest.approx(expected, rel=1e-10)


def test_trade_pnl_reconciles_with_equity(daily):
    rng = np.random.default_rng(3)
    sig = (
        pd.Series(rng.choice([0.0, 1.0], len(daily), p=[0.97, 0.03]), index=daily.index)
        .replace(0.0, np.nan)
        .ffill(limit=15)
        .fillna(0.0)
    )
    res = run_backtest(daily, sig, daily.index[30], None, execution_from_preset("india_equity_nse"))
    assert res.trades["net_pnl"].sum() == pytest.approx(res.equity.iloc[-1] - 100_000, rel=1e-9)
    assert res.trades["costs"].sum() == pytest.approx(res.totals["total_costs"], rel=1e-9)


def test_whole_shares_when_not_fractional(daily):
    sig = pd.Series(1.0, index=daily.index)
    res = run_backtest(daily, sig, daily.index[10], daily.index[100], _cfg(fractional=False))
    qty = res.fills["qty"].iloc[0]
    assert qty == int(qty) and qty > 0


def test_long_flat_clips_shorts_and_long_short_borrows(daily):
    sig = pd.Series(-1.0, index=daily.index)
    flat = run_backtest(daily, sig, daily.index[10], daily.index[200], _cfg())
    assert flat.fills.empty and flat.equity.iloc[-1] == 100_000
    short = run_backtest(
        daily, sig, daily.index[10], daily.index[200], _cfg(mode="long_short", borrow_rate=0.05)
    )
    assert (short.position.iloc[:-1] < 0).all()
    assert short.totals["borrow"] > 0
    assert short.trades.iloc[0]["side"] == "short"


def test_idle_cash_earns_interest(daily):
    from tokenedge.metrics import sharpe_ratio

    flat_sig = pd.Series(0.0, index=daily.index)
    start, end = daily.index[100], daily.index[351]
    flat = run_backtest(daily, flat_sig, start, end, _cfg(cash_rate=0.04), 252)
    n = len(flat.equity)
    assert flat.equity.iloc[-1] == pytest.approx(100_000 * (1 + 0.04 / 252) ** n, rel=1e-12)
    assert flat.totals["interest"] == pytest.approx(flat.equity.iloc[-1] - 100_000)
    # Earning exactly the risk-free rate means an excess return of zero, hence a zero Sharpe.
    assert sharpe_ratio(flat.returns, 252, 0.04) == 0.0

    # Fully invested: only leftover cash earns interest, so the result barely moves.
    long_sig = pd.Series(1.0, index=daily.index)
    plain = run_backtest(daily, long_sig, start, end, _cfg(), 252)
    paid = run_backtest(daily, long_sig, start, end, _cfg(cash_rate=0.04), 252)
    assert paid.totals["interest"] < 1.0
    assert paid.equity.iloc[-1] == pytest.approx(plain.equity.iloc[-1], rel=1e-5)

    # Short: interest on the trader's own capital, never on the short-sale proceeds.
    short = run_backtest(daily, -long_sig, start, end, _cfg(mode="long_short", cash_rate=0.04), 252)
    cap = short.equity.max() * 0.04 / 252 * n
    assert 0 < short.totals["interest"] <= cap


def test_empty_window_raises(daily):
    with pytest.raises(InsufficientDataError):
        run_backtest(daily, pd.Series(1.0, index=daily.index), "2040-01-01", None, _cfg())


def test_commission_model():
    c = CommissionModel(buy_bps=10, sell_bps=20, fixed_fee=1, min_fee=5)
    assert c.fee(10, 100) == pytest.approx(5 + 1)  # 1 bps-fee of 1.0 < min fee
    assert c.fee(-1000, 100) == pytest.approx(100_000 * 0.002 + 1)
    assert c.fee(0, 100) == 0


def test_slippage_models():
    assert SlippageModel(model="fixed", bps=7).fraction(1, 0.02, 0.01, 1e6) == pytest.approx(7e-4)
    assert SlippageModel(model="range", range_fraction=0.1).fraction(
        1, 0.02, 0.01, 1e6
    ) == pytest.approx(0.002)
    s = SlippageModel(model="sqrt_impact", half_spread_bps=1, impact_coef=0.5)
    small, big = s.fraction(100, 0, 0.02, 1e6), s.fraction(1e5, 0, 0.02, 1e6)
    assert small < big
    assert big == pytest.approx(1e-4 + 0.5 * 0.02 * np.sqrt(0.1))
    assert SlippageModel(model="fixed", bps=900, max_bps=100).fraction(1, 0, 0, 0) == pytest.approx(
        0.01
    )


def test_presets_exist():
    for name in ("zero_cost", "us_equity", "india_equity_nse", "crypto_spot"):
        assert isinstance(execution_from_preset(name), ExecutionConfig)
    with pytest.raises(ValueError):
        execution_from_preset("nope")

"""Event-driven bar-by-bar backtesting engine.

Timing contract (prevents look-ahead):
    * a strategy's target position for bar t is computed from data up to the close of bar t;
    * the engine fills that target at the OPEN of bar t+1;
    * the portfolio is marked to market at each bar's close.
Positions are only changed when the target changes, so equity drift never causes
micro-rebalancing trades. Any position still open on the last bar is closed at its close.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from tokenedge.engine.costs import ExecutionConfig
from tokenedge.engine.trades import TradeBook
from tokenedge.errors import InsufficientDataError


@dataclass
class BacktestResult:
    strategy: str
    params: dict
    config: ExecutionConfig
    periods_per_year: float
    equity: pd.Series
    cash: pd.Series
    position: pd.Series
    exposure: pd.Series
    returns: pd.Series
    drawdown: pd.Series
    target: pd.Series
    trades: pd.DataFrame
    fills: pd.DataFrame
    totals: dict = field(default_factory=dict)

    @property
    def index(self) -> pd.DatetimeIndex:
        return pd.DatetimeIndex(self.equity.index)


def _window_bounds(index: pd.DatetimeIndex, start, end) -> tuple[int, int]:
    mask = np.ones(len(index), dtype=bool)
    if start is not None:
        mask &= index >= pd.Timestamp(start)
    if end is not None:
        mask &= index <= pd.Timestamp(end)
    positions = np.flatnonzero(mask)
    if len(positions) < 2:
        raise InsufficientDataError(
            "The backtest window contains fewer than 2 bars.",
            {"start": str(start), "end": str(end), "bars": int(len(positions))},
        )
    return int(positions[0]), int(positions[-1])


def run_backtest(
    data: pd.DataFrame,
    signals: pd.Series,
    start: pd.Timestamp | str | None = None,
    end: pd.Timestamp | str | None = None,
    config: ExecutionConfig | None = None,
    periods_per_year: float = 252.0,
    strategy_name: str = "strategy",
    params: dict | None = None,
) -> BacktestResult:
    """Simulate ``signals`` (target position per bar, in [-1, 1]) on ``data`` within [start, end].

    ``data`` may include history before ``start``; it is used only to warm up the signals
    and slippage estimates, and no trade happens before ``start``.
    """
    config = config or ExecutionConfig()
    data = data.sort_index()
    index = pd.DatetimeIndex(data.index)
    sig = signals.reindex(index).astype("float64").fillna(0.0).clip(-1.0, 1.0)
    if config.mode == "long_flat":
        sig = sig.clip(lower=0.0)
    i0, i1 = _window_bounds(index, _tz_like(start, index), _tz_like(end, index))

    o = data["open"].to_numpy("float64")
    c = data["close"].to_numpy("float64")
    h = data["high"].to_numpy("float64")
    lo = data["low"].to_numpy("float64")
    v = data["volume"].to_numpy("float64")
    # Target executed at bar i was decided at the close of bar i-1.
    target_at = np.concatenate([[0.0], sig.to_numpy()[:-1]])
    # Slippage inputs known before bar i opens.
    prev_range = np.concatenate([[np.nan], ((h - lo) / c)[:-1]])
    log_ret = np.diff(np.log(c), prepend=np.nan)
    sigma = pd.Series(log_ret).rolling(20, min_periods=5).std().shift(1).to_numpy()
    adv = pd.Series(v).rolling(20, min_periods=5).mean().shift(1).to_numpy()

    comm, slip = config.commission, config.slippage
    cash = float(config.initial_capital)
    qty = 0.0
    current_target = 0.0
    book = TradeBook()
    fills: list[dict] = []
    totals = {"fees": 0.0, "slippage": 0.0, "borrow": 0.0, "traded_value": 0.0}

    n = i1 - i0 + 1
    eq_arr = np.empty(n)
    cash_arr = np.empty(n)
    qty_arr = np.empty(n)
    tgt_arr = np.empty(n)

    def execute(i: int, delta: float, ref: float, reason: str) -> None:
        nonlocal cash, qty
        s = slip.fraction(delta, prev_range[i], sigma[i], adv[i])
        fill = ref * (1.0 + s) if delta > 0 else ref * (1.0 - s)
        fee = comm.fee(delta, fill)
        slip_cost = abs(delta) * abs(fill - ref)
        cash -= delta * fill + fee
        qty += delta
        if abs(qty) < 1e-12:
            qty = 0.0
        totals["fees"] += fee
        totals["slippage"] += slip_cost
        totals["traded_value"] += abs(delta) * fill
        book.on_fill(index[i], i, delta, ref, fee, slip_cost)
        fills.append(
            {
                "timestamp": index[i],
                "side": "buy" if delta > 0 else "sell",
                "qty": abs(delta),
                "ref_price": ref,
                "fill_price": fill,
                "fee": fee,
                "slippage": slip_cost,
                "reason": reason,
            }
        )

    def desired_qty(i: int, tgt: float, prev_tgt: float, equity: float, ref: float) -> float:
        if tgt == 0.0 or equity <= 0:
            return 0.0
        direction = 1.0 if tgt > prev_tgt else -1.0  # a higher target weight means buying
        value = abs(tgt) * equity * config.max_leverage
        est_qty = value / ref
        s = slip.fraction(est_qty, prev_range[i], sigma[i], adv[i])
        fill = ref * (1.0 + s * direction)
        rate = comm.rate(1 if direction > 0 else -1)
        q = max((value - comm.fixed_fee) / (fill * (1.0 + rate)), 0.0)
        if not config.fractional:
            q = math.floor(q + 1e-9)
        return math.copysign(q, tgt)

    for k, i in enumerate(range(i0, i1 + 1)):
        tgt = float(target_at[i])
        if tgt != current_target:
            equity_open = cash + qty * o[i]
            delta = desired_qty(i, tgt, current_target, equity_open, o[i]) - qty
            if abs(delta) > 1e-12:
                execute(i, delta, o[i], "signal")
            current_target = tgt

        if qty < 0 and config.borrow_rate > 0:
            borrow = -qty * c[i] * config.borrow_rate / periods_per_year
            cash -= borrow
            totals["borrow"] += borrow
            book.accrue_borrow(borrow)

        if i == i1 and qty != 0.0:
            execute(i, -qty, c[i], "end_of_window")

        eq_arr[k] = cash + qty * c[i]
        cash_arr[k] = cash
        qty_arr[k] = qty
        tgt_arr[k] = current_target

    win = index[i0 : i1 + 1]
    equity = pd.Series(eq_arr, index=win, name="equity")
    returns = equity.pct_change()
    returns.iloc[0] = equity.iloc[0] / config.initial_capital - 1.0
    peak = equity.cummax().clip(lower=config.initial_capital)
    drawdown = equity / peak - 1.0
    close_win = pd.Series(c[i0 : i1 + 1], index=win)
    position = pd.Series(qty_arr, index=win, name="position")
    exposure = (position * close_win / equity.replace(0.0, np.nan)).fillna(0.0)
    # The forced close on the last bar leaves qty = 0; show the exposure held during that bar.
    if len(qty_arr) > 1 and fills and fills[-1]["reason"] == "end_of_window":
        exposure.iloc[-1] = exposure.iloc[-2]

    fills_df = pd.DataFrame(
        fills,
        columns=[
            "timestamp",
            "side",
            "qty",
            "ref_price",
            "fill_price",
            "fee",
            "slippage",
            "reason",
        ],
    )
    totals["total_costs"] = totals["fees"] + totals["slippage"] + totals["borrow"]
    totals["final_equity"] = float(equity.iloc[-1])

    return BacktestResult(
        strategy=strategy_name,
        params=params or {},
        config=config,
        periods_per_year=periods_per_year,
        equity=equity,
        cash=pd.Series(cash_arr, index=win, name="cash"),
        position=position,
        exposure=exposure.rename("exposure"),
        returns=returns.rename("returns"),
        drawdown=drawdown.rename("drawdown"),
        target=pd.Series(tgt_arr, index=win, name="target"),
        trades=book.to_frame(),
        fills=fills_df,
        totals=totals,
    )


def _tz_like(value, index: pd.DatetimeIndex):
    if value is None:
        return None
    ts = pd.Timestamp(value)
    if index.tz is not None and ts.tzinfo is None:
        return ts.tz_localize(index.tz)
    if index.tz is None and ts.tzinfo is not None:
        return ts.tz_convert(None)
    return ts

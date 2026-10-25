"""Independent check of the TokenEdge engine against Backtrader (FR-E11).

Runs the SMA crossover with the same costs in both engines and compares trade count and
total return. Backtrader's cheat-on-open mode lets the strategy act at the next bar's open,
which matches the TokenEdge timing contract, and the position size is computed with the same
formula, so differences only come from Backtrader's slippage capping at the bar's high/low
and the final position being valued without exit costs.
"""

from __future__ import annotations

import math

import pandas as pd

from tokenedge.engine.backtester import run_backtest
from tokenedge.engine.costs import ExecutionConfig
from tokenedge.strategies.classical import SMACrossover


def run_backtrader_sma(
    data: pd.DataFrame,
    fast: int,
    slow: int,
    commission_bps: float,
    slippage_bps: float,
    cash: float,
) -> dict:
    import backtrader as bt

    comm = commission_bps / 1e4
    slip = slippage_bps / 1e4

    class SmaCross(bt.Strategy):
        def __init__(self):
            self.fast = bt.ind.SMA(self.data.close, period=fast)
            self.slow = bt.ind.SMA(self.data.close, period=slow)
            self.entries = 0

        def next_open(self):
            # Indicators here still hold the previous bar's values: signal from bar t-1,
            # executed at the open of bar t.
            want_long = self.fast[0] > self.slow[0]
            if want_long and not self.position:
                fill = self.data.open[0] * (1 + slip)
                size = math.floor(self.broker.getcash() / (fill * (1 + comm)) + 1e-9)
                if size > 0:
                    self.buy(size=size)
                    self.entries += 1
            elif not want_long and self.position:
                self.close()

    cerebro = bt.Cerebro(cheat_on_open=True, stdstats=False)
    feed = data.copy()
    feed.index = pd.DatetimeIndex(feed.index).tz_localize(None)
    cerebro.adddata(bt.feeds.PandasData(dataname=feed))
    cerebro.addstrategy(SmaCross)
    cerebro.broker.setcash(cash)
    cerebro.broker.setcommission(commission=comm)
    cerebro.broker.set_slippage_perc(
        slip, slip_open=True, slip_limit=True, slip_match=True, slip_out=False
    )
    strat = cerebro.run()[0]
    final = cerebro.broker.getvalue()
    return {"entries": strat.entries, "total_return": final / cash - 1.0, "final_value": final}


def crosscheck_sma(
    data: pd.DataFrame,
    fast: int = 20,
    slow: int = 50,
    commission_bps: float = 10.0,
    slippage_bps: float = 0.0,
    cash: float = 100_000.0,
) -> dict:
    cfg = ExecutionConfig(
        initial_capital=cash,
        fractional=False,
        commission={"buy_bps": commission_bps, "sell_bps": commission_bps},
        slippage={"model": "fixed", "bps": slippage_bps},
    )
    sig = SMACrossover(fast=fast, slow=slow).generate_signals(data)
    ours = run_backtest(data, sig, data.index[slow], None, cfg, 252, "sma_crossover")
    theirs = run_backtrader_sma(data, fast, slow, commission_bps, slippage_bps, cash)
    our_return = float(ours.equity.iloc[-1] / cash - 1.0)
    return {
        "tokenedge": {
            "entries": int((ours.fills["side"] == "buy").sum()),
            "total_return": our_return,
        },
        "backtrader": theirs,
        "return_diff_pp": abs(our_return - theirs["total_return"]) * 100,
    }

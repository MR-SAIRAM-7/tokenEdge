"""SMA crossover parameter search on train/validation data only (FR-S3).

Each (fast, slow) pair is scored on the validation window, with the preceding history used
only to warm up the averages. The winner is frozen before the test window is ever touched,
and the number of pairs tried is reported so the Deflated Sharpe Ratio can account for it.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from tokenedge.config import DEFAULT_RISK_FREE_RATE
from tokenedge.data.loader import slice_window
from tokenedge.engine.backtester import run_backtest
from tokenedge.engine.costs import ExecutionConfig
from tokenedge.metrics.performance import finite, sharpe_ratio
from tokenedge.strategies.classical import SMACrossover

DEFAULT_FAST = (5, 10, 20, 30, 50)
DEFAULT_SLOW = (50, 100, 150, 200)


def grid_search_sma(
    data: pd.DataFrame,
    train: tuple[str, str],
    val: tuple[str, str],
    config: ExecutionConfig,
    periods_per_year: float,
    fast_grid: tuple[int, ...] = DEFAULT_FAST,
    slow_grid: tuple[int, ...] = DEFAULT_SLOW,
    ma_type: str = "sma",
    rf_annual: float = DEFAULT_RISK_FREE_RATE,
) -> dict:
    history = slice_window(data, None, val[1])  # nothing after the validation window is visible
    grid = []
    for fast in fast_grid:
        for slow in slow_grid:
            if fast >= slow:
                continue
            sig = SMACrossover(fast=fast, slow=slow, ma_type=ma_type).generate_signals(history)
            row: dict[str, Any] = {"fast": fast, "slow": slow}
            for name, (start, end) in (("train", train), ("val", val)):
                res = run_backtest(
                    history, sig, start, end, config, periods_per_year, "sma_crossover"
                )
                row[f"{name}_sharpe"] = finite(
                    sharpe_ratio(res.returns, periods_per_year, rf_annual)
                )
                row[f"{name}_return"] = finite(res.equity.iloc[-1] / config.initial_capital - 1.0)
                row[f"{name}_trades"] = len(res.trades)
            grid.append(row)

    scored = [g for g in grid if g["val_sharpe"] is not None]
    if not scored:
        raise ValueError("No SMA configuration could be evaluated on the validation window.")
    best = max(scored, key=lambda g: (g["val_sharpe"], -g["fast"]))
    val_sharpes = np.array([g["val_sharpe"] for g in scored])
    return {
        "best": {"fast": best["fast"], "slow": best["slow"], "ma_type": ma_type},
        "best_val_sharpe": best["val_sharpe"],
        "grid": grid,
        "trials": len(scored),
        "trial_sharpe_std": float(val_sharpes.std(ddof=1)) if len(val_sharpes) > 1 else None,
        "train": list(train),
        "val": list(val),
    }

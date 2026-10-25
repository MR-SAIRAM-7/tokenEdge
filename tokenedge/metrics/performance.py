"""Performance metrics computed from a BacktestResult."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from tokenedge.config import DEFAULT_RISK_FREE_RATE
from tokenedge.engine.backtester import BacktestResult
from tokenedge.metrics.statistics import MIN_STD, _moments, probabilistic_sharpe_ratio


def finite(value) -> float | None:
    """JSON-safe float: NaN and infinities become None."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def sharpe_ratio(returns: pd.Series, periods_per_year: float, rf_annual: float = 0.0) -> float:
    x = returns.dropna() - rf_annual / periods_per_year
    if len(x) < 2:
        return float("nan")
    sd = x.std(ddof=1)
    return float(x.mean() / sd * math.sqrt(periods_per_year)) if sd > MIN_STD else 0.0


def sortino_ratio(returns: pd.Series, periods_per_year: float, rf_annual: float = 0.0) -> float:
    x = returns.dropna() - rf_annual / periods_per_year
    if len(x) < 2:
        return float("nan")
    downside = math.sqrt(float((np.minimum(x, 0.0) ** 2).mean()))
    return (
        float(x.mean() / downside * math.sqrt(periods_per_year))
        if downside > MIN_STD
        else float("nan")
    )


def drawdown_duration(drawdown: pd.Series) -> tuple[int, float]:
    """Longest stretch below a previous peak, in bars and in calendar days."""
    under = (drawdown < -1e-12).to_numpy()
    best_len, best_days, run_start = 0, 0.0, None
    idx = pd.DatetimeIndex(drawdown.index)
    for i, flag in enumerate(np.append(under, False)):
        if flag and run_start is None:
            run_start = i
        elif not flag and run_start is not None:
            length = i - run_start
            if length > best_len:
                best_len = length
                end = idx[min(i, len(idx) - 1)]
                best_days = (end - idx[max(run_start - 1, 0)]).total_seconds() / 86_400.0
            run_start = None
    return best_len, best_days


def compute_metrics(result: BacktestResult, rf_annual: float = DEFAULT_RISK_FREE_RATE) -> dict:
    ppy = result.periods_per_year
    equity = result.equity
    returns = result.returns
    initial = result.config.initial_capital
    n = len(returns)
    years = n / ppy if ppy else float("nan")

    total_return = equity.iloc[-1] / initial - 1.0
    cagr = (
        (equity.iloc[-1] / initial) ** (1.0 / years) - 1.0
        if years > 0 and equity.iloc[-1] > 0
        else float("nan")
    )
    vol = float(returns.std(ddof=1) * math.sqrt(ppy)) if n > 1 else float("nan")
    mdd = float(result.drawdown.min())
    dd_bars, dd_days = drawdown_duration(result.drawdown)
    sharpe = sharpe_ratio(returns, ppy, rf_annual)
    skew, kurt = _moments(returns.dropna().to_numpy())

    trades = result.trades
    n_trades = len(trades)
    wins = trades.loc[trades["net_pnl"] > 0, "net_pnl"] if n_trades else pd.Series(dtype=float)
    losses = trades.loc[trades["net_pnl"] <= 0, "net_pnl"] if n_trades else pd.Series(dtype=float)
    gross_loss = abs(float(losses.sum()))
    profit_factor = (
        float(wins.sum()) / gross_loss
        if gross_loss > 0
        else (float("inf") if len(wins) else float("nan"))
    )

    in_market = (result.exposure.abs() > 1e-9).mean() if n else 0.0
    mean_equity = float(equity.mean()) if n else initial
    turnover = (
        result.totals.get("traded_value", 0.0) / mean_equity / years
        if years > 0 and mean_equity > 0
        else 0.0
    )

    return {
        "total_return": finite(total_return),
        "cagr": finite(cagr),
        "volatility": finite(vol),
        "sharpe": finite(sharpe),
        "sortino": finite(sortino_ratio(returns, ppy, rf_annual)),
        "max_drawdown": finite(mdd),
        "max_drawdown_duration_bars": int(dd_bars),
        "max_drawdown_duration_days": finite(dd_days),
        "calmar": finite(cagr / abs(mdd)) if mdd < 0 and math.isfinite(cagr) else None,
        "best_period": finite(returns.max()),
        "worst_period": finite(returns.min()),
        "skew": finite(skew),
        "kurtosis": finite(kurt),
        "psr": finite(probabilistic_sharpe_ratio(returns.to_numpy(), 0.0, rf_annual / ppy)),
        "trades": int(n_trades),
        "win_rate": finite(len(wins) / n_trades) if n_trades else None,
        "avg_win": finite(wins.mean()) if len(wins) else None,
        "avg_loss": finite(losses.mean()) if len(losses) else None,
        "profit_factor": finite(profit_factor),
        "avg_trade_return": finite(trades["return"].mean()) if n_trades else None,
        "avg_bars_held": finite(trades["bars_held"].mean()) if n_trades else None,
        "turnover": finite(turnover),
        "exposure": finite(in_market),
        "total_costs": finite(result.totals.get("total_costs", 0.0)),
        "fees": finite(result.totals.get("fees", 0.0)),
        "slippage_cost": finite(result.totals.get("slippage", 0.0)),
        "borrow_cost": finite(result.totals.get("borrow", 0.0)),
        "final_equity": finite(equity.iloc[-1]),
        "n_periods": int(n),
        "years": finite(years),
        "start": equity.index[0].isoformat(),
        "end": equity.index[-1].isoformat(),
    }


def monthly_returns(result: BacktestResult) -> list[dict]:
    """Calendar-month returns for a heatmap."""
    eq = result.equity.copy()
    eq.index = pd.DatetimeIndex(eq.index).tz_localize(None) if eq.index.tz is not None else eq.index
    month_end = eq.resample("ME").last()
    prev = month_end.shift(1)
    prev.iloc[0] = result.config.initial_capital
    rets = month_end / prev - 1.0
    return [
        {"year": int(ts.year), "month": int(ts.month), "return": finite(r)}
        for ts, r in rets.items()
    ]

"""Strategy comparison, cost sensitivity and the plain-language verdict."""

from __future__ import annotations

import pandas as pd

from tokenedge.config import DEFAULT_RISK_FREE_RATE
from tokenedge.engine.backtester import BacktestResult, run_backtest
from tokenedge.engine.costs import ExecutionConfig, with_flat_cost
from tokenedge.metrics.performance import compute_metrics, finite, sharpe_ratio
from tokenedge.metrics.statistics import bootstrap_sharpe_difference, deflated_sharpe_ratio

DEFAULT_COST_LEVELS = (0.0, 5.0, 10.0, 20.0, 50.0)


def compare_strategies(
    results: dict[str, BacktestResult],
    labels: dict[str, str] | None = None,
    baseline: str | None = None,
    rf_annual: float = DEFAULT_RISK_FREE_RATE,
    trials: dict[str, int] | None = None,
    trial_sharpe_std: dict[str, float | None] | None = None,
    bootstrap_samples: int = 5000,
    block_size: float | None = None,
    seed: int = 42,
) -> dict:
    """Metrics for every strategy, DSR per strategy and bootstrap Sharpe differences vs baseline."""
    labels = labels or {k: k for k in results}
    trials = trials or {}
    trial_sharpe_std = trial_sharpe_std or {}
    metrics = {name: compute_metrics(res, rf_annual) for name, res in results.items()}

    dsr = {}
    for name, res in results.items():
        dsr[name] = deflated_sharpe_ratio(
            res.returns.to_numpy(),
            n_trials=max(int(trials.get(name, 1)), 1),
            periods_per_year=res.periods_per_year,
            rf_annual=rf_annual,
            trial_sharpe_std_annual=trial_sharpe_std.get(name),
        )

    if baseline is None or baseline not in results:
        baseline = next((k for k in results if k.startswith("sma")), next(iter(results)))

    diffs: dict[str, dict | None] = {}
    base_ret = results[baseline].returns
    for name, res in results.items():
        if name == baseline:
            continue
        aligned = pd.concat([res.returns, base_ret], axis=1, join="inner")
        diffs[name] = bootstrap_sharpe_difference(
            aligned.iloc[:, 0].to_numpy(),
            aligned.iloc[:, 1].to_numpy(),
            res.periods_per_year,
            n_samples=bootstrap_samples,
            block_size=block_size,
            seed=seed,
            rf_annual=rf_annual,
        )

    ranking = sorted(
        results,
        key=lambda k: metrics[k]["sharpe"] if metrics[k]["sharpe"] is not None else -1e9,
        reverse=True,
    )
    return {
        "baseline": baseline,
        "metrics": metrics,
        "dsr": dsr,
        "sharpe_diff": diffs,
        "ranking": ranking,
        "verdict": build_verdict(metrics, dsr, diffs, baseline, labels),
    }


def _fmt(x: float | None, digits: int = 2) -> str:
    return "n/a" if x is None else f"{x:.{digits}f}"


def build_verdict(
    metrics: dict[str, dict],
    dsr: dict[str, dict],
    diffs: dict[str, dict | None],
    baseline: str,
    labels: dict[str, str],
) -> str:
    def lab(k: str) -> str:
        return labels.get(k, k)

    any_metrics = next(iter(metrics.values()))
    window = f"{any_metrics['start'][:10]} to {any_metrics['end'][:10]}"
    ranking = sorted(
        metrics,
        key=lambda k: metrics[k]["sharpe"] if metrics[k]["sharpe"] is not None else -1e9,
        reverse=True,
    )
    best = ranking[0]
    parts = [
        f"On the window {window}, the highest Sharpe ratio was {lab(best)} "
        f"({_fmt(metrics[best]['sharpe'])}, max drawdown {_fmt((metrics[best]['max_drawdown'] or 0) * 100, 1)}%)."
    ]

    challengers = [k for k in ranking if k != baseline and not k.startswith("buy_hold")]
    if not challengers and baseline != best:
        parts.append(f"{lab(baseline)} Sharpe: {_fmt(metrics[baseline]['sharpe'])}.")
    for name in challengers:
        d = diffs.get(name)
        if not d:
            continue
        verdict = (
            "a statistically significant improvement"
            if d["ci_low"] > 0
            else "significantly worse"
            if d["ci_high"] < 0
            else "not statistically significant"
        )
        parts.append(
            f"{lab(name)} vs {lab(baseline)}: Sharpe {_fmt(metrics[name]['sharpe'])} vs "
            f"{_fmt(metrics[baseline]['sharpe'])}, difference {d['estimate']:+.2f} "
            f"(95% CI [{d['ci_low']:+.2f}, {d['ci_high']:+.2f}], p = {d['p_value']:.2f}): {verdict}."
        )

    d_best = dsr.get(best, {})
    if d_best.get("dsr") is not None and d_best.get("n_trials", 1) > 1:
        parts.append(
            f"After correcting for {d_best['n_trials']} trials, the Deflated Sharpe probability for "
            f"{lab(best)} is {d_best['dsr']:.2f}."
        )
    bh = next((k for k in metrics if k.startswith("buy_hold")), None)
    if bh and bh != best:
        parts.append(f"Buy & Hold reference Sharpe: {_fmt(metrics[bh]['sharpe'])}.")
    return " ".join(parts)


def cost_sensitivity(
    data: pd.DataFrame,
    signals: dict[str, pd.Series],
    start,
    end,
    base_config: ExecutionConfig,
    periods_per_year: float,
    levels: tuple[float, ...] = DEFAULT_COST_LEVELS,
    rf_annual: float = DEFAULT_RISK_FREE_RATE,
) -> dict:
    """Re-run each strategy with a flat cost of ``level`` bps per side (no slippage)."""
    out: dict[str, dict] = {}
    for name, sig in signals.items():
        sharpe, cagr, total = [], [], []
        for bps in levels:
            res = run_backtest(
                data, sig, start, end, with_flat_cost(base_config, bps), periods_per_year, name
            )
            m = compute_metrics(res, rf_annual)
            sharpe.append(finite(sharpe_ratio(res.returns, periods_per_year, rf_annual)))
            cagr.append(m["cagr"])
            total.append(m["total_return"])
        out[name] = {
            "sharpe": sharpe,
            "cagr": cagr,
            "total_return": total,
            "break_even_bps": _break_even(list(levels), total),
        }
    return {"levels": list(levels), "strategies": out}


def _break_even(levels: list[float], values: list[float | None]) -> float | None:
    """Cost level (bps per side) where total return crosses zero, by linear interpolation."""
    pairs = [(lv, v) for lv, v in zip(levels, values, strict=False) if v is not None]
    if not pairs or pairs[0][1] <= 0:
        return 0.0 if pairs else None
    for (l0, v0), (l1, v1) in zip(pairs, pairs[1:], strict=False):
        if v0 > 0 >= v1:
            return l0 + (l1 - l0) * v0 / (v0 - v1)
    return None  # still profitable at the highest level tested

"""Business logic behind the API: windows, leakage guard, backtests, comparisons, persistence."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd

from tokenedge.api import db
from tokenedge.api.schemas import (
    BacktestRequest,
    CompareRequest,
    MarketIn,
    SensitivityRequest,
    StrategySpec,
    TuneRequest,
    WindowIn,
)
from tokenedge.config import (
    ROOT_DIR,
    asset_class_of,
    default_splits,
    get_settings,
    periods_per_year,
)
from tokenedge.data.cache import data_hash
from tokenedge.data.loader import get_ohlcv, slice_window, to_utc, to_utc_end
from tokenedge.engine.backtester import BacktestResult, run_backtest
from tokenedge.engine.costs import ExecutionConfig
from tokenedge.errors import ConfigError, InsufficientDataError
from tokenedge.labeling import make_labels
from tokenedge.metrics.performance import compute_metrics, finite, monthly_returns
from tokenedge.metrics.report import compare_strategies, cost_sensitivity
from tokenedge.ml.evaluation import classification_report
from tokenedge.ml.registry import get_registry
from tokenedge.strategies import REGISTRY, get_strategy
from tokenedge.strategies.base import Strategy
from tokenedge.strategies.ml_strategy import MLStrategy
from tokenedge.strategies.tuning import grid_search_sma
from tokenedge.validation.leakage import check_model_window, held_out_start

MIN_BARS = 60


@lru_cache(maxsize=1)
def git_sha() -> str | None:
    if get_settings().git_sha:
        return get_settings().git_sha
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            timeout=3,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


# --------------------------------------------------------------------------- helpers


@dataclass
class Prepared:
    key: str
    spec: StrategySpec
    strategy: Strategy
    label: str
    trials: int
    trial_sharpe_std: float | None
    model_meta: dict | None


def load_history(market: MarketIn, end: str | None = None) -> pd.DataFrame:
    df = get_ohlcv(market.symbol, market.source, market.interval)
    if end:
        df = slice_window(df, None, end)
    if len(df) < MIN_BARS:
        raise InsufficientDataError(
            f"Only {len(df)} bars available for {market.symbol}; at least {MIN_BARS} are needed.",
            {"bars": len(df)},
        )
    return df


def load_window_history(req: WindowIn) -> pd.DataFrame:
    """History for a request: everything, or up to the end date of a custom window."""
    if req.window != "custom":
        return load_history(req)
    if req.start and req.end and to_utc(req.start) > to_utc_end(req.end):
        raise ConfigError(
            f"The start date ({req.start}) is after the end date ({req.end}).",
            {"start": req.start, "end": req.end},
        )
    return load_history(req, req.end)


MODEL_TYPE_LABELS = {"xgboost": "XGBoost", "lstm": "LSTM"}


def _label_for(spec: StrategySpec, strategy: Strategy, meta: dict | None = None) -> str:
    if spec.label:
        return spec.label
    p = strategy.params.model_dump()
    if strategy.name in ("sma_crossover", "sma_ml_filter"):
        prefix = "EMA" if p.get("ma_type") == "ema" else "SMA"
        label = f"{prefix} {p['fast']}/{p['slow']}"
        if strategy.name == "sma_ml_filter" and meta:
            kind = meta.get("model_type", "")
            label += f" + {MODEL_TYPE_LABELS.get(kind, kind)} filter"
        return label
    return strategy.label


def prepare_strategies(
    specs: list[StrategySpec], market: MarketIn, warnings: list[str]
) -> list[Prepared]:
    prepared: list[Prepared] = []
    seen: dict[str, int] = {}
    registry = get_registry()
    for spec in specs:
        if spec.name not in REGISTRY:
            raise ConfigError(f"Unknown strategy '{spec.name}'.", {"available": sorted(REGISTRY)})
        strategy = get_strategy(spec.name, spec.params)
        meta = None
        trials = spec.trials or 1
        trial_std = spec.trial_sharpe_std
        if isinstance(strategy, MLStrategy):
            meta = registry.info(strategy.params.model_id).metadata  # type: ignore[attr-defined]
            if strategy.model_type and meta.get("model_type") != strategy.model_type:
                have = MODEL_TYPE_LABELS.get(meta.get("model_type", ""), meta.get("model_type"))
                need = MODEL_TYPE_LABELS.get(strategy.model_type, strategy.model_type)
                raise ConfigError(
                    f"Model '{meta.get('model_id')}' is an {have} model, "
                    f"but the {strategy.label} strategy needs an {need} model."
                )
            cv = meta.get("cv") or {}
            trials = spec.trials or int(cv.get("trials") or 1)
            trial_std = (
                spec.trial_sharpe_std
                if spec.trial_sharpe_std is not None
                else cv.get("trial_sharpe_std")
            )
            if meta.get("symbol") != market.symbol or meta.get("interval") != market.interval:
                warnings.append(
                    f"Model {meta['model_id']} was trained on {meta.get('symbol')} {meta.get('interval')} "
                    f"but is being applied to {market.symbol} {market.interval}."
                )
        count = seen.get(spec.name, 0) + 1
        seen[spec.name] = count
        key = spec.name if count == 1 else f"{spec.name}_{count}"
        prepared.append(
            Prepared(key, spec, strategy, _label_for(spec, strategy, meta), trials, trial_std, meta)
        )
    return prepared


def resolve_window(
    req: WindowIn, prepared: list[Prepared], index: pd.DatetimeIndex
) -> tuple[pd.Timestamp, pd.Timestamp]:
    splits = default_splits(req.source)
    first, last = index[0], index[-1]
    if req.window == "custom":
        start = to_utc(req.start) if req.start else first
        end = to_utc_end(req.end) if req.end else last
    elif req.window == "full":
        start, end = first, last
    elif req.window == "model_test":
        held = [held_out_start(p.model_meta) for p in prepared if p.model_meta]
        start = max(held) if held else to_utc(splits.test[0])
        end = to_utc_end(req.end) if req.end else last
    else:
        window = getattr(splits, req.window)
        start = to_utc(window[0])
        end = to_utc(window[1]) if window[1] else last
        if req.window != "test" and window[1]:
            end = end + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    start = max(start, first)
    end = min(end, last)
    if start >= end:
        raise InsufficientDataError(
            f"Empty window: {start.date()} to {end.date()} (data covers {first.date()} to {last.date()}).",
            {"start": start.isoformat(), "end": end.isoformat()},
        )
    return start, end


def guard(prepared: list[Prepared], start: pd.Timestamp, allow_in_sample: bool) -> dict:
    in_sample = False
    held: list[str] = []
    test_models: list[str] = []
    for p in prepared:
        if not p.model_meta:
            continue
        res = check_model_window(p.model_meta, start, allow_in_sample)
        held.append(res["held_out_start"])
        if res["in_sample"]:
            in_sample = True
        else:
            test_models.append(p.model_meta["model_id"])
    return {
        "in_sample": in_sample,
        "held_out_start": max(held) if held else None,
        "test_models": test_models,
    }


def run_prepared(
    data: pd.DataFrame, p: Prepared, start, end, cfg: ExecutionConfig, ppy: float
) -> tuple[BacktestResult, pd.Series, pd.Series | None]:
    proba = None
    if isinstance(p.strategy, MLStrategy):
        signals, proba = p.strategy.signals_and_proba(data)
    else:
        signals = p.strategy.generate_signals(data)
    res = run_backtest(data, signals, start, end, cfg, ppy, p.key, p.strategy.params.model_dump())
    return res, signals, proba


def ml_diagnostics(p: Prepared, proba: pd.Series, data: pd.DataFrame, start, end) -> dict | None:
    """Classification metrics on the backtest window (accuracy is not profitability: FR-X9)."""
    if p.model_meta is None or proba is None:
        return None
    labels = make_labels(
        data["close"], p.model_meta.get("label") or {"method": "fixed_horizon", "horizon": 1}
    )
    window = (data.index >= start) & (data.index <= end)
    y = labels["label"][window]
    pr = proba[window]
    ok = y.notna() & pr.notna()
    if ok.sum() < 10:
        return None
    long_t = (p.model_meta.get("threshold") or {}).get("long", 0.5)
    rep = classification_report(y[ok].to_numpy(), pr[ok].to_numpy(), 0.5)
    rep["at_trading_threshold"] = classification_report(y[ok].to_numpy(), pr[ok].to_numpy(), long_t)
    return rep


def _epoch(index: pd.DatetimeIndex) -> list[int]:
    return pd.DatetimeIndex(index).as_unit("s").asi8.tolist()


def _arr(series: pd.Series | np.ndarray, digits: int = 6) -> list:
    values = np.asarray(series, dtype="float64")
    rounded = np.round(values, digits)
    return [None if not np.isfinite(v) else float(v) for v in rounded]


def trades_json(trades: pd.DataFrame, limit: int = 2000) -> list[dict]:
    out = []
    for row in trades.tail(limit).itertuples(index=False):
        out.append(
            {
                "entry_time": row.entry_time.isoformat(),
                "exit_time": row.exit_time.isoformat(),
                "side": row.side,
                "qty": finite(row.qty),
                "entry_price": finite(row.entry_price),
                "exit_price": finite(row.exit_price),
                "gross_pnl": finite(row.gross_pnl),
                "costs": finite(row.costs),
                "fees": finite(row.fees),
                "slippage": finite(row.slippage),
                "net_pnl": finite(row.net_pnl),
                "return": finite(row[12]),
                "bars_held": int(row.bars_held),
            }
        )
    return out


def fills_json(fills: pd.DataFrame, limit: int = 4000) -> list[dict]:
    return [
        {
            "time": int(pd.Timestamp(r.timestamp).timestamp()),
            "side": r.side,
            "price": finite(r.fill_price),
            "qty": finite(r.qty),
            "reason": r.reason,
        }
        for r in fills.tail(limit).itertuples(index=False)
    ]


def _execution_dict(cfg: ExecutionConfig, preset: str | None) -> dict:
    return {**cfg.model_dump(), "preset": preset}


def _strategy_meta(p: Prepared) -> dict:
    return {
        "key": p.key,
        "name": p.strategy.name,
        "label": p.label,
        "kind": p.strategy.kind,
        "params": p.strategy.params.model_dump(),
        "trials": p.trials,
        "model_id": p.model_meta.get("model_id") if p.model_meta else None,
    }


# --------------------------------------------------------------------------- endpoints


def backtest(req: BacktestRequest) -> dict:
    warnings: list[str] = []
    cfg, preset = req.execution.to_config(req.symbol, req.source, req.risk_free_rate)
    data = load_window_history(req)
    prepared = prepare_strategies([req.strategy], req, warnings)
    start, end = resolve_window(req, prepared, pd.DatetimeIndex(data.index))
    g = guard(prepared, start, req.allow_in_sample)
    data = slice_window(data, None, end)
    ppy = periods_per_year(req.interval, asset_class_of(req.source))

    p = prepared[0]
    res, _, proba = run_prepared(data, p, start, end, cfg, ppy)
    metrics = compute_metrics(res, req.risk_free_rate)
    window_data = data.loc[res.equity.index]

    series = {
        "timestamp": _epoch(res.equity.index),
        "equity": _arr(res.equity, 2),
        "drawdown": _arr(res.drawdown, 5),
        "exposure": _arr(res.exposure, 4),
        "target": _arr(res.target, 2),
        "open": _arr(window_data["open"], 6),
        "high": _arr(window_data["high"], 6),
        "low": _arr(window_data["low"], 6),
        "close": _arr(window_data["close"], 6),
        "volume": _arr(window_data["volume"], 2),
    }
    benchmark = None
    if req.benchmark and p.strategy.name != "buy_hold":
        bh = get_strategy("buy_hold")
        bres = run_backtest(data, bh.generate_signals(data), start, end, cfg, ppy, "buy_hold")
        series["benchmark_equity"] = _arr(bres.equity, 2)
        series["benchmark_drawdown"] = _arr(bres.drawdown, 5)
        benchmark = compute_metrics(bres, req.risk_free_rate)
    if proba is not None:
        series["proba"] = _arr(proba.reindex(res.equity.index), 4)

    response = {
        "kind": "backtest",
        "symbol": req.symbol,
        "source": req.source,
        "interval": req.interval,
        "window": {"name": req.window, "start": start.isoformat(), "end": end.isoformat()},
        "in_sample": g["in_sample"],
        "held_out_start": g["held_out_start"],
        "warnings": warnings,
        "strategies": [_strategy_meta(p)],
        "strategy": _strategy_meta(p),
        "execution": _execution_dict(cfg, preset),
        "risk_free_rate": req.risk_free_rate,
        "periods_per_year": ppy,
        "metrics": metrics,
        "benchmark_metrics": benchmark,
        "series": series,
        "trades": trades_json(res.trades),
        "fills": fills_json(res.fills),
        "monthly_returns": monthly_returns(res),
        "diagnostics": ml_diagnostics(p, proba, data, start, end) if proba is not None else None,
        "model_ids": [p.model_meta["model_id"]] if p.model_meta else [],
        "data_hash": data_hash(data),
        "git_sha": git_sha(),
    }
    if req.save:
        db.save_run(
            "backtest",
            req.model_dump(),
            response,
            {p.key: db.summary_metrics(metrics)},
            g["test_models"],
        )
    return response


def compare(req: CompareRequest) -> dict:
    warnings: list[str] = []
    cfg, preset = req.execution.to_config(req.symbol, req.source, req.risk_free_rate)
    data = load_window_history(req)
    prepared = prepare_strategies(req.strategies, req, warnings)
    start, end = resolve_window(req, prepared, pd.DatetimeIndex(data.index))
    g = guard(prepared, start, req.allow_in_sample)
    data = slice_window(data, None, end)
    ppy = periods_per_year(req.interval, asset_class_of(req.source))

    results: dict[str, BacktestResult] = {}
    signals: dict[str, pd.Series] = {}
    diagnostics: dict[str, dict | None] = {}
    for p in prepared:
        res, sig, proba = run_prepared(data, p, start, end, cfg, ppy)
        results[p.key] = res
        signals[p.key] = sig
        if proba is not None:
            diagnostics[p.key] = ml_diagnostics(p, proba, data, start, end)

    baseline = req.statistics.baseline
    if baseline is not None and baseline not in results:
        raise ConfigError(
            f"Baseline '{baseline}' is not one of the compared strategies.", {"keys": list(results)}
        )
    report = compare_strategies(
        results,
        labels={p.key: p.label for p in prepared},
        baseline=baseline,
        rf_annual=req.risk_free_rate,
        trials={p.key: p.trials for p in prepared},
        trial_sharpe_std={p.key: p.trial_sharpe_std for p in prepared},
        bootstrap_samples=req.statistics.bootstrap_samples,
        block_size=req.statistics.block_size,
        seed=req.statistics.seed,
    )
    sens = (
        cost_sensitivity(
            data, signals, start, end, cfg, ppy, tuple(req.cost_levels), req.risk_free_rate
        )
        if req.cost_levels
        else None
    )

    first = next(iter(results.values()))
    response = {
        "kind": "compare",
        "symbol": req.symbol,
        "source": req.source,
        "interval": req.interval,
        "window": {"name": req.window, "start": start.isoformat(), "end": end.isoformat()},
        "in_sample": g["in_sample"],
        "held_out_start": g["held_out_start"],
        "warnings": warnings,
        "strategies": [_strategy_meta(p) for p in prepared],
        "execution": _execution_dict(cfg, preset),
        "risk_free_rate": req.risk_free_rate,
        "periods_per_year": ppy,
        **report,
        "series": {
            "timestamp": _epoch(first.equity.index),
            "close": _arr(data.loc[first.equity.index, "close"], 6),
            "equity": {k: _arr(r.equity, 2) for k, r in results.items()},
            "drawdown": {k: _arr(r.drawdown, 5) for k, r in results.items()},
        },
        "trades": {k: trades_json(r.trades, 1000) for k, r in results.items()},
        "monthly_returns": {k: monthly_returns(r) for k, r in results.items()},
        "sensitivity": sens,
        "diagnostics": diagnostics,
        "model_ids": [p.model_meta["model_id"] for p in prepared if p.model_meta],
        "data_hash": data_hash(data),
        "git_sha": git_sha(),
    }
    if req.save:
        db.save_run(
            "compare",
            req.model_dump(),
            response,
            {k: db.summary_metrics(m) for k, m in report["metrics"].items()},
            g["test_models"],
        )
    return response


def sensitivity(req: SensitivityRequest) -> dict:
    warnings: list[str] = []
    cfg, _ = req.execution.to_config(req.symbol, req.source, req.risk_free_rate)
    data = load_window_history(req)
    prepared = prepare_strategies(req.strategies, req, warnings)
    start, end = resolve_window(req, prepared, pd.DatetimeIndex(data.index))
    g = guard(prepared, start, req.allow_in_sample)
    data = slice_window(data, None, end)
    ppy = periods_per_year(req.interval, asset_class_of(req.source))
    signals = {p.key: run_prepared(data, p, start, end, cfg, ppy)[1] for p in prepared}
    out = cost_sensitivity(
        data, signals, start, end, cfg, ppy, tuple(req.cost_levels), req.risk_free_rate
    )
    return {
        **out,
        "labels": {p.key: p.label for p in prepared},
        "in_sample": g["in_sample"],
        "warnings": warnings,
        "window": {"start": start.isoformat(), "end": end.isoformat()},
    }


def tune_sma(req: TuneRequest) -> dict:
    cfg, preset = req.execution.to_config(req.symbol, req.source, req.risk_free_rate)
    splits = default_splits(req.source)
    data = load_history(req, splits.val[1])
    ppy = periods_per_year(req.interval, asset_class_of(req.source))
    result = grid_search_sma(
        data,
        splits.train,
        splits.val,
        cfg,
        ppy,
        tuple(req.fast_grid),
        tuple(req.slow_grid),
        req.ma_type,
        req.risk_free_rate,
    )
    return {**result, "symbol": req.symbol, "interval": req.interval, "preset": preset}

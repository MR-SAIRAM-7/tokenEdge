"""Experiments E1-E6 from the PRD (section 11.3), used by notebooks/03_experiments.ipynb.

E1/E2/E5/E6 only evaluate existing models and run anywhere. E3 and E4 train small XGBoost
models and are meant for Colab.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from tokenedge.config import (
    DEFAULT_RISK_FREE_RATE,
    asset_class_of,
    default_cost_preset_for,
    default_label_config,
    default_splits,
    periods_per_year,
)
from tokenedge.data.loader import get_ohlcv, slice_window, to_utc
from tokenedge.engine.backtester import BacktestResult, run_backtest
from tokenedge.engine.costs import ExecutionConfig, execution_from_preset
from tokenedge.labeling import make_labels
from tokenedge.metrics.performance import compute_metrics
from tokenedge.metrics.report import compare_strategies, cost_sensitivity
from tokenedge.ml.datasets import build_dataset
from tokenedge.ml.evaluation import classification_report
from tokenedge.ml.registry import get_registry
from tokenedge.ml.splits import SplitWindows, assign_splits
from tokenedge.strategies import get_strategy
from tokenedge.strategies.tuning import grid_search_sma
from tokenedge.validation.leakage import held_out_start

MarketSpec = tuple[str, str, str]  # (symbol, source, interval)

DEFAULT_MARKETS: list[MarketSpec] = [
    ("SPY", "yfinance", "1d"),
    ("AAPL", "yfinance", "1d"),
    ("RELIANCE.NS", "yfinance", "1d"),
    ("BTC/USDT", "ccxt", "1h"),
    ("ETH/USDT", "ccxt", "1h"),
]


@dataclass
class MarketRun:
    market: MarketSpec
    window: tuple[pd.Timestamp, pd.Timestamp]
    data: pd.DataFrame
    signals: dict[str, pd.Series]
    results: dict[str, BacktestResult]
    report: dict
    diagnostics: dict[str, dict]
    config: ExecutionConfig


def run_market(
    symbol: str,
    source: str,
    interval: str,
    rf_annual: float = DEFAULT_RISK_FREE_RATE,
    bootstrap_samples: int = 5000,
) -> MarketRun:
    """Buy & Hold vs tuned SMA vs every registered model for this market, on held-out data."""
    df = get_ohlcv(symbol, source, interval)
    splits = default_splits(source)
    ppy = periods_per_year(interval, asset_class_of(source))
    cfg = execution_from_preset(default_cost_preset_for(symbol, source))

    tune = grid_search_sma(df, splits.train, splits.val, cfg, ppy, rf_annual=rf_annual)
    models = [
        m for m in get_registry().list() if m["symbol"] == symbol and m["interval"] == interval
    ]
    starts = [to_utc(splits.test[0])] + [
        held_out_start(get_registry().info(m["model_id"]).metadata) for m in models
    ]
    start, end = max(starts), df.index[-1]

    strategies = {
        "buy_hold": (get_strategy("buy_hold"), 1, None),
        "sma_crossover": (
            get_strategy("sma_crossover", tune["best"]),
            tune["trials"],
            tune["trial_sharpe_std"],
        ),
    }
    for m in models:
        md = get_registry().info(m["model_id"]).metadata
        cv = md.get("cv") or {}
        key = m["model_type"] if m["model_type"] not in strategies else m["model_id"]
        strategies[key] = (
            get_strategy(m["model_type"], {"model_id": m["model_id"]}),
            int(cv.get("trials") or 1),
            cv.get("trial_sharpe_std"),
        )

    signals, results, diagnostics = {}, {}, {}
    for key, (strat, _, _) in strategies.items():
        sig = strat.generate_signals(df)
        signals[key] = sig
        results[key] = run_backtest(df, sig, start, end, cfg, ppy, key)
        if strat.kind == "ml":
            proba = strat.predict_proba(df)  # type: ignore[attr-defined]
            md = strat.model().metadata  # type: ignore[attr-defined]
            labels = make_labels(df["close"], md["label"])["label"]
            mask = (df.index >= start) & labels.notna() & proba.notna()
            diagnostics[key] = classification_report(labels[mask], proba[mask], 0.5)

    report = compare_strategies(
        results,
        labels={k: k for k in results},
        baseline="sma_crossover",
        rf_annual=rf_annual,
        trials={k: v[1] for k, v in strategies.items()},
        trial_sharpe_std={k: v[2] for k, v in strategies.items()},
        bootstrap_samples=bootstrap_samples,
    )
    report["sma_params"] = tune["best"]
    return MarketRun(
        (symbol, source, interval), (start, end), df, signals, results, report, diagnostics, cfg
    )


def e1_main_comparison(
    markets: list[MarketSpec] | None = None, **kw
) -> tuple[pd.DataFrame, list[MarketRun]]:
    """E1 + E5: metrics, DSR and bootstrap Sharpe difference per market and strategy."""
    rows, runs = [], []
    for symbol, source, interval in markets or DEFAULT_MARKETS:
        run = run_market(symbol, source, interval, **kw)
        runs.append(run)
        for key, m in run.report["metrics"].items():
            diff = run.report["sharpe_diff"].get(key) or {}
            rows.append(
                {
                    "market": f"{symbol} {interval}",
                    "strategy": key,
                    "window": f"{run.window[0].date()} to {run.window[1].date()}",
                    "total_return": m["total_return"],
                    "cagr": m["cagr"],
                    "sharpe": m["sharpe"],
                    "sortino": m["sortino"],
                    "max_drawdown": m["max_drawdown"],
                    "calmar": m["calmar"],
                    "psr": m["psr"],
                    "dsr": run.report["dsr"][key]["dsr"],
                    "trials": run.report["dsr"][key]["n_trials"],
                    "trades": m["trades"],
                    "sharpe_diff_vs_sma": diff.get("estimate"),
                    "ci_low": diff.get("ci_low"),
                    "ci_high": diff.get("ci_high"),
                    "p_value": diff.get("p_value"),
                }
            )
    return pd.DataFrame(rows), runs


def e2_cost_sensitivity(
    runs: list[MarketRun], levels: tuple[float, ...] = (0, 5, 10, 20, 50)
) -> pd.DataFrame:
    rows = []
    for run in runs:
        ppy = next(iter(run.results.values())).periods_per_year
        sens = cost_sensitivity(run.data, run.signals, *run.window, run.config, ppy, levels)
        for key, s in sens["strategies"].items():
            for lv, sh, tr in zip(levels, s["sharpe"], s["total_return"], strict=True):
                rows.append(
                    {
                        "market": f"{run.market[0]} {run.market[2]}",
                        "strategy": key,
                        "bps_per_side": lv,
                        "sharpe": sh,
                        "total_return": tr,
                        "break_even_bps": s["break_even_bps"],
                    }
                )
    return pd.DataFrame(rows)


def e6_accuracy_vs_profit(runs: list[MarketRun]) -> pd.DataFrame:
    rows = []
    for run in runs:
        for key, rep in run.diagnostics.items():
            rows.append(
                {
                    "market": f"{run.market[0]} {run.market[2]}",
                    "model": key,
                    "accuracy": rep.get("accuracy"),
                    "roc_auc": rep.get("roc_auc"),
                    "base_rate": rep.get("base_rate"),
                    "sharpe": run.report["metrics"][key]["sharpe"],
                    "total_return": run.report["metrics"][key]["total_return"],
                }
            )
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- E3 / E4 (Colab)


def _quick_xgb(X: np.ndarray, y: np.ndarray, X_val=None, y_val=None, seed: int = 42):
    import xgboost as xgb

    params = {
        "objective": "binary:logistic",
        "max_depth": 3,
        "eta": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "seed": seed,
        "verbosity": 0,
    }
    dtrain = xgb.DMatrix(X, label=y)
    if X_val is not None:
        dval = xgb.DMatrix(X_val, label=y_val)
        return xgb.train(
            params,
            dtrain,
            1000,
            evals=[(dval, "val")],
            early_stopping_rounds=50,
            verbose_eval=False,
        )
    return xgb.train(params, dtrain, 300)


def e3_label_ablation(
    symbol: str = "SPY", source: str = "yfinance", interval: str = "1d", n_trials: int = 20
) -> pd.DataFrame:
    """Train the full XGBoost pipeline with each labeling method; compare on the test window."""
    import tempfile

    from tokenedge.ml.registry import ModelRegistry
    from tokenedge.ml.xgb_model import train_xgboost

    df = get_ohlcv(symbol, source, interval)
    ppy = periods_per_year(interval, asset_class_of(source))
    cfg = execution_from_preset(default_cost_preset_for(symbol, source))
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for method in ("fixed_horizon", "triple_barrier"):
            out = train_xgboost(
                df,
                symbol,
                source,
                interval,
                label_config=default_label_config(method, interval),
                n_trials=n_trials,
                output_dir=tmp,
                verbose=False,
            )
            model = ModelRegistry(tmp).load(out.metadata["model_id"])
            proba = model.predict_proba(df)
            th = out.metadata["threshold"]["long"]
            sig = (
                pd.Series(np.where(proba > th, 1.0, 0.0), index=df.index)
                .where(proba.notna())
                .fillna(0.0)
            )
            start = held_out_start(out.metadata)
            res = run_backtest(df, sig, start, None, cfg, ppy, method)
            m = compute_metrics(res)
            rows.append(
                {
                    "label_method": method,
                    "val_auc": out.metadata["metrics"]["val"]["roc_auc"],
                    "test_sharpe": m["sharpe"],
                    "test_total_return": m["total_return"],
                    "test_max_drawdown": m["max_drawdown"],
                    "test_trades": m["trades"],
                }
            )
    return pd.DataFrame(rows)


def e4_lookahead_demo(
    symbol: str = "SPY", source: str = "yfinance", interval: str = "1d"
) -> pd.DataFrame:
    """How much do common leaks inflate a backtest? (educational)

    * clean: model fit on train, early-stopped on validation, evaluated on test.
    * leak_in_sample: model fit on everything, including the test window.
    * leak_peek_one_bar: clean model, but each signal is executed one bar early,
      i.e. the strategy trades on information it would only have tomorrow.
    """
    df = get_ohlcv(symbol, source, interval)
    ppy = periods_per_year(interval, asset_class_of(source))
    cfg = execution_from_preset(default_cost_preset_for(symbol, source))
    splits = SplitWindows.from_config(default_splits(source))
    ds = build_dataset(df, "v1", interval, default_label_config("fixed_horizon", interval))
    parts = assign_splits(pd.DatetimeIndex(ds.X.index), ds.t1, splits)
    X, y = ds.X.to_numpy("float32"), ds.y.to_numpy()
    test_start = to_utc(splits.test[0])

    clean = _quick_xgb(X[parts["train"]], y[parts["train"]], X[parts["val"]], y[parts["val"]])
    leaky = _quick_xgb(X, y)  # every labeled row, test window included

    def backtest(booster, shift: int = 0) -> dict:
        import xgboost as xgb

        p = pd.Series(booster.predict(xgb.DMatrix(X)), index=ds.X.index).reindex(df.index)
        sig = pd.Series(np.where(p > 0.5, 1.0, 0.0), index=df.index).where(p.notna()).fillna(0.0)
        if shift:
            sig = sig.shift(-shift).fillna(0.0)
        res = run_backtest(slice_window(df, None, None), sig, test_start, None, cfg, ppy, "e4")
        return compute_metrics(res)

    rows = []
    for name, booster, shift in (
        ("clean", clean, 0),
        ("leak_in_sample", leaky, 0),
        ("leak_peek_one_bar", clean, 1),
    ):
        m = backtest(booster, shift)
        rows.append(
            {
                "variant": name,
                "sharpe": m["sharpe"],
                "total_return": m["total_return"],
                "max_drawdown": m["max_drawdown"],
            }
        )
    return pd.DataFrame(rows)

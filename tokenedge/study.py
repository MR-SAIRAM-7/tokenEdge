"""The research study: a fixed set of comparisons and backtests behind the reported findings.

Every study run is an ordinary run of the engine on the bundled market data and the registered
models. Running the study executes the scenarios below and saves them to the run history, which
feeds the dashboard, the findings scoreboard and Run History.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

from tokenedge.api import db
from tokenedge.api.schemas import (
    BacktestRequest,
    CompareRequest,
    ExecutionIn,
    StrategySpec,
    TuneRequest,
)
from tokenedge.ml.registry import get_registry

log = logging.getLogger(__name__)

STUDY_MARKETS: list[tuple[str, str, str]] = [
    ("SPY", "yfinance", "1d"),
    ("AAPL", "yfinance", "1d"),
    ("RELIANCE.NS", "yfinance", "1d"),
    ("TCS.NS", "yfinance", "1d"),
    ("BTC/USDT", "ccxt", "1h"),
    ("ETH/USDT", "ccxt", "1h"),
]


@dataclass
class StudyStatus:
    state: str = "idle"  # idle | running | done | error
    done: int = 0
    total: int = 0
    current: str = ""
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "state": self.state,
            "done": self.done,
            "total": self.total,
            "current": self.current,
            "errors": self.errors,
        }


STATUS = StudyStatus()
_lock = threading.Lock()


def _models_for(symbol: str, interval: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in get_registry().list():
        if m["symbol"] == symbol and m["interval"] == interval and m["model_type"] not in out:
            out[m["model_type"]] = m["model_id"]
    return out


def _scenarios() -> list[tuple[str, object]]:
    """(description, request) pairs, built lazily so they reflect the models present now."""
    from tokenedge.api import services

    items: list[tuple[str, object]] = []
    for symbol, source, interval in STUDY_MARKETS:
        models = _models_for(symbol, interval)

        def compare_request(symbol=symbol, source=source, interval=interval, models=models):
            tune = services.tune_sma(TuneRequest(symbol=symbol, source=source, interval=interval))
            specs = [
                StrategySpec(name="buy_hold"),
                StrategySpec(
                    name="sma_crossover",
                    params=tune["best"],
                    trials=tune["trials"],
                    trial_sharpe_std=tune["trial_sharpe_std"],
                ),
            ]
            for model_type in ("xgboost", "lstm"):
                if model_type in models:
                    specs.append(
                        StrategySpec(name=model_type, params={"model_id": models[model_type]})
                    )
            return CompareRequest(
                symbol=symbol,
                source=source,
                interval=interval,
                window="model_test" if models else "test",
                strategies=specs,
                name=f"{symbol}: classical vs ML on held-out data",
            )

        items.append((f"Comparison · {symbol} {interval}", compare_request))

    def backtest(name, symbol, source, interval, strategy, params, **kw):
        return lambda: BacktestRequest(
            symbol=symbol,
            source=source,
            interval=interval,
            strategy=StrategySpec(name=strategy, params=params),
            name=name,
            **kw,
        )

    items += [
        (
            "Backtest · SPY golden cross",
            backtest(
                "SPY golden cross (SMA 50/200)",
                "SPY",
                "yfinance",
                "1d",
                "sma_crossover",
                {"fast": 50, "slow": 200},
            ),
        ),
        (
            "Backtest · BTC EMA",
            backtest(
                "BTC/USDT hourly EMA 24/168",
                "BTC/USDT",
                "ccxt",
                "1h",
                "sma_crossover",
                {"fast": 24, "slow": 168, "ma_type": "ema"},
            ),
        ),
        (
            "Backtest · TCS long/short",
            backtest(
                "TCS.NS SMA 20/100 long/short, NSE costs",
                "TCS.NS",
                "yfinance",
                "1d",
                "sma_crossover",
                {"fast": 20, "slow": 100},
                execution=ExecutionIn(
                    preset="india_equity_nse", mode="long_short", borrow_rate=0.02
                ),
            ),
        ),
    ]
    spy_models = _models_for("SPY", "1d")
    if "xgboost" in spy_models:
        items.append(
            (
                "Backtest · SPY XGBoost",
                backtest(
                    "SPY XGBoost on its held-out window",
                    "SPY",
                    "yfinance",
                    "1d",
                    "xgboost",
                    {"model_id": spy_models["xgboost"]},
                    window="model_test",
                ),
            )
        )
        items.append(
            (
                "Backtest · SPY XGBoost bet sizing",
                backtest(
                    "SPY XGBoost with probability bet sizing",
                    "SPY",
                    "yfinance",
                    "1d",
                    "xgboost",
                    {"model_id": spy_models["xgboost"], "sizing": "probability"},
                    window="model_test",
                ),
            )
        )
        items.append(
            (
                "Backtest · SPY SMA + XGBoost filter",
                backtest(
                    "SPY SMA 20/50 filtered by XGBoost",
                    "SPY",
                    "yfinance",
                    "1d",
                    "sma_ml_filter",
                    {"fast": 20, "slow": 50, "model_id": spy_models["xgboost"]},
                    window="model_test",
                ),
            )
        )
        items.append(
            (
                "Backtest · SPY XGBoost in-sample",
                backtest(
                    "SPY XGBoost on validation data (in-sample, for contrast)",
                    "SPY",
                    "yfinance",
                    "1d",
                    "xgboost",
                    {"model_id": spy_models["xgboost"]},
                    window="val",
                    allow_in_sample=True,
                ),
            )
        )
    if "lstm" in spy_models:
        items.append(
            (
                "Backtest · SPY LSTM",
                backtest(
                    "SPY LSTM on its held-out window",
                    "SPY",
                    "yfinance",
                    "1d",
                    "lstm",
                    {"model_id": spy_models["lstm"]},
                    window="model_test",
                ),
            )
        )
    rel = _models_for("RELIANCE.NS", "1d")
    if "xgboost" in rel:
        items.append(
            (
                "Backtest · RELIANCE XGBoost",
                backtest(
                    "RELIANCE.NS XGBoost with NSE costs",
                    "RELIANCE.NS",
                    "yfinance",
                    "1d",
                    "xgboost",
                    {"model_id": rel["xgboost"]},
                    window="model_test",
                ),
            )
        )
    return items


def run_study(replace: bool = False) -> dict:
    """Run every study scenario synchronously and store the results."""
    from tokenedge.api import services

    with _lock:
        if STATUS.state == "running":
            return STATUS.as_dict()
        STATUS.state, STATUS.done, STATUS.errors, STATUS.current = "running", 0, [], ""
    try:
        scenarios = _scenarios()
        if replace:
            names = study_run_names()
            for run in db.list_runs(limit=10_000)["items"]:
                if run.get("name") in names:
                    db.delete_run(run["id"])
        STATUS.total = len(scenarios)
        for label, make in scenarios:
            STATUS.current = label
            try:
                req = make()  # type: ignore[operator]
                if isinstance(req, CompareRequest):
                    services.compare(req)
                else:
                    services.backtest(req)  # type: ignore[arg-type]
            except Exception as exc:  # keep going; report what failed
                log.warning("Study scenario %s failed: %s", label, exc)
                STATUS.errors.append(f"{label}: {exc}")
            STATUS.done += 1
        STATUS.state = "done"
    except Exception as exc:
        STATUS.state = "error"
        STATUS.errors.append(str(exc))
    STATUS.current = ""
    return STATUS.as_dict()


def study_run_names() -> set[str]:
    """Names given to study runs; only these are replaced when the study is re-run."""
    names = {f"{symbol}: classical vs ML on held-out data" for symbol, _, _ in STUDY_MARKETS}
    names |= {
        "SPY golden cross (SMA 50/200)",
        "BTC/USDT hourly EMA 24/168",
        "TCS.NS SMA 20/100 long/short, NSE costs",
        "SPY XGBoost on its held-out window",
        "SPY XGBoost with probability bet sizing",
        "SPY SMA 20/50 filtered by XGBoost",
        "SPY XGBoost on validation data (in-sample, for contrast)",
        "SPY LSTM on its held-out window",
        "RELIANCE.NS XGBoost with NSE costs",
    }
    return names


def run_in_background(replace: bool = False) -> dict:
    if STATUS.state != "running":
        threading.Thread(target=run_study, kwargs={"replace": replace}, daemon=True).start()
        STATUS.state = "running"
    return STATUS.as_dict()


def has_runs() -> bool:
    return db.list_runs(limit=1)["total"] > 0

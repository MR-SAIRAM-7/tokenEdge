"""Overview endpoints: market overview, research findings and the research study runner."""

from __future__ import annotations

import numpy as np
import pandas as pd
from fastapi import APIRouter

from tokenedge import study
from tokenedge.api import db
from tokenedge.config import DEFAULT_UNIVERSE, get_settings, periods_per_year
from tokenedge.data.cache import cache_file, snapshot_file
from tokenedge.data.loader import get_ohlcv
from tokenedge.metrics.performance import finite

router = APIRouter(tags=["insights"])


def _change(close: pd.Series, delta: pd.Timedelta) -> float | None:
    past = close[close.index <= close.index[-1] - delta]
    return finite(close.iloc[-1] / past.iloc[-1] - 1.0) if len(past) else None


@router.get("/markets/overview")
def markets_overview() -> dict:
    settings = get_settings()
    items = []
    for inst in DEFAULT_UNIVERSE:
        has_data = (
            snapshot_file(settings.snapshot_dir, inst.symbol, inst.interval).exists()
            or cache_file(settings.data_dir, inst.source, inst.symbol, inst.interval).exists()
        )
        if not has_data:
            continue
        try:
            df = get_ohlcv(inst.symbol, inst.source, inst.interval)
        except Exception:
            continue
        close = df["close"]
        daily = close.resample("1D").last().dropna()
        spark = daily.iloc[-90:]
        step = max(1, len(spark) // 60)
        rets = np.log(daily).diff().dropna().iloc[-365:]
        ppy = periods_per_year("1d", inst.asset_class)
        items.append(
            {
                "symbol": inst.symbol,
                "source": inst.source,
                "interval": inst.interval,
                "name": inst.name,
                "asset_class": inst.asset_class,
                "last_close": finite(close.iloc[-1]),
                "last_time": close.index[-1].isoformat(),
                "change_1d": _change(close, pd.Timedelta(days=1)),
                "change_30d": _change(close, pd.Timedelta(days=30)),
                "change_1y": _change(close, pd.Timedelta(days=365)),
                "volatility_1y": finite(rets.std() * np.sqrt(ppy)) if len(rets) > 10 else None,
                "bars": len(df),
                "sparkline": [finite(v) for v in spark.iloc[::step].tolist()],
            }
        )
    return {"items": items}


_FINDING_METRICS = (
    "total_return",
    "cagr",
    "sharpe",
    "sortino",
    "max_drawdown",
    "calmar",
    "psr",
    "trades",
)


def _finding_runs() -> list[dict]:
    """One comparison per market: the research study's, else the latest comparison.

    Preferring the study run keeps the scoreboard on the tuned baseline and the registered
    models even after someone runs an ad-hoc comparison on the same market.
    """
    order = {(symbol, interval): i for i, (symbol, _, interval) in enumerate(study.STUDY_MARKETS)}
    chosen: dict[tuple[str, str], dict] = {}
    for summary in db.list_runs(kind="compare", limit=500)["items"]:  # newest first
        key = (summary["symbol"], summary["interval"])
        is_study = summary["name"] == study.comparison_name(summary["symbol"])
        if key not in chosen or (is_study and not chosen[key]["study"]):
            chosen[key] = {**summary, "study": is_study}
    return sorted(
        chosen.values(), key=lambda s: order.get((s["symbol"], s["interval"]), len(order))
    )


@router.get("/findings")
def findings() -> dict:
    """One comparison per market (see ``_finding_runs``), condensed for the results scoreboard."""
    out = []
    for summary in _finding_runs():
        run = db.get_run(summary["id"])
        if run is None:
            continue
        out.append(
            {
                "run_id": run["run_id"],
                "name": run.get("name"),
                "study": summary["study"],
                "created_at": run["created_at"],
                "symbol": run["symbol"],
                "source": run["source"],
                "interval": run["interval"],
                "window": run["window"],
                "in_sample": run["in_sample"],
                "execution": {"preset": run["execution"].get("preset")},
                "strategies": [
                    {"key": s["key"], "name": s["name"], "label": s["label"], "kind": s["kind"]}
                    for s in run["strategies"]
                ],
                "metrics": {
                    k: {m: v.get(m) for m in _FINDING_METRICS} for k, v in run["metrics"].items()
                },
                "dsr": run["dsr"],
                "sharpe_diff": {
                    k: (
                        {
                            f: d[f]
                            for f in ("estimate", "ci_low", "ci_high", "p_value", "significant")
                        }
                        if d
                        else None
                    )
                    for k, d in run["sharpe_diff"].items()
                },
                "baseline": run["baseline"],
                "ranking": run["ranking"],
                "verdict": run["verdict"],
            }
        )
    return {"items": out}


@router.get("/study/status")
def study_status() -> dict:
    return {**study.STATUS.as_dict(), "has_runs": study.has_runs()}


@router.post("/study/run")
def run_study(replace: bool = False) -> dict:
    return study.run_in_background(replace=replace)

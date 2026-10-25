"""Helpers shared by the XGBoost and LSTM training pipelines (run in Google Colab)."""

from __future__ import annotations

import contextlib
import json
import platform
import shutil
from datetime import UTC, datetime
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from tokenedge import __version__
from tokenedge.config import DEFAULT_RISK_FREE_RATE, safe_name
from tokenedge.data.loader import slice_window
from tokenedge.engine.backtester import run_backtest
from tokenedge.engine.costs import ExecutionConfig
from tokenedge.metrics.performance import finite, sharpe_ratio

THRESHOLD_CANDIDATES = tuple(round(x, 2) for x in np.arange(0.50, 0.651, 0.01))
LABEL_SHORT = {"fixed_horizon": "fh", "triple_barrier": "tb"}


def make_model_id(
    model_type: str, symbol: str, interval: str, label_method: str, version: int = 1
) -> str:
    prefix = "xgb" if model_type == "xgboost" else model_type
    return f"{prefix}_{safe_name(symbol).lower()}_{interval}_{LABEL_SHORT.get(label_method, label_method)}_v{version}"


def proba_on_index(index: pd.Index, sample_index: pd.Index, proba: np.ndarray) -> pd.Series:
    return pd.Series(proba, index=sample_index).reindex(index)


def select_threshold(
    data: pd.DataFrame,
    proba: pd.Series,
    window: tuple[str, str],
    config: ExecutionConfig,
    periods_per_year: float,
    candidates: tuple[float, ...] = THRESHOLD_CANDIDATES,
    rf_annual: float = DEFAULT_RISK_FREE_RATE,
) -> dict:
    """Pick the long threshold that maximizes validation Sharpe after costs (FR-M5)."""
    history = slice_window(data, None, window[1])
    p = proba.reindex(history.index)
    table: list[dict[str, Any]] = []
    for th in candidates:
        sig = (
            pd.Series(np.where(p > th, 1.0, 0.0), index=history.index).where(p.notna()).fillna(0.0)
        )
        res = run_backtest(history, sig, window[0], window[1], config, periods_per_year, "ml")
        table.append(
            {
                "threshold": th,
                "sharpe": finite(sharpe_ratio(res.returns, periods_per_year, rf_annual)),
                "total_return": finite(res.equity.iloc[-1] / config.initial_capital - 1.0),
                "trades": int(len(res.trades)),
            }
        )
    scored = [r for r in table if r["sharpe"] is not None and r["trades"] > 0]
    best: dict[str, Any] = (
        max(scored, key=lambda r: (r["sharpe"], -r["threshold"]))
        if scored
        else {"threshold": 0.55, "sharpe": None}
    )
    sharpes = np.array([r["sharpe"] for r in scored]) if scored else np.array([])
    return {
        "threshold": float(best["threshold"]),
        "val_sharpe": best.get("sharpe"),
        "table": table,
        "trials": len(table),
        "trial_sharpe_std": float(sharpes.std(ddof=1)) if len(sharpes) > 1 else None,
    }


def library_versions(packages: tuple[str, ...]) -> dict[str, str]:
    out = {"python": platform.python_version(), "tokenedge": __version__}
    for pkg in packages:
        with contextlib.suppress(importlib_metadata.PackageNotFoundError):
            out[pkg] = importlib_metadata.version(pkg)
    return out


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_metadata(model_dir: Path, metadata: dict) -> Path:
    model_dir.mkdir(parents=True, exist_ok=True)
    path = model_dir / "metadata.json"
    path.write_text(json.dumps(metadata, indent=2, default=_json_default), encoding="utf-8")
    return path


def zip_model_dir(model_dir: Path) -> Path:
    """Zip a model folder so it can be downloaded from Colab and unzipped into models/."""
    archive = shutil.make_archive(
        str(model_dir), "zip", root_dir=model_dir.parent, base_dir=model_dir.name
    )
    return Path(archive)


def _json_default(value):
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    raise TypeError(f"Not JSON serializable: {type(value)}")

"""Data-quality checks for OHLCV frames."""

from __future__ import annotations

import numpy as np
import pandas as pd

from tokenedge.data.base import is_daily_or_slower


def _expected_bars(index: pd.DatetimeIndex, interval: str, asset_class: str) -> int | None:
    if len(index) < 2:
        return len(index)
    start, end = index[0], index[-1]
    if is_daily_or_slower(interval):
        if interval != "1d":
            return None
        if asset_class == "crypto":
            return int((end - start) / pd.Timedelta(days=1)) + 1
        # Business days; exchange holidays are counted as "missing", so this is an upper bound.
        return len(pd.bdate_range(start, end))
    if asset_class == "crypto" and interval.endswith("h"):
        hours = int(interval[:-1] or 1)
        return int((end - start) / pd.Timedelta(hours=hours)) + 1
    return None


def quality_report(df: pd.DataFrame, interval: str, asset_class: str) -> dict:
    """Summarize gaps, NaNs, bad prices, zero volume and outliers. Returns JSON-friendly data."""
    n = len(df)
    issues: list[dict] = []
    if n == 0:
        return {
            "bars": 0,
            "issues": [{"severity": "error", "check": "empty", "message": "No data."}],
        }

    idx = pd.DatetimeIndex(df.index)
    duplicates = int(idx.duplicated().sum())
    nan_counts = {c: int(df[c].isna().sum()) for c in df.columns}
    price_cols = ["open", "high", "low", "close"]
    non_positive = int((df[price_cols] <= 0).any(axis=1).sum())
    zero_volume = int((df["volume"] <= 0).sum())
    hi = df[["open", "close"]].max(axis=1)
    lo = df[["open", "close"]].min(axis=1)
    tol = 1e-9 * df["close"].abs()
    ohlc_bad = int(((df["high"] + tol < hi) | (df["low"] - tol > lo)).sum())

    rets = np.log(df["close"]).diff().dropna()
    sigma = float(rets.std()) if len(rets) > 2 else 0.0
    outlier_mask = (rets.abs() > 5 * sigma) if sigma > 0 else pd.Series(False, index=rets.index)
    outliers = [
        {"timestamp": ts.isoformat(), "return": float(np.expm1(r))}
        for ts, r in rets[outlier_mask].items()
    ][:50]

    expected = _expected_bars(idx, interval, asset_class)
    missing = max(expected - n, 0) if expected is not None else None

    if duplicates:
        issues.append(
            {
                "severity": "error",
                "check": "duplicates",
                "message": f"{duplicates} duplicate timestamps.",
            }
        )
    if any(nan_counts.values()):
        issues.append(
            {"severity": "warning", "check": "nan", "message": f"NaN values: {nan_counts}."}
        )
    if non_positive:
        issues.append(
            {
                "severity": "error",
                "check": "non_positive",
                "message": f"{non_positive} bars with price <= 0.",
            }
        )
    if ohlc_bad:
        issues.append(
            {
                "severity": "warning",
                "check": "ohlc",
                "message": f"{ohlc_bad} bars where high/low do not bracket open/close.",
            }
        )
    if zero_volume:
        sev = "info" if zero_volume / n < 0.05 else "warning"
        issues.append(
            {
                "severity": sev,
                "check": "zero_volume",
                "message": f"{zero_volume} bars with zero volume.",
            }
        )
    if outliers:
        issues.append(
            {
                "severity": "info",
                "check": "outliers",
                "message": f"{int(outlier_mask.sum())} returns beyond 5 sigma.",
            }
        )
    if missing:
        note = " (includes exchange holidays)" if asset_class == "equity" else ""
        sev = (
            "info"
            if asset_class == "equity" or missing / max(expected or 1, 1) < 0.01
            else "warning"
        )
        issues.append(
            {"severity": sev, "check": "gaps", "message": f"About {missing} missing bars{note}."}
        )

    return {
        "bars": n,
        "start": idx[0].isoformat(),
        "end": idx[-1].isoformat(),
        "expected_bars": expected,
        "missing_bars": missing,
        "duplicates": duplicates,
        "nan_counts": nan_counts,
        "non_positive_prices": non_positive,
        "zero_volume_bars": zero_volume,
        "ohlc_inconsistent": ohlc_bad,
        "outliers": outliers,
        "return_sigma": sigma,
        "issues": issues,
        "ok": not any(i["severity"] == "error" for i in issues),
    }

"""Common OHLCV schema and the DataSource protocol."""

from __future__ import annotations

from typing import Protocol

import pandas as pd

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


class DataSource(Protocol):
    name: str

    def fetch(
        self, symbol: str, interval: str, start: str | None = None, end: str | None = None
    ) -> pd.DataFrame: ...


def is_daily_or_slower(interval: str) -> bool:
    return interval.endswith(("d", "wk", "mo"))


def normalize_ohlcv(df: pd.DataFrame, interval: str | None = None) -> pd.DataFrame:
    """Return a frame with a UTC DatetimeIndex named ``timestamp`` and float64 OHLCV columns.

    Rows are sorted ascending, duplicate timestamps keep the last value, and rows with no
    close price are dropped. Daily-or-slower bars are snapped to 00:00 UTC of their date so
    that the same session never shows up under two timestamps.
    """
    if df is None or df.empty:
        return pd.DataFrame(
            columns=OHLCV_COLUMNS, index=pd.DatetimeIndex([], tz="UTC", name="timestamp")
        )

    out = df.copy()
    out.columns = [str(c).strip().lower().replace(" ", "_") for c in out.columns]
    if "adj_close" in out.columns and "close" not in out.columns:
        out = out.rename(columns={"adj_close": "close"})
    missing = [c for c in OHLCV_COLUMNS if c not in out.columns]
    if missing:
        raise ValueError(f"OHLCV data is missing columns: {missing}")

    idx = pd.DatetimeIndex(pd.to_datetime(out.index))
    idx = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")
    if interval is not None and is_daily_or_slower(interval):
        idx = idx.normalize()
    out.index = idx
    out.index.name = "timestamp"

    out = out[OHLCV_COLUMNS].astype("float64")
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out = out.dropna(subset=["close"])
    return out

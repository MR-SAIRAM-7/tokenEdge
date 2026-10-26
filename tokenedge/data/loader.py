"""High-level OHLCV access: cache -> bundled snapshot -> download.

Data never silently changes under a run: once a symbol is cached (or a snapshot exists), the
same bars are returned until the caller asks for ``refresh=True``.
"""

from __future__ import annotations

import logging

import pandas as pd

from tokenedge.config import HISTORY_START, Settings, asset_class_of, get_settings
from tokenedge.data.cache import cache_file, merge_bars, read_parquet, snapshot_file, write_parquet
from tokenedge.data.ccxt_source import CCXTSource
from tokenedge.data.yfinance_source import YFinanceSource
from tokenedge.errors import ConfigError, DataUnavailableError

log = logging.getLogger(__name__)

SOURCES = ("yfinance", "ccxt")


def _source_for(source: str, settings: Settings):
    if source == "yfinance":
        return YFinanceSource()
    if source == "ccxt":
        return CCXTSource(settings.ccxt_exchange, settings.ccxt_fallbacks)
    raise DataUnavailableError(f"Unknown data source '{source}'.", {"sources": list(SOURCES)})


def _stored(symbol: str, source: str, interval: str, settings: Settings) -> pd.DataFrame | None:
    cached = read_parquet(cache_file(settings.data_dir, source, symbol, interval), interval)
    if cached is not None and not cached.empty:
        return cached
    snap = read_parquet(snapshot_file(settings.snapshot_dir, symbol, interval), interval)
    if snap is not None and not snap.empty:
        return snap
    return None


def download(
    symbol: str,
    source: str,
    interval: str,
    start: str | None = None,
    settings: Settings | None = None,
) -> pd.DataFrame:
    """Download bars from the network (no cache involved)."""
    settings = settings or get_settings()
    start = start or HISTORY_START[asset_class_of(source)]
    return _source_for(source, settings).fetch(symbol, interval, start=start)


def get_ohlcv(
    symbol: str,
    source: str = "yfinance",
    interval: str = "1d",
    start: str | pd.Timestamp | None = None,
    end: str | pd.Timestamp | None = None,
    refresh: bool = False,
    settings: Settings | None = None,
) -> pd.DataFrame:
    """Return OHLCV bars for ``symbol`` between ``start`` and ``end`` (inclusive)."""
    settings = settings or get_settings()
    df = _stored(symbol, source, interval, settings)

    if not settings.offline and (df is None or refresh):
        try:
            fetch_from = None
            if df is not None and not df.empty:
                fetch_from = (df.index[-1] - pd.Timedelta(days=3)).strftime("%Y-%m-%d")
            fresh = download(symbol, source, interval, start=fetch_from, settings=settings)
            if not fresh.empty:
                df = merge_bars(df, fresh)
                write_parquet(df, cache_file(settings.data_dir, source, symbol, interval))
        except Exception as exc:
            log.warning("Download failed for %s (%s %s): %s", symbol, source, interval, exc)
            if df is None:
                raise DataUnavailableError(
                    f"Could not download {symbol} from {source} and no cached or snapshot data exists.",
                    {"symbol": symbol, "source": source, "interval": interval, "reason": str(exc)},
                ) from exc

    if df is None or df.empty:
        hint = (
            " Offline mode is on, so only bundled snapshots are available."
            if settings.offline
            else ""
        )
        raise DataUnavailableError(
            f"No data for {symbol} ({source}, {interval}).{hint}",
            {"symbol": symbol, "source": source, "interval": interval},
        )
    return slice_window(df, start, end)


def slice_window(
    df: pd.DataFrame, start: str | pd.Timestamp | None, end: str | pd.Timestamp | None
) -> pd.DataFrame:
    out = df
    if start is not None:
        out = out[out.index >= to_utc(start)]
    if end is not None:
        out = out[out.index <= to_utc_end(end)]
    return out


def to_utc(value: str | pd.Timestamp) -> pd.Timestamp:
    try:
        ts = pd.Timestamp(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"'{value}' is not a valid date; use YYYY-MM-DD.") from exc
    if pd.isna(ts):
        raise ConfigError(f"'{value}' is not a valid date; use YYYY-MM-DD.")
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def to_utc_end(value: str | pd.Timestamp) -> pd.Timestamp:
    """Like ``to_utc``, but a bare date (YYYY-MM-DD) as an end bound covers that whole day."""
    ts = to_utc(value)
    if isinstance(value, str) and len(value) <= 10:
        ts = ts + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    return ts


def available_snapshots(settings: Settings | None = None) -> list[str]:
    settings = settings or get_settings()
    if not settings.snapshot_dir.exists():
        return []
    return sorted(p.stem for p in settings.snapshot_dir.glob("*.parquet"))

from __future__ import annotations

from typing import Literal

import pandas as pd
from fastapi import APIRouter, Query

from tokenedge.api.schemas import RefreshRequest
from tokenedge.api.services import _arr, _epoch
from tokenedge.config import asset_class_of
from tokenedge.data.cache import data_hash
from tokenedge.data.loader import get_ohlcv, slice_window
from tokenedge.data.quality import quality_report
from tokenedge.errors import ConfigError
from tokenedge.features.indicators import compute_indicator

router = APIRouter(prefix="/data", tags=["data"])

Source = Literal["yfinance", "ccxt"]
INTERVAL = Query("1d", pattern=r"^\d+(m|h|d|wk|mo)$")


def _load(
    symbol: str, source: str, interval: str, start: str | None, end: str | None, limit: int | None
) -> pd.DataFrame:
    df = slice_window(get_ohlcv(symbol, source, interval), start, end)
    if limit:
        df = df.tail(limit)
    return df


@router.get("/ohlcv")
def ohlcv(
    symbol: str,
    source: Source = "yfinance",
    interval: str = INTERVAL,
    start: str | None = None,
    end: str | None = None,
    limit: int | None = Query(None, ge=10, le=200_000),
) -> dict:
    df = _load(symbol, source, interval, start, end, limit)
    return {
        "symbol": symbol,
        "source": source,
        "interval": interval,
        "bars": len(df),
        "data_hash": data_hash(df),
        "timestamp": _epoch(df.index),
        "open": _arr(df["open"]),
        "high": _arr(df["high"]),
        "low": _arr(df["low"]),
        "close": _arr(df["close"]),
        "volume": _arr(df["volume"], 2),
    }


@router.get("/quality")
def quality(
    symbol: str,
    source: Source = "yfinance",
    interval: str = INTERVAL,
    start: str | None = None,
    end: str | None = None,
) -> dict:
    df = _load(symbol, source, interval, start, end, None)
    return quality_report(df, interval, asset_class_of(source))


@router.get("/indicators")
def indicators(
    symbol: str,
    source: Source = "yfinance",
    interval: str = INTERVAL,
    start: str | None = None,
    end: str | None = None,
    limit: int | None = Query(None, ge=10, le=200_000),
    names: str = Query(
        "sma:20,sma:50",
        alias="indicators",
        description="Comma list, e.g. sma:20,bb:20,rsi:14,macd,ffd:0.4",
    ),
) -> dict:
    full = get_ohlcv(symbol, source, interval)  # compute on full history so values are warmed up
    out: dict[str, pd.Series] = {}
    for item in [x.strip() for x in names.split(",") if x.strip()]:
        name, _, param = item.partition(":")
        try:
            value = float(param) if param else None
        except ValueError as exc:
            raise ConfigError(f"Indicator '{item}': the parameter must be a number.") from exc
        try:
            out.update(compute_indicator(full, name.lower(), value))
        except ValueError as exc:
            raise ConfigError(str(exc)) from exc
    window_df = _load(symbol, source, interval, start, end, limit)
    return {
        "timestamp": _epoch(window_df.index),
        "series": {k: _arr(v.reindex(window_df.index), 6) for k, v in out.items()},
    }


@router.post("/refresh")
def refresh(req: RefreshRequest) -> dict:
    df = get_ohlcv(req.symbol, req.source, req.interval, refresh=True)
    return {
        "symbol": req.symbol,
        "bars": len(df),
        "start": df.index[0].isoformat(),
        "end": df.index[-1].isoformat(),
    }

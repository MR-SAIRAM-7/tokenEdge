"""Crypto OHLCV loader through ccxt with pagination and exchange fallbacks."""

from __future__ import annotations

import logging
import time

import pandas as pd

from tokenedge.data.base import normalize_ohlcv

log = logging.getLogger(__name__)

_PAGE_LIMIT = 1000


class CCXTSource:
    def __init__(self, exchange: str = "binance", fallbacks: tuple[str, ...] = ()):
        self.exchange_id = exchange
        self.fallbacks = tuple(x for x in fallbacks if x != exchange)
        self.used_exchange: str | None = None

    @property
    def name(self) -> str:
        return "ccxt"

    def fetch(
        self, symbol: str, interval: str = "1h", start: str | None = None, end: str | None = None
    ) -> pd.DataFrame:
        errors: list[str] = []
        for exchange_id in (self.exchange_id, *self.fallbacks):
            try:
                df = self._fetch_from(exchange_id, symbol, interval, start, end)
            except Exception as exc:  # geo-blocks, unknown symbol, network errors
                log.warning("ccxt %s failed for %s: %s", exchange_id, symbol, exc)
                errors.append(f"{exchange_id}: {exc}")
                continue
            if not df.empty:
                self.used_exchange = exchange_id
                return df
            errors.append(f"{exchange_id}: no data")
        raise RuntimeError("All exchanges failed: " + "; ".join(errors))

    def _fetch_from(
        self, exchange_id: str, symbol: str, interval: str, start: str | None, end: str | None
    ) -> pd.DataFrame:
        import ccxt

        exchange = getattr(ccxt, exchange_id)({"enableRateLimit": True})
        timeframe_ms = exchange.parse_timeframe(interval) * 1000
        now_ms = exchange.milliseconds()
        since = (
            int(pd.Timestamp(start, tz="UTC").value // 1_000_000)
            if start
            else now_ms - 365 * 86_400_000
        )
        end_ms = int(pd.Timestamp(end, tz="UTC").value // 1_000_000) if end else now_ms

        rows: list[list[float]] = []
        while since < end_ms:
            batch = exchange.fetch_ohlcv(symbol, timeframe=interval, since=since, limit=_PAGE_LIMIT)
            if not batch:
                break
            rows.extend(batch)
            last = batch[-1][0]
            if last < since:  # exchange ignored `since`; avoid looping forever
                break
            since = last + timeframe_ms
            if last + timeframe_ms >= now_ms:
                break
            time.sleep(exchange.rateLimit / 1000.0)

        if not rows:
            return normalize_ohlcv(pd.DataFrame(), interval)
        df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df = df.set_index("timestamp")
        df = df[df.index < pd.Timestamp(end_ms, unit="ms", tz="UTC")]
        # Drop the still-forming candle so cached history only holds closed bars.
        df = df[
            df.index + pd.Timedelta(milliseconds=timeframe_ms)
            <= pd.Timestamp(now_ms, unit="ms", tz="UTC")
        ]
        return normalize_ohlcv(df, interval)

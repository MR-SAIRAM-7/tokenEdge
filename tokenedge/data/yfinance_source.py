"""Yahoo Finance loader (equities, ETFs, indices)."""

from __future__ import annotations

import warnings

import pandas as pd

from tokenedge.data.base import is_daily_or_slower, normalize_ohlcv


class YFinanceSource:
    name = "yfinance"

    def fetch(
        self, symbol: str, interval: str = "1d", start: str | None = None, end: str | None = None
    ) -> pd.DataFrame:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # yfinance internals emit pandas deprecation noise
            # auto_adjust=True gives split- and dividend-adjusted OHLC, which is what we trade on.
            raw = ticker.history(
                start=start,
                end=end,
                interval=interval,
                auto_adjust=True,
                actions=False,
                raise_errors=False,
            )
        if raw is None or raw.empty:
            return normalize_ohlcv(pd.DataFrame(), interval)
        if is_daily_or_slower(interval):
            # Yahoo stamps daily bars at local exchange midnight; keep the session date only.
            raw.index = pd.to_datetime(pd.DatetimeIndex(raw.index).date)
        return normalize_ohlcv(raw, interval)

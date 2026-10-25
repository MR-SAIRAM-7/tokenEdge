"""Versioned feature sets shared by Colab training and in-app inference."""

from __future__ import annotations

import numpy as np
import pandas as pd

from tokenedge.data.base import is_daily_or_slower
from tokenedge.features import indicators as ind

RETURN_LAGS = (1, 2, 3, 5, 10, 20)
SMA_WINDOWS = (10, 20, 50)


def _calendar(index: pd.DatetimeIndex, interval: str) -> dict[str, pd.Series]:
    out: dict[str, pd.Series] = {}
    if interval.endswith(("wk", "mo")):
        return out
    dow = index.dayofweek.to_numpy()
    out["dow_sin"] = pd.Series(np.sin(2 * np.pi * dow / 7.0), index=index)
    out["dow_cos"] = pd.Series(np.cos(2 * np.pi * dow / 7.0), index=index)
    if not is_daily_or_slower(interval):
        hour = index.hour.to_numpy()
        out["hour_sin"] = pd.Series(np.sin(2 * np.pi * hour / 24.0), index=index)
        out["hour_cos"] = pd.Series(np.cos(2 * np.pi * hour / 24.0), index=index)
    return out


def build_features_v1(df: pd.DataFrame, interval: str = "1d") -> pd.DataFrame:
    close, high, low, volume = df["close"], df["high"], df["low"], df["volume"]
    f: dict[str, pd.Series] = {}

    for k in RETURN_LAGS:
        f[f"ret_{k}"] = ind.log_returns(close, k)
    for w in SMA_WINDOWS:
        f[f"sma_ratio_{w}"] = close / ind.sma(close, w) - 1.0
    f["ema_ratio_12_26"] = ind.ema(close, 12) / ind.ema(close, 26) - 1.0

    f["rsi_14"] = ind.rsi(close, 14) / 100.0
    m = ind.macd(close)
    f["macd"] = m["macd"] / close
    f["macd_signal"] = m["signal"] / close
    f["macd_hist"] = m["hist"] / close

    f["vol_10"] = ind.rolling_volatility(close, 10)
    f["vol_20"] = ind.rolling_volatility(close, 20)
    f["atr_ratio_14"] = ind.atr(high, low, close, 14) / close
    bands = ind.bollinger(close, 20)
    f["bb_pct_b"] = bands["pct_b"]
    f["bb_width"] = bands["bandwidth"]

    # Volume features are filled with 0 where undefined (e.g. indices with no volume);
    # a constant fill uses no future information.
    f["vol_z_20"] = ind.volume_zscore(volume, 20).fillna(0.0)
    vol_ma = volume.rolling(20, min_periods=20).mean()
    f["log_vol_ratio_20"] = np.log((volume + 1.0) / (vol_ma + 1.0))

    f.update(_calendar(pd.DatetimeIndex(df.index), interval))
    out = pd.DataFrame(f, index=df.index)
    return out.replace([np.inf, -np.inf], np.nan)


FFD_ORDER = 0.4


def build_features_v2(df: pd.DataFrame, interval: str = "1d") -> pd.DataFrame:
    """v1 plus the fractionally differentiated log price (AFML Ch. 5), which keeps memory of
    the price level while staying close to stationary. Its warm-up is longer (~280 bars)."""
    out = build_features_v1(df, interval)
    out["ffd_log_close"] = ind.frac_diff(np.log(df["close"]), FFD_ORDER)
    return out


FEATURE_SETS = {"v1": build_features_v1, "v2": build_features_v2}


def build_features(df: pd.DataFrame, feature_set: str = "v1", interval: str = "1d") -> pd.DataFrame:
    """Feature matrix aligned to ``df.index``. Warm-up rows contain NaN and must be dropped."""
    try:
        builder = FEATURE_SETS[feature_set]
    except KeyError as exc:
        raise ValueError(
            f"Unknown feature set '{feature_set}'. Available: {sorted(FEATURE_SETS)}"
        ) from exc
    return builder(df, interval)


def feature_names(feature_set: str = "v1", interval: str = "1d") -> list[str]:
    idx = pd.date_range(
        "2020-01-01", periods=80, freq="D" if is_daily_or_slower(interval) else "h", tz="UTC"
    )
    dummy = pd.DataFrame(
        {"open": 1.0, "high": 1.0, "low": 1.0, "close": np.linspace(1, 2, len(idx)), "volume": 1.0},
        index=idx,
    )
    return list(build_features(dummy, feature_set, interval).columns)

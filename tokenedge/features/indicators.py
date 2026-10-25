"""Technical indicators. Every function is causal: the value at bar t uses bars <= t only."""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window, min_periods=window).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False, min_periods=span).mean()


def moving_average(series: pd.Series, window: int, kind: str = "sma") -> pd.Series:
    if kind == "sma":
        return sma(series, window)
    if kind == "ema":
        return ema(series, window)
    raise ValueError(f"Unknown moving average type: {kind}")


def _wilder(series: pd.Series, window: int) -> pd.Series:
    return series.ewm(alpha=1.0 / window, adjust=False, min_periods=window).mean()


def rsi(close: pd.Series, window: int = 14) -> pd.Series:
    """Relative Strength Index with Wilder smoothing (0-100)."""
    delta = close.diff()
    gain = _wilder(delta.clip(lower=0.0), window)
    loss = _wilder(-delta.clip(upper=0.0), window)
    rs = gain / loss
    out = 100.0 - 100.0 / (1.0 + rs)
    out = out.where(loss != 0, 100.0)  # only gains in the window
    out = out.where(~((gain == 0) & (loss == 0)), 50.0)  # flat prices
    return out.where(gain.notna())


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig}, index=close.index)


def bollinger(close: pd.Series, window: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    mid = sma(close, window)
    std = close.rolling(window, min_periods=window).std(ddof=0)
    upper = mid + num_std * std
    lower = mid - num_std * std
    width = upper - lower
    pct_b = (close - lower) / width.replace(0.0, np.nan)
    bandwidth = width / mid
    return pd.DataFrame(
        {"mid": mid, "upper": upper, "lower": lower, "pct_b": pct_b, "bandwidth": bandwidth},
        index=close.index,
    )


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    ranges = pd.concat([high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1)
    return ranges.max(axis=1, skipna=False).where(prev_close.notna(), high - low)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.Series:
    return _wilder(true_range(high, low, close), window)


def log_returns(close: pd.Series, periods: int = 1) -> pd.Series:
    return np.log(close / close.shift(periods))


def rolling_volatility(close: pd.Series, window: int = 20) -> pd.Series:
    return log_returns(close).rolling(window, min_periods=window).std()


def volume_zscore(volume: pd.Series, window: int = 20) -> pd.Series:
    mean = volume.rolling(window, min_periods=window).mean()
    std = volume.rolling(window, min_periods=window).std()
    return (volume - mean) / std.replace(0.0, np.nan)


INDICATORS = {
    "sma": "Simple moving average (window)",
    "ema": "Exponential moving average (span)",
    "bb": "Bollinger Bands (window, 2 std)",
    "rsi": "Relative Strength Index (window)",
    "macd": "MACD (12, 26, 9)",
    "atr": "Average True Range (window)",
}


def compute_indicator(
    df: pd.DataFrame, name: str, window: int | None = None
) -> dict[str, pd.Series]:
    """Indicator series for charting, keyed by output name."""
    close = df["close"]
    if name == "sma":
        w = window or 20
        return {f"sma_{w}": sma(close, w)}
    if name == "ema":
        w = window or 20
        return {f"ema_{w}": ema(close, w)}
    if name == "bb":
        bands = bollinger(close, window or 20)
        return {"bb_upper": bands["upper"], "bb_mid": bands["mid"], "bb_lower": bands["lower"]}
    if name == "rsi":
        w = window or 14
        return {f"rsi_{w}": rsi(close, w)}
    if name == "macd":
        m = macd(close)
        return {"macd": m["macd"], "macd_signal": m["signal"], "macd_hist": m["hist"]}
    if name == "atr":
        w = window or 14
        return {f"atr_{w}": atr(df["high"], df["low"], close, w)}
    raise ValueError(f"Unknown indicator '{name}'. Available: {sorted(INDICATORS)}")

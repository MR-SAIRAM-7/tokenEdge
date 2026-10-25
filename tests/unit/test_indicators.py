import numpy as np
import pandas as pd
import pytest

from tokenedge.features import build_features, feature_names
from tokenedge.features import indicators as ind


@pytest.fixture
def close():
    return pd.Series(
        [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 20, 19, 21], dtype=float
    )


def test_sma_and_ema(close):
    s = ind.sma(close, 3)
    assert s.iloc[:2].isna().all()
    assert s.iloc[2] == pytest.approx((10 + 11 + 12) / 3)
    e = ind.ema(close, 3)
    alpha = 2 / 4
    manual = close.iloc[0]
    for v in close.iloc[1:3]:
        manual = alpha * v + (1 - alpha) * manual
    assert e.iloc[2] == pytest.approx(manual)


def test_rsi_matches_wilder_loop(close):
    n = 5
    out = ind.rsi(close, n)
    delta = close.diff().to_numpy()
    avg_g = avg_l = None
    expected = []
    for i in range(1, len(close)):
        g, lo = max(delta[i], 0), max(-delta[i], 0)
        if avg_g is None:
            avg_g, avg_l = g, lo
        else:
            avg_g = (avg_g * (n - 1) + g) / n
            avg_l = (avg_l * (n - 1) + lo) / n
        expected.append(100 - 100 / (1 + avg_g / avg_l) if avg_l else 100.0)
    assert out.iloc[-1] == pytest.approx(expected[-1])
    assert out.iloc[: n - 1].isna().all()


def test_rsi_extremes():
    up = pd.Series(np.arange(1, 40, dtype=float))
    assert ind.rsi(up, 14).dropna().eq(100).all()
    flat = pd.Series(np.full(40, 5.0))
    assert ind.rsi(flat, 14).dropna().eq(50).all()


def test_macd_bollinger_atr(close):
    m = ind.macd(close, 3, 6, 2)
    assert np.allclose((m["macd"] - m["signal"]).dropna(), m["hist"].dropna())
    bb = ind.bollinger(close, 5)
    row = bb.dropna().iloc[-1]
    assert row["lower"] < row["mid"] < row["upper"]
    df = pd.DataFrame({"high": close + 1, "low": close - 1, "close": close})
    a = ind.atr(df["high"], df["low"], df["close"], 5)
    assert (a.dropna() > 0).all()


def test_feature_set_columns_and_warmup(daily, hourly):
    f = build_features(daily, "v1", "1d")
    assert list(f.columns) == feature_names("v1", "1d")
    assert f.iloc[60:].notna().all().all()
    assert np.isfinite(f.iloc[60:].to_numpy()).all()
    fh = build_features(hourly, "v1", "1h")
    assert "hour_sin" in fh.columns and "hour_sin" not in f.columns


def test_unknown_feature_set(daily):
    with pytest.raises(ValueError):
        build_features(daily, "v99")

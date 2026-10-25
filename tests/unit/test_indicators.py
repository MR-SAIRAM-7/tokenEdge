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


def test_frac_diff_limits_and_weights(close):
    w = ind.frac_diff_weights(0.4)
    assert w[0] == 1.0 and w[1] == pytest.approx(-0.4) and w[2] == pytest.approx(-0.12)
    assert abs(w[-1]) >= 1e-4 > abs(-w[-1] * (0.4 - len(w) + 1) / len(w))
    log_close = np.log(close)
    pd.testing.assert_series_equal(ind.frac_diff(log_close, 0.0), log_close, check_names=False)
    first_diff = ind.frac_diff(log_close, 1.0)
    pd.testing.assert_series_equal(first_diff, log_close.diff(), check_names=False)


def test_frac_diff_matches_direct_sum(daily):
    x = np.log(daily["close"])
    out = ind.frac_diff(x, 0.4)
    w = ind.frac_diff_weights(0.4)
    t = len(x) - 1
    expected = sum(w[k] * x.iloc[t - k] for k in range(len(w)))
    assert out.iloc[t] == pytest.approx(expected)
    assert out.iloc[: len(w) - 1].isna().all() and out.iloc[len(w) - 1 :].notna().all()
    # Memory: the d=0.4 series is far more correlated with the price level than returns are.
    level_corr = np.corrcoef(out.dropna(), x[out.notna()])[0, 1]
    ret_corr = np.corrcoef(x.diff().dropna(), x.iloc[1:])[0, 1]
    assert abs(level_corr) > abs(ret_corr)


def test_feature_set_v2_adds_frac_diff(daily):
    v1 = build_features(daily, "v1", "1d")
    v2 = build_features(daily, "v2", "1d")
    assert list(v2.columns) == [*v1.columns, "ffd_log_close"]
    pd.testing.assert_frame_equal(v2[v1.columns], v1)
    assert "ffd_log_close" in feature_names("v2", "1d")

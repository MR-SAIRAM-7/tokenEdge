import pandas as pd
import pytest

from tokenedge.config import Settings, get_settings, periods_per_year, safe_name
from tokenedge.data import data_hash, get_ohlcv, normalize_ohlcv, quality_report
from tokenedge.data.cache import cache_file, read_parquet, write_parquet
from tokenedge.errors import DataUnavailableError


def test_normalize_ohlcv_sorts_dedups_and_sets_utc():
    raw = pd.DataFrame(
        {
            "Open": [2, 1, 1.5],
            "High": [2, 1, 2],
            "Low": [1, 1, 1],
            "Close": [2, 1, 1.8],
            "Volume": [10, 20, 30],
        },
        index=pd.to_datetime(["2024-01-03 15:00", "2024-01-02 15:00", "2024-01-03 15:00"]),
    )
    df = normalize_ohlcv(raw, "1d")
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert str(df.index.tz) == "UTC" and df.index.is_monotonic_increasing
    assert len(df) == 2 and df["close"].iloc[-1] == 1.8  # duplicate kept last
    assert (df.index == df.index.normalize()).all()


def test_cache_roundtrip_and_hash(tmp_path, daily):
    path = cache_file(tmp_path, "yfinance", "BTC/USDT", "1h")
    assert path.name == "BTC-USDT_1h.parquet"
    write_parquet(daily, path)
    back = read_parquet(path, "1d")
    pd.testing.assert_frame_equal(back, daily, check_freq=False)
    assert data_hash(back) == data_hash(daily)
    changed = daily.copy()
    changed.iloc[5, 3] += 0.01
    assert data_hash(changed) != data_hash(daily)


def test_quality_report_flags_problems(daily):
    bad = daily.iloc[:200].copy()
    bad.iloc[10, 3] = -1.0
    bad.iloc[20, 4] = 0.0
    bad.iloc[30, 1] = bad.iloc[30, 2] * 0.5  # high below low
    rep = quality_report(bad, "1d", "equity")
    checks = {i["check"] for i in rep["issues"]}
    assert {"non_positive", "zero_volume", "ohlc"} <= checks
    assert rep["ok"] is False


def test_offline_loader_uses_snapshot_and_errors_without_one(sandbox, daily):
    df = get_ohlcv("SYN", "yfinance", "1d", start="2015-01-01", end="2015-12-31")
    assert df.index[0].year == 2015 and df.index[-1].year == 2015
    with pytest.raises(DataUnavailableError):
        get_ohlcv("NOPE", "yfinance", "1d")


def test_settings_and_helpers(sandbox):
    s = get_settings()
    assert isinstance(s, Settings) and s.offline
    assert safe_name("^NSEI") == "NSEI"
    assert periods_per_year("1d", "equity") == 252
    assert periods_per_year("1h", "crypto") == 8760
    assert periods_per_year("4h", "crypto") == 2190
    assert periods_per_year("1wk", "equity") == 52

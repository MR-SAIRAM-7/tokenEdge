"""Settings, default universe and research defaults shared by the library, API and notebooks."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

DEFAULT_SEED = 42
DEFAULT_RISK_FREE_RATE = 0.04


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    return Path(value).expanduser().resolve() if value else default


@dataclass(frozen=True)
class Settings:
    offline: bool
    data_dir: Path
    snapshot_dir: Path
    models_dir: Path
    db_url: str
    ccxt_exchange: str
    ccxt_fallbacks: tuple[str, ...]
    cors_origins: tuple[str, ...]
    static_dir: Path | None
    git_sha: str | None = field(default=None)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    static = os.getenv("TOKENEDGE_STATIC_DIR")
    default_static = ROOT_DIR / "web" / "dist"
    return Settings(
        offline=_env_bool("TOKENEDGE_OFFLINE"),
        data_dir=_env_path("TOKENEDGE_DATA_DIR", ROOT_DIR / "data_cache"),
        snapshot_dir=_env_path("TOKENEDGE_SNAPSHOT_DIR", ROOT_DIR / "data" / "snapshots"),
        models_dir=_env_path("TOKENEDGE_MODELS_DIR", ROOT_DIR / "models"),
        db_url=os.getenv("TOKENEDGE_DB_URL", f"sqlite:///{(ROOT_DIR / 'tokenedge.db').as_posix()}"),
        ccxt_exchange=os.getenv("TOKENEDGE_CCXT_EXCHANGE", "binance"),
        ccxt_fallbacks=tuple(
            x.strip()
            for x in os.getenv("TOKENEDGE_CCXT_FALLBACKS", "bybit,kucoin,okx").split(",")
            if x.strip()
        ),
        cors_origins=tuple(
            x.strip()
            for x in os.getenv(
                "TOKENEDGE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if x.strip()
        ),
        static_dir=Path(static)
        if static
        else (default_static if default_static.exists() else None),
        git_sha=os.getenv("TOKENEDGE_GIT_SHA"),
    )


# --------------------------------------------------------------------------- universe


@dataclass(frozen=True)
class Instrument:
    symbol: str
    source: str  # "yfinance" | "ccxt"
    interval: str
    name: str

    @property
    def asset_class(self) -> str:
        return asset_class_of(self.source)


DEFAULT_UNIVERSE: tuple[Instrument, ...] = (
    Instrument("SPY", "yfinance", "1d", "SPDR S&P 500 ETF"),
    Instrument("AAPL", "yfinance", "1d", "Apple Inc."),
    Instrument("MSFT", "yfinance", "1d", "Microsoft Corp."),
    Instrument("RELIANCE.NS", "yfinance", "1d", "Reliance Industries (NSE)"),
    Instrument("TCS.NS", "yfinance", "1d", "Tata Consultancy Services (NSE)"),
    Instrument("NIFTYBEES.NS", "yfinance", "1d", "Nippon India Nifty 50 BeES ETF (NSE)"),
    Instrument("BTC/USDT", "ccxt", "1h", "Bitcoin / Tether"),
    Instrument("ETH/USDT", "ccxt", "1h", "Ether / Tether"),
    Instrument("SOL/USDT", "ccxt", "1h", "Solana / Tether"),
)

# Earliest history pulled when a symbol is first cached.
HISTORY_START = {"equity": "2010-01-01", "crypto": "2018-01-01"}


def asset_class_of(source: str) -> str:
    return "crypto" if source.startswith("ccxt") else "equity"


def safe_name(symbol: str) -> str:
    """File-system and id friendly symbol name: 'BTC/USDT' -> 'BTC-USDT', '^NSEI' -> 'NSEI'."""
    return symbol.replace("/", "-").replace("^", "").replace(":", "-").replace(" ", "")


def periods_per_year(interval: str, asset_class: str) -> float:
    """Number of bars per year used to annualize returns and volatility."""
    trading_days = 365.0 if asset_class == "crypto" else 252.0
    hours_per_day = 24.0 if asset_class == "crypto" else 6.5
    if interval.endswith("wk"):
        return 52.0 / max(int(interval[:-2] or 1), 1)
    if interval.endswith("mo"):
        return 12.0
    unit, count = interval[-1], interval[:-1]
    n = int(count) if count.isdigit() else 1
    if unit == "d":
        return trading_days / n
    if unit == "h":
        return trading_days * hours_per_day / n
    if unit == "m":
        return trading_days * hours_per_day * 60.0 / n
    raise ValueError(f"Unsupported interval: {interval}")


# --------------------------------------------------------------------------- research splits


@dataclass(frozen=True)
class SplitConfig:
    train: tuple[str, str]
    val: tuple[str, str]
    test: tuple[str, str | None]  # None = latest available bar
    embargo_bars: int

    def as_dict(self) -> dict:
        return {
            "train": list(self.train),
            "val": list(self.val),
            "test": [self.test[0], self.test[1]],
            "embargo_bars": self.embargo_bars,
        }


DEFAULT_SPLITS: dict[str, SplitConfig] = {
    "equity": SplitConfig(
        train=("2012-01-01", "2020-12-31"),
        val=("2021-01-01", "2022-12-31"),
        test=("2023-01-01", None),
        embargo_bars=5,
    ),
    "crypto": SplitConfig(
        train=("2019-01-01", "2023-06-30"),
        val=("2023-07-01", "2024-06-30"),
        test=("2024-07-01", None),
        embargo_bars=24,
    ),
}


def default_splits(source: str) -> SplitConfig:
    return DEFAULT_SPLITS[asset_class_of(source)]


DEFAULT_LABELS: dict[str, dict[str, dict]] = {
    "fixed_horizon": {
        "1d": {"horizon": 1, "threshold": 0.0},
        "1h": {"horizon": 4, "threshold": 0.0},
    },
    "triple_barrier": {
        "1d": {"horizon": 5, "pt_sl": [1.5, 1.0], "vol_span": 20},
        "1h": {"horizon": 24, "pt_sl": [1.5, 1.0], "vol_span": 48},
    },
}


def default_label_config(method: str, interval: str) -> dict:
    by_interval = DEFAULT_LABELS[method]
    cfg = by_interval.get(interval) or by_interval["1d" if interval.endswith(("d", "wk")) else "1h"]
    return {"method": method, **cfg}


def default_cost_preset(source: str) -> str:
    return "crypto_spot" if asset_class_of(source) == "crypto" else "us_equity"


def default_cost_preset_for(symbol: str, source: str) -> str:
    if asset_class_of(source) == "crypto":
        return "crypto_spot"
    if symbol.upper().endswith((".NS", ".BO")):
        return "india_equity_nse"
    return "us_equity"

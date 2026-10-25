"""Parquet cache for OHLCV data and the data hash used for reproducibility."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

from tokenedge.config import safe_name
from tokenedge.data.base import normalize_ohlcv


def cache_file(root: Path, source: str, symbol: str, interval: str) -> Path:
    return root / source / f"{safe_name(symbol)}_{interval}.parquet"


def snapshot_file(root: Path, symbol: str, interval: str) -> Path:
    return root / f"{safe_name(symbol)}_{interval}.parquet"


def read_parquet(path: Path, interval: str) -> pd.DataFrame | None:
    if not path.exists():
        return None
    return normalize_ohlcv(pd.read_parquet(path), interval)


def write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    df.to_parquet(tmp, compression="zstd")
    tmp.replace(path)


def merge_bars(old: pd.DataFrame | None, new: pd.DataFrame) -> pd.DataFrame:
    if old is None or old.empty:
        return new
    combined = pd.concat([old, new])
    return combined[~combined.index.duplicated(keep="last")].sort_index()


def data_hash(df: pd.DataFrame) -> str:
    """Deterministic SHA-256 of the exact bars (index + OHLCV values) used in a run."""
    hashed = pd.util.hash_pandas_object(df, index=True).to_numpy()
    return "sha256:" + hashlib.sha256(hashed.tobytes()).hexdigest()

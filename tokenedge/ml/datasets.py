"""Supervised datasets built from OHLCV bars: features at t, label resolved at t1 > t."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from tokenedge.features.feature_sets import build_features
from tokenedge.labeling import make_labels


@dataclass
class Dataset:
    X: pd.DataFrame  # rows with complete features and a resolved label
    y: pd.Series
    t1: pd.Series
    ret: pd.Series
    features_all: pd.DataFrame  # every bar, NaN during warm-up (used for LSTM windows)
    label_config: dict

    @property
    def feature_names(self) -> list[str]:
        return list(self.X.columns)


def build_dataset(df: pd.DataFrame, feature_set: str, interval: str, label_config: dict) -> Dataset:
    feats = build_features(df, feature_set, interval)
    labels = make_labels(df["close"], label_config)
    ok = feats.notna().all(axis=1) & labels["label"].notna()
    return Dataset(
        X=feats[ok],
        y=labels.loc[ok, "label"].astype("int64"),
        t1=labels.loc[ok, "t1"],
        ret=labels.loc[ok, "ret"],
        features_all=feats,
        label_config=dict(label_config),
    )


def sequence_positions(
    features_all: pd.DataFrame, sample_index: pd.Index, seq_len: int
) -> np.ndarray:
    """Row position in ``features_all`` of each sample, or -1 when its window is incomplete."""
    valid = features_all.notna().all(axis=1).to_numpy()
    bad = np.convolve((~valid).astype(int), np.ones(seq_len, dtype=int), mode="full")[: len(valid)]
    pos = features_all.index.get_indexer(sample_index)
    ok = (pos >= seq_len - 1) & (bad[np.clip(pos, 0, None)] == 0)
    return np.where(ok, pos, -1)


def make_sequences(matrix: np.ndarray, end_positions: np.ndarray, seq_len: int) -> np.ndarray:
    """Stack windows ``matrix[p - seq_len + 1 : p + 1]`` -> (N, seq_len, n_features)."""
    offsets = np.arange(-seq_len + 1, 1)
    return matrix[end_positions[:, None] + offsets[None, :]]

"""Purged K-fold cross-validation (López de Prado, AFML Ch. 7)."""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np
import pandas as pd


class PurgedKFold:
    """K contiguous folds; training samples overlapping a test fold's label span are purged.

    For each test fold covering samples [t_a, t_b] whose labels resolve by ``max(t1)``:
      * training samples before the fold must have ``t1 < t_a`` (purge);
      * training samples after the fold must start after ``max(t1)`` plus ``embargo_bars``.
    """

    def __init__(self, n_splits: int = 5, embargo_bars: int = 0):
        if n_splits < 2:
            raise ValueError("n_splits must be >= 2")
        self.n_splits = n_splits
        self.embargo_bars = embargo_bars

    def split(
        self, index: pd.DatetimeIndex, t1: pd.Series
    ) -> Iterator[tuple[np.ndarray, np.ndarray]]:
        n = len(index)
        if n < self.n_splits * 2:
            raise ValueError("Not enough samples for the requested number of folds.")
        t1v = pd.DatetimeIndex(t1.reindex(index)).fillna(index[-1])
        positions = np.arange(n)
        for test_idx in np.array_split(positions, self.n_splits):
            t_start = index[test_idx[0]]
            t_end = t1v[test_idx].max()
            before = positions[(t1v < t_start) & (positions < test_idx[0])]
            after_start = int(np.searchsorted(index, t_end, side="right")) + self.embargo_bars
            after = positions[after_start:]
            yield np.concatenate([before, after]), test_idx

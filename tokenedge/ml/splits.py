"""Chronological train / validation / test splits with purging and embargo.

* Purging: a sample whose label is resolved (``t1``) on or after the start of the next split
  is dropped, because its outcome overlaps data the next split will be judged on.
* Embargo: the last ``embargo_bars`` samples before each boundary are dropped as well, to
  guard against leakage through serially correlated features.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from tokenedge.config import SplitConfig


def _ts(value, tz) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    if tz is not None and ts.tzinfo is None:
        return ts.tz_localize(tz)
    return ts


@dataclass(frozen=True)
class SplitWindows:
    train: tuple[str, str]
    val: tuple[str, str]
    test: tuple[str, str | None]
    embargo_bars: int

    @classmethod
    def from_config(cls, cfg: SplitConfig | dict) -> SplitWindows:
        if isinstance(cfg, SplitConfig):
            return cls(cfg.train, cfg.val, cfg.test, cfg.embargo_bars)
        return cls(
            tuple(cfg["train"]),
            tuple(cfg["val"]),
            tuple(cfg["test"]),
            int(cfg.get("embargo_bars", 0)),
        )


def _end_of_day(value, tz) -> pd.Timestamp:
    ts = _ts(value, tz)
    if isinstance(value, str) and len(value) <= 10:
        ts = ts + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    return ts


def assign_splits(
    index: pd.DatetimeIndex, t1: pd.Series, windows: SplitWindows
) -> dict[str, np.ndarray]:
    """Positions (into ``index``) of usable train / val / test samples."""
    tz = index.tz
    pos = np.arange(len(index))
    t1v = pd.DatetimeIndex(t1.reindex(index))
    has_t1 = ~t1v.isna()

    train0, train1 = _ts(windows.train[0], tz), _end_of_day(windows.train[1], tz)
    val0, val1 = _ts(windows.val[0], tz), _end_of_day(windows.val[1], tz)
    test0 = _ts(windows.test[0], tz)
    test1 = _end_of_day(windows.test[1], tz) if windows.test[1] else None

    first_val = int(np.searchsorted(index, val0))
    first_test = int(np.searchsorted(index, test0))
    e = int(windows.embargo_bars)

    in_train = (index >= train0) & (index <= train1)
    in_val = (index >= val0) & (index <= val1)
    in_test = index >= test0
    if test1 is not None:
        in_test &= index <= test1

    # NaT never compares as "<", so samples without a resolved label drop out here too.
    train_ok = in_train & has_t1 & (t1v < val0) & (pos < first_val - e)
    val_ok = in_val & has_t1 & (t1v < test0) & (pos < first_test - e)
    test_ok = in_test & has_t1
    return {"train": pos[train_ok], "val": pos[val_ok], "test": pos[test_ok]}


def split_summary(
    index: pd.DatetimeIndex, parts: dict[str, np.ndarray], windows: SplitWindows
) -> dict:
    """Split metadata recorded with a model: configured windows plus the bars actually used."""
    out: dict = {"embargo_bars": windows.embargo_bars}
    for name, window in (("train", windows.train), ("val", windows.val), ("test", windows.test)):
        p = parts.get(name, np.array([], dtype=int))
        out[name] = [window[0], window[1]]
        out[f"{name}_used"] = (
            [index[p[0]].isoformat(), index[p[-1]].isoformat(), int(len(p))] if len(p) else None
        )
    return out

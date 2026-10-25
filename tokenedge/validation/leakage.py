"""Look-ahead and leakage guards.

* ``check_model_window``: stops an ML backtest from running on bars the model was trained or
  tuned on (FR-V5). The earliest held-out bar is the start of the model's test window, which
  already sits after the validation window plus the embargo.
* ``future_perturbation_check``: verifies that a function of OHLCV data is causal, i.e. its
  output up to bar t does not change when random bars are appended after t (FR-V1, FR-V2).
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pandas as pd

from tokenedge.data.loader import to_utc
from tokenedge.errors import InSampleWindowError


def held_out_start(metadata: dict) -> pd.Timestamp:
    splits = metadata.get("splits") or {}
    test = splits.get("test")
    if test and test[0]:
        return to_utc(test[0])
    val = splits.get("val")
    if val and val[1]:
        return to_utc(val[1]) + pd.Timedelta(days=1)
    raise InSampleWindowError(f"Model {metadata.get('model_id')} has no recorded split windows.")


def check_model_window(metadata: dict, start: pd.Timestamp, allow_in_sample: bool = False) -> dict:
    """Return ``{"in_sample": bool, "held_out_start": iso}``; raise if overlap is not allowed."""
    earliest = held_out_start(metadata)
    start_ts = to_utc(start)
    in_sample = bool(start_ts < earliest)
    if in_sample and not allow_in_sample:
        raise InSampleWindowError(
            f"Requested window starts {start_ts.date()}, before model {metadata.get('model_id')}'s "
            f"held-out period begins ({earliest.date()}). Those bars were used for training or "
            "validation, so results would be optimistic.",
            {
                "model_id": metadata.get("model_id"),
                "held_out_start": earliest.isoformat(),
                "requested_start": start_ts.isoformat(),
            },
        )
    return {"in_sample": in_sample, "held_out_start": earliest.isoformat()}


def _random_future(data: pd.DataFrame, k: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    last = data.iloc[-1]
    step = data.index[-1] - data.index[-2]
    idx = pd.DatetimeIndex([data.index[-1] + step * (i + 1) for i in range(k)])
    close = float(last["close"]) * np.exp(np.cumsum(rng.normal(0, 0.05, k)))
    open_ = close * np.exp(rng.normal(0, 0.01, k))
    return pd.DataFrame(
        {
            "open": open_,
            "high": np.maximum(open_, close) * 1.02,
            "low": np.minimum(open_, close) * 0.98,
            "close": close,
            "volume": rng.uniform(0.5, 2.0, k) * float(data["volume"].mean() or 1.0),
        },
        index=idx,
    )


def future_perturbation_check(
    func: Callable[[pd.DataFrame], pd.Series | pd.DataFrame],
    data: pd.DataFrame,
    cut: int,
    k: int = 50,
    seed: int = 0,
) -> bool:
    """True when ``func(data[:cut])`` equals ``func(data[:cut] + random future)`` on the first ``cut`` bars."""
    past = data.iloc[:cut]
    with_future = pd.concat([past, _random_future(past, k, seed)])
    a = func(past)
    b = func(with_future).iloc[:cut]
    return bool(
        np.allclose(
            np.asarray(a, dtype="float64"),
            np.asarray(b, dtype="float64"),
            equal_nan=True,
            rtol=0,
            atol=1e-10,
        )
    )

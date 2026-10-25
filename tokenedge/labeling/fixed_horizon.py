"""Fixed-horizon labels: did the price rise by more than ``threshold`` over ``horizon`` bars?"""

from __future__ import annotations

import pandas as pd


def fixed_horizon_labels(
    close: pd.Series, horizon: int = 1, threshold: float = 0.0
) -> pd.DataFrame:
    """Return ``label`` (1/0, NaN where the horizon runs past the data), ``ret`` and ``t1``.

    ``t1`` is the timestamp at which the label is resolved; purging uses it to drop training
    samples whose outcome overlaps the next split.
    """
    if horizon < 1:
        raise ValueError("horizon must be >= 1")
    fwd = close.shift(-horizon) / close - 1.0
    label = (fwd > threshold).astype("float64").where(fwd.notna())
    t1 = pd.Series(close.index, index=close.index).shift(-horizon)
    out = pd.DataFrame({"label": label, "ret": fwd.astype("float64"), "t1": t1}, index=close.index)
    out["barrier"] = pd.Series("vertical", index=close.index, dtype=object).where(fwd.notna(), None)
    return out

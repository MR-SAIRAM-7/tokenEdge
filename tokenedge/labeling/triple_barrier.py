"""Triple-barrier labeling (López de Prado, AFML Ch. 3).

For each bar t we place an upper barrier at ``+pt * sigma_t``, a lower barrier at
``-sl * sigma_t`` (sigma_t = EWM volatility of log returns known at t) and a vertical barrier
``horizon`` bars ahead. The label records which barrier the price path touches first.
Binary mode: 1 = upper barrier first, 0 = lower or vertical barrier.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view


def ewm_volatility(close: pd.Series, span: int = 20) -> pd.Series:
    return np.log(close).diff().ewm(span=span, min_periods=span).std()


def triple_barrier_labels(
    close: pd.Series,
    horizon: int = 5,
    pt_sl: tuple[float, float] | list[float] = (1.5, 1.0),
    vol_span: int = 20,
) -> pd.DataFrame:
    if horizon < 1:
        raise ValueError("horizon must be >= 1")
    pt, sl = float(pt_sl[0]), float(pt_sl[1])
    c = close.to_numpy(dtype="float64")
    n = len(c)
    index = close.index
    vol = ewm_volatility(close, vol_span).to_numpy()

    label = np.full(n, np.nan)
    ret = np.full(n, np.nan)
    barrier = np.full(n, None, dtype=object)

    m = n - horizon  # events whose full horizon is inside the data
    if m <= 0:
        t1_empty = pd.Series(index, index=index).where(pd.Series(False, index=index))
        return pd.DataFrame(
            {"label": label, "ret": ret, "t1": t1_empty, "barrier": barrier}, index=index
        )

    paths = sliding_window_view(c[1:], horizon)[:m] / c[:m, None] - 1.0  # (m, horizon)
    sigma = vol[:m, None]
    hit_up = paths >= pt * sigma if pt > 0 else np.zeros_like(paths, dtype=bool)
    hit_dn = paths <= -sl * sigma if sl > 0 else np.zeros_like(paths, dtype=bool)
    first_up = np.where(hit_up.any(axis=1), hit_up.argmax(axis=1), horizon)
    first_dn = np.where(hit_dn.any(axis=1), hit_dn.argmax(axis=1), horizon)

    touch = np.minimum(first_up, first_dn)
    vertical = touch >= horizon
    touch = np.where(vertical, horizon - 1, touch)
    rows = np.arange(m)

    valid = ~np.isnan(vol[:m])
    label[:m] = np.where(valid, (first_up < first_dn).astype(float), np.nan)
    ret[:m] = np.where(valid, paths[rows, touch], np.nan)
    end_pos = rows + 1 + touch
    t1 = pd.Series(index[end_pos], index=index[:m])[valid].reindex(index)
    kinds = np.where(vertical, "vertical", np.where(first_up < first_dn, "upper", "lower"))
    kinds_obj = kinds.astype(object)
    kinds_obj[~valid] = None
    barrier[:m] = kinds_obj

    return pd.DataFrame({"label": label, "ret": ret, "t1": t1, "barrier": barrier}, index=index)

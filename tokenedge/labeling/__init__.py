from __future__ import annotations

import pandas as pd

from tokenedge.labeling.fixed_horizon import fixed_horizon_labels
from tokenedge.labeling.triple_barrier import triple_barrier_labels

LABEL_METHODS = ("fixed_horizon", "triple_barrier")


def make_labels(close: pd.Series, config: dict) -> pd.DataFrame:
    """Dispatch on ``config["method"]``; remaining keys are passed to the labeler."""
    method = config.get("method", "fixed_horizon")
    if method == "fixed_horizon":
        return fixed_horizon_labels(
            close, int(config.get("horizon", 1)), float(config.get("threshold", 0.0))
        )
    if method == "triple_barrier":
        return triple_barrier_labels(
            close,
            int(config.get("horizon", 5)),
            tuple(config.get("pt_sl", (1.5, 1.0))),
            int(config.get("vol_span", 20)),
        )
    raise ValueError(f"Unknown label method '{method}'. Available: {LABEL_METHODS}")


__all__ = ["LABEL_METHODS", "fixed_horizon_labels", "make_labels", "triple_barrier_labels"]

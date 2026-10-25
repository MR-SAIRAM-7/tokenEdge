"""Benchmark and classical technical-indicator strategies."""

from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd
from pydantic import Field, model_validator

from tokenedge.features.indicators import moving_average
from tokenedge.strategies.base import Strategy, StrategyParams, register


@register
class BuyHold(Strategy):
    name = "buy_hold"
    label = "Buy & Hold"
    description = "Buy at the first bar of the window and hold to the end. Reference benchmark."
    kind = "benchmark"

    def raw_signals(self, data: pd.DataFrame) -> pd.Series:
        return pd.Series(1.0, index=data.index)


class SMAParams(StrategyParams):
    fast: int = Field(
        20, ge=2, le=400, title="Fast window", description="Bars in the fast moving average"
    )
    slow: int = Field(
        50, ge=3, le=500, title="Slow window", description="Bars in the slow moving average"
    )
    ma_type: Literal["sma", "ema"] = Field("sma", title="Average type")
    min_hold: int = Field(
        0,
        ge=0,
        le=500,
        title="Minimum hold (bars)",
        description="Ignore new signals until a position has been held this long",
    )

    @model_validator(mode="after")
    def _fast_below_slow(self):
        if self.fast >= self.slow:
            raise ValueError("fast window must be smaller than slow window")
        return self


@register
class SMACrossover(Strategy):
    name = "sma_crossover"
    label = "SMA Crossover"
    description = (
        "Long when the fast moving average is above the slow one; flat (or short in long/short "
        "mode) otherwise. Classical baseline."
    )
    kind = "classical"
    Params = SMAParams

    def raw_signals(self, data: pd.DataFrame) -> pd.Series:
        p: SMAParams = self.params  # type: ignore[assignment]
        fast = moving_average(data["close"], p.fast, p.ma_type)
        slow = moving_average(data["close"], p.slow, p.ma_type)
        sig = pd.Series(np.where(fast > slow, 1.0, -1.0), index=data.index)
        return sig.where(fast.notna() & slow.notna())

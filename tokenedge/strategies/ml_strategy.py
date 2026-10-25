"""Strategies driven by registered ML models (XGBoost, LSTM, and an ML filter on SMA)."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
import pandas as pd
from pydantic import Field, model_validator
from scipy.stats import norm

from tokenedge.errors import ConfigError
from tokenedge.features.indicators import moving_average
from tokenedge.ml.registry import LoadedModel, get_registry
from tokenedge.strategies.base import Strategy, StrategyParams, register

BET_SIZE_STEP = 0.1


def bet_size(proba: pd.Series | np.ndarray, step: float = BET_SIZE_STEP) -> np.ndarray:
    """Position size from the predicted probability (AFML Ch. 10): m = 2 * Phi(z) - 1 with
    z = (p - 0.5) / sqrt(p (1 - p)), discretised to ``step`` so that small probability changes
    do not cause rebalancing trades. Taking a position always means at least one step."""
    p = np.clip(np.asarray(proba, dtype="float64"), 1e-6, 1 - 1e-6)
    m = np.abs(2.0 * norm.cdf((p - 0.5) / np.sqrt(p * (1.0 - p))) - 1.0)
    return np.maximum(step, np.round(m / step) * step)


class MLParams(StrategyParams):
    model_id: str = Field(..., title="Model", description="Registered model to use")
    threshold_long: float | None = Field(
        None,
        ge=0.5,
        le=0.99,
        title="Long threshold",
        description="Go long when P(up) is above this. Empty = value chosen on validation.",
    )
    threshold_short: float | None = Field(
        None,
        ge=0.01,
        le=0.5,
        title="Short threshold",
        description="Go short when P(up) is below this (long/short mode only). Empty = 1 - long threshold.",
    )
    sizing: Literal["all_in", "probability"] = Field(
        "all_in",
        title="Position sizing",
        description="All-in: full position whenever the threshold is crossed. Probability: size "
        "grows with the model's confidence (AFML bet sizing, steps of 10%).",
    )
    min_hold: int = Field(0, ge=0, le=500, title="Minimum hold (bars)")


class MLStrategy(Strategy):
    kind = "ml"
    Params: ClassVar[type[StrategyParams]] = MLParams

    def model(self) -> LoadedModel:
        p: MLParams = self.params  # type: ignore[assignment]
        model = get_registry().load(p.model_id)
        if self.model_type and model.metadata.get("model_type") != self.model_type:
            raise ConfigError(
                f"Model '{p.model_id}' is a {model.metadata.get('model_type')} model; "
                f"strategy '{self.name}' needs a {self.model_type} model."
            )
        return model

    def thresholds(self, model: LoadedModel) -> tuple[float, float]:
        p: MLParams = self.params  # type: ignore[assignment]
        stored = model.metadata.get("threshold") or {}
        long_t = (
            p.threshold_long if p.threshold_long is not None else float(stored.get("long", 0.55))
        )
        short_default = stored.get("short")
        short_t = (
            p.threshold_short
            if p.threshold_short is not None
            else float(short_default)
            if short_default is not None
            else 1.0 - long_t
        )
        return long_t, min(short_t, long_t)

    def predict_proba(self, data: pd.DataFrame) -> pd.Series:
        return self.model().predict_proba(data)

    def signals_from_proba(
        self, proba: pd.Series, model: LoadedModel, data: pd.DataFrame | None = None
    ) -> pd.Series:
        long_t, short_t = self.thresholds(model)
        values = np.where(proba > long_t, 1.0, np.where(proba < short_t, -1.0, 0.0))
        if getattr(self.params, "sizing", "all_in") == "probability":
            values = values * bet_size(proba.fillna(0.5))
        return pd.Series(values, index=proba.index).where(proba.notna())

    def raw_signals(self, data: pd.DataFrame) -> pd.Series:
        model = self.model()
        return self.signals_from_proba(model.predict_proba(data), model, data)

    def signals_and_proba(self, data: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
        """Final signals plus the model probabilities they came from (one inference pass)."""
        model = self.model()
        proba = model.predict_proba(data)
        return self.finalize(self.signals_from_proba(proba, model, data), data.index), proba


@register
class XGBoostStrategy(MLStrategy):
    name = "xgboost"
    label = "XGBoost"
    description = (
        "Gradient-boosted trees predict P(price up) from technical features. Long above the "
        "threshold chosen on validation data."
    )
    model_type = "xgboost"


@register
class LSTMStrategy(MLStrategy):
    name = "lstm"
    label = "LSTM"
    description = (
        "A recurrent neural network reads the last N bars of features and predicts P(price up). "
        "Runs through ONNX Runtime."
    )
    model_type = "lstm"


class FilterParams(StrategyParams):
    fast: int = Field(20, ge=2, le=400, title="Fast window", description="Bars in the fast average")
    slow: int = Field(50, ge=3, le=500, title="Slow window", description="Bars in the slow average")
    ma_type: Literal["sma", "ema"] = Field("sma", title="Average type")
    model_id: str = Field(..., title="Model", description="Registered model used as the filter")
    threshold_long: float | None = Field(
        None,
        ge=0.5,
        le=0.99,
        title="Confirmation threshold",
        description="Take an SMA long only when P(up) is above this. Empty = the model's "
        "validation threshold.",
    )
    threshold_short: float | None = Field(
        None,
        ge=0.01,
        le=0.5,
        title="Short confirmation",
        description="Take an SMA short only when P(up) is below this (long/short mode). "
        "Empty = 1 - confirmation threshold.",
    )
    min_hold: int = Field(0, ge=0, le=500, title="Minimum hold (bars)")

    @model_validator(mode="after")
    def _fast_below_slow(self):
        if self.fast >= self.slow:
            raise ValueError("fast window must be smaller than slow window")
        return self


@register
class SMAMLFilter(MLStrategy):
    """Meta-labeling style filter: the SMA crossover decides the side, the model decides whether
    to take it. Uses an existing direction model (XGBoost or LSTM) as the secondary model."""

    name = "sma_ml_filter"
    label = "SMA + ML filter"
    description = (
        "The SMA crossover picks the side and a trained model must agree before a position is "
        "taken: long only when P(up) is above the threshold. Fewer, more selective trades."
    )
    model_type = None
    Params = FilterParams

    def signals_from_proba(
        self, proba: pd.Series, model: LoadedModel, data: pd.DataFrame | None = None
    ) -> pd.Series:
        if data is None:
            raise ValueError("The SMA + ML filter needs the price data for the SMA side.")
        p: FilterParams = self.params  # type: ignore[assignment]
        fast = moving_average(data["close"], p.fast, p.ma_type)
        slow = moving_average(data["close"], p.slow, p.ma_type)
        long_t, short_t = self.thresholds(model)
        bullish = fast > slow
        values = np.where(
            bullish & (proba > long_t), 1.0, np.where(~bullish & (proba < short_t), -1.0, 0.0)
        )
        known = proba.notna() & fast.notna() & slow.notna()
        return pd.Series(values, index=proba.index).where(known)

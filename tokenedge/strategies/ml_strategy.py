"""Strategies driven by registered ML models (XGBoost, LSTM)."""

from __future__ import annotations

import numpy as np
import pandas as pd
from pydantic import Field

from tokenedge.errors import ConfigError
from tokenedge.ml.registry import LoadedModel, get_registry
from tokenedge.strategies.base import Strategy, StrategyParams, register


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
    min_hold: int = Field(0, ge=0, le=500, title="Minimum hold (bars)")


class MLStrategy(Strategy):
    kind = "ml"
    Params = MLParams

    def model(self) -> LoadedModel:
        p: MLParams = self.params  # type: ignore[assignment]
        model = get_registry().load(p.model_id)
        if model.metadata.get("model_type") != self.model_type:
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

    def signals_from_proba(self, proba: pd.Series, model: LoadedModel) -> pd.Series:
        long_t, short_t = self.thresholds(model)
        values = np.where(proba > long_t, 1.0, np.where(proba < short_t, -1.0, 0.0))
        return pd.Series(values, index=proba.index).where(proba.notna())

    def raw_signals(self, data: pd.DataFrame) -> pd.Series:
        model = self.model()
        return self.signals_from_proba(model.predict_proba(data), model)

    def signals_and_proba(self, data: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
        """Final signals plus the model probabilities they came from (one inference pass)."""
        model = self.model()
        proba = model.predict_proba(data)
        return self.finalize(self.signals_from_proba(proba, model), data.index), proba


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

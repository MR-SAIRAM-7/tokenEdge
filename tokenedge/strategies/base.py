"""Strategy interface and registry.

A strategy turns OHLCV bars into a target position per bar in {-1, 0, +1}. The signal at bar
t may use data up to and including bar t; the engine executes it at the open of bar t+1.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, ValidationError

from tokenedge.errors import ConfigError


class StrategyParams(BaseModel):
    """Base parameter model. Subclasses that support it declare ``min_hold`` (last, for form order)."""

    model_config = ConfigDict(extra="forbid")


class Strategy(ABC):
    name: ClassVar[str]
    label: ClassVar[str]
    description: ClassVar[str]
    kind: ClassVar[str]  # "benchmark" | "classical" | "ml"
    model_type: ClassVar[str | None] = None
    Params: ClassVar[type[StrategyParams]] = StrategyParams

    def __init__(self, **params):
        try:
            self.params = self.Params(**params)
        except ValidationError as exc:
            problems = "; ".join(
                f"{'.'.join(str(x) for x in e['loc']) or 'params'}: {e['msg'].removeprefix('Value error, ')}"
                for e in exc.errors()
            )
            raise ConfigError(f"Invalid parameters for {self.label}: {problems}") from exc

    @abstractmethod
    def raw_signals(self, data: pd.DataFrame) -> pd.Series:
        """Unfiltered target positions; NaN means 'no opinion' and becomes flat."""

    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        return self.finalize(self.raw_signals(data), data.index)

    def finalize(self, raw: pd.Series, index: pd.Index) -> pd.Series:
        """NaN -> flat, clip to [-1, 1] and apply the minimum holding period."""
        sig = raw.reindex(index).astype("float64").fillna(0.0).clip(-1.0, 1.0)
        min_hold = int(getattr(self.params, "min_hold", 0) or 0)
        if min_hold > 0:
            sig = apply_min_hold(sig, min_hold)
        return sig.rename(self.name)

    def describe(self) -> dict:
        return {"name": self.name, "label": self.label, "params": self.params.model_dump()}


def apply_min_hold(signals: pd.Series, bars: int) -> pd.Series:
    """Keep each new position for at least ``bars`` bars before allowing another change."""
    values = signals.to_numpy().copy()
    last_change = -bars - 1
    current = 0.0
    for i, v in enumerate(values):
        if v != current and i - last_change >= bars:
            current = v
            last_change = i
        values[i] = current
    return pd.Series(values, index=signals.index)


REGISTRY: dict[str, type[Strategy]] = {}


def register(cls: type[Strategy]) -> type[Strategy]:
    REGISTRY[cls.name] = cls
    return cls


def get_strategy(name: str, params: dict | None = None) -> Strategy:
    try:
        cls = REGISTRY[name]
    except KeyError as exc:
        raise ConfigError(f"Unknown strategy '{name}'.", {"available": sorted(REGISTRY)}) from exc
    return cls(**(params or {}))


def list_strategies() -> list[dict]:
    out = []
    for cls in REGISTRY.values():
        schema = cls.Params.model_json_schema()
        out.append(
            {
                "name": cls.name,
                "label": cls.label,
                "description": cls.description,
                "kind": cls.kind,
                "model_type": cls.model_type,
                "params_schema": schema,
            }
        )
    return out


def sign(x: pd.Series) -> pd.Series:
    return pd.Series(np.sign(x.to_numpy()), index=x.index)

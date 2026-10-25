"""Request models for the REST API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from tokenedge.config import DEFAULT_RISK_FREE_RATE, default_cost_preset_for
from tokenedge.engine.costs import (
    COST_PRESETS,
    CommissionModel,
    ExecutionConfig,
    SlippageModel,
    execution_from_preset,
)
from tokenedge.errors import ConfigError

WindowName = Literal["custom", "train", "val", "test", "model_test", "full"]


class ExecutionIn(BaseModel):
    """Execution settings. ``preset`` fills commission/slippage; explicit fields override it."""

    model_config = ConfigDict(extra="forbid")

    preset: str | None = Field(None, description=f"One of {sorted(COST_PRESETS)}")
    initial_capital: float = Field(100_000.0, gt=0, le=1e12)
    mode: Literal["long_flat", "long_short"] = "long_flat"
    max_leverage: float = Field(1.0, gt=0, le=5)
    fractional: bool | None = None
    commission: CommissionModel | None = None
    slippage: SlippageModel | None = None
    borrow_rate: float = Field(0.0, ge=0, le=1)
    cash_rate: float | None = Field(
        None,
        ge=-0.05,
        le=1,
        description="Annual interest on idle cash. Empty = the risk-free rate used for the Sharpe "
        "ratio, so a strategy that stays flat has a Sharpe of about zero.",
    )

    def to_config(
        self, symbol: str, source: str, risk_free_rate: float = DEFAULT_RISK_FREE_RATE
    ) -> tuple[ExecutionConfig, str | None]:
        preset = self.preset
        if preset is None and self.commission is None and self.slippage is None:
            preset = default_cost_preset_for(symbol, source)
        if preset is not None and preset not in COST_PRESETS:
            raise ConfigError(
                f"Unknown cost preset '{preset}'.", {"available": sorted(COST_PRESETS)}
            )
        base = execution_from_preset(preset) if preset else ExecutionConfig()
        update: dict = {
            "initial_capital": self.initial_capital,
            "mode": self.mode,
            "max_leverage": self.max_leverage,
            "borrow_rate": self.borrow_rate,
            "cash_rate": self.cash_rate if self.cash_rate is not None else risk_free_rate,
        }
        if self.fractional is not None:
            update["fractional"] = self.fractional
        if self.commission is not None:
            update["commission"] = self.commission
        if self.slippage is not None:
            update["slippage"] = self.slippage
        return base.model_copy(update=update), preset


class StrategySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    params: dict = Field(default_factory=dict)
    label: str | None = None
    trials: int | None = Field(
        None, ge=1, le=100_000, description="Configurations tried (for the Deflated Sharpe Ratio)"
    )
    trial_sharpe_std: float | None = Field(None, ge=0)


class MarketIn(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=40)
    source: Literal["yfinance", "ccxt"] = "yfinance"
    interval: str = Field("1d", pattern=r"^\d+(m|h|d|wk|mo)$")


class WindowIn(MarketIn):
    window: WindowName = "test"
    start: str | None = None
    end: str | None = None


class BacktestRequest(WindowIn):
    model_config = ConfigDict(extra="forbid")

    strategy: StrategySpec
    execution: ExecutionIn = Field(default_factory=ExecutionIn)
    risk_free_rate: float = Field(DEFAULT_RISK_FREE_RATE, ge=-0.05, le=0.5)
    allow_in_sample: bool = False
    benchmark: bool = True
    name: str | None = Field(None, max_length=120)
    save: bool = True


class StatisticsIn(BaseModel):
    bootstrap_samples: int = Field(5000, ge=100, le=20_000)
    block_size: float | None = Field(None, gt=0, le=1000)
    baseline: str | None = None
    seed: int = 42


class CompareRequest(WindowIn):
    model_config = ConfigDict(extra="forbid")

    window: WindowName = "model_test"
    strategies: list[StrategySpec] = Field(..., min_length=1, max_length=8)
    execution: ExecutionIn = Field(default_factory=ExecutionIn)
    risk_free_rate: float = Field(DEFAULT_RISK_FREE_RATE, ge=-0.05, le=0.5)
    allow_in_sample: bool = False
    statistics: StatisticsIn = Field(default_factory=StatisticsIn)
    cost_levels: list[float] = Field(
        default_factory=lambda: [0.0, 5.0, 10.0, 20.0, 50.0], max_length=12
    )
    name: str | None = Field(None, max_length=120)
    save: bool = True


class SensitivityRequest(WindowIn):
    model_config = ConfigDict(extra="forbid")

    strategies: list[StrategySpec] = Field(..., min_length=1, max_length=8)
    execution: ExecutionIn = Field(default_factory=ExecutionIn)
    risk_free_rate: float = Field(DEFAULT_RISK_FREE_RATE, ge=-0.05, le=0.5)
    allow_in_sample: bool = False
    cost_levels: list[float] = Field(
        default_factory=lambda: [0.0, 5.0, 10.0, 20.0, 50.0], max_length=12
    )


class TuneRequest(MarketIn):
    model_config = ConfigDict(extra="forbid")

    execution: ExecutionIn = Field(default_factory=ExecutionIn)
    fast_grid: list[int] = Field(
        default_factory=lambda: [5, 10, 20, 30, 50], min_length=1, max_length=12
    )
    slow_grid: list[int] = Field(
        default_factory=lambda: [50, 100, 150, 200], min_length=1, max_length=12
    )
    ma_type: Literal["sma", "ema"] = "sma"
    risk_free_rate: float = Field(DEFAULT_RISK_FREE_RATE, ge=-0.05, le=0.5)


class RefreshRequest(MarketIn):
    pass


class RenameRunRequest(BaseModel):
    name: str = Field(..., max_length=120)

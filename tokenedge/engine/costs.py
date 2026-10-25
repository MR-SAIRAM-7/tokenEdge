"""Commission and slippage models, execution settings and cost presets."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field


class CommissionModel(BaseModel):
    """fee = max(min_fee, notional * bps / 1e4) + fixed_fee, with separate buy and sell rates."""

    buy_bps: float = Field(0.0, ge=0, le=1000, description="Commission on buys, in basis points")
    sell_bps: float = Field(0.0, ge=0, le=1000, description="Commission on sells, in basis points")
    fixed_fee: float = Field(0.0, ge=0, description="Flat fee per order (account currency)")
    min_fee: float = Field(0.0, ge=0, description="Minimum percentage fee per order")

    def rate(self, side: int) -> float:
        return (self.buy_bps if side > 0 else self.sell_bps) / 1e4

    def fee(self, qty: float, price: float) -> float:
        notional = abs(qty) * price
        if notional == 0:
            return 0.0
        side = 1 if qty > 0 else -1
        return max(self.min_fee, notional * self.rate(side)) + self.fixed_fee


class SlippageModel(BaseModel):
    """Price concession s (a fraction) applied against the trader at the fill.

    * ``fixed``: s = bps / 1e4
    * ``range``: s = range_fraction * (high - low) / close of the previous bar
    * ``sqrt_impact``: s = half_spread + impact_coef * sigma * sqrt(qty / ADV20),
      with sigma and ADV measured over the previous 20 bars (square-root market impact)
    """

    model: Literal["fixed", "range", "sqrt_impact"] = "fixed"
    bps: float = Field(0.0, ge=0, le=1000)
    range_fraction: float = Field(0.1, ge=0, le=1)
    half_spread_bps: float = Field(1.0, ge=0, le=500)
    impact_coef: float = Field(0.1, ge=0, le=10)
    max_bps: float = Field(500.0, gt=0, le=5000, description="Cap on slippage per fill")

    def fraction(self, qty: float, prev_range: float, sigma: float, adv: float) -> float:
        if self.model == "fixed":
            s = self.bps / 1e4
        elif self.model == "range":
            s = self.range_fraction * prev_range if math.isfinite(prev_range) else 0.0
        else:
            s = self.half_spread_bps / 1e4
            if adv > 0 and math.isfinite(adv) and math.isfinite(sigma):
                s += self.impact_coef * sigma * math.sqrt(abs(qty) / adv)
        return min(max(s, 0.0), self.max_bps / 1e4)


class ExecutionConfig(BaseModel):
    initial_capital: float = Field(100_000.0, gt=0)
    mode: Literal["long_flat", "long_short"] = "long_flat"
    max_leverage: float = Field(1.0, gt=0, le=5)
    fractional: bool = Field(
        True, description="Allow fractional quantities (crypto). False = whole shares."
    )
    commission: CommissionModel = Field(default_factory=CommissionModel)
    slippage: SlippageModel = Field(default_factory=SlippageModel)
    borrow_rate: float = Field(0.0, ge=0, le=1, description="Annual borrow cost on short notional")

    def per_side_cost_bps(self) -> float:
        """Rough round-number view of costs used in reports (fixed slippage only)."""
        slip = (
            self.slippage.bps if self.slippage.model == "fixed" else self.slippage.half_spread_bps
        )
        return (self.commission.buy_bps + self.commission.sell_bps) / 2 + slip


COST_PRESETS: dict[str, dict] = {
    "zero_cost": {
        "label": "Zero cost (ablation)",
        "description": "No commission or slippage. Use only to measure how much costs matter.",
        "commission": {"buy_bps": 0, "sell_bps": 0},
        "slippage": {"model": "fixed", "bps": 0},
        "fractional": True,
    },
    "us_equity": {
        "label": "US equity (commission-free broker)",
        "description": "0 bps commission, 2 bps slippage per side.",
        "commission": {"buy_bps": 0, "sell_bps": 0},
        "slippage": {"model": "fixed", "bps": 2},
        "fractional": False,
    },
    "india_equity_nse": {
        "label": "Indian equity delivery (NSE)",
        "description": "Approx. STT 0.1% each side plus exchange, SEBI, GST and stamp duty "
        "(about 12 bps on buys, 11 bps on sells), 3 bps slippage.",
        "commission": {"buy_bps": 12, "sell_bps": 11},
        "slippage": {"model": "fixed", "bps": 3},
        "fractional": False,
    },
    "crypto_spot": {
        "label": "Crypto spot (taker)",
        "description": "10 bps taker fee per side (typical exchange base tier), 3 bps slippage.",
        "commission": {"buy_bps": 10, "sell_bps": 10},
        "slippage": {"model": "fixed", "bps": 3},
        "fractional": True,
    },
}


def execution_from_preset(name: str, **overrides) -> ExecutionConfig:
    if name not in COST_PRESETS:
        raise ValueError(f"Unknown cost preset '{name}'. Available: {sorted(COST_PRESETS)}")
    preset = COST_PRESETS[name]
    data = {
        "commission": preset["commission"],
        "slippage": preset["slippage"],
        "fractional": preset["fractional"],
    }
    data.update(overrides)
    return ExecutionConfig(**data)


def with_flat_cost(config: ExecutionConfig, bps_per_side: float) -> ExecutionConfig:
    """Copy of ``config`` with commission = ``bps_per_side`` on both sides and no slippage."""
    return config.model_copy(
        update={
            "commission": CommissionModel(buy_bps=bps_per_side, sell_bps=bps_per_side),
            "slippage": SlippageModel(model="fixed", bps=0.0),
        }
    )

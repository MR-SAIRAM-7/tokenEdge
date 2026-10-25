"""Round-trip trade bookkeeping.

Gross P&L is measured at reference prices (the bar open, or the final close), so that
``net_pnl = gross_pnl - fees - slippage - borrow`` equals the trade's real cash effect.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd


@dataclass
class _OpenTrade:
    side: int
    entry_time: pd.Timestamp
    entry_bar: int
    qty: float = 0.0
    qty_in: float = 0.0
    qty_out: float = 0.0
    max_qty: float = 0.0
    entry_ref_value: float = 0.0
    exit_ref_value: float = 0.0
    fees: float = 0.0
    slippage: float = 0.0
    borrow: float = 0.0


@dataclass
class TradeBook:
    open: _OpenTrade | None = None
    closed: list[dict] = field(default_factory=list)

    def on_fill(
        self,
        ts: pd.Timestamp,
        bar: int,
        delta: float,
        ref_price: float,
        fee: float,
        slip_cost: float,
    ) -> None:
        if delta == 0:
            return
        side = 1 if delta > 0 else -1
        remaining = abs(delta)

        if self.open is not None and side != self.open.side:
            close_qty = min(remaining, self.open.qty)
            share = close_qty / abs(delta)
            t = self.open
            t.qty -= close_qty
            t.qty_out += close_qty
            t.exit_ref_value += ref_price * close_qty
            t.fees += fee * share
            t.slippage += slip_cost * share
            remaining -= close_qty
            if t.qty <= 1e-12:
                self._finalize(ts, bar)

        if remaining > 1e-12:
            share = remaining / abs(delta)
            if self.open is None:
                self.open = _OpenTrade(side=side, entry_time=ts, entry_bar=bar)
            t = self.open
            t.qty += remaining
            t.qty_in += remaining
            t.max_qty = max(t.max_qty, t.qty)
            t.entry_ref_value += ref_price * remaining
            t.fees += fee * share
            t.slippage += slip_cost * share

    def accrue_borrow(self, cost: float) -> None:
        if self.open is not None:
            self.open.borrow += cost

    def _finalize(self, ts: pd.Timestamp, bar: int) -> None:
        t = self.open
        assert t is not None
        entry_price = t.entry_ref_value / t.qty_in
        exit_price = t.exit_ref_value / t.qty_out
        gross = t.side * (t.exit_ref_value - t.entry_ref_value)
        costs = t.fees + t.slippage + t.borrow
        net = gross - costs
        self.closed.append(
            {
                "entry_time": t.entry_time,
                "exit_time": ts,
                "side": "long" if t.side > 0 else "short",
                "qty": t.max_qty,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "gross_pnl": gross,
                "fees": t.fees,
                "slippage": t.slippage,
                "borrow": t.borrow,
                "costs": costs,
                "net_pnl": net,
                "return": net / t.entry_ref_value if t.entry_ref_value else 0.0,
                "bars_held": bar - t.entry_bar,
            }
        )
        self.open = None

    def to_frame(self) -> pd.DataFrame:
        cols = [
            "entry_time",
            "exit_time",
            "side",
            "qty",
            "entry_price",
            "exit_price",
            "gross_pnl",
            "fees",
            "slippage",
            "borrow",
            "costs",
            "net_pnl",
            "return",
            "bars_held",
        ]
        return pd.DataFrame(self.closed, columns=cols)

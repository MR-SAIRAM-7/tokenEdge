"""Run the evaluation experiments (E1, E2, E5, E6) and save CSV tables to docs/results/.

Uses only existing data and registered models (no training). E3 and E4 train models and live in
notebooks/03_experiments.ipynb for Colab.

Usage:
    python scripts/run_experiments.py                    # default markets
    python scripts/run_experiments.py SPY:yfinance:1d    # custom list
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tokenedge.experiments import (  # noqa: E402
    DEFAULT_MARKETS,
    e1_main_comparison,
    e2_cost_sensitivity,
    e6_accuracy_vs_profit,
)


def main(args: list[str]) -> None:
    markets = [tuple(a.split(":")) for a in args] if args else DEFAULT_MARKETS
    out = ROOT / "docs" / "results"
    out.mkdir(parents=True, exist_ok=True)
    e1, runs = e1_main_comparison(markets)  # type: ignore[arg-type]
    e1.to_csv(out / "e1_main_comparison.csv", index=False)
    e2_cost_sensitivity(runs).to_csv(out / "e2_cost_sensitivity.csv", index=False)
    e6 = e6_accuracy_vs_profit(runs)
    if not e6.empty:
        e6.to_csv(out / "e6_accuracy_vs_profit.csv", index=False)
    with open(out / "verdicts.md", "w", encoding="utf-8") as fh:
        for run in runs:
            fh.write(f"## {run.market[0]} {run.market[2]}\n\n{run.report['verdict']}\n\n")
    print(e1.round(3).to_string(index=False))
    print(f"\nSaved tables to {out}")


if __name__ == "__main__":
    main(sys.argv[1:])

"""Run the evaluation experiments and save tables, figures and a summary to docs/results/.

E1, E2, E5, E6 and E7 only evaluate the registered models. E3 and E4 train small XGBoost models,
so they only run with --with-training (in Colab or the "Experiments" GitHub Actions workflow,
not on a laptop).

Usage:
    python scripts/run_experiments.py                          # default markets, no training
    python scripts/run_experiments.py --with-training          # also E3 and E4
    python scripts/run_experiments.py SPY:yfinance:1d BTC/USDT:ccxt:1h
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tokenedge.config import default_cost_preset_for  # noqa: E402
from tokenedge.data.cache import data_hash  # noqa: E402
from tokenedge.experiments import (  # noqa: E402
    DEFAULT_MARKETS,
    MarketRun,
    e1_main_comparison,
    e2_cost_sensitivity,
    e3_label_ablation,
    e4_lookahead_bias,
    e6_accuracy_vs_profit,
    e7_extensions,
)
from tokenedge.ml.registry import get_registry  # noqa: E402

# Same colors as the web app: the color follows the strategy.
COLORS = {
    "buy_hold": "#6250d6",
    "sma_crossover": "#2a78d6",
    "xgboost": "#eb6834",
    "lstm": "#1baf7a",
    "filter": "#eda100",
}
NAMES = {
    "buy_hold": "Buy & Hold",
    "sma_crossover": "SMA (tuned)",
    "xgboost": "XGBoost",
    "lstm": "LSTM",
}
PCT = {"total_return", "cagr", "max_drawdown", "psr", "dsr", "exposure", "accuracy", "base_rate"}


# ----------------------------------------------------------------------------- formatting


def _fmt(col: str, v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "—"
    if isinstance(v, float):
        if col in PCT or col.startswith("test_total_return") or col.startswith("test_max"):
            return f"{v:.1%}"
        return f"{v:.3f}" if abs(v) < 10 else f"{v:,.0f}"
    return str(v)


def md_table(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for row in df.itertuples(index=False):
        lines.append("| " + " | ".join(_fmt(c, v) for c, v in zip(cols, row, strict=True)) + " |")
    return "\n".join(lines)


def git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True
        )
        return out.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


# ----------------------------------------------------------------------------- figures


def _plt():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update(
        {
            "figure.dpi": 130,
            "font.size": 9,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.color": "#eceef1",
            "axes.axisbelow": True,
        }
    )
    return plt


def _grouped_bars(ax, table: pd.DataFrame, value: str, keys: list[str], colors, labels) -> None:
    markets = list(dict.fromkeys(table["market"]))
    width = 0.8 / max(len(keys), 1)
    for i, key in enumerate(keys):
        vals = [
            table[(table["market"] == m) & (table["key"] == key)][value].mean() for m in markets
        ]
        xs = [j + (i - (len(keys) - 1) / 2) * width for j in range(len(markets))]
        ax.bar(xs, vals, width * 0.92, color=colors[i], label=labels[i])
    ax.set_xticks(range(len(markets)), markets)
    ax.axhline(0, color="#747b8a", lw=0.8)
    ax.legend(frameon=False, ncols=len(keys), loc="upper center", bbox_to_anchor=(0.5, 1.13))


def figures(out: Path, e1: pd.DataFrame, runs: list[MarketRun], e2, e3, e4, e6, e7) -> list[str]:
    plt = _plt()
    made: list[str] = []
    keys = [k for k in NAMES if k in set(e1["strategy"])]
    t1 = e1.rename(columns={"strategy": "key"})

    for value, title, name in (
        ("sharpe", "Sharpe ratio on held-out data (after costs)", "e1_sharpe.png"),
        ("max_drawdown", "Maximum drawdown on held-out data", "e1_max_drawdown.png"),
    ):
        fig, ax = plt.subplots(figsize=(9, 3.8))
        _grouped_bars(ax, t1, value, keys, [COLORS[k] for k in keys], [NAMES[k] for k in keys])
        ax.set_title(title, pad=26)
        if value == "max_drawdown":
            ax.yaxis.set_major_formatter(lambda v, _: f"{v:.0%}")
        fig.tight_layout()
        fig.savefig(out / name)
        plt.close(fig)
        made.append(name)

    n = len(runs)
    cols = 3 if n > 4 else 2
    rows = -(-n // cols)
    fig, axes = plt.subplots(rows, cols, figsize=(4.2 * cols, 2.8 * rows), squeeze=False)
    for ax, run in zip(axes.flat, runs, strict=False):
        for key, res in run.results.items():
            eq = res.equity / res.equity.iloc[0]
            ax.plot(eq.index, eq, color=COLORS.get(key, "#888"), lw=1.2, label=NAMES.get(key, key))
        ax.set_title(f"{run.market[0]} {run.market[2]}")
        ax.tick_params(axis="x", labelrotation=30)
    for ax in list(axes.flat)[n:]:
        ax.axis("off")
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.suptitle("Growth of 1 on the held-out window")
    fig.tight_layout(rect=(0, 0.06, 1, 1))
    fig.legend(handles, labels, loc="lower center", ncols=len(labels), frameon=False)
    fig.savefig(out / "e1_equity_curves.png", bbox_inches="tight")
    plt.close(fig)
    made.append("e1_equity_curves.png")

    markets = list(dict.fromkeys(e2["market"]))
    cols = 3 if len(markets) > 4 else 2
    rows = -(-len(markets) // cols)
    fig, axes = plt.subplots(rows, cols, figsize=(4.2 * cols, 2.7 * rows), squeeze=False)
    for ax, market in zip(axes.flat, markets, strict=False):
        part = e2[e2["market"] == market]
        for key, g in part.groupby("strategy", sort=False):
            ax.plot(
                g["bps_per_side"],
                g["sharpe"],
                "o-",
                ms=3,
                color=COLORS.get(key, "#888"),
                label=NAMES.get(key, key),
            )
        ax.axhline(0, color="#747b8a", lw=0.8)
        ax.set_title(market)
        ax.set_xlabel("cost per side (bps)")
    for ax in list(axes.flat)[len(markets) :]:
        ax.axis("off")
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.suptitle("Sharpe ratio as trading costs rise")
    fig.tight_layout(rect=(0, 0.06, 1, 1))
    fig.legend(handles, labels, loc="lower center", ncols=len(labels), frameon=False)
    fig.savefig(out / "e2_cost_sensitivity.png", bbox_inches="tight")
    plt.close(fig)
    made.append("e2_cost_sensitivity.png")

    if not e6.empty:
        fig, ax = plt.subplots(figsize=(5.5, 4))
        for row in e6.itertuples(index=False):
            ax.scatter(row.roc_auc, row.sharpe, color=COLORS.get(row.model, "#888"), s=40)
            ax.annotate(
                row.market.split()[0],
                (row.roc_auc, row.sharpe),
                fontsize=7,
                xytext=(4, 3),
                textcoords="offset points",
            )
        for key in sorted(set(e6["model"])):
            ax.scatter([], [], color=COLORS.get(key, "#888"), label=NAMES.get(key, key))
        ax.axvline(0.5, color="#747b8a", lw=0.8, ls="--")
        ax.axhline(0, color="#747b8a", lw=0.8)
        ax.set_xlabel("ROC-AUC on the held-out window")
        ax.set_ylabel("Sharpe ratio (after costs)")
        ax.set_title("Accuracy is not profitability")
        ax.legend(frameon=False)
        fig.tight_layout()
        fig.savefig(out / "e6_auc_vs_sharpe.png")
        plt.close(fig)
        made.append("e6_auc_vs_sharpe.png")

    if not e7.empty:
        t7 = e7.assign(key=e7["variant"].map(_e7_group))
        order = ["sma", "all_in", "sized", "filter"]
        present = [k for k in order if k in set(t7["key"])]
        palette = {
            "sma": COLORS["sma_crossover"],
            "all_in": COLORS["xgboost"],
            "sized": "#e87ba4",
            "filter": COLORS["filter"],
        }
        names = {
            "sma": "SMA (tuned)",
            "all_in": "Model, all-in",
            "sized": "Model, bet sizing",
            "filter": "SMA + model filter",
        }
        fig, ax = plt.subplots(figsize=(9, 3.8))
        _grouped_bars(
            ax,
            t7,
            "sharpe_rf0",
            present,
            [palette[k] for k in present],
            [names[k] for k in present],
        )
        ax.set_title(
            "Sharpe ratio (rf = 0) of the extensions, mean over each market's models", pad=26
        )
        fig.tight_layout()
        fig.savefig(out / "e7_extensions.png")
        plt.close(fig)
        made.append("e7_extensions.png")

    for table, x, name, title in (
        (e3, "label_method", "e3_label_ablation.png", "Test Sharpe by labeling method"),
        (e4, "variant", "e4_lookahead_bias.png", "How look-ahead bias inflates a backtest"),
    ):
        if table is None or table.empty:
            continue
        y = "test_sharpe" if "test_sharpe" in table else "sharpe"
        fig, ax = plt.subplots(figsize=(5.5, 3.4))
        colors = [
            "#2a78d6"
            if v in ("clean", "triple_barrier")
            else "#e34948"
            if str(v).startswith("leak")
            else "#747b8a"
            for v in table[x]
        ]
        ax.bar(table[x].astype(str), table[y], color=colors)
        ax.axhline(0, color="#747b8a", lw=0.8)
        ax.set_title(title)
        ax.set_ylabel("Sharpe ratio")
        fig.tight_layout()
        fig.savefig(out / name)
        plt.close(fig)
        made.append(name)
    return made


def _e7_group(variant: str) -> str:
    if variant == "sma_crossover":
        return "sma"
    if variant.endswith("_all_in"):
        return "all_in"
    if variant.endswith("_sized"):
        return "sized"
    return "filter"


# ----------------------------------------------------------------------------- main


def market_table(runs: list[MarketRun]) -> pd.DataFrame:
    rows = []
    for run in runs:
        symbol, source, interval = run.market
        models = sorted(
            m["model_id"]
            for m in get_registry().list()
            if m["symbol"] == symbol and m["interval"] == interval
        )
        sma = run.report["sma_params"]
        rows.append(
            {
                "market": f"{symbol} {interval}",
                "held-out window": f"{run.window[0].date()} to {run.window[1].date()}",
                "bars": int(
                    ((run.data.index >= run.window[0]) & (run.data.index <= run.window[1])).sum()
                ),
                "cost preset": default_cost_preset_for(symbol, source),
                "tuned SMA": f"{sma['fast']}/{sma['slow']}",
                "models": ", ".join(models) or "none",
                "data hash": data_hash(run.data)[:19],
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("markets", nargs="*", help="SYMBOL:source:interval (default: study markets)")
    p.add_argument("--with-training", action="store_true", help="also run E3 and E4 (trains)")
    p.add_argument("--no-figures", action="store_true")
    p.add_argument("--bootstrap", type=int, default=5000, help="bootstrap resamples (E1/E5)")
    p.add_argument("--out", default=str(ROOT / "docs" / "results"))
    a = p.parse_args()

    markets = [tuple(m.split(":")) for m in a.markets] if a.markets else DEFAULT_MARKETS
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    print("E1/E5: main comparison", flush=True)
    e1, runs = e1_main_comparison(markets, bootstrap_samples=a.bootstrap)  # type: ignore[arg-type]
    print("E2: cost sensitivity", flush=True)
    e2 = e2_cost_sensitivity(runs)
    e6 = e6_accuracy_vs_profit(runs)
    print("E7: extensions", flush=True)
    e7 = e7_extensions(runs)
    e3 = e4 = None
    if a.with_training:
        print("E3: labeling ablation (trains two XGBoost models)", flush=True)
        e3 = e3_label_ablation("SPY", "yfinance", "1d")
        print("E4: look-ahead bias (trains two XGBoost models)", flush=True)
        e4 = e4_lookahead_bias("SPY", "yfinance", "1d")

    markets_df = market_table(runs)
    tables = {
        "markets": markets_df,
        "e1_main_comparison": e1,
        "e2_cost_sensitivity": e2,
        "e3_label_ablation": e3,
        "e4_lookahead_bias": e4,
        "e6_accuracy_vs_profit": e6,
        "e7_extensions": e7,
    }
    for name, df in tables.items():
        if df is not None and not df.empty:
            df.to_csv(out / f"{name}.csv", index=False)
    made = [] if a.no_figures else figures(out, e1, runs, e2, e3, e4, e6, e7)

    sections = [
        "# Experiment results",
        "",
        f"Generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC from commit `{git_sha()}` with "
        "`python scripts/run_experiments.py"
        + (" --with-training" if a.with_training else "")
        + "` on the bundled data snapshots. Every number below is on each market's held-out "
        "window (after the models' validation period plus embargo), after the market's cost "
        "preset. Returns and drawdowns are fractions of starting equity.",
        "",
        "## Markets and settings",
        "",
        md_table(markets_df),
        "",
        "## E1 and E5: main comparison with Deflated Sharpe and bootstrap test",
        "",
        "`sharpe_diff_vs_sma` is the strategy's Sharpe minus the tuned SMA's, with a 95% "
        "stationary-bootstrap confidence interval and a one-sided p-value.",
        "",
        md_table(e1),
        "",
    ]
    sections += [f"![{f}]({f})\n" for f in made if f.startswith("e1_")]
    sections += ["## Verdicts", ""]
    for run in runs:
        sections += [f"**{run.market[0]} {run.market[2]}.** {run.report['verdict']}", ""]
    sections += [
        "## E2: cost sensitivity",
        "",
        "Sharpe ratio at 0, 5, 10, 20 and 50 bps per side (commission and slippage combined). "
        "`break_even_bps` is the cost level at which the strategy's Sharpe falls to zero.",
        "",
    ]
    sections += [f"![{f}]({f})\n" for f in made if f.startswith("e2_")]
    breakeven = e2.drop_duplicates(["market", "strategy"])[["market", "strategy", "break_even_bps"]]
    sections += [md_table(breakeven), ""]
    for name, title, note in (
        (
            "e3_label_ablation",
            "E3: labeling ablation (SPY)",
            "XGBoost trained with each labeling method, scored on the test window.",
        ),
        (
            "e4_lookahead_bias",
            "E4: look-ahead bias (SPY)",
            "The same model evaluated cleanly, after training on the test window, and when trading one bar early.",
        ),
        (
            "e6_accuracy_vs_profit",
            "E6: accuracy vs profitability",
            "Classification quality on the held-out window next to the trading result.",
        ),
        (
            "e7_extensions",
            "E7: ML filter and bet sizing",
            "Each model as a confirmation filter on the tuned SMA, and with probability bet sizing (AFML Ch. 10), on the same window and costs. Idle cash earns no interest in the engine, so `sharpe` (risk-free rate 4%) penalises strategies that hold smaller positions; `sharpe_rf0` is the scale-free comparison and is the one plotted.",
        ),
    ):
        df = tables[name]
        sections += [f"## {title}", ""]
        if df is None or df.empty:
            sections += ["Not run here (needs `--with-training`).", ""]
            continue
        sections += [note, "", md_table(df), ""]
        sections += [f"![{f}]({f})\n" for f in made if f.startswith(name.split("_")[0] + "_")]

    (out / "README.md").write_text("\n".join(sections), encoding="utf-8")
    with open(out / "verdicts.md", "w", encoding="utf-8") as fh:
        for run in runs:
            fh.write(f"## {run.market[0]} {run.market[2]}\n\n{run.report['verdict']}\n\n")
    print(e1.round(3).to_string(index=False))
    print(f"\nSaved {len(made)} figures and the tables to {out}")


if __name__ == "__main__":
    main()

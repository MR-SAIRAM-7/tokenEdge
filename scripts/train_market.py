"""Train the XGBoost + LSTM models for one market (used by the "Train models" GitHub Actions workflow).

Same pipeline as the Colab notebooks, with settings sized for a CPU runner. Uses the bundled
snapshots (set TOKENEDGE_OFFLINE=1) so results are reproducible.

Usage:
    python scripts/train_market.py SPY --source yfinance --interval 1d --out out/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tokenedge.config import default_label_config  # noqa: E402
from tokenedge.data.loader import get_ohlcv  # noqa: E402

INTRADAY = {
    "xgb": {"n_trials": 15, "cv_folds": 4},
    "lstm": {"max_epochs": 15, "patience": 4, "batch_size": 512, "hidden": 48},
}
DAILY = {
    "xgb": {"n_trials": 40, "cv_folds": 5},
    "lstm": {"max_epochs": 60, "patience": 10, "batch_size": 128, "hidden": 64},
}


def tag(model_dir: Path, env: str) -> None:
    path = model_dir / "metadata.json"
    md = json.loads(path.read_text(encoding="utf-8"))
    md["training_env"] = env
    path.write_text(json.dumps(md, indent=2), encoding="utf-8")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("symbol")
    p.add_argument("--source", default="yfinance")
    p.add_argument("--interval", default="1d")
    p.add_argument("--out", default="out")
    p.add_argument("--env", default="GitHub Actions (CPU runner)")
    a = p.parse_args()

    out = Path(a.out)
    cfg = DAILY if a.interval.endswith("d") else INTRADAY
    df = get_ohlcv(a.symbol, a.source, a.interval)
    print(f"{a.symbol} {a.interval}: {len(df):,} bars {df.index[0]} -> {df.index[-1]}", flush=True)

    from tokenedge.ml.xgb_model import train_xgboost

    t = time.time()
    xgb = train_xgboost(
        df,
        a.symbol,
        a.source,
        a.interval,
        label_config=default_label_config("triple_barrier", a.interval),
        output_dir=out,
        verbose=False,
        **cfg["xgb"],
    )
    tag(xgb.model_dir, a.env)
    print(f"xgboost done in {time.time() - t:.0f}s: {xgb.metadata['model_id']}", flush=True)

    from tokenedge.ml.lstm_model import train_lstm

    t = time.time()
    lstm = train_lstm(
        df,
        a.symbol,
        a.source,
        a.interval,
        label_config=default_label_config("fixed_horizon", a.interval),
        output_dir=out,
        verbose=True,
        **cfg["lstm"],
    )
    tag(lstm.model_dir, a.env)
    print(f"lstm done in {time.time() - t:.0f}s: {lstm.metadata['model_id']}", flush=True)


if __name__ == "__main__":
    main()

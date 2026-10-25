"""Command-line training (same pipeline as the Colab notebooks). Needs `pip install -e ".[train]"`.

Examples:
    python scripts/train.py xgboost SPY
    python scripts/train.py lstm BTC/USDT --source ccxt --interval 1h --epochs 60
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tokenedge.config import default_label_config  # noqa: E402
from tokenedge.data.loader import get_ohlcv  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("model", choices=["xgboost", "lstm"])
    p.add_argument("symbol")
    p.add_argument("--source", default="yfinance", choices=["yfinance", "ccxt"])
    p.add_argument("--interval", default="1d")
    p.add_argument("--label", default=None, choices=["fixed_horizon", "triple_barrier"])
    p.add_argument("--trials", type=int, default=40, help="XGBoost hyperparameter trials")
    p.add_argument("--epochs", type=int, default=100, help="LSTM max epochs")
    p.add_argument("--device", default=None, help="cpu / cuda")
    p.add_argument("--refresh", action="store_true", help="download new bars before training")
    p.add_argument("--zip", action="store_true", help="also write <model_id>.zip")
    a = p.parse_args()

    df = get_ohlcv(a.symbol, a.source, a.interval, refresh=a.refresh)
    if a.model == "xgboost":
        from tokenedge.ml.xgb_model import train_xgboost

        label = default_label_config(a.label or "triple_barrier", a.interval)
        out = train_xgboost(
            df,
            a.symbol,
            a.source,
            a.interval,
            label_config=label,
            n_trials=a.trials,
            device=a.device or "cpu",
        )
    else:
        from tokenedge.ml.lstm_model import train_lstm

        label = default_label_config(a.label or "fixed_horizon", a.interval)
        out = train_lstm(
            df,
            a.symbol,
            a.source,
            a.interval,
            label_config=label,
            max_epochs=a.epochs,
            device=a.device,
        )

    if a.zip:
        from tokenedge.ml.training import zip_model_dir

        print("archive:", zip_model_dir(out.model_dir))


if __name__ == "__main__":
    main()

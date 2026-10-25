# TokenEdge

**AI-Powered Algorithmic Trading Research Platform** (Major Project, 4th Year)

TokenEdge is a backtesting and signal-generation platform. It compares a classical technical-indicator strategy (moving-average crossover) with ML-based price-movement predictors (XGBoost and LSTM) on historical equity and crypto data. All strategies use the same realistic transaction costs and slippage, strict train/test separation, and risk-adjusted metrics on held-out data.

> **Research question:** after costs, on data the models have never seen, does machine learning beat a simple rule?

- Product requirements: [docs/PRD.md](docs/PRD.md)
- How to run and use it: [docs/user_guide.md](docs/user_guide.md)
- Deployment: [docs/deployment.md](docs/deployment.md)

## Features

- **Backtesting engine** with next-bar-open execution, commission presets (US, NSE, crypto), three slippage models (fixed, range-based, square-root impact), long/flat and long/short modes, and a full trade log. It matches Backtrader to within 0.2 percentage points.
- **Strategies:** Buy & Hold, SMA/EMA crossover with train/validation grid search, XGBoost, and LSTM (ONNX).
- **ML pipeline:** triple-barrier and fixed-horizon labels, purged and embargoed chronological splits, purged K-fold CV, and a trading threshold chosen by validation Sharpe after costs. Training runs in Google Colab notebooks.
- **Statistics:** Sharpe, Sortino, max drawdown, Calmar, Probabilistic and Deflated Sharpe Ratio, a stationary block-bootstrap test of the Sharpe difference, and cost sensitivity.
- **Leakage guards:** a future-perturbation test for every feature and strategy, a fill-after-signal test, scalers fitted on training rows only, and an API guard that refuses ML backtests on training or validation data.
- **Web app:** Dashboard, Data Explorer, Backtest Lab, Compare, Models, Run History and Methodology. Includes dark and light themes, CSV/JSON/PNG export and reproducible run history.

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt -r requirements-dev.txt
pip install -e . --no-deps
cd web && npm ci && npm run build && cd ..
uvicorn tokenedge.api.main:app --port 8000
```

Open http://localhost:8000. Market data for 9 instruments is bundled in `data/snapshots/`, so it works offline (`TOKENEDGE_OFFLINE=1`).

With Docker: `docker compose up --build`.

## Training the models (Google Colab)

| Notebook | Purpose |
|---|---|
| [00_data_exploration](notebooks/00_data_exploration.ipynb) | Data quality, returns, features, label balance |
| [01_train_xgboost](https://colab.research.google.com/github/MR-SAIRAM-7/tokenEdge/blob/main/notebooks/01_train_xgboost.ipynb) | XGBoost with purged CV, exports `model.json` |
| [02_train_lstm](https://colab.research.google.com/github/MR-SAIRAM-7/tokenEdge/blob/main/notebooks/02_train_lstm.ipynb) | LSTM on GPU, exports `model.onnx` |
| [03_experiments](https://colab.research.google.com/github/MR-SAIRAM-7/tokenEdge/blob/main/notebooks/03_experiments.ipynb) | Experiments E1–E6 for the report |

Each training notebook ends by downloading a zip. Unzip it into `models/` and the web app picks the model up automatically.

## Project layout

```
tokenedge/        Python package: data, features, labeling, engine, strategies, ml, metrics, validation, api
web/              React + TypeScript + Vite frontend
notebooks/        Colab notebooks (training, experiments)
models/           Exported model artifacts (registry)
data/snapshots/   Bundled OHLCV datasets for offline use
tests/            unit, leakage, property-based, integration, Backtrader parity
scripts/          download_snapshots.py, train.py, run_experiments.py
docs/             PRD, user guide, deployment guide
```

## Tech stack

Python 3.11+, pandas, NumPy, SciPy · yfinance, ccxt · XGBoost, PyTorch (training only), ONNX Runtime · FastAPI, SQLAlchemy/SQLite · React 19, TypeScript, Vite, Tailwind CSS, TradingView Lightweight Charts, Recharts · pytest, Hypothesis, Backtrader (parity tests) · Docker, GitHub Actions, Render.

## Disclaimer

For education and research only. TokenEdge simulates trades on historical data, places no orders and is not financial advice.

## Reference

López de Prado, M. (2018). *Advances in Financial Machine Learning*. Wiley.

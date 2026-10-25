# TokenEdge

**AI-Powered Algorithmic Trading Research Platform** (Major Project, 4th Year)

TokenEdge is a backtesting and signal-generation platform. It compares a classical technical-indicator strategy (moving-average crossover) with ML-based price-movement predictors (XGBoost and LSTM) on historical equity and crypto data. The comparison uses realistic transaction costs and slippage, strict train/test separation, and risk-adjusted metrics (Sharpe, max drawdown, Deflated Sharpe) on held-out data.

> **Status:** planning. The full Product Requirements Document is in [docs/PRD.md](docs/PRD.md).

## Planned stack

| Area | Tools |
|---|---|
| Core | Python 3.11+, pandas, numpy |
| Data | yfinance (equities), ccxt (crypto OHLCV) |
| Backtesting | Custom event-driven engine, cross-checked against Backtrader |
| ML | XGBoost and PyTorch LSTM, trained in Google Colab; ONNX Runtime for inference |
| API | FastAPI + SQLite |
| Web UI | React + TypeScript + Vite, Tailwind, Lightweight Charts, Recharts |
| Deployment | Docker, GitHub Actions, Hugging Face Spaces / Render |

## Methodology highlights

- Signals at bar *t* execute at the open of bar *t+1*. A strategy never trades on the bar that produced its signal.
- Chronological train / validation / test splits with purging and an embargo.
- Triple-barrier labeling and purged K-fold cross-validation (López de Prado, *Advances in Financial Machine Learning*, 2018).
- Automated look-ahead tests and a guard that blocks in-sample backtests of ML models.

## Disclaimer

For education and research only. TokenEdge runs simulations on historical data. It does not place trades and is not financial advice.

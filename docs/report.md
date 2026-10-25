# TokenEdge: An AI-Powered Algorithmic Trading Research Platform

**Major project report, B.Tech 4th year**

Repository: https://github.com/MR-SAIRAM-7/tokenEdge · Version 0.2.0 · October 2026

> TokenEdge is an educational research tool. It simulates trades on historical data only, places no orders and gives no investment advice.

---

## Abstract

Many student and retail trading projects report excellent backtests that fail on new data. The usual causes are look-ahead bias, leakage between training and test data, ignored trading costs and selection among many trials. TokenEdge is a backtesting and signal-generation platform built to answer one question honestly: **after realistic costs, on data the models have never seen, does machine learning beat a simple technical rule?**

The platform compares a moving-average crossover baseline with two machine-learning strategies, an XGBoost classifier and an LSTM network, that predict short-horizon price direction. All strategies run through the same event-driven engine. The engine fills orders at the next bar's open and models commissions (US, Indian NSE and crypto presets) and three kinds of slippage. The ML pipeline follows López de Prado (2018): triple-barrier labels, chronological splits with purging and an embargo, purged K-fold cross-validation, and a trading threshold chosen on validation data. Results are judged on held-out data with the Sharpe, Sortino and Calmar ratios, maximum drawdown, the Probabilistic and Deflated Sharpe Ratios, and a stationary block-bootstrap test of the Sharpe difference. Automated tests check that every feature and strategy is causal, that every fill comes after its signal, and that the engine matches Backtrader.

Models are trained outside the application, in Google Colab or a cloud CI runner. The web application (FastAPI and React) only runs inference. It lets a user explore data, run and compare strategies, inspect models and reproduce every stored run. The experiments cover six markets (four equities and two crypto pairs), and Section 7 reports the findings.

---

## 1. Introduction

### 1.1 Motivation

Machine learning is often presented as an edge in trading. Published studies and student projects alike tend to overstate it, because a backtest has many ways to see the future without anyone noticing. A scaler can be fitted on the whole dataset. A label's horizon can cross the train/test boundary. Trades can be filled at the same bar's close that produced the signal. Hundreds of configurations can be tried and only the best one reported. Each mistake makes results look better than they are, and they compound.

### 1.2 Problem statement

Build a platform that implements and compares a classical technical-indicator strategy with ML-based price-movement predictors (XGBoost and LSTM) on historical equity and crypto data. The comparison must use strict train/test separation to avoid look-ahead bias, and must judge strategies by risk-adjusted returns on held-out data after transaction costs and slippage.

### 1.3 Objectives

1. Build a backtesting engine with realistic transaction-cost and slippage models.
2. Implement a moving-average crossover baseline strategy.
3. Train XGBoost and LSTM models for short-horizon price-movement prediction and use them as strategies.
4. Compare risk-adjusted returns (Sharpe ratio, maximum drawdown and others) on held-out data.

### 1.4 Contributions

- An event-driven engine with next-bar execution, cost presets for three markets and three slippage models, verified against Backtrader.
- A leakage-safe ML pipeline shared, as one Python package, by training notebooks and the application, so features cannot drift between training and inference.
- A statistical comparison layer: PSR, DSR with the real number of trials, a stationary block-bootstrap test, cost sensitivity and a plain-language verdict.
- A model registry with a **window guard**: the API refuses to backtest a model on data it was trained or validated on, and counts every look at the test window.
- A web application that makes the research interactive and reproducible: stored runs with data hashes and code versions, bundle import/export and shareable configuration links.
- Seven experiments (E1–E7), including a measurement of how much leakage inflates results and two extensions (an ML filter on the baseline and probability bet sizing).

### 1.5 Organisation of the report

Section 2 reviews related work. Section 3 describes the data, and Section 4 the methodology. Section 5 covers system design and implementation, and Section 6 testing. Section 7 presents the results, and Section 8 discusses them and the threats to validity. Section 9 concludes.

---

## 2. Literature review

**Technical trading rules.** Brock, Lakonishok and LeBaron (1992) found that simple moving-average and trading-range rules had predictive power on the Dow Jones index over 1897–1986. Sullivan, Timmermann and White (1999) re-examined these rules with White's Reality Check bootstrap, which corrects for data snooping across the whole universe of rules. They found the best rule's apparent performance in-sample, but not out of sample. Moving-average crossovers therefore make a natural, well-studied baseline.

**Machine learning for return prediction.** Gu, Kelly and Xiu (2020) compared linear models, tree ensembles and neural networks for predicting stock returns. Trees and networks performed best, with gains concentrated in non-linear interactions among predictors. Fischer and Krauss (2018) trained LSTM networks on S&P 500 constituents and reported daily returns above those of random forests and logistic regression before costs. They also found the edge shrank sharply in later years and after transaction costs. Chen and Guestrin (2016) introduced XGBoost, a regularised gradient-boosting system that is a strong default for tabular data. Hochreiter and Schmidhuber (1997) introduced the LSTM.

**Backtest overfitting and its statistics.** Bailey and López de Prado (2012) derived the Probabilistic Sharpe Ratio, which accounts for sample length, skewness and kurtosis. The Deflated Sharpe Ratio (Bailey and López de Prado, 2014) also corrects for the number of strategies tried. Bailey, Borwein, López de Prado and Zhu (2017) showed how easily a strategy selected from many trials is overfit. Harvey, Liu and Zhu (2016) argued that the usual t-statistic threshold of 2 is far too low once multiple testing is accounted for. The stationary bootstrap of Politis and Romano (1994) resamples blocks of random length and preserves serial dependence, so it suits tests on return series.

**Financial ML methodology.** López de Prado (2018) collects practical guidance that this project follows: triple-barrier labeling (Ch. 3), sample uniqueness (Ch. 4), fractional differentiation (Ch. 5), purged and embargoed cross-validation (Ch. 7), bet sizing (Ch. 10), the dangers of backtesting (Ch. 11) and backtest statistics (Ch. 14).

**Transaction costs.** Almgren, Thum, Hauptmann and Li (2005) estimated market impact that grows with the square root of trade size relative to volume, which is the basis of the engine's impact slippage model.

**Gap.** These ideas are well known in the literature but rarely combined in an open, student-friendly tool that puts a classical and an ML strategy side by side under the same realistic and leakage-free conditions, and that reports negative results as readily as positive ones. TokenEdge is built to fill that gap.

---

## 3. Data

| Market | Source | Interval | Bars | Period in the snapshot |
|---|---|---|---:|---|
| SPY, AAPL, MSFT | Yahoo Finance (yfinance) | 1 day | 4,228 | 2010-01-04 to 2026-10-23 |
| RELIANCE.NS, TCS.NS | Yahoo Finance (NSE) | 1 day | 4,149 | 2010-01-04 to 2026-10-23 |
| NIFTYBEES.NS | Yahoo Finance (NSE) | 1 day | 4,147 | 2010-01-04 to 2026-10-23 |
| BTC/USDT, ETH/USDT | Binance spot (ccxt) | 1 hour | 77,139 | 2018-01-01 to 2026-10-25 |
| SOL/USDT | Binance spot (ccxt) | 1 hour | 54,363 | 2020-08-11 to 2026-10-25 |

Equity prices are split- and dividend-adjusted. All data is normalised to one schema (UTC timestamps; open, high, low, close, volume) and cached as Parquet. Snapshots of every market are committed to the repository, so experiments are reproducible and the application works offline. Every run stores a SHA-256 hash of the exact data slice it used. A data-quality report checks for gaps against the expected calendar, duplicates, missing values, non-positive prices, zero-volume bars, outlier returns (more than 5σ) and OHLC consistency.

**Splits.** Equities: train 2012-01-01 to 2020-12-31, validation 2021-01-01 to 2022-12-31, test from 2023-01-01. Crypto: train 2019-01-01 to 2023-06-30, validation 2023-07-01 to 2024-06-30, test from 2024-07-01. The training periods include the 2020 crash and the 2022 bear market. The test periods were never used to fit, tune or select anything.

---

## 4. Methodology

### 4.1 Features

Feature set **v1** (23 features for daily data, 25 for hourly) is computed by one function shared by training and inference:

- log returns over 1, 2, 3, 5, 10 and 20 bars
- price relative to SMA(10, 20, 50), and the EMA(12)/EMA(26) ratio
- RSI(14), and MACD line, signal and histogram scaled by price
- rolling volatility (10 and 20 bars), ATR(14)/price, Bollinger %B and bandwidth
- volume z-score and log volume ratio
- cyclical day-of-week encoding, plus hour-of-day for hourly data

Feature set **v2** adds the fractionally differentiated log price (d = 0.4, fixed-width window with weights cut below 10⁻⁴). This is close to stationary yet keeps memory of the price level (López de Prado, 2018, Ch. 5). Every indicator uses right-aligned windows or recursive averages only.

### 4.2 Labels

- **Fixed horizon** (used by the LSTM): 1 if the close *h* bars ahead is above today's close (*h* = 1 day or 4 hours).
- **Triple barrier** (used by XGBoost): a profit-taking barrier at +1.5σ, a stop-loss at −1.0σ (σ = exponentially weighted volatility known at *t*) and a time limit of 5 days or 24 hours. The label is 1 if the upper barrier is touched first, otherwise 0.

Each label records the time `t1` at which it is resolved, and purging uses it.

### 4.3 Splits, purging and embargo

Samples whose label period crosses into the next split are purged. An embargo of 5 daily or 24 hourly bars is skipped after each boundary. Hyperparameters are searched with purged K-fold cross-validation on the training set only. Validation data is used for early stopping and for choosing the trading threshold. The **held-out start** of a model is the start of its test window, and the API refuses any ML backtest that starts earlier (HTTP 409) unless in-sample use is explicitly allowed. In that case every result is labelled *In-sample*.

### 4.4 Models

| | XGBoost | LSTM |
|---|---|---|
| Input | feature vector at bar *t* | last 60 daily or 48 hourly feature vectors, standardised with mean and std from training rows only |
| Label | triple barrier | fixed horizon |
| Architecture / search | random search over depth, learning rate, rounds, subsampling and child weight, scored by purged K-fold log loss (40 trials daily, 15 hourly) | 2-layer LSTM (hidden 64 daily, 48 hourly; dropout 0.2) → linear → sigmoid; Adam, lr 10⁻³, BCE loss, early stopping on validation loss |
| Threshold | 0.50–0.65 chosen by validation Sharpe after costs | same |
| Inference in the app | XGBoost native JSON | ONNX Runtime (no PyTorch at runtime) |
| Trials recorded for the DSR | search trials + 16 threshold candidates | 16 threshold candidates |

The committed models were trained with this pipeline on a GitHub Actions CPU runner from the bundled snapshots. Each model's `metadata.json` records its splits, features, label configuration, scaler, threshold, hyperparameters, validation metrics, data hash and library versions.

### 4.5 Strategies

| Strategy | Rule |
|---|---|
| Buy & Hold | Long from the first to the last bar of the window (benchmark). |
| SMA crossover | Long when SMA(fast) > SMA(slow). Windows chosen by grid search over fast ∈ {5, 10, 20, 30, 50} and slow ∈ {50, 100, 150, 200} on train/validation only, by validation Sharpe. The grid size counts as trials for the DSR. |
| XGBoost / LSTM | Long when P(up) is above the model's threshold; optional **probability bet sizing**: position = 2Φ(z) − 1 with z = (p − ½)/√(p(1 − p)), in steps of 10% (López de Prado, 2018, Ch. 10). |
| SMA + ML filter | The SMA decides the side and the model must agree (P(up) above its threshold) before a position is taken. This is a simplified form of meta-labeling that uses the existing direction models as the secondary model. |

All strategies run long/flat in the experiments. Long/short mode, with a borrow cost, is available in the application.

### 4.6 Backtesting engine

At each bar the engine (1) fills pending orders at this bar's **open**, (2) marks the portfolio to market at the **close**, (3) reads the strategy's target position for this bar and (4) schedules the change for the next bar's open. A signal computed from bar *t* can therefore never trade at a bar-*t* price. Position size is target weight × equity × leverage, in whole shares for equities and fractional units for crypto. Positions open at the end of the window are closed at the last close, with costs. Idle cash earns the risk-free rate (4% a year, accrued bar by bar), the same rate the Sharpe ratio subtracts, so a strategy that stays out of the market has zero excess return.

Fees are `max(min_fee, |qty| · price · bps/10⁴) + fixed_fee`, with separate buy and sell rates. The fill price moves against the trader by *s*, which is fixed in bps, a fraction of the previous bar's range, or square-root impact `half_spread + η·σ·√(qty/ADV₂₀)`. The presets are: US equity, 0 bps commission and 2 bps slippage; Indian equity delivery (NSE), 12 bps buy and 11 bps sell (STT, exchange charges, GST, stamp duty) plus 3 bps slippage; crypto spot taker, 10 bps per side plus 3 bps slippage.

### 4.7 Evaluation

Metrics: total return, CAGR, annualised volatility, Sharpe (risk-free rate 4%), Sortino, maximum drawdown, Calmar, win rate, profit factor, turnover, exposure and costs paid. Annualisation uses 252 periods per year for daily equities and 8,760 for hourly crypto. The **PSR** is the probability that the true Sharpe is above 0. The **DSR** is the PSR against the Sharpe expected from the best of *K* skill-less trials, where *K* is the number of configurations actually tried. The **bootstrap test** resamples the excess returns of a strategy and the SMA baseline together (stationary bootstrap, 5,000 resamples). It reports a 95% confidence interval for the difference in Sharpe ratios and a one-sided p-value. **Cost sensitivity** re-runs every strategy at 0, 5, 10, 20 and 50 bps per side and finds the break-even cost.

---

## 5. System design and implementation

### 5.1 Architecture

```
 Yahoo Finance / crypto exchanges
            │
            ▼
 ┌────────────────────────── TokenEdge (one Docker container) ──────────────────────────┐
 │  React web UI ──HTTP/JSON──▶ FastAPI ──▶ data layer (cache → snapshot → download)     │
 │                                 │        features & labels ──▶ strategies ──▶ engine   │
 │                                 │        model registry (models/*/metadata.json)       │
 │                                 └──▶ metrics & statistics ──▶ SQLite run history      │
 └──────────────────────────────────────────────────────────────────────────────────────┘
            ▲
 Model artifacts (XGBoost JSON, LSTM ONNX + scaler + metadata)
 trained in Google Colab or the "Train models" GitHub Actions workflow
```

The same `tokenedge` Python package is used by the training notebooks and by the application, so feature code cannot drift between training and inference. The application never trains models. It loads exported artifacts and runs inference with XGBoost and ONNX Runtime, which keeps the runtime image free of PyTorch.

### 5.2 Library (`tokenedge/`)

| Module | Responsibility |
|---|---|
| `data` | yfinance and ccxt sources (with pagination and exchange fallbacks), Parquet cache, data hash, quality report |
| `features`, `labeling` | indicators, fractional differentiation, feature sets v1/v2; fixed-horizon and triple-barrier labels |
| `engine` | event-driven backtester, commission and slippage models, trade book |
| `strategies` | strategy interface and registry (parameter schemas drive the UI forms), classical and ML strategies, SMA grid search |
| `ml` | splits with purge and embargo, purged K-fold, datasets, XGBoost and LSTM training, threshold selection, export, registry and inference |
| `metrics` | performance metrics, PSR/DSR, stationary bootstrap, comparison report and verdict, cost sensitivity |
| `validation` | window guard and future-perturbation check |
| `api` | FastAPI routes, request schemas, orchestration, SQLite persistence |
| `experiments`, `study` | E1–E7, and the research study behind the findings page |

### 5.3 Web application

| Page | Purpose |
|---|---|
| Dashboard | Research question, headline numbers, latest comparison, recent runs |
| Findings | Latest comparison per market as a scoreboard, with takeaways and CSV export |
| Data Explorer | Candlestick chart with overlays, RSI/MACD/fractional-differentiation panes, data-quality report |
| Backtest Lab | One strategy with schema-generated parameters, window and cost settings; equity, drawdown, trades on price, monthly returns, trade log, ML diagnostics |
| Compare | Several strategies on one window: verdict, overlaid curves, metrics, PSR/DSR, bootstrap distribution, cost sensitivity |
| Models / Model detail | Split timeline, validation metrics, threshold search, training curve, ROC curve, feature importance, test-evaluation counter |
| Run History | Search, reopen, rename, delete, export (CSV, JSON, bundle) and import runs |
| Methodology, About | How leakage is prevented, cost models, statistics, limitations; project summary |

Each run stores its full request, the data hash, model IDs and the git commit. Re-running a stored configuration reproduces the same metrics. Backtest Lab and Compare keep their setup in the page address, so a configuration can be shared as a link.

### 5.4 Deployment and automation

- **Docker**: a multi-stage image builds the React app with Node and runs FastAPI with uvicorn on Python 3.11, as an unprivileged user with a health check. `docker compose up` runs it locally, and `render.yaml` deploys it on Render.
- **CI** (every push): ruff, mypy, pytest with coverage, frontend type-check/tests/build, Docker build with an offline smoke test.
- **Train models** workflow: trains XGBoost and LSTM per market on a cloud runner and uploads the model folders.
- **Experiments** workflow: runs E1–E7 and uploads the tables, figures and summary in `docs/results/`.

---

## 6. Testing and validation

| Suite | Tests | Examples |
|---|---:|---|
| Unit | 57 | RSI against a reference loop; triple-barrier labels on hand-built paths; commission, slippage and cash-interest arithmetic; Sharpe, drawdown, PSR/DSR; the bootstrap on a nearly flat strategy; purged K-fold; fractional-differentiation weights and limits; bet sizing; the ML filter |
| Property-based (Hypothesis) | 2 | equity = cash + position × price at every bar; zero-cost Buy & Hold equals the price return; higher costs never raise final equity |
| Leakage | 19 | future perturbation for feature sets v1/v2 and every strategy (including sized and filtered ML); every fill strictly after its signal; the window guard refuses in-sample backtests |
| Integration (API) | 15 | every endpoint with synthetic data; 409 on in-sample windows; run persistence, export and bundle import; reproducibility; the research study |
| Cross-check | 3 | SMA(20/50) in TokenEdge and Backtrader at three cost levels (0, 10 bps, 10 bps + 5 bps slippage): same entries, total return within 0.5 percentage points (0.2 pp observed) |
| Frontend (Vitest) | 4 | formatting, palette, downsampling, share-link encoding |

All 96 Python tests and 4 frontend tests pass in CI on every push. Line coverage is 91% overall and above 85% on the engine, metrics, labeling and validation modules.

---

## 7. Results

All numbers are on each market's held-out window, after that market's cost preset, from the bundled data snapshots and the committed models. They are reproduced by `scripts/run_experiments.py --with-training` (commit `41bac79`). The full tables, verdicts and figures are in [`docs/results/`](results/README.md).

### 7.1 Setup

| Market | Held-out window | Bars | Cost preset | Tuned SMA (19 pairs tried) |
|---|---|---:|---|---|
| SPY 1d | 2023-01-03 to 2026-10-23 | 956 | US equity | 30/200 |
| AAPL 1d | 2023-01-03 to 2026-10-23 | 956 | US equity | 50/100 |
| RELIANCE.NS 1d | 2023-01-02 to 2026-10-23 | 940 | NSE delivery | 50/200 |
| TCS.NS 1d | 2023-01-02 to 2026-10-23 | 940 | NSE delivery | 30/150 |
| BTC/USDT 1h | 2024-07-01 to 2026-10-25 | 20,309 | Crypto spot | 50/100 |
| ETH/USDT 1h | 2024-07-01 to 2026-10-25 | 20,309 | Crypto spot | 30/100 |

### 7.2 E1 and E5: main comparison

Sharpe ratio (risk-free rate 4%, idle cash earning the same rate) and maximum drawdown on the held-out window:

| Market | Buy & Hold | SMA (tuned) | XGBoost | LSTM |
|---|---|---|---|---|
| SPY 1d | **1.10** / −18.7% | 0.87 / −14.3% | 0.78 / −15.4% | 0.44 / −15.1% |
| AAPL 1d | **1.00** / −33.4% | 0.46 / −22.7% | 0.38 / −13.6% | 0.72 / −16.7% |
| RELIANCE.NS 1d | −0.06 / −27.1% | **0.03** / −18.5% | −0.79 / −24.6% | −0.23 / −22.1% |
| TCS.NS 1d | −0.21 / −52.3% | −0.32 / −26.3% | **−0.14** / −17.5% | −0.38 / −32.1% |
| BTC/USDT 1h | **0.38** / −53.7% | −0.05 / −50.5% | −0.77 / −2.3% | −1.25 / −5.6% |
| ETH/USDT 1h | **0.02** / −69.1% | −0.06 / −59.2% | −0.50 / −5.6% | −1.62 / −60.4% |

![Sharpe ratio on held-out data](results/e1_sharpe.png)

![Growth of 1 on the held-out window](results/e1_equity_curves.png)

- **Buy & Hold had the best Sharpe ratio in 4 of 6 markets.** The tuned SMA was best only on RELIANCE (0.03) and XGBoost only on TCS (−0.14), where every strategy was close to zero or negative.
- **ML vs the SMA baseline:** in 12 model–market pairs, the model's Sharpe was higher in 2 (AAPL LSTM +0.26, TCS XGBoost +0.18). **None of the 12 differences is statistically significant:** every 95% bootstrap confidence interval contains zero. The largest, ETH LSTM −1.55 [−3.23, +0.24], points the other way.
- **Deflated Sharpe:** no ML strategy has a DSR above 22%. XGBoost's 56 recorded trials (40 hyperparameter sets plus 16 thresholds) push its DSR to 0–6% everywhere. The tuned SMA on SPY keeps a DSR of 69%.
- **Drawdowns:** every active strategy had a smaller maximum drawdown than Buy & Hold in every market, because it is out of the market part of the time. The ML strategies were invested only 0–45% of the time (XGBoost on BTC traded 3 times), so their low drawdowns largely reflect low exposure.

### 7.3 E2: cost sensitivity

![Sharpe ratio as trading costs rise](results/e2_cost_sensitivity.png)

| Strategy | Sharpe at 0 → 50 bps per side (SPY) | Break-even cost per side (total return reaches zero) |
|---|---|---|
| Buy & Hold | 1.10 → 1.08 | never (one trade) |
| SMA (tuned) | 0.87 → 0.83 | above 50 bps on SPY, AAPL and RELIANCE; 11 bps BTC, 6 bps ETH; TCS negative even before costs |
| XGBoost | 0.90 → −2.02 | 19 bps SPY, 27 bps AAPL, 3 bps RELIANCE, 23 bps TCS, 22 bps ETH |
| LSTM | 0.47 → −0.20 | 39 bps AAPL, 16 bps RELIANCE, 11 bps BTC, 2 bps ETH |

Costs decide the comparison. **Before costs, XGBoost on SPY (0.90) beat the tuned SMA (0.87), and the LSTM on BTC hourly reached a Sharpe of 1.15, three times Buy & Hold's 0.38.** At the crypto preset (10 bps commission plus 3 bps slippage per side), the BTC LSTM falls to −1.25: its total return turns negative above 11 bps per side, less than a taker actually pays. The daily SMA trades 2–6 times in almost four years and is nearly insensitive to costs. The hourly SMA trades about 120 times, and its total return turns negative at 6–11 bps.

### 7.4 E3: labeling ablation (SPY, XGBoost)

| Labels | Validation AUC | Test Sharpe | Test return | Test max drawdown | Trades |
|---|---:|---:|---:|---:|---:|
| Fixed horizon (1 day) | 0.463 | 0.92 | 81.6% | −17.1% | 79 |
| Triple barrier (5 days, 1.5σ/1.0σ) | 0.559 | 0.93 | 55.0% | −9.3% | 106 |

Both labelings reach the same test Sharpe. The triple-barrier model is better calibrated (validation AUC 0.56 vs 0.46) and has half the drawdown, but also a lower return. Triple-barrier labels change the risk profile more than the risk-adjusted return.

### 7.5 E4: how much does leakage inflate results? (SPY, XGBoost)

| Variant | Sharpe | Total return | Max drawdown |
|---|---:|---:|---:|
| Clean: trained on train, early-stopped on validation | 0.99 | 93.9% | −18.8% |
| Leak: trained on every labelled row, test window included | **2.50** | **284.0%** | −10.3% |
| Leak: clean model, signals executed one bar early | 0.75 | 68.8% | −18.8% |

![How look-ahead bias inflates a backtest](results/e4_lookahead_bias.png)

Training on the test window inflates the Sharpe ratio 2.5 times and the return 3 times, with a smaller drawdown. That is exactly the kind of result that looks publishable and fails live. Shifting a clean model's signals one bar early made results *worse* here: a leak only inflates results when the model has learned to exploit it. This is why the project tests for causality directly (Section 6) instead of trusting that suspicious results will look suspicious.

### 7.6 E6: accuracy is not profitability

![ROC-AUC against Sharpe ratio](results/e6_auc_vs_sharpe.png)

On the held-out windows the 12 models have ROC-AUC between 0.48 and 0.60 and accuracy between 47% and 58%: barely better than chance. Across models, AUC and Sharpe are uncorrelated (Pearson 0.02, Spearman −0.22). The AAPL LSTM, with an AUC of exactly 0.50, had the second-best ML Sharpe (0.72). The SPY XGBoost, with the best AUC (0.60), was less profitable than Buy & Hold. Classification metrics alone would have ranked the models wrongly.

### 7.7 E7: the models as a filter, and probability bet sizing

| Market | SMA | SMA + XGBoost filter | XGBoost all-in | XGBoost sized | LSTM all-in | LSTM sized |
|---|---:|---:|---:|---:|---:|---:|
| SPY 1d | **0.87** | 0.59 | 0.78 | 0.52 | 0.44 | 0.44 |
| AAPL 1d | 0.46 | 0.15 | 0.38 | 0.53 | 0.72 | **0.81** |
| RELIANCE.NS 1d | **0.03** | −1.01 | −0.79 | −1.11 | −0.23 | −0.30 |
| TCS.NS 1d | −0.32 | −0.72 | **−0.14** | −0.22 | −0.38 | −0.40 |
| BTC/USDT 1h | **−0.05** | −0.77 | −0.77 | −0.77 | −1.25 | −1.15 |
| ETH/USDT 1h | **−0.06** | −1.10 | −0.50 | −0.64 | −1.62 | −1.48 |

- **Filter:** requiring the model to confirm the SMA's trades lowered the SMA's Sharpe in all 12 model–market pairs. The filter turns a slow, low-turnover rule into a fast, high-turnover one (SPY: 2 trades become 131) and pays the costs of the noisy model.
- **Bet sizing:** sizing positions by the model's confidence cut maximum drawdowns by a factor of 3 to 25 (SPY XGBoost −15.4% to −1.6%). It improved the Sharpe ratio in 5 of 12 cases, for example AAPL LSTM 0.72 to 0.81 and AAPL XGBoost 0.38 to 0.53. It is a risk control, not a source of edge.

---

## 8. Discussion

### 8.1 Answer to the research question

**After costs, on data the models never saw, machine learning did not beat a simple rule in this study.** Across six markets and twelve model–market pairs, the XGBoost and LSTM strategies had a higher Sharpe ratio than the tuned moving-average crossover twice. Neither difference was statistically significant, and Buy & Hold beat every active strategy in four markets. The models are not useless. Before costs, some of them clearly beat the baseline (XGBoost on SPY, the LSTM on BTC), and they cut drawdowns sharply. But their edge is small, they trade often, and realistic costs consume it. This agrees with Fischer and Krauss (2018), whose LSTM edge shrank after costs, and with the long literature on how data snooping inflates trading-rule results (Sullivan, Timmermann and White, 1999).

### 8.2 What the methodology contributed

- The **window guard** and **future-perturbation tests** removed the leaks that E4 shows can triple a backtest's return.
- The **Deflated Sharpe Ratio** made the cost of searching explicit. XGBoost's 56 trials reduce its DSR to near zero even where its raw Sharpe looks respectable.
- The **bootstrap test** stopped every apparent winner from being reported as a real one: none of the 12 ML-vs-SMA differences survives it.
- **Interest on idle cash.** Building this study exposed a subtle bias in the first version of the engine. Cash earned nothing while the Sharpe ratio subtracted a 4% risk-free rate, so a strategy that sat in cash looked far worse than it was (XGBoost on BTC: Sharpe −3.85 instead of −0.77). The same study revealed rounding noise in the bootstrap for nearly flat strategies. Both were fixed, and are covered by tests, before the results above were produced.

### 8.3 Threats to validity

- **One path per market.** Each held-out window is a single historical path of 2–4 years. The equity window (2023–2026) was a strong bull market for US stocks, which favours Buy & Hold.
- **Model capacity and training budget.** The committed models were trained on a CPU runner with modest search budgets (40 or 15 hyperparameter trials; LSTMs with early stopping). Larger searches on a GPU might find better models, though the DSR would then penalise them more.
- **Features.** Only price and volume features were used. Fundamentals, order-book data, cross-asset signals and news were out of scope.
- **Costs and execution.** The cost presets are realistic for liquid instruments and retail-sized orders but are still models. Fills at the open assume the order can be executed at that price plus slippage.
- **Data.** Yahoo Finance data has survivorship bias (only tickers that exist today) and adjusted prices. Crypto data comes from one exchange.
- **Cash yield.** Idle cash earns the risk-free rate (4%). This is reasonable for a brokerage sweep account but generous for crypto stablecoins.

---

## 9. Conclusion and future work

TokenEdge meets the four project objectives:

1. **A backtesting engine with realistic costs**: next-bar execution, commission presets for US, Indian and crypto markets, three slippage models, interest on idle cash and borrow costs. It matches Backtrader to within 0.2 percentage points.
2. **A classical baseline**: an SMA/EMA crossover tuned on train and validation data only, with its trial count fed into the Deflated Sharpe Ratio.
3. **ML strategies**: XGBoost and LSTM models trained with triple-barrier or fixed-horizon labels, purged cross-validation and a validation-chosen threshold, used as strategies through a shared feature pipeline and ONNX inference.
4. **A risk-adjusted comparison on held-out data**: Sharpe, Sortino, maximum drawdown, Calmar, PSR, DSR, a stationary-bootstrap test and cost sensitivity, behind an API guard that refuses in-sample evaluations.

The main finding is negative and, we believe, honest: in this setting, the ML models did not beat a simple rule after costs, and the apparent edges they showed before costs or in-sample disappear under realistic assumptions. The platform makes that conclusion checkable: every number in this report can be reproduced from the repository with one command, and every run in the web application stores its configuration, data hash and code version.

**Future work.**

- Walk-forward evaluation with periodic re-training, and combinatorial purged cross-validation with the probability of backtest overfitting (López de Prado, 2018, Ch. 12; Bailey et al., 2017).
- Full meta-labeling: a secondary model trained on the SMA's own trade outcomes, instead of reusing the direction models as a filter.
- Lower-turnover ML strategies: longer horizons, minimum holding periods chosen on validation data, or cost-aware labels.
- Richer inputs (fundamentals, cross-asset and sentiment features) and portfolio-level backtests across many assets.
- End-to-end browser tests of the main user flows.

---

## References

1. Almgren, R., Thum, C., Hauptmann, E., & Li, H. (2005). Direct estimation of equity market impact. *Risk*, 18(7), 58–62.
2. Bailey, D. H., Borwein, J., López de Prado, M., & Zhu, Q. J. (2017). The probability of backtest overfitting. *Journal of Computational Finance*, 20(4), 39–69.
3. Bailey, D. H., & López de Prado, M. (2012). The Sharpe ratio efficient frontier. *Journal of Risk*, 15(2), 3–44.
4. Bailey, D. H., & López de Prado, M. (2014). The deflated Sharpe ratio: Correcting for selection bias, backtest overfitting and non-normality. *Journal of Portfolio Management*, 40(5), 94–107.
5. Brock, W., Lakonishok, J., & LeBaron, B. (1992). Simple technical trading rules and the stochastic properties of stock returns. *Journal of Finance*, 47(5), 1731–1764.
6. Chen, T., & Guestrin, C. (2016). XGBoost: A scalable tree boosting system. In *Proceedings of the 22nd ACM SIGKDD Conference* (pp. 785–794).
7. Fischer, T., & Krauss, C. (2018). Deep learning with long short-term memory networks for financial market predictions. *European Journal of Operational Research*, 270(2), 654–669.
8. Gu, S., Kelly, B., & Xiu, D. (2020). Empirical asset pricing via machine learning. *Review of Financial Studies*, 33(5), 2223–2273.
9. Harvey, C. R., Liu, Y., & Zhu, H. (2016). … and the cross-section of expected returns. *Review of Financial Studies*, 29(1), 5–68.
10. Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. *Neural Computation*, 9(8), 1735–1780.
11. López de Prado, M. (2018). *Advances in Financial Machine Learning*. Wiley.
12. Politis, D. N., & Romano, J. P. (1994). The stationary bootstrap. *Journal of the American Statistical Association*, 89(428), 1303–1313.
13. Sullivan, R., Timmermann, A., & White, H. (1999). Data-snooping, technical trading rule performance, and the bootstrap. *Journal of Finance*, 54(5), 1647–1691.

---

## Appendix: reproducing the results

```bash
pip install -r requirements.txt matplotlib && pip install -e . --no-deps
TOKENEDGE_OFFLINE=1 python scripts/run_experiments.py --with-training --out docs/results
```

The command uses the bundled snapshots and the committed models, so it reproduces the tables in Section 7. E3 and E4 train small XGBoost models; run them in Colab or with the Experiments workflow rather than on a laptop. Section 4 of the [user guide](user_guide.md) describes the workflows.

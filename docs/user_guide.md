# TokenEdge user guide

## 1. Run it locally

**Requirements:** Python 3.11 or newer, Node.js 20 or newer, Git.

```bash
git clone https://github.com/MR-SAIRAM-7/tokenEdge.git
cd tokenEdge
python -m venv .venv
```

Activate the virtual environment:

- Windows (PowerShell): `.venv\Scripts\Activate.ps1`
- macOS / Linux: `source .venv/bin/activate`

Install the backend and build the frontend once:

```bash
pip install -r requirements.txt -r requirements-dev.txt
pip install -e . --no-deps
cd web && npm ci && npm run build && cd ..
```

Start the app (the API also serves the built UI):

```bash
uvicorn tokenedge.api.main:app --port 8000
```

Open http://localhost:8000. Interactive API docs are at http://localhost:8000/docs.

### Frontend development mode

For hot reload while editing the UI, run the API as above and, in a second terminal:

```bash
cd web
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` calls to port 8000.

### Offline mode

Set `TOKENEDGE_OFFLINE=1` before starting the server to use only the bundled snapshots in `data/snapshots/`. Nothing is downloaded. Use this for demos and vivas where Wi-Fi is unreliable.

## 2. Using the web app

The market selector in the top bar (symbol and interval) applies to every page. Pick "Other symbol…" to load any Yahoo Finance ticker (for example `INFY.NS`) or ccxt pair (for example `ADA/USDT`); it is downloaded and cached on first use.

| Page | What to do there |
|---|---|
| **Dashboard** | Overview, latest comparison, recent runs. "Compare strategies" runs the default comparison for the selected market. |
| **Data Explorer** | Candlestick chart with SMA/EMA/Bollinger overlays, RSI and MACD panes, a data-quality report and the data hash. **Refresh data** downloads bars newer than the cache. |
| **Backtest Lab** | Run one strategy. Choose the window (Train / Validation / Test / Model test / Full / Custom), cost preset or custom commission and slippage, then **Run backtest**. For SMA, **Auto-tune** grid-searches the windows on train/validation data only and shows the validation-Sharpe heatmap. |
| **Compare** | Buy & Hold vs SMA vs XGBoost vs LSTM on the same window and costs. Shows the verdict, equity and drawdown curves, metrics table, PSR/DSR, bootstrap test of the Sharpe difference and cost sensitivity. |
| **Models** | Every model in `models/`, with its split timeline, validation metrics, threshold search, training curve, ROC curve and feature importance. Also shows Colab training instructions. |
| **Run History** | Every run is saved with its configuration and data hash. Open, rename, export (CSV zip or JSON) or delete. |
| **Methodology** | How look-ahead bias is prevented, the cost models, the statistics and the known limitations. |

### Reading the results

- **Held-out ✓ / In-sample ⚠**: whether the window starts after the model's held-out start. ML backtests on in-sample windows are refused unless you tick "Allow in-sample".
- **PSR**: probability that the true Sharpe ratio is above zero.
- **DSR**: the same, after correcting for how many configurations were tried. A tuned SMA counts its grid size; an ML model counts its hyperparameter and threshold trials.
- **Bootstrap test**: if the 95% interval of the Sharpe difference includes 0, the better-looking strategy may just be lucky.
- **Break-even cost**: the commission per side at which a strategy's total return falls to zero.

## 3. Training the ML models (Google Colab)

Models are trained in Colab, not on your laptop. The app only loads the exported files.

1. Open a notebook in Colab:
   - XGBoost: https://colab.research.google.com/github/MR-SAIRAM-7/tokenEdge/blob/main/notebooks/01_train_xgboost.ipynb
   - LSTM: https://colab.research.google.com/github/MR-SAIRAM-7/tokenEdge/blob/main/notebooks/02_train_lstm.ipynb
2. For the LSTM, choose Runtime → Change runtime type → **T4 GPU**.
3. Edit the configuration cell (`SYMBOL`, `SOURCE`, `INTERVAL`, ...), then Runtime → **Run all**. If Colab asks to restart after installing packages, restart and run all again.
4. The last cell downloads `<model_id>.zip`. Unzip it into `models/` so you have `models/<model_id>/metadata.json`.
5. Refresh the web app. The model appears on the Models page.
6. Commit it so the deployed demo includes it:

```bash
git add models/
git commit -m "Add trained models"
git push
```

Suggested set for the report: XGBoost and LSTM for `SPY` (1d), `RELIANCE.NS` (1d) and `BTC/USDT` (1h).

The same pipeline is available from the command line for anyone with a GPU: `python scripts/train.py xgboost SPY` (needs `pip install -e ".[train]"`).

## 4. Experiments for the report

`notebooks/03_experiments.ipynb` runs experiments E1–E6 from the PRD and saves CSV tables to `docs/results/`. E1, E2, E5 and E6 only need trained models and can also run locally:

```bash
python scripts/run_experiments.py
```

E3 (labeling ablation) and E4 (look-ahead demonstration) train small models, so run them in Colab.

## 5. Tests

```bash
pytest                       # everything: unit, leakage, property-based, API, Backtrader parity
pytest tests/leakage -v      # just the look-ahead tests
pytest -m "not crosscheck"   # skip the Backtrader comparison
cd web && npm test           # frontend unit tests
```

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| "Could not download … from yfinance" | Yahoo sometimes rate-limits. Bundled snapshots still work; try Refresh later. |
| ccxt errors for crypto | Some exchanges block certain countries or cloud regions. Set `TOKENEDGE_CCXT_EXCHANGE` (for example `kraken`, `kucoin`) or rely on the snapshots. |
| `409 IN_SAMPLE_WINDOW` | The window overlaps the model's training or validation data. Use the **Model test** window. |
| No XGBoost/LSTM option | No trained models in `models/` yet. See section 3. |
| Port 8000 in use | `uvicorn tokenedge.api.main:app --port 8001`, and change the port in `web/vite.config.ts` for dev mode. |

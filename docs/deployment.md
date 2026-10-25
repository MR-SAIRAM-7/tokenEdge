# Deploying TokenEdge

TokenEdge ships as a single Docker image. A multi-stage build compiles the React app with Node, then copies it into a slim Python image that serves both the API and the static files. The runtime has no PyTorch (LSTM inference uses ONNX Runtime), so it fits free hosting tiers.

## 1. Docker on your machine

```bash
docker compose up --build
```

Open http://localhost:8000. `./models` is mounted read-only, so new model folders show up without a rebuild. Run history and the data cache are kept in the `tokenedge-var` volume. For a fully offline demo, set `TOKENEDGE_OFFLINE: "1"` in `docker-compose.yml`.

## 2. Render (recommended free hosting)

The repository includes a Render Blueprint (`render.yaml`).

1. Sign in at https://render.com with GitHub.
2. Choose **New → Blueprint** and select the `tokenEdge` repository.
3. Accept the defaults (free plan, Docker, Frankfurt region) and click **Apply**.
4. The first build takes about 5–8 minutes. Your URL looks like `https://tokenedge.onrender.com`.

Every push to `main` redeploys automatically. Free services sleep after about 15 minutes without traffic, so the first request after a pause takes up to a minute. Open the site a few minutes before a review.

The Frankfurt region is chosen because some crypto exchange APIs block US servers. The bundled snapshots work everywhere.

## 3. Hugging Face Spaces (alternative)

1. Create a Space at https://huggingface.co/new-space with **SDK: Docker**.
2. Hugging Face needs binary files (Parquet snapshots, model files) tracked with Git LFS, and a README header that sets the port. In a copy of the repository:

```bash
git lfs install
git lfs track "*.parquet" "*.onnx"
```

3. Put this at the very top of the Space's `README.md`:

```yaml
---
title: TokenEdge
sdk: docker
app_port: 8000
---
```

4. Push to the Space remote: `git push https://huggingface.co/spaces/<user>/<space> main`.

## 4. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `TOKENEDGE_OFFLINE` | `0` | `1` = snapshots and cache only, never call Yahoo or exchanges |
| `TOKENEDGE_DATA_DIR` | `./data_cache` (`/app/var/cache` in Docker) | Download cache |
| `TOKENEDGE_SNAPSHOT_DIR` | `./data/snapshots` | Bundled datasets |
| `TOKENEDGE_MODELS_DIR` | `./models` | Model registry |
| `TOKENEDGE_DB_URL` | `sqlite:///./tokenedge.db` | Run-history database |
| `TOKENEDGE_CCXT_EXCHANGE` | `binance` | Primary crypto exchange |
| `TOKENEDGE_CCXT_FALLBACKS` | `bybit,kucoin,okx` | Tried in order if the primary fails |
| `TOKENEDGE_CORS_ORIGINS` | `http://localhost:5173,…` | Allowed origins for the dev server |
| `TOKENEDGE_GIT_SHA` | from `git` | Code version stored with each run |

## 5. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Python**: ruff lint and format check, mypy, then the full pytest suite with coverage (unit, leakage, property-based, API integration and Backtrader parity).
2. **Web**: `npm ci`, Vitest unit tests, TypeScript check and production build.
3. **Docker**: builds the image, starts it in offline mode, and smoke-tests `/api/health` and a backtest.

## 6. Refreshing the bundled data

Before a release or demo, update the snapshots and commit them:

```bash
python scripts/download_snapshots.py
git add data/snapshots
git commit -m "Refresh market data snapshots"
```

Existing models keep working because their training windows end before the new data.

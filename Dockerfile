# ---------- Stage 1: build the React frontend
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- Stage 2: Python runtime (no PyTorch; LSTM inference uses ONNX Runtime)
FROM python:3.11-slim
ARG GIT_SHA=""
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    TOKENEDGE_STATIC_DIR=/app/static \
    TOKENEDGE_DATA_DIR=/app/var/cache \
    TOKENEDGE_DB_URL=sqlite:////app/var/tokenedge.db \
    TOKENEDGE_GIT_SHA=${GIT_SHA} \
    PORT=8000

# libgomp is required by XGBoost wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY tokenedge/ ./tokenedge/
COPY models/ ./models/
COPY data/snapshots/ ./data/snapshots/
COPY --from=web /web/dist ./static

# Run as an unprivileged user (uid 1000 also matches Hugging Face Spaces).
RUN useradd --create-home --uid 1000 app && mkdir -p /app/var && chown -R app:app /app/var
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health', timeout=4)"
CMD ["sh", "-c", "uvicorn tokenedge.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

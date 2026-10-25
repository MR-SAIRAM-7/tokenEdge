from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from helpers import build_lstm_onnx, build_xgb_model, synthetic_ohlcv  # noqa: E402

from tokenedge.config import get_settings  # noqa: E402
from tokenedge.data.cache import snapshot_file, write_parquet  # noqa: E402
from tokenedge.ml import registry as registry_module  # noqa: E402


@pytest.fixture(scope="session")
def daily():
    return synthetic_ohlcv()


@pytest.fixture(scope="session")
def hourly():
    return synthetic_ohlcv(n=3000, start="2024-01-01", freq="h", seed=11)


@pytest.fixture(scope="session")
def sandbox(tmp_path_factory, daily):
    """Isolated offline environment: snapshot data, two model artifacts and a fresh database."""
    root = tmp_path_factory.mktemp("tokenedge")
    env = {
        "TOKENEDGE_OFFLINE": "1",
        "TOKENEDGE_DATA_DIR": str(root / "cache"),
        "TOKENEDGE_SNAPSHOT_DIR": str(root / "snapshots"),
        "TOKENEDGE_MODELS_DIR": str(root / "models"),
        "TOKENEDGE_DB_URL": f"sqlite:///{(root / 'test.db').as_posix()}",
        "TOKENEDGE_STATIC_DIR": str(root / "no_static"),
    }
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    get_settings.cache_clear()
    registry_module.set_registry(None)

    write_parquet(daily, snapshot_file(root / "snapshots", "SYN", "1d"))
    build_xgb_model(root / "models" / "xgb_syn_1d_fh_v1", daily)
    build_lstm_onnx(root / "models" / "lstm_syn_1d_fh_v1")
    yield root

    for k, v in old.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    get_settings.cache_clear()
    registry_module.set_registry(None)


@pytest.fixture(scope="session")
def client(sandbox):
    from fastapi.testclient import TestClient

    from tokenedge.api.main import create_app

    with TestClient(create_app()) as c:
        yield c

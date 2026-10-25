"""Synthetic data and tiny model artifacts for tests (no network, no real training)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from tokenedge.features.feature_sets import build_features, feature_names
from tokenedge.labeling import make_labels

TEST_SPLITS = {
    "train": ["2012-01-01", "2020-12-31"],
    "val": ["2021-01-01", "2022-12-31"],
    "test": ["2023-01-01", None],
    "embargo_bars": 5,
}


def synthetic_ohlcv(
    n: int = 3600, start: str = "2012-01-02", freq: str = "B", seed: int = 7
) -> pd.DataFrame:
    """Geometric random walk with mild momentum and realistic OHLC structure."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n, freq=freq, tz="UTC", name="timestamp")
    eps = rng.normal(0, 0.011, n)
    rets = np.empty(n)
    rets[0] = eps[0]
    for i in range(1, n):
        rets[i] = 0.0003 + 0.08 * rets[i - 1] + eps[i]
    close = 100 * np.exp(np.cumsum(rets))
    open_ = np.r_[close[0], close[:-1]] * np.exp(rng.normal(0, 0.002, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.004, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.004, n)))
    volume = rng.lognormal(13, 0.3, n)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


def write_metadata(model_dir: Path, metadata: dict) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def base_metadata(
    model_id: str, model_type: str, symbol: str = "SYN", interval: str = "1d"
) -> dict:
    return {
        "model_id": model_id,
        "model_type": model_type,
        "symbol": symbol,
        "source": "yfinance",
        "interval": interval,
        "feature_set": "v1",
        "features": feature_names("v1", interval),
        "label": {"method": "fixed_horizon", "horizon": 1, "threshold": 0.0},
        "splits": dict(TEST_SPLITS),
        "embargo_bars": 5,
        "threshold": {"long": 0.5, "short": 0.5},
        "cv": {"method": "test_fixture", "trials": 10, "trial_sharpe_std": 0.3},
        "metrics": {
            "val": {"accuracy": 0.51, "roc_auc": 0.52, "f1": 0.5, "sharpe_after_costs": 0.2}
        },
        "data_hash": "sha256:test",
        "seed": 0,
        "created_at": "2026-01-01T00:00:00Z",
    }


def build_xgb_model(model_dir: Path, df: pd.DataFrame, model_id: str = "xgb_syn_1d_fh_v1") -> Path:
    """A 10-tree XGBoost model fitted on the synthetic training window (milliseconds)."""
    import xgboost as xgb

    feats = build_features(df, "v1", "1d")
    labels = make_labels(df["close"], {"method": "fixed_horizon", "horizon": 1})
    ok = (
        feats.notna().all(axis=1)
        & labels["label"].notna()
        & (feats.index < pd.Timestamp("2021-01-01", tz="UTC"))
    )
    names = list(feats.columns)
    dtrain = xgb.DMatrix(
        feats[ok].to_numpy("float32"), label=labels.loc[ok, "label"].to_numpy(), feature_names=names
    )
    booster = xgb.train(
        {"objective": "binary:logistic", "max_depth": 2, "eta": 0.3, "seed": 0, "verbosity": 0},
        dtrain,
        10,
    )
    model_dir.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(model_dir / "model.json"))
    md = base_metadata(model_id, "xgboost")
    md["artifact"] = "model.json"
    write_metadata(model_dir, md)
    return model_dir


def build_lstm_onnx(
    model_dir: Path,
    model_id: str = "lstm_syn_1d_fh_v1",
    seq_len: int = 10,
    hidden: int = 8,
    seed: int = 0,
) -> Path:
    """A random-weight LSTM classifier as an ONNX graph, built without PyTorch."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    n_features = len(feature_names("v1", "1d"))
    rng = np.random.default_rng(seed)
    arrays = {
        "W": rng.normal(0, 0.3, (1, 4 * hidden, n_features)).astype(np.float32),
        "R": rng.normal(0, 0.3, (1, 4 * hidden, hidden)).astype(np.float32),
        "B": np.zeros((1, 8 * hidden), np.float32),
        "Wo": rng.normal(0, 0.5, (hidden, 1)).astype(np.float32),
        "bo": np.zeros((1,), np.float32),
        "shape_h": np.array([-1, hidden], np.int64),
        "shape_out": np.array([-1], np.int64),
    }
    nodes = [
        helper.make_node("Transpose", ["x"], ["xt"], perm=[1, 0, 2]),
        helper.make_node("LSTM", ["xt", "W", "R", "B"], ["Y", "Y_h"], hidden_size=hidden),
        helper.make_node("Reshape", ["Y_h", "shape_h"], ["h"]),
        helper.make_node("MatMul", ["h", "Wo"], ["z"]),
        helper.make_node("Add", ["z", "bo"], ["z2"]),
        helper.make_node("Sigmoid", ["z2"], ["p2"]),
        helper.make_node("Reshape", ["p2", "shape_out"], ["prob"]),
    ]
    graph = helper.make_graph(
        nodes,
        "lstm_classifier",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", seq_len, n_features])],
        [helper.make_tensor_value_info("prob", TensorProto.FLOAT, ["batch"])],
        [numpy_helper.from_array(v, k) for k, v in arrays.items()],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    model_dir.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(model_dir / "model.onnx"))
    md = base_metadata(model_id, "lstm")
    md["artifact"] = "model.onnx"
    md["seq_len"] = seq_len
    md["scaler"] = {"mean": [0.0] * n_features, "std": [0.05] * n_features, "fit_on": "train"}
    write_metadata(model_dir, md)
    return model_dir

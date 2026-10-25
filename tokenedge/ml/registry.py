"""Model registry: discovers exported models in ``models/*/metadata.json`` and runs inference.

Inference needs no PyTorch. XGBoost models load from their native JSON file and LSTM models
run through ONNX Runtime. Each model carries its own feature list, scaler and split windows,
so the app rebuilds exactly the inputs the model was trained on.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from tokenedge.config import get_settings
from tokenedge.errors import ModelNotFoundError
from tokenedge.features.feature_sets import build_features

log = logging.getLogger(__name__)

MODEL_TYPES = ("xgboost", "lstm")


@dataclass
class ModelInfo:
    model_id: str
    path: Path
    metadata: dict
    mtime: float

    def summary(self) -> dict:
        md = self.metadata
        val = (md.get("metrics") or {}).get("val", {})
        return {
            "model_id": self.model_id,
            "model_type": md.get("model_type"),
            "symbol": md.get("symbol"),
            "source": md.get("source"),
            "interval": md.get("interval"),
            "feature_set": md.get("feature_set"),
            "label_method": (md.get("label") or {}).get("method"),
            "splits": md.get("splits"),
            "threshold": md.get("threshold"),
            "created_at": md.get("created_at"),
            "trials": (md.get("cv") or {}).get("trials"),
            "val_metrics": {
                k: val.get(k) for k in ("accuracy", "roc_auc", "f1", "sharpe_after_costs")
            },
        }


class LoadedModel:
    def __init__(self, info: ModelInfo):
        self.info = info
        self.metadata = info.metadata
        self.model_id = info.model_id
        self.features: list[str] = list(self.metadata["features"])
        self.feature_set: str = self.metadata.get("feature_set", "v1")
        self.interval: str = self.metadata.get("interval", "1d")

    def feature_frame(self, data: pd.DataFrame) -> pd.DataFrame:
        feats = build_features(data, self.feature_set, self.interval)
        missing = [c for c in self.features if c not in feats.columns]
        if missing:
            raise ModelNotFoundError(
                f"Model {self.model_id} expects features that feature set '{self.feature_set}' "
                f"does not produce: {missing}"
            )
        return feats[self.features]

    def predict_proba(self, data: pd.DataFrame) -> pd.Series:
        raise NotImplementedError


class XGBoostModel(LoadedModel):
    def __init__(self, info: ModelInfo):
        super().__init__(info)
        import xgboost as xgb

        self._xgb = xgb
        self.booster = xgb.Booster()
        self.booster.load_model(str(info.path / info.metadata.get("artifact", "model.json")))

    def predict_proba(self, data: pd.DataFrame) -> pd.Series:
        X = self.feature_frame(data)
        valid = X.notna().all(axis=1).to_numpy()
        out = np.full(len(X), np.nan)
        if valid.any():
            dm = self._xgb.DMatrix(X.to_numpy("float32")[valid], feature_names=self.features)
            out[valid] = self.booster.predict(dm)
        return pd.Series(out, index=data.index, name="proba")


class LSTMOnnxModel(LoadedModel):
    def __init__(self, info: ModelInfo):
        super().__init__(info)
        import onnxruntime as ort

        md = info.metadata
        self.seq_len = int(md["seq_len"])
        scaler = md.get("scaler")
        if scaler is None and (info.path / "scaler.json").exists():
            scaler = json.loads((info.path / "scaler.json").read_text())
        if scaler is None:
            raise ModelNotFoundError(f"Model {self.model_id} has no scaler parameters.")
        self.mean = np.asarray(scaler["mean"], dtype="float32")
        std = np.asarray(scaler["std"], dtype="float32")
        self.std = np.where(std > 0, std, 1.0).astype("float32")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.session = ort.InferenceSession(
            str(info.path / md.get("artifact", "model.onnx")),
            opts,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def predict_proba(self, data: pd.DataFrame, batch: int = 4096) -> pd.Series:
        X = self.feature_frame(data).to_numpy("float32")
        n, L = len(X), self.seq_len
        out = np.full(n, np.nan)
        if n < L:
            return pd.Series(out, index=data.index, name="proba")
        invalid = ~np.isfinite(X).all(axis=1)
        Xs = np.nan_to_num((X - self.mean) / self.std, nan=0.0, posinf=0.0, neginf=0.0)
        # A window ending at row t is usable only if all L rows are valid.
        bad_in_window = np.convolve(invalid.astype(int), np.ones(L, dtype=int), mode="valid")
        ends = np.flatnonzero(bad_in_window == 0) + L - 1
        if len(ends) == 0:
            return pd.Series(out, index=data.index, name="proba")
        windows = sliding_window_view(Xs, L, axis=0)  # (n-L+1, F, L), a view
        for s in range(0, len(ends), batch):
            chunk = ends[s : s + batch]
            x = np.ascontiguousarray(windows[chunk - L + 1].transpose(0, 2, 1), dtype="float32")
            prob = self.session.run(None, {self.input_name: x})[0]
            out[chunk] = np.asarray(prob, dtype="float64").reshape(-1)
        return pd.Series(out, index=data.index, name="proba")


class ModelRegistry:
    def __init__(self, models_dir: Path | str):
        self.models_dir = Path(models_dir)
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[float, LoadedModel]] = {}

    def scan(self) -> dict[str, ModelInfo]:
        found: dict[str, ModelInfo] = {}
        if not self.models_dir.exists():
            return found
        for meta_path in sorted(self.models_dir.glob("*/metadata.json")):
            try:
                md = json.loads(meta_path.read_text(encoding="utf-8"))
                model_id = md.get("model_id") or meta_path.parent.name
                if md.get("model_type") not in MODEL_TYPES:
                    raise ValueError(f"unknown model_type {md.get('model_type')!r}")
                found[model_id] = ModelInfo(
                    model_id, meta_path.parent, md, meta_path.stat().st_mtime
                )
            except Exception as exc:
                log.warning("Skipping invalid model folder %s: %s", meta_path.parent, exc)
        return found

    def list(self) -> list[dict]:
        return [info.summary() for info in self.scan().values()]

    def info(self, model_id: str) -> ModelInfo:
        models = self.scan()
        if model_id not in models:
            raise ModelNotFoundError(
                f"Model '{model_id}' not found in {self.models_dir}.", {"available": sorted(models)}
            )
        return models[model_id]

    def load(self, model_id: str) -> LoadedModel:
        info = self.info(model_id)
        with self._lock:
            cached = self._cache.get(model_id)
            if cached and cached[0] == info.mtime:
                return cached[1]
            model: LoadedModel
            if info.metadata["model_type"] == "xgboost":
                model = XGBoostModel(info)
            else:
                model = LSTMOnnxModel(info)
            self._cache[model_id] = (info.mtime, model)
            return model


_registry: ModelRegistry | None = None
_override: ModelRegistry | None = None


def get_registry() -> ModelRegistry:
    global _registry
    if _override is not None:
        return _override
    models_dir = get_settings().models_dir
    if _registry is None or _registry.models_dir != models_dir:
        _registry = ModelRegistry(models_dir)
    return _registry


def set_registry(registry: ModelRegistry | None) -> None:
    """Override the process-wide registry (tests, notebooks); ``None`` restores the default."""
    global _override
    _override = registry

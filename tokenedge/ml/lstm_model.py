"""LSTM training pipeline with ONNX export (designed to run in Google Colab with a GPU).

PyTorch is imported inside the functions, so the rest of TokenEdge (and the web app) never
needs it. The exported ONNX graph includes the final sigmoid and takes a float32 tensor of
shape (batch, seq_len, n_features) of already-scaled features.
"""

from __future__ import annotations

import copy
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from tokenedge import __version__
from tokenedge.config import (
    DEFAULT_SEED,
    ROOT_DIR,
    SplitConfig,
    asset_class_of,
    default_cost_preset_for,
    default_label_config,
    default_splits,
    periods_per_year,
)
from tokenedge.data.cache import data_hash
from tokenedge.data.loader import slice_window
from tokenedge.engine.costs import execution_from_preset
from tokenedge.ml.datasets import build_dataset, make_sequences, sequence_positions
from tokenedge.ml.evaluation import classification_report, roc_auc, roc_curve_points
from tokenedge.ml.splits import SplitWindows, assign_splits, split_summary
from tokenedge.ml.training import (
    library_versions,
    make_model_id,
    proba_on_index,
    select_threshold,
    utc_now,
    write_metadata,
)
from tokenedge.ml.xgb_model import TrainingOutput

DEFAULT_SEQ_LEN = {"1d": 60, "1h": 48, "4h": 48}


def build_lstm(n_features: int, hidden: int = 64, layers: int = 2, dropout: float = 0.2):
    import torch
    from torch import nn

    class LSTMClassifier(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(
                n_features,
                hidden,
                num_layers=layers,
                batch_first=True,
                dropout=dropout if layers > 1 else 0.0,
            )
            self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(hidden, 1))

        def forward(self, x):  # x: (batch, seq, features) -> logits (batch,)
            out, _ = self.lstm(x)
            return self.head(out[:, -1, :]).squeeze(-1)

    class ProbabilityModel(nn.Module):
        """Wrapper exported to ONNX: logits -> probabilities."""

        def __init__(self, core):
            super().__init__()
            self.core = core

        def forward(self, x):
            return torch.sigmoid(self.core(x))

    return LSTMClassifier(), ProbabilityModel


def export_onnx(prob_model, seq_len: int, n_features: int, path: Path, opset: int = 17) -> None:
    """Export with the classic exporter where available, else the dynamo exporter."""
    import torch

    prob_model = prob_model.eval().cpu()
    # Batch size 1 at export is what the exporter recommends for LSTMs with a dynamic batch axis.
    dummy = torch.zeros(1, seq_len, n_features, dtype=torch.float32)
    kwargs: dict[str, Any] = {
        "input_names": ["x"],
        "output_names": ["prob"],
        "opset_version": opset,
    }
    try:
        torch.onnx.export(
            prob_model,
            (dummy,),
            str(path),
            dynamo=False,
            dynamic_axes={"x": {0: "batch"}, "prob": {0: "batch"}},
            **kwargs,
        )
    except TypeError:  # torch versions without the `dynamo` flag
        torch.onnx.export(
            prob_model,
            (dummy,),
            str(path),
            dynamic_axes={"x": {0: "batch"}, "prob": {0: "batch"}},
            **kwargs,
        )
    except Exception:
        batch = torch.export.Dim("batch", min=1)
        torch.onnx.export(
            prob_model, (dummy,), str(path), dynamo=True, dynamic_shapes=({0: batch},), **kwargs
        )
    # Make sure weights are stored inside the single .onnx file.
    try:
        import onnx

        model = onnx.load(str(path))
        onnx.save_model(model, str(path), save_as_external_data=False)
        data_file = Path(str(path) + ".data")
        if data_file.exists():
            data_file.unlink()
    except ImportError:
        pass


def train_lstm(
    df: pd.DataFrame,
    symbol: str,
    source: str,
    interval: str,
    label_config: dict | None = None,
    splits: SplitConfig | dict | None = None,
    feature_set: str = "v1",
    seq_len: int | None = None,
    hidden: int = 64,
    layers: int = 2,
    dropout: float = 0.2,
    lr: float = 1e-3,
    batch_size: int = 256,
    max_epochs: int = 100,
    patience: int = 10,
    cost_preset: str | None = None,
    seed: int = DEFAULT_SEED,
    device: str | None = None,
    output_dir: str | Path | None = None,
    model_id: str | None = None,
    verbose: bool = True,
) -> TrainingOutput:
    import torch
    from torch import nn

    t_start = time.time()
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    label_config = label_config or default_label_config("fixed_horizon", interval)
    windows = SplitWindows.from_config(splits or default_splits(source))
    asset_class = asset_class_of(source)
    ppy = periods_per_year(interval, asset_class)
    seq_len = seq_len or DEFAULT_SEQ_LEN.get(interval, 48)
    cost_preset = cost_preset or default_cost_preset_for(symbol, source)
    exec_cfg = execution_from_preset(cost_preset)

    history = slice_window(df, None, windows.val[1])
    ds = build_dataset(history, feature_set, interval, label_config)
    parts = assign_splits(pd.DatetimeIndex(ds.X.index), ds.t1, windows)
    feats = ds.feature_names

    # Scaler fitted on training rows only (FR-V4).
    train_rows = ds.X.iloc[parts["train"]]
    mean = train_rows.mean().to_numpy("float64")
    std = train_rows.std(ddof=0).to_numpy("float64")
    std = np.where(std > 1e-12, std, 1.0)
    matrix = ((ds.features_all[feats].to_numpy("float64") - mean) / std).astype("float32")
    matrix = np.nan_to_num(matrix, nan=0.0)

    seq_pos = sequence_positions(ds.features_all[feats], ds.X.index, seq_len)
    tr = parts["train"][seq_pos[parts["train"]] >= 0]
    va = parts["val"][seq_pos[parts["val"]] >= 0]
    if len(tr) < 200 or len(va) < 50:
        raise ValueError(f"Not enough sequences: train={len(tr)}, val={len(va)}.")
    y = ds.y.to_numpy().astype("float32")
    X_tr = torch.from_numpy(make_sequences(matrix, seq_pos[tr], seq_len))
    X_va = torch.from_numpy(make_sequences(matrix, seq_pos[va], seq_len))
    y_tr = torch.from_numpy(y[tr])
    y_va = torch.from_numpy(y[va])
    pos_rate = float(y_tr.mean())
    if verbose:
        print(
            f"[lstm] device={device} train={len(tr)} val={len(va)} seq_len={seq_len} features={len(feats)} pos_rate={pos_rate:.3f}"
        )

    core, ProbabilityModel = build_lstm(len(feats), hidden, layers, dropout)
    core = core.to(device)
    optimizer = torch.optim.Adam(core.parameters(), lr=lr)
    loss_fn = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor((1 - pos_rate) / max(pos_rate, 1e-6), device=device)
    )
    gen = torch.Generator().manual_seed(seed)

    def evaluate(X, yt):
        core.eval()
        losses, probs = [], []
        with torch.no_grad():
            for s in range(0, len(X), 4096):
                xb, yb = X[s : s + 4096].to(device), yt[s : s + 4096].to(device)
                logits = core(xb)
                losses.append(loss_fn(logits, yb).item() * len(xb))
                probs.append(torch.sigmoid(logits).cpu().numpy())
        return sum(losses) / len(X), np.concatenate(probs)

    history_log: dict[str, list] = {"train_loss": [], "val_loss": [], "val_auc": []}
    best_state, best_loss, bad_epochs = None, float("inf"), 0
    for epoch in range(max_epochs):
        core.train()
        perm = torch.randperm(len(X_tr), generator=gen)
        total = 0.0
        for s in range(0, len(perm), batch_size):
            idx = perm[s : s + batch_size]
            xb, yb = X_tr[idx].to(device), y_tr[idx].to(device)
            optimizer.zero_grad()
            loss = loss_fn(core(xb), yb)
            loss.backward()
            nn.utils.clip_grad_norm_(core.parameters(), 1.0)
            optimizer.step()
            total += loss.item() * len(idx)
        val_loss, val_prob = evaluate(X_va, y_va)
        history_log["train_loss"].append(total / len(X_tr))
        history_log["val_loss"].append(val_loss)
        history_log["val_auc"].append(roc_auc(y[va], val_prob))
        if verbose:
            print(
                f"[lstm] epoch {epoch + 1:>3}  train_loss={total / len(X_tr):.4f}  val_loss={val_loss:.4f}  val_auc={history_log['val_auc'][-1]}"
            )
        if val_loss < best_loss - 1e-5:
            best_loss, best_state, bad_epochs = val_loss, copy.deepcopy(core.state_dict()), 0
        else:
            bad_epochs += 1
            if bad_epochs >= patience:
                break
    if best_state is not None:
        core.load_state_dict(best_state)
    _, val_proba = evaluate(X_va, y_va)

    proba_full = proba_on_index(history.index, ds.X.index[va], val_proba)
    thr = select_threshold(history, proba_full, windows.val, exec_cfg, ppy)
    val_report = classification_report(y[va], val_proba, 0.5)
    val_report["threshold_report"] = classification_report(y[va], val_proba, thr["threshold"])
    val_report["sharpe_after_costs"] = thr["val_sharpe"]
    val_report["roc_curve"] = roc_curve_points(y[va], val_proba)
    _, train_proba = evaluate(X_tr, y_tr)
    train_report = classification_report(y[tr], train_proba, 0.5)

    model_id = model_id or make_model_id("lstm", symbol, interval, label_config["method"])
    out_root = Path(output_dir) if output_dir else ROOT_DIR / "models"
    model_dir = out_root / model_id
    model_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = model_dir / "model.onnx"
    export_onnx(ProbabilityModel(core.cpu()), seq_len, len(feats), onnx_path)
    parity = _check_onnx_parity(ProbabilityModel(core), onnx_path, X_va[:256])

    scaler = {"mean": mean.tolist(), "std": std.tolist(), "fit_on": "train", "features": feats}
    (model_dir / "scaler.json").write_text(json.dumps(scaler, indent=2), encoding="utf-8")

    metadata = {
        "model_id": model_id,
        "model_type": "lstm",
        "artifact": "model.onnx",
        "symbol": symbol,
        "source": source,
        "interval": interval,
        "asset_class": asset_class,
        "feature_set": feature_set,
        "features": feats,
        "label": label_config,
        "splits": split_summary(
            pd.DatetimeIndex(ds.X.index), {"train": tr, "val": va, "test": parts["test"]}, windows
        ),
        "purge": "t1 < next split start",
        "embargo_bars": windows.embargo_bars,
        "seq_len": seq_len,
        "scaler": scaler,
        "threshold": {"long": thr["threshold"], "short": round(1.0 - thr["threshold"], 2)},
        "threshold_search": thr["table"],
        "cost_preset": cost_preset,
        "hyperparameters": {
            "hidden": hidden,
            "layers": layers,
            "dropout": dropout,
            "lr": lr,
            "batch_size": batch_size,
            "max_epochs": max_epochs,
            "patience": patience,
            "epochs_trained": len(history_log["val_loss"]),
        },
        "cv": {
            "method": "holdout_validation",
            "trials": thr["trials"],
            "threshold_trials": thr["trials"],
            "trial_sharpe_std": thr["trial_sharpe_std"],
        },
        "metrics": {"train": train_report, "val": val_report},
        "history": history_log,
        "onnx_parity_max_abs_diff": parity,
        "feature_importance": None,
        "data_hash": data_hash(history),
        "data_range": [history.index[0].isoformat(), history.index[-1].isoformat()],
        "seed": seed,
        "device": device,
        "created_at": utc_now(),
        "training_seconds": round(time.time() - t_start, 1),
        "library_versions": library_versions(("torch", "onnx", "numpy", "pandas")),
        "tokenedge_version": __version__,
    }
    write_metadata(model_dir, metadata)
    if verbose:
        print(
            f"[lstm] saved {model_dir}  val_auc={val_report['roc_auc']}  threshold={thr['threshold']}  onnx_diff={parity}"
        )
    return TrainingOutput(model_dir, metadata, core)


def _check_onnx_parity(prob_model, onnx_path: Path, sample) -> float | None:
    try:
        import onnxruntime as ort
        import torch
    except ImportError:
        return None
    prob_model = prob_model.eval().cpu()
    with torch.no_grad():
        expected = prob_model(sample.cpu()).numpy().reshape(-1)
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    got = sess.run(None, {sess.get_inputs()[0].name: sample.numpy()})[0].reshape(-1)
    return float(np.max(np.abs(expected - got)))

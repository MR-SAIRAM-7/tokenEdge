"""XGBoost training pipeline (designed to run in Google Colab).

1. Build features (t) and labels (resolved at t1 > t).
2. Chronological train / val / test split with purging and embargo; test is never touched.
3. Random hyperparameter search scored by purged K-fold CV on the training set.
4. Refit on train with early stopping on validation.
5. Choose the trading threshold on validation by Sharpe after costs.
6. Export model.json + metadata.json into models/<model_id>/.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
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
from tokenedge.ml.cv import PurgedKFold
from tokenedge.ml.datasets import build_dataset
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

log = logging.getLogger(__name__)


@dataclass
class TrainingOutput:
    model_dir: Path
    metadata: dict
    model: object


def _sample_params(rng: np.random.Generator) -> dict:
    return {
        "max_depth": int(rng.choice([2, 3, 4, 5, 6])),
        "eta": float(10 ** rng.uniform(-2.0, -0.7)),
        "subsample": float(rng.uniform(0.5, 1.0)),
        "colsample_bytree": float(rng.uniform(0.5, 1.0)),
        "min_child_weight": float(rng.choice([1, 3, 5, 10, 20])),
        "lambda": float(10 ** rng.uniform(-1.0, 1.0)),
        "gamma": float(rng.choice([0.0, 0.1, 0.5, 1.0])),
    }


def train_xgboost(
    df: pd.DataFrame,
    symbol: str,
    source: str,
    interval: str,
    label_config: dict | None = None,
    splits: SplitConfig | dict | None = None,
    feature_set: str = "v1",
    n_trials: int = 40,
    cv_folds: int = 5,
    cost_preset: str | None = None,
    seed: int = DEFAULT_SEED,
    device: str = "cpu",
    output_dir: str | Path | None = None,
    model_id: str | None = None,
    max_rounds: int = 1000,
    verbose: bool = True,
) -> TrainingOutput:
    import xgboost as xgb

    t_start = time.time()
    label_config = label_config or default_label_config("triple_barrier", interval)
    windows = SplitWindows.from_config(splits or default_splits(source))
    asset_class = asset_class_of(source)
    ppy = periods_per_year(interval, asset_class)
    cost_preset = cost_preset or default_cost_preset_for(symbol, source)
    exec_cfg = execution_from_preset(cost_preset)

    # Nothing after the validation window is needed for training; dropping it makes the
    # "test set never touched" property structural rather than a convention.
    history = slice_window(df, None, windows.val[1])
    ds = build_dataset(history, feature_set, interval, label_config)
    parts = assign_splits(pd.DatetimeIndex(ds.X.index), ds.t1, windows)
    tr, va = parts["train"], parts["val"]
    if len(tr) < 200 or len(va) < 50:
        raise ValueError(
            f"Not enough samples: train={len(tr)}, val={len(va)}. Check the data range and splits."
        )

    X, y = ds.X.to_numpy("float32"), ds.y.to_numpy()
    feats = ds.feature_names
    pos_rate = float(y[tr].mean())
    base = {
        "objective": "binary:logistic",
        "eval_metric": ["auc", "logloss"],
        "tree_method": "hist",
        "device": device,
        "seed": seed,
        "scale_pos_weight": (1.0 - pos_rate) / max(pos_rate, 1e-6),
        "verbosity": 0,
    }
    if verbose:
        print(
            f"[xgboost] samples train={len(tr)} val={len(va)} features={len(feats)} pos_rate={pos_rate:.3f}"
        )

    # --- hyperparameter search with purged K-fold CV on the training set only
    rng = np.random.default_rng(seed)
    train_index = pd.DatetimeIndex(ds.X.index[tr])
    folds = list(PurgedKFold(cv_folds, windows.embargo_bars).split(train_index, ds.t1.iloc[tr]))
    trials: list[dict[str, Any]] = []
    for t in range(n_trials):
        params = _sample_params(rng)
        losses, aucs, rounds = [], [], []
        for f_tr, f_te in folds:
            dtr = xgb.DMatrix(X[tr][f_tr], label=y[tr][f_tr], feature_names=feats)
            dte = xgb.DMatrix(X[tr][f_te], label=y[tr][f_te], feature_names=feats)
            booster = xgb.train(
                {**base, **params},
                dtr,
                num_boost_round=max_rounds,
                evals=[(dte, "test")],
                early_stopping_rounds=50,
                verbose_eval=False,
            )
            best_it = booster.best_iteration
            pred = booster.predict(dte, iteration_range=(0, best_it + 1))
            losses.append(float(booster.best_score))
            aucs.append(roc_auc(y[tr][f_te], pred) or 0.5)
            rounds.append(best_it + 1)
        trials.append(
            {
                "params": params,
                "cv_logloss": float(np.mean(losses)),
                "cv_auc": float(np.mean(aucs)),
                "rounds": int(np.mean(rounds)),
            }
        )
        if verbose:
            print(
                f"[xgboost] trial {t + 1:>3}/{n_trials}  cv_logloss={trials[-1]['cv_logloss']:.4f}  cv_auc={trials[-1]['cv_auc']:.4f}"
            )
    best_trial = min(trials, key=lambda r: r["cv_logloss"])
    best_params = {**base, **best_trial["params"]}

    # --- refit on train, early stopping on validation
    dtrain = xgb.DMatrix(X[tr], label=y[tr], feature_names=feats)
    dval = xgb.DMatrix(X[va], label=y[va], feature_names=feats)
    evals_result: dict = {}
    booster = xgb.train(
        best_params,
        dtrain,
        num_boost_round=max_rounds * 2,
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=50,
        verbose_eval=False,
        evals_result=evals_result,
    )
    best_it = booster.best_iteration
    booster = booster[: best_it + 1]
    val_proba = booster.predict(dval)

    # --- trading threshold chosen on validation (Sharpe after costs)
    proba_full = proba_on_index(history.index, ds.X.index[va], val_proba)
    thr = select_threshold(history, proba_full, windows.val, exec_cfg, ppy)
    val_report = classification_report(y[va], val_proba, 0.5)
    val_report["threshold_report"] = classification_report(y[va], val_proba, thr["threshold"])
    val_report["sharpe_after_costs"] = thr["val_sharpe"]
    val_report["roc_curve"] = roc_curve_points(y[va], val_proba)
    train_report = classification_report(y[tr], booster.predict(dtrain), 0.5)

    gain = {k: float(v) for k, v in booster.get_score(importance_type="gain").items()}  # type: ignore[arg-type]
    total_gain = sum(gain.values()) or 1.0
    importance = dict(sorted(((k, v / total_gain) for k, v in gain.items()), key=lambda kv: -kv[1]))

    model_id = model_id or make_model_id("xgboost", symbol, interval, label_config["method"])
    out_root = Path(output_dir) if output_dir else ROOT_DIR / "models"
    model_dir = out_root / model_id
    model_dir.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(model_dir / "model.json"))

    metadata = {
        "model_id": model_id,
        "model_type": "xgboost",
        "artifact": "model.json",
        "symbol": symbol,
        "source": source,
        "interval": interval,
        "asset_class": asset_class,
        "feature_set": feature_set,
        "features": feats,
        "label": label_config,
        "splits": split_summary(pd.DatetimeIndex(ds.X.index), parts, windows),
        "purge": "t1 < next split start",
        "embargo_bars": windows.embargo_bars,
        "seq_len": None,
        "scaler": None,
        "threshold": {"long": thr["threshold"], "short": round(1.0 - thr["threshold"], 2)},
        "threshold_search": thr["table"],
        "cost_preset": cost_preset,
        "hyperparameters": {
            **best_trial["params"],
            "n_estimators": best_it + 1,
            "scale_pos_weight": base["scale_pos_weight"],
        },
        "cv": {
            "method": "purged_kfold",
            "folds": cv_folds,
            "trials": n_trials + thr["trials"],
            "hyperparameter_trials": n_trials,
            "threshold_trials": thr["trials"],
            "trial_sharpe_std": thr["trial_sharpe_std"],
            "best_cv_logloss": best_trial["cv_logloss"],
            "best_cv_auc": best_trial["cv_auc"],
            "search": trials,
        },
        "metrics": {"train": train_report, "val": val_report},
        "history": {k: v for k, v in evals_result.get("val", {}).items()},
        "feature_importance": importance,
        "data_hash": data_hash(history),
        "data_range": [history.index[0].isoformat(), history.index[-1].isoformat()],
        "seed": seed,
        "created_at": utc_now(),
        "training_seconds": round(time.time() - t_start, 1),
        "library_versions": library_versions(("xgboost", "numpy", "pandas")),
        "tokenedge_version": __version__,
    }
    write_metadata(model_dir, metadata)
    if verbose:
        print(
            f"[xgboost] saved {model_dir}  val_auc={val_report['roc_auc']}  "
            f"threshold={thr['threshold']}  val_sharpe={thr['val_sharpe']}"
        )
    return TrainingOutput(model_dir, metadata, booster)

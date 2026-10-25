"""Classification metrics without scikit-learn (keeps the runtime image small)."""

from __future__ import annotations

import math

import numpy as np
from scipy.stats import rankdata


def roc_auc(y: np.ndarray, p: np.ndarray) -> float | None:
    y = np.asarray(y).astype(int)
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    if pos == 0 or neg == 0:
        return None
    ranks = rankdata(p)
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2.0) / (pos * neg))


def roc_curve_points(y: np.ndarray, p: np.ndarray, n_points: int = 50) -> list[dict]:
    y = np.asarray(y).astype(int)
    pos, neg = max(int(y.sum()), 1), max(int(len(y) - y.sum()), 1)
    out = []
    for t in np.linspace(1.0, 0.0, n_points):
        pred = p >= t
        out.append(
            {
                "fpr": float((pred & (y == 0)).sum() / neg),
                "tpr": float((pred & (y == 1)).sum() / pos),
            }
        )
    return out


def classification_report(y, proba, threshold: float = 0.5) -> dict:
    y = np.asarray(y).astype(int)
    p = np.asarray(proba, dtype="float64")
    ok = np.isfinite(p)
    y, p = y[ok], p[ok]
    n = len(y)
    if n == 0:
        return {"n": 0}
    pred = (p > threshold).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    eps = 1e-7
    pc = np.clip(p, eps, 1 - eps)
    log_loss = float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc)))
    auc = roc_auc(y, p)
    return {
        "n": n,
        "threshold": threshold,
        "accuracy": (tp + tn) / n,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "roc_auc": auc if auc is None or math.isfinite(auc) else None,
        "log_loss": log_loss,
        "base_rate": float(y.mean()),
        "predicted_positive_rate": float(pred.mean()),
        "confusion_matrix": [[tn, fp], [fn, tp]],
    }

import importlib.util

import numpy as np
import pandas as pd
import pytest

from tokenedge.labeling import make_labels
from tokenedge.ml.cv import PurgedKFold
from tokenedge.ml.datasets import build_dataset, make_sequences, sequence_positions
from tokenedge.ml.evaluation import classification_report, roc_auc
from tokenedge.ml.registry import ModelRegistry, get_registry
from tokenedge.ml.splits import SplitWindows, assign_splits
from tokenedge.strategies import get_strategy

WINDOWS = SplitWindows(
    ("2012-01-01", "2018-12-31"), ("2019-01-01", "2020-12-31"), ("2021-01-01", None), 5
)


def test_assign_splits_purges_and_embargoes(daily):
    labels = make_labels(daily["close"], {"method": "triple_barrier", "horizon": 10})
    ok = labels["label"].notna()
    idx, t1 = daily.index[ok], labels.loc[ok, "t1"]
    parts = assign_splits(idx, t1, WINDOWS)
    val_start = pd.Timestamp("2019-01-01", tz="UTC")
    test_start = pd.Timestamp("2021-01-01", tz="UTC")
    assert (t1.iloc[parts["train"]] < val_start).all()
    assert (t1.iloc[parts["val"]] < test_start).all()
    first_val = np.searchsorted(idx, val_start)
    assert parts["train"].max() < first_val - 5
    assert not set(parts["train"]) & set(parts["val"])
    assert idx[parts["test"]].min() >= test_start


def test_purged_kfold_has_no_overlap(daily):
    labels = make_labels(daily["close"], {"method": "fixed_horizon", "horizon": 5})
    ok = labels["label"].notna()
    idx, t1 = daily.index[ok][:1500], labels.loc[ok, "t1"].iloc[:1500]
    for train, test in PurgedKFold(5, embargo_bars=3).split(idx, t1):
        t_start, t_end = idx[test[0]], t1.iloc[test].max()
        tr_start, tr_end = idx[train], t1.iloc[train]
        overlaps = (tr_start <= t_end) & (tr_end.to_numpy() >= t_start)
        assert not overlaps.any()


def test_dataset_and_sequences(daily):
    ds = build_dataset(daily, "v1", "1d", {"method": "fixed_horizon", "horizon": 1})
    assert ds.X.notna().all().all() and set(ds.y.unique()) <= {0, 1}
    pos = sequence_positions(ds.features_all, ds.X.index, 20)
    valid = pos[pos >= 0]
    seqs = make_sequences(ds.features_all.to_numpy(), valid[:5], 20)
    assert seqs.shape == (5, 20, ds.X.shape[1])
    np.testing.assert_allclose(seqs[0, -1], ds.features_all.iloc[valid[0]].to_numpy())


def test_classification_metrics():
    y = np.array([0, 0, 1, 1, 1, 0])
    p = np.array([0.1, 0.4, 0.8, 0.6, 0.3, 0.7])
    rep = classification_report(y, p, 0.5)
    assert rep["confusion_matrix"] == [[2, 1], [1, 2]]
    assert rep["accuracy"] == pytest.approx(4 / 6)
    assert roc_auc(np.array([0, 1]), np.array([0.2, 0.9])) == 1.0


def test_registry_loads_and_predicts(sandbox, daily):
    reg = get_registry()
    ids = {m["model_id"] for m in reg.list()}
    assert {"xgb_syn_1d_fh_v1", "lstm_syn_1d_fh_v1"} <= ids
    for model_id in ids:
        proba = reg.load(model_id).predict_proba(daily)
        assert proba.index.equals(daily.index)
        assert proba.iloc[:30].isna().all()
        valid = proba.dropna()
        assert len(valid) > len(daily) * 0.9 and valid.between(0, 1).all()


def test_registry_skips_invalid_folders(tmp_path):
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "metadata.json").write_text("{not json")
    (tmp_path / "wrong").mkdir()
    (tmp_path / "wrong" / "metadata.json").write_text('{"model_type": "svm"}')
    assert ModelRegistry(tmp_path).list() == []


def test_ml_strategy_type_mismatch(sandbox, daily):
    from tokenedge.errors import ConfigError

    with pytest.raises(ConfigError):
        get_strategy("lstm", {"model_id": "xgb_syn_1d_fh_v1"}).generate_signals(daily)


def test_train_xgboost_smoke(tmp_path, daily):
    """Tiny end-to-end run of the Colab pipeline on synthetic data (seconds)."""
    from tokenedge.ml.xgb_model import train_xgboost

    splits = {
        "train": ["2012-01-01", "2018-12-31"],
        "val": ["2019-01-01", "2020-12-31"],
        "test": ["2021-01-01", None],
        "embargo_bars": 5,
    }
    out = train_xgboost(
        daily,
        "SYN",
        "yfinance",
        "1d",
        splits=splits,
        n_trials=2,
        cv_folds=3,
        max_rounds=40,
        output_dir=tmp_path,
        verbose=False,
    )
    md = out.metadata
    assert (out.model_dir / "model.json").exists() and (out.model_dir / "metadata.json").exists()
    assert pd.Timestamp(md["splits"]["train_used"][1]) < pd.Timestamp("2019-01-01", tz="UTC")
    assert pd.Timestamp(md["data_range"][1]) <= pd.Timestamp(
        "2020-12-31 23:59", tz="UTC"
    )  # test data never loaded
    assert 0.5 <= md["threshold"]["long"] <= 0.65
    assert md["cv"]["trials"] == 2 + md["cv"]["threshold_trials"]
    proba = ModelRegistry(tmp_path).load(md["model_id"]).predict_proba(daily)
    assert proba.dropna().between(0, 1).all()


@pytest.mark.skipif(
    importlib.util.find_spec("torch") is None, reason="PyTorch not installed (training extra)"
)
def test_train_lstm_smoke(tmp_path, daily):
    from tokenedge.ml.lstm_model import train_lstm

    splits = {
        "train": ["2012-01-01", "2018-12-31"],
        "val": ["2019-01-01", "2020-12-31"],
        "test": ["2021-01-01", None],
        "embargo_bars": 5,
    }
    out = train_lstm(
        daily,
        "SYN",
        "yfinance",
        "1d",
        splits=splits,
        seq_len=12,
        hidden=8,
        layers=1,
        max_epochs=2,
        output_dir=tmp_path,
        verbose=False,
    )
    assert out.metadata["onnx_parity_max_abs_diff"] < 1e-4
    assert out.metadata["scaler"]["fit_on"] == "train"
    proba = ModelRegistry(tmp_path).load(out.metadata["model_id"]).predict_proba(daily)
    assert proba.dropna().between(0, 1).all()

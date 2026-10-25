# Model registry

Each trained model lives in its own folder here. The web app scans `models/*/metadata.json` on every request, so adding or removing a folder is all it takes.

```
models/
  xgb_spy_1d_tb_v1/
    metadata.json   # splits, features, label config, threshold, validation metrics, data hash
    model.json      # XGBoost native format
  lstm_spy_1d_fh_v1/
    metadata.json
    model.onnx      # LSTM exported from PyTorch, run with ONNX Runtime
    scaler.json     # feature mean/std fitted on training rows only
```

The committed models (XGBoost with triple-barrier labels and LSTM with fixed-horizon labels for SPY, AAPL, RELIANCE.NS, TCS.NS, BTC/USDT and ETH/USDT) were trained by the "Train models" GitHub Actions workflow on the bundled snapshots; `metadata.json` records the training environment, data hash and library versions.

To train more, use Google Colab with `notebooks/01_train_xgboost.ipynb` and `notebooks/02_train_lstm.ipynb`, or the workflow. Each notebook ends by downloading `<model_id>.zip`; unzip it into this folder and commit it.

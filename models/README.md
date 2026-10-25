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

Train models in Google Colab with `notebooks/01_train_xgboost.ipynb` and `notebooks/02_train_lstm.ipynb`. Each notebook ends by downloading `<model_id>.zip`; unzip it into this folder and commit it.

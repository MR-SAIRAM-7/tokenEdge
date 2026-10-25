"""ML pipeline: datasets, purged CV, training (Colab) and the inference registry (app).

Training entry points live in ``tokenedge.ml.xgb_model`` and ``tokenedge.ml.lstm_model`` and
are imported explicitly, so importing this package never pulls in PyTorch.
"""

from tokenedge.ml.registry import ModelRegistry, get_registry

__all__ = ["ModelRegistry", "get_registry"]

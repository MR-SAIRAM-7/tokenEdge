from tokenedge.strategies import classical, ml_strategy  # noqa: F401  (registers strategies)
from tokenedge.strategies.base import REGISTRY, Strategy, get_strategy, list_strategies
from tokenedge.strategies.classical import BuyHold, SMACrossover
from tokenedge.strategies.ml_strategy import (
    LSTMStrategy,
    MLStrategy,
    SMAMLFilter,
    XGBoostStrategy,
)

__all__ = [
    "REGISTRY",
    "BuyHold",
    "LSTMStrategy",
    "MLStrategy",
    "SMACrossover",
    "SMAMLFilter",
    "Strategy",
    "XGBoostStrategy",
    "get_strategy",
    "list_strategies",
]

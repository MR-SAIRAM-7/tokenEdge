from __future__ import annotations

from fastapi import APIRouter

from tokenedge.api import services
from tokenedge.api.schemas import BacktestRequest, CompareRequest, SensitivityRequest, TuneRequest

router = APIRouter(tags=["backtest"])


@router.post("/backtest")
def backtest(req: BacktestRequest) -> dict:
    return services.backtest(req)


@router.post("/compare")
def compare(req: CompareRequest) -> dict:
    return services.compare(req)


@router.post("/sensitivity")
def sensitivity(req: SensitivityRequest) -> dict:
    return services.sensitivity(req)


@router.post("/tune/sma")
def tune_sma(req: TuneRequest) -> dict:
    return services.tune_sma(req)

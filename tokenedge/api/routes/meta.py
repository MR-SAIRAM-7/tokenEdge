from __future__ import annotations

from fastapi import APIRouter

from tokenedge import __version__
from tokenedge.api.services import git_sha
from tokenedge.config import DEFAULT_SPLITS, DEFAULT_UNIVERSE, get_settings
from tokenedge.data.cache import cache_file, snapshot_file
from tokenedge.engine.costs import COST_PRESETS
from tokenedge.ml.registry import get_registry
from tokenedge.strategies import list_strategies

router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "version": __version__,
        "git_sha": git_sha(),
        "offline": settings.offline,
        "models": len(get_registry().scan()),
        "static": settings.static_dir is not None,
    }


@router.get("/symbols")
def symbols() -> dict:
    settings = get_settings()
    items = []
    for inst in DEFAULT_UNIVERSE:
        items.append(
            {
                "symbol": inst.symbol,
                "source": inst.source,
                "interval": inst.interval,
                "name": inst.name,
                "asset_class": inst.asset_class,
                "snapshot": snapshot_file(
                    settings.snapshot_dir, inst.symbol, inst.interval
                ).exists(),
                "cached": cache_file(
                    settings.data_dir, inst.source, inst.symbol, inst.interval
                ).exists(),
            }
        )
    return {"items": items, "offline": settings.offline}


@router.get("/strategies")
def strategies() -> dict:
    return {"items": list_strategies()}


@router.get("/cost-presets")
def cost_presets() -> dict:
    return {"items": [{"name": k, **v} for k, v in COST_PRESETS.items()]}


@router.get("/splits")
def splits() -> dict:
    return {k: v.as_dict() for k, v in DEFAULT_SPLITS.items()}

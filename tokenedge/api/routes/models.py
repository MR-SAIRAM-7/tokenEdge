from __future__ import annotations

from fastapi import APIRouter

from tokenedge.api import db
from tokenedge.ml.registry import get_registry

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
def list_models() -> dict:
    counts = db.test_evaluation_counts()
    items = get_registry().list()
    for item in items:
        item["test_evaluations"] = counts.get(item["model_id"], 0)
    return {"items": items}


@router.get("/{model_id}")
def get_model(model_id: str) -> dict:
    info = get_registry().info(model_id)
    return {
        **info.metadata,
        "files": sorted(p.name for p in info.path.iterdir() if p.is_file()),
        "test_evaluations": db.test_evaluation_counts().get(model_id, 0),
    }

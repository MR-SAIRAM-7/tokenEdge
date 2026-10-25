from __future__ import annotations

import csv
import io
import json
import zipfile
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from tokenedge.api import db
from tokenedge.api.schemas import RenameRunRequest
from tokenedge.errors import TokenEdgeError

router = APIRouter(prefix="/runs", tags=["runs"])


class RunNotFoundError(TokenEdgeError):
    code = "RUN_NOT_FOUND"
    status = 404


def _get(run_id: str) -> dict:
    run = db.get_run(run_id)
    if run is None:
        raise RunNotFoundError(f"Run '{run_id}' not found.")
    return run


@router.get("")
def list_runs(
    symbol: str | None = None,
    kind: Literal["backtest", "compare"] | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    return db.list_runs(symbol, kind, limit, offset)


@router.get("/{run_id}")
def get_run(run_id: str) -> dict:
    return _get(run_id)


@router.patch("/{run_id}")
def rename_run(run_id: str, req: RenameRunRequest) -> dict:
    if not db.rename_run(run_id, req.name):
        raise RunNotFoundError(f"Run '{run_id}' not found.")
    return {"id": run_id, "name": req.name}


@router.delete("/{run_id}")
def delete_run(run_id: str) -> dict:
    if not db.delete_run(run_id):
        raise RunNotFoundError(f"Run '{run_id}' not found.")
    return {"deleted": run_id}


def _csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return buf.getvalue()


@router.get("/{run_id}/export")
def export_run(run_id: str, format: Literal["json", "csv"] = "json") -> Response:
    run = _get(run_id)
    short = run_id[:8]
    if format == "json":
        return Response(
            json.dumps(run, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="tokenedge_run_{short}.json"'},
        )

    series = run["series"]
    ts = series["timestamp"]
    if run["kind"] == "compare":
        metrics_rows = [{"strategy": k, **v} for k, v in run["metrics"].items()]
        equity_rows = [
            {"timestamp": t, **{f"equity_{k}": v[i] for k, v in series["equity"].items()}}
            for i, t in enumerate(ts)
        ]
        trade_rows = [{"strategy": k, **t} for k, trades in run["trades"].items() for t in trades]
    else:
        metrics_rows = [{"strategy": run["strategy"]["key"], **run["metrics"]}]
        if run.get("benchmark_metrics"):
            metrics_rows.append({"strategy": "buy_hold", **run["benchmark_metrics"]})
        keys = [
            k
            for k in ("equity", "drawdown", "exposure", "close", "benchmark_equity")
            if k in series
        ]
        equity_rows = [
            {"timestamp": t, **{k: series[k][i] for k in keys}} for i, t in enumerate(ts)
        ]
        trade_rows = run["trades"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("metrics.csv", _csv(metrics_rows))
        zf.writestr("equity.csv", _csv(equity_rows))
        zf.writestr("trades.csv", _csv(trade_rows))
        zf.writestr(
            "run.json",
            json.dumps(
                {
                    k: run[k]
                    for k in (
                        "kind",
                        "symbol",
                        "source",
                        "interval",
                        "window",
                        "execution",
                        "data_hash",
                        "git_sha",
                        "model_ids",
                        "in_sample",
                    )
                },
                indent=2,
            ),
        )
    return Response(
        buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="tokenedge_run_{short}.zip"'},
    )

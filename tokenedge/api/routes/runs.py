from __future__ import annotations

import csv
import io
import json
import zipfile
from typing import Literal

from fastapi import APIRouter, Query, Request
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


BUNDLE_FORMAT = "tokenedge.runs"
MAX_IMPORT_BYTES = 64 * 1024 * 1024
_REQUIRED = ("kind", "symbol", "source", "interval", "window", "strategies", "metrics", "data_hash")


class InvalidBundleError(TokenEdgeError):
    code = "INVALID_BUNDLE"
    status = 422


@router.get("/bundle")
def export_bundle(
    ids: str | None = Query(None, description="Comma-separated run IDs; all if empty"),
):
    """Every run (or the given ones) in one JSON file that /runs/import can read back (FR-R3)."""
    wanted = [i for i in (ids or "").split(",") if i] or db.all_run_ids()
    runs = [r for r in (db.get_run(i) for i in wanted) if r is not None]
    body = {"format": BUNDLE_FORMAT, "version": 1, "exported_at": db.utc_now(), "runs": runs}
    return Response(
        json.dumps(body, separators=(",", ":")),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="tokenedge_runs.json"'},
    )


@router.post("/import")
async def import_runs(request: Request) -> dict:
    """Import a bundle from /runs/bundle, or a single run from /runs/{id}/export?format=json."""
    if int(request.headers.get("content-length") or 0) > MAX_IMPORT_BYTES:
        raise InvalidBundleError(f"The file is larger than {MAX_IMPORT_BYTES // 2**20} MB.")
    raw = await request.body()
    if len(raw) > MAX_IMPORT_BYTES:
        raise InvalidBundleError(f"The file is larger than {MAX_IMPORT_BYTES // 2**20} MB.")
    try:
        body = json.loads(raw)
    except ValueError as exc:
        raise InvalidBundleError("The file is not valid JSON.") from exc
    if isinstance(body, dict) and body.get("format") == BUNDLE_FORMAT:
        items = body.get("runs")
    elif isinstance(body, dict) and "kind" in body:
        items = [body]
    else:
        items = None
    if not isinstance(items, list):
        raise InvalidBundleError(
            "Not a TokenEdge run export: expected a run bundle or a single run."
        )

    imported, skipped = [], 0
    for n, run in enumerate(items, start=1):
        missing = [k for k in _REQUIRED if not isinstance(run, dict) or k not in run]
        if missing or run["kind"] not in ("backtest", "compare"):
            raise InvalidBundleError(
                f"Run {n} is incomplete or has an unknown kind.", {"missing": missing}
            )
        run_id = db.import_run(run)
        if run_id is None:
            skipped += 1
        else:
            imported.append(run_id)
    return {"imported": len(imported), "skipped": skipped, "ids": imported}


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

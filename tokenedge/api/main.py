"""FastAPI application: REST API under /api plus the built React app as static files."""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from tokenedge import __version__
from tokenedge.api import db
from tokenedge.api.routes import backtest, data, meta, models, runs
from tokenedge.config import get_settings
from tokenedge.errors import TokenEdgeError

log = logging.getLogger("tokenedge.api")


def _error(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "details": jsonable_encoder(details or {})}
        },
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.session().close()  # creates tables on first start
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="TokenEdge API",
        version=__version__,
        description="Backtesting and signal research: SMA baseline vs XGBoost/LSTM on held-out data.",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        request_id = uuid.uuid4().hex[:8]
        started = time.perf_counter()
        response = await call_next(request)
        if request.url.path.startswith("/api"):
            log.info(
                json.dumps(
                    {
                        "request_id": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "status": response.status_code,
                        "ms": round((time.perf_counter() - started) * 1000, 1),
                    }
                )
            )
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(TokenEdgeError)
    async def tokenedge_error(_: Request, exc: TokenEdgeError):
        return _error(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {}
        where = ".".join(str(x) for x in first.get("loc", []) if x != "body")
        message = (
            f"{where}: {first.get('msg', 'invalid input')}"
            if where
            else first.get("msg", "Invalid input")
        )
        return _error(422, "VALIDATION_ERROR", message, {"errors": errors})

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return _error(500, "INTERNAL_ERROR", f"{type(exc).__name__}: {exc}")

    for router in (meta.router, data.router, models.router, backtest.router, runs.router):
        app.include_router(router, prefix="/api")

    if settings.static_dir and Path(settings.static_dir).exists():
        _mount_spa(app, Path(settings.static_dir))
    return app


def _mount_spa(app: FastAPI, static_dir: Path) -> None:
    assets = static_dir / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
    index = static_dir / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return _error(404, "NOT_FOUND", f"No API route /{full_path}")
        candidate = (static_dir / full_path).resolve()
        if full_path and candidate.is_file() and static_dir.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)


logging.basicConfig(level=logging.INFO, format="%(message)s")
app = create_app()

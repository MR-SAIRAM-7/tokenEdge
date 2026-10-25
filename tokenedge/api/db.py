"""SQLite run history (SQLAlchemy 2.x)."""

from __future__ import annotations

import gzip
import json
import uuid
from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import (
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    create_engine,
    delete,
    func,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from tokenedge.config import get_settings


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    symbol: Mapped[str] = mapped_column(String(40), index=True)
    source: Mapped[str] = mapped_column(String(16))
    interval: Mapped[str] = mapped_column(String(8))
    start_date: Mapped[str] = mapped_column(String(32))
    end_date: Mapped[str] = mapped_column(String(32))
    config_json: Mapped[str] = mapped_column(Text)
    model_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategies: Mapped[str] = mapped_column(Text)
    data_hash: Mapped[str] = mapped_column(String(80))
    git_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)
    in_sample: Mapped[int] = mapped_column(Integer, default=0)
    metrics_json: Mapped[str] = mapped_column(Text)
    result_blob: Mapped[bytes] = mapped_column(LargeBinary)


class TestEvaluation(Base):
    __tablename__ = "test_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String(120), index=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id", ondelete="CASCADE"))
    created_at: Mapped[str] = mapped_column(String(32))


@lru_cache(maxsize=4)
def _session_factory(db_url: str) -> sessionmaker[Session]:
    engine = create_engine(
        db_url, connect_args={"check_same_thread": False} if db_url.startswith("sqlite") else {}
    )
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)


def session() -> Session:
    return _session_factory(get_settings().db_url)()


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def save_run(
    kind: str, request: dict, response: dict, metrics: dict, test_models: list[str]
) -> str:
    run_id = str(uuid.uuid4())
    response["run_id"] = run_id
    response["created_at"] = utc_now()
    blob = gzip.compress(json.dumps(response, separators=(",", ":")).encode("utf-8"))
    run = Run(
        id=run_id,
        created_at=response["created_at"],
        kind=kind,
        name=request.get("name"),
        symbol=request["symbol"],
        source=request["source"],
        interval=request["interval"],
        start_date=response["window"]["start"],
        end_date=response["window"]["end"],
        config_json=json.dumps(request),
        model_ids=json.dumps(response.get("model_ids") or []),
        strategies=json.dumps([s["label"] for s in response["strategies"]]),
        data_hash=response["data_hash"],
        git_sha=response.get("git_sha"),
        in_sample=int(bool(response.get("in_sample"))),
        metrics_json=json.dumps(metrics),
        result_blob=blob,
    )
    with session() as s, s.begin():
        s.add(run)
        s.flush()
        for model_id in test_models:
            s.add(
                TestEvaluation(model_id=model_id, run_id=run_id, created_at=response["created_at"])
            )
    return run_id


def _summary(run: Run) -> dict:
    return {
        "id": run.id,
        "created_at": run.created_at,
        "kind": run.kind,
        "name": run.name,
        "symbol": run.symbol,
        "source": run.source,
        "interval": run.interval,
        "start": run.start_date,
        "end": run.end_date,
        "strategies": json.loads(run.strategies),
        "model_ids": json.loads(run.model_ids or "[]"),
        "in_sample": bool(run.in_sample),
        "metrics": json.loads(run.metrics_json),
        "data_hash": run.data_hash,
    }


def list_runs(
    symbol: str | None = None, kind: str | None = None, limit: int = 50, offset: int = 0
) -> dict:
    with session() as s:
        q = select(Run)
        count_q = select(func.count()).select_from(Run)
        if symbol:
            q = q.where(Run.symbol == symbol)
            count_q = count_q.where(Run.symbol == symbol)
        if kind:
            q = q.where(Run.kind == kind)
            count_q = count_q.where(Run.kind == kind)
        total = s.scalar(count_q) or 0
        rows = s.scalars(q.order_by(Run.created_at.desc()).limit(limit).offset(offset)).all()
        return {"total": int(total), "items": [_summary(r) for r in rows]}


def get_run(run_id: str) -> dict | None:
    with session() as s:
        run = s.get(Run, run_id)
        if run is None:
            return None
        payload = json.loads(gzip.decompress(run.result_blob))
        payload["name"] = run.name
        payload["request"] = json.loads(run.config_json)
        return payload


def rename_run(run_id: str, name: str) -> bool:
    with session() as s, s.begin():
        run = s.get(Run, run_id)
        if run is None:
            return False
        run.name = name
        return True


def delete_run(run_id: str) -> bool:
    with session() as s, s.begin():
        s.execute(delete(TestEvaluation).where(TestEvaluation.run_id == run_id))
        result = s.execute(delete(Run).where(Run.id == run_id))
        return bool(getattr(result, "rowcount", 0))


def test_evaluation_counts() -> dict[str, int]:
    with session() as s:
        rows = s.execute(
            select(TestEvaluation.model_id, func.count()).group_by(TestEvaluation.model_id)
        ).all()
        return {model_id: int(n) for model_id, n in rows}

"""WorkflowRun — the shared durable-workflow run tracker (audit primitive #1).

Every major MIRA action should be *a machine with a dashboard, not a hidden code
path*. This wrapper turns any call-chain into a durable, observable run by
writing one `workflow_runs` row (Hub migration 044) at start, recording each
step in memory, and flushing the final status + step artifacts at exit.

Usage::

    async with WorkflowRun("pdf_ingest", tenant_id=tid, input={"file": name}) as run:
        text   = await run.step("parse",  parse_pdf, file)
        chunks = await run.step("chunk",  chunk_text, text)
        await run.step("store", store_chunks, chunks)
        run.set_output({"chunks": len(chunks)})
    # clean exit  -> status="ok" (or "degraded" if a tolerated step failed)
    # exception   -> status="failed", error_detail captured, then re-raised

Design constraints (mirror decision_trace.py — the established precedent):

- **Fail-open. ALWAYS.** A run-record write failure (NeonDB down, env unset,
  schema drift) must NEVER block, delay, or fail the wrapped work. This includes
  ``__aenter__`` — if the create-row INSERT fails, the body still runs; the run
  simply degrades to "not recorded". The wrapper is observational, not
  load-bearing.
- **Event loop never blocked.** DB writes are offloaded to a worker thread via
  ``run_in_executor`` with a hard timeout. Steps are buffered in memory and
  flushed ONCE at exit — never a DB round-trip per ``step()`` (Phase 2 wraps hot
  paths like ``engine.handle_message``).
- **Lazy imports.** sqlalchemy is imported inside the worker so services without
  it still boot and import this module.
- **Pure state logic.** ``compute_final_status`` / ``build_step_record`` are pure
  functions — the lifecycle is unit-tested without a live NeonDB.

What idempotency_key buys (and what it does NOT):
- A non-NULL key dedups the `workflow_runs` row (ON CONFLICT DO NOTHING on the
  partial unique index); a re-run reuses the existing run_id and bumps
  retry_count instead of inserting a second row.
- ``run.already_succeeded`` lets the caller branch ("skip the work").
- It does **NOT** auto-skip the with-body (a context manager always runs its
  body), and it does **NOT** make a surface's own data-table writes idempotent —
  that is fixed at each surface's INSERT (the audit's anti-pattern #5), not here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional, Union

logger = logging.getLogger("mira.workflow")

# DB writes are bounded so a slow/unreachable NeonDB never stalls the wrapped
# work. Same 2s budget decision_trace uses for its observational insert.
_TIMEOUT_SECONDS = 2

# Cap any single artifact / output payload so a runaway dict can't bloat the row
# or blow the JSONB. Truncation is recorded so it is never silently lossy.
_MAX_JSON_BYTES = 16_000

_VALID_STATUS = ("running", "ok", "degraded", "failed")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _connect_args(url: str) -> dict[str, Any]:
    """SSL connect args for create_engine.

    Neon requires ``sslmode=require``; we default to it (matching
    decision_trace.py) UNLESS the URL already carries an explicit sslmode — that
    lets a local/throwaway Postgres pass ``?sslmode=disable`` for integration
    tests without the wrapper forcing TLS it doesn't have.
    """
    if "sslmode" in url:
        return {}
    return {"sslmode": "require"}


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested without a DB)
# ---------------------------------------------------------------------------


def compute_final_status(exc_type: Optional[type], degraded: bool) -> str:
    """Final run status from the exit condition. Pure.

    Exception during the with-body -> "failed". Clean exit -> "degraded" if any
    tolerated step failed, else "ok".
    """
    status = "failed" if exc_type is not None else ("degraded" if degraded else "ok")
    assert status in _VALID_STATUS  # postcondition: only ever a valid enum value
    return status


def _bounded_json(value: Any) -> Optional[str]:
    """JSON-encode a value, bounding its size. None passes through as None."""
    if value is None:
        return None
    try:
        encoded = json.dumps(value, default=str)
    except (TypeError, ValueError):
        encoded = json.dumps({"_unserializable": str(value)[:_MAX_JSON_BYTES]})
    if len(encoded) > _MAX_JSON_BYTES:
        return json.dumps({"_truncated": True, "preview": encoded[:_MAX_JSON_BYTES]})
    return encoded


def build_step_record(
    *,
    step_name: str,
    status: str,
    started_at: datetime,
    finished_at: datetime,
    artifact: Any = None,
    error: Optional[str] = None,
) -> dict[str, Any]:
    """Assemble one step_artifacts entry. Pure.

    ``artifact`` is stored as a bounded JSON-able summary; large/unserialisable
    values are truncated, never dropped silently.
    """
    rec: dict[str, Any] = {
        "step_name": step_name,
        "status": status,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_ms": int((finished_at - started_at).total_seconds() * 1000),
    }
    if artifact is not None:
        bounded = _bounded_json(artifact)
        # store the parsed form so step_artifacts stays a JSON array, not strings
        rec["artifact"] = json.loads(bounded) if bounded is not None else None
    if error is not None:
        rec["error"] = error[:2000]
    return rec


# ---------------------------------------------------------------------------
# WorkflowRun
# ---------------------------------------------------------------------------


class WorkflowRun:
    """Durable workflow run tracker. See module docstring for usage."""

    def __init__(
        self,
        workflow_name: str,
        *,
        version: str = "1.0.0",
        tenant_id: Optional[str] = None,
        input: Optional[dict] = None,
        idempotency_key: Optional[str] = None,
        retry_count: int = 0,
        db_url: Optional[str] = None,
        log: Optional[logging.Logger] = None,
    ) -> None:
        self.workflow_name = workflow_name
        self.version = version
        self.tenant_id = tenant_id
        self.input = input
        self.idempotency_key = idempotency_key
        self.retry_count = retry_count
        self._db_url = db_url  # None -> resolved from env at write time
        self._log = log or logger

        # Local run_id so in-memory tracking works even when the DB is absent;
        # replaced by the DB's run_id if a row is created/reused.
        self.run_id: str = str(uuid.uuid4())
        self.status: str = "running"
        self.output: Any = None
        self.error_detail: Optional[str] = None
        self.already_succeeded: bool = False
        self._steps: list[dict[str, Any]] = []
        self._degraded: bool = False
        self._recorded: bool = False  # True once a DB row exists for run_id

    # -- public API --------------------------------------------------------

    def set_output(self, value: Any) -> None:
        """Set the run's output payload (flushed at exit)."""
        self.output = value

    async def step(
        self,
        name: str,
        fn: Callable[..., Union[Any, Awaitable[Any]]],
        *args: Any,
        tolerate: bool = False,
        artifact: Optional[Union[Any, Callable[[Any], Any]]] = None,
        **kwargs: Any,
    ) -> Any:
        """Run ``fn(*args, **kwargs)`` as a recorded step; return its result.

        ``fn`` may be sync or async. On success the step is recorded "ok" and the
        result returned. On exception the step is recorded "failed":
        - ``tolerate=False`` (default): re-raise -> run ends "failed".
        - ``tolerate=True``: swallow, mark the run "degraded", return None.

        ``artifact`` is a JSON-able summary, or a callable taking the result and
        returning one. Keep it small — it is bounded to ~16 KB.
        """
        started = _utcnow()
        try:
            result = fn(*args, **kwargs)
            if asyncio.iscoroutine(result) or asyncio.isfuture(result):
                result = await result
        except Exception as exc:  # noqa: BLE001 — record then propagate per tolerate
            self._steps.append(
                build_step_record(
                    step_name=name,
                    status="failed",
                    started_at=started,
                    finished_at=_utcnow(),
                    error=str(exc),
                )
            )
            self._log.warning("workflow %s step %s failed: %s", self.workflow_name, name, exc)
            if tolerate:
                self._degraded = True
                return None
            raise

        resolved_artifact = artifact(result) if callable(artifact) else artifact
        self._steps.append(
            build_step_record(
                step_name=name,
                status="ok",
                started_at=started,
                finished_at=_utcnow(),
                artifact=resolved_artifact,
            )
        )
        return result

    def record_step(
        self,
        name: str,
        status: str,
        *,
        artifact: Any = None,
        error: Optional[str] = None,
        started_at: Optional[datetime] = None,
        finished_at: Optional[datetime] = None,
    ) -> None:
        """Record a step that doesn't fit the ``step(fn)`` call-wrap shape.

        ``status="failed"`` marks the run degraded (the caller chose to continue).
        """
        now = _utcnow()
        if status == "failed":
            self._degraded = True
        self._steps.append(
            build_step_record(
                step_name=name,
                status=status,
                started_at=started_at or now,
                finished_at=finished_at or now,
                artifact=artifact,
                error=error,
            )
        )

    # -- context manager ---------------------------------------------------

    async def __aenter__(self) -> "WorkflowRun":
        await self._create_row()
        self._log.info(
            "workflow %s v%s started (run_id=%s tenant=%s)",
            self.workflow_name,
            self.version,
            self.run_id,
            self.tenant_id,
        )
        return self

    async def __aexit__(self, exc_type, exc, _tb) -> bool:  # noqa: ANN001
        self.status = compute_final_status(exc_type, self._degraded)
        if exc_type is not None and self.error_detail is None:
            self.error_detail = f"{getattr(exc_type, '__name__', exc_type)}: {exc}"
        await self._finalize()
        level = logging.ERROR if self.status == "failed" else logging.INFO
        self._log.log(
            level,
            "workflow %s finished status=%s (run_id=%s steps=%d)",
            self.workflow_name,
            self.status,
            self.run_id,
            len(self._steps),
        )
        return False  # never suppress the wrapped exception

    # -- DB writes (fail-open, executor-offloaded, bounded) ----------------

    def _url(self) -> Optional[str]:
        return self._db_url or os.environ.get("NEON_DATABASE_URL")

    async def _create_row(self) -> None:
        """Insert (or reuse, on idempotency conflict) the run row. Fail-open."""
        if not self._url():
            return  # run-record storage disabled — purely in-memory
        try:
            await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(None, self._create_row_sync),
                timeout=_TIMEOUT_SECONDS,
            )
        except Exception as exc:  # noqa: BLE001
            self._log.warning("workflow run create skipped (degraded to in-memory): %s", exc)

    def _finalize(self) -> Awaitable[None]:
        async def _run() -> None:
            if not self._recorded or not self._url():
                return  # no row to update (never created) — nothing to flush
            try:
                await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(None, self._finalize_sync),
                    timeout=_TIMEOUT_SECONDS,
                )
            except Exception as exc:  # noqa: BLE001
                self._log.warning("workflow run finalize skipped: %s", exc)

        return _run()

    def _create_row_sync(self) -> None:
        url = self._url()
        if not url:
            return
        from sqlalchemy import create_engine
        from sqlalchemy import text as sql_text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args=_connect_args(url),
            pool_pre_ping=True,
        )
        params = {
            "run_id": self.run_id,
            "workflow_name": self.workflow_name,
            "workflow_version": self.version,
            "tenant_id": self.tenant_id,
            "input": _bounded_json(self.input),
            "idempotency_key": self.idempotency_key,
            "retry_count": self.retry_count,
        }
        with engine.begin() as conn:
            row = conn.execute(
                sql_text(
                    """
                    INSERT INTO workflow_runs
                      (run_id, workflow_name, workflow_version, tenant_id,
                       status, input, idempotency_key, retry_count)
                    VALUES
                      (CAST(:run_id AS UUID), :workflow_name, :workflow_version,
                       :tenant_id, 'running', CAST(:input AS JSONB),
                       :idempotency_key, :retry_count)
                    ON CONFLICT (idempotency_key)
                      WHERE idempotency_key IS NOT NULL
                      DO NOTHING
                    RETURNING run_id
                    """
                ),
                params,
            ).fetchone()

            if row is not None:
                self.run_id = str(row[0])
                self._recorded = True
                return

            # Conflict: a row with this idempotency_key already exists. Read its
            # prior outcome (to surface already_succeeded), then reuse the row and
            # bump retry_count — one logical run, re-executed, never a 2nd row.
            existing = conn.execute(
                sql_text("SELECT run_id, status FROM workflow_runs WHERE idempotency_key = :k"),
                {"k": self.idempotency_key},
            ).fetchone()
            if existing is None:
                return  # raced away; degrade to in-memory
            self.run_id = str(existing[0])
            self.already_succeeded = existing[1] == "ok"
            updated = conn.execute(
                sql_text(
                    """
                    UPDATE workflow_runs
                       SET retry_count = retry_count + 1,
                           status = 'running',
                           started_at = NOW(),
                           finished_at = NULL
                     WHERE run_id = CAST(:run_id AS UUID)
                    RETURNING retry_count
                    """
                ),
                {"run_id": self.run_id},
            ).fetchone()
            if updated is not None:
                self.retry_count = int(updated[0])
            self._recorded = True

    def _finalize_sync(self) -> None:
        url = self._url()
        if not url:
            return
        from sqlalchemy import create_engine
        from sqlalchemy import text as sql_text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args=_connect_args(url),
            pool_pre_ping=True,
        )
        with engine.begin() as conn:
            conn.execute(
                sql_text(
                    """
                    UPDATE workflow_runs
                       SET status = :status,
                           output = CAST(:output AS JSONB),
                           error_detail = :error_detail,
                           step_artifacts = CAST(:step_artifacts AS JSONB),
                           finished_at = NOW()
                     WHERE run_id = CAST(:run_id AS UUID)
                    """
                ),
                {
                    "run_id": self.run_id,
                    "status": self.status,
                    "output": _bounded_json(self.output),
                    "error_detail": (self.error_detail or None),
                    "step_artifacts": json.dumps(self._steps, default=str),
                },
            )

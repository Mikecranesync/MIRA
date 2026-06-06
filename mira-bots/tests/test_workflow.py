"""Tests for the shared WorkflowRun primitive (Hub migration 044).

Two layers:
- Pure helpers (compute_final_status / build_step_record / _bounded_json) — no DB.
- Lifecycle with NEON_DATABASE_URL unset/bogus — proves fail-open: the wrapped
  work always runs and status tracks in-memory even when the run record can't be
  written.

A real-Postgres round-trip lives in test_workflow_round_trip(); it skips unless
WORKFLOW_TEST_DATABASE_URL points at a throwaway database (CHARLIE has no psql;
run it on demand against an ephemeral pg). The pure + in-memory tests below run
anywhere and are the regression floor.
"""

from __future__ import annotations

import os

import pytest

from shared import workflow as wf
from shared.workflow import WorkflowRun, build_step_record, compute_final_status

# A URL that fails to connect fast — exercises the fail-open path without a 2s
# wait (connection refused / no driver both resolve quickly and are caught).
_BOGUS_URL = "postgresql://u:p@127.0.0.1:1/nope"


# --------------------------------------------------------------------------- #
# Pure helpers
# --------------------------------------------------------------------------- #


def test_compute_final_status_clean_ok():
    assert compute_final_status(None, False) == "ok"


def test_compute_final_status_clean_degraded():
    assert compute_final_status(None, True) == "degraded"


def test_compute_final_status_exception_failed():
    # Exception always wins, even if a step was tolerated.
    assert compute_final_status(ValueError, True) == "failed"


def test_build_step_record_ok_shape():
    t0 = wf._utcnow()
    t1 = wf._utcnow()
    rec = build_step_record(step_name="parse", status="ok", started_at=t0, finished_at=t1)
    assert rec["step_name"] == "parse"
    assert rec["status"] == "ok"
    assert "duration_ms" in rec and rec["duration_ms"] >= 0
    assert "error" not in rec and "artifact" not in rec


def test_build_step_record_error_truncated():
    t = wf._utcnow()
    rec = build_step_record(
        step_name="x", status="failed", started_at=t, finished_at=t, error="E" * 5000
    )
    assert rec["status"] == "failed"
    assert len(rec["error"]) == 2000


def test_build_step_record_artifact_is_json_value():
    t = wf._utcnow()
    rec = build_step_record(
        step_name="x", status="ok", started_at=t, finished_at=t, artifact={"chunks": 7}
    )
    # stored as a parsed JSON value, not a string
    assert rec["artifact"] == {"chunks": 7}


def test_bounded_json_none_passthrough():
    assert wf._bounded_json(None) is None


def test_bounded_json_truncates_oversized():
    big = {"blob": "z" * (wf._MAX_JSON_BYTES + 100)}
    out = wf._bounded_json(big)
    assert out is not None and '"_truncated": true' in out


def test_bounded_json_unserialisable_is_not_dropped():
    class Weird:
        pass

    out = wf._bounded_json({"obj": Weird()})
    # default=str makes it serialisable; never raises, never empty
    assert out is not None and "obj" in out


# --------------------------------------------------------------------------- #
# Lifecycle — in-memory (NEON unset) and fail-open (bogus URL)
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _no_neon(monkeypatch):
    """Default every test to run-record storage DISABLED."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)


async def test_happy_path_records_steps_in_memory():
    async with WorkflowRun("unit_test", tenant_id="t1", input={"k": 1}) as run:
        out = await run.step("double", lambda x: x * 2, 21)
        assert out == 42
        run.set_output({"answer": out})

    assert run.status == "ok"
    assert run.run_id  # a local uuid even with no DB
    assert run._recorded is False  # no DB row created
    assert [s["step_name"] for s in run._steps] == ["double"]
    assert run._steps[0]["status"] == "ok"
    assert run.output == {"answer": 42}


async def test_async_step_is_awaited():
    async def fetch():
        return "value"

    async with WorkflowRun("unit_test") as run:
        result = await run.step("fetch", fetch)
    assert result == "value"
    assert run.status == "ok"


async def test_tolerated_step_failure_degrades():
    def boom():
        raise RuntimeError("nope")

    async with WorkflowRun("unit_test") as run:
        result = await run.step("boom", boom, tolerate=True)
        assert result is None

    assert run.status == "degraded"
    assert run._steps[0]["status"] == "failed"
    assert "nope" in run._steps[0]["error"]


async def test_untolerated_step_failure_fails_and_propagates():
    def boom():
        raise ValueError("kaboom")

    with pytest.raises(ValueError, match="kaboom"):
        async with WorkflowRun("unit_test") as run:
            await run.step("boom", boom)

    assert run.status == "failed"
    assert run.error_detail is not None and "kaboom" in run.error_detail
    assert run._steps[0]["status"] == "failed"


async def test_record_step_failed_marks_degraded():
    async with WorkflowRun("unit_test") as run:
        run.record_step("manual", "failed", error="partial")
    assert run.status == "degraded"
    assert run._steps[0]["error"] == "partial"


async def test_record_step_ok_stays_ok():
    async with WorkflowRun("unit_test") as run:
        run.record_step("manual", "ok", artifact={"n": 3})
    assert run.status == "ok"
    assert run._steps[0]["artifact"] == {"n": 3}


async def test_artifact_callable_resolved_with_result():
    async with WorkflowRun("unit_test") as run:
        await run.step("make", lambda: [1, 2, 3], artifact=lambda r: {"count": len(r)})
    assert run._steps[0]["artifact"] == {"count": 3}


async def test_fail_open_create_row_does_not_break_body(monkeypatch):
    """A broken NEON URL must NOT prevent the body from running."""
    monkeypatch.setenv("NEON_DATABASE_URL", _BOGUS_URL)
    ran = []
    async with WorkflowRun("unit_test", tenant_id="t1") as run:
        await run.step("work", lambda: ran.append(True))
    assert ran == [True]
    assert run.status == "ok"
    assert run._recorded is False  # create failed → degraded to in-memory


async def test_idempotency_key_stored_without_db():
    async with WorkflowRun("unit_test", idempotency_key="abc-123") as run:
        pass
    assert run.idempotency_key == "abc-123"
    assert run.already_succeeded is False  # nothing to dedup against w/o a DB


# --------------------------------------------------------------------------- #
# Real-Postgres round-trip — opt-in via WORKFLOW_TEST_DATABASE_URL
# --------------------------------------------------------------------------- #


@pytest.mark.skipif(
    not os.environ.get("WORKFLOW_TEST_DATABASE_URL"),
    reason="set WORKFLOW_TEST_DATABASE_URL to a throwaway pg with migration 044 applied",
)
async def test_workflow_round_trip(monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy import text as sql_text
    from sqlalchemy.pool import NullPool

    url = os.environ["WORKFLOW_TEST_DATABASE_URL"]
    monkeypatch.setenv("NEON_DATABASE_URL", url)

    key = "round-trip-" + wf.uuid.uuid4().hex

    async with WorkflowRun(
        "round_trip", tenant_id="t1", input={"a": 1}, idempotency_key=key
    ) as run:
        await run.step("s1", lambda: 1)
        run.set_output({"done": True})
    first_run_id = run.run_id
    assert run.status == "ok"
    assert run._recorded is True

    engine = create_engine(url, poolclass=NullPool, connect_args=wf._connect_args(url))
    with engine.connect() as conn:
        row = conn.execute(
            sql_text(
                "SELECT status, output, step_artifacts, retry_count "
                "FROM workflow_runs WHERE run_id = CAST(:r AS UUID)"
            ),
            {"r": first_run_id},
        ).fetchone()
    assert row is not None
    assert row[0] == "ok"
    assert row[1] == {"done": True}
    assert len(row[2]) == 1 and row[2][0]["step_name"] == "s1"
    assert row[3] == 0

    # Re-run with the same idempotency_key: reuses the row, bumps retry_count,
    # surfaces already_succeeded — does NOT insert a 2nd row.
    async with WorkflowRun("round_trip", tenant_id="t1", idempotency_key=key) as run2:
        assert run2.run_id == first_run_id
        assert run2.already_succeeded is True
        await run2.step("s1b", lambda: 2)
    assert run2.retry_count == 1

    with engine.connect() as conn:
        count = conn.execute(
            sql_text("SELECT COUNT(*) FROM workflow_runs WHERE idempotency_key = :k"),
            {"k": key},
        ).scalar()
    assert count == 1  # idempotent: one row, not two

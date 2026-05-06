"""Tests for Atlas WO retry + durable outbox (Unit 8 — CRA-17).

Covers:
- ``atlas_cmms.create_work_order`` retry behaviour: 5xx/timeout retried,
  4xx not retried, eventual success ends retry loop.
- Outbox enqueue happens once after ``_MAX_ATTEMPTS`` consecutive failures.
- ``wo_outbox.drain_once`` marks rows sent on successful resubmit and
  fires the admin-alert callback once for rows older than
  ``ALERT_AFTER_SECONDS``.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "mira-bots"))

from shared.integrations import wo_outbox  # noqa: E402
from shared.integrations.atlas_cmms import AtlasCMMSClient  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _http_status_error(status_code: int, body: str = "boom") -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://test/api/cmms/work-orders")
    response = httpx.Response(status_code, request=request, text=body)
    return httpx.HTTPStatusError(f"HTTP {status_code}", request=request, response=response)


@pytest.fixture
def db(tmp_path, monkeypatch):
    """Point the outbox at a fresh per-test SQLite file."""
    db_path = tmp_path / "outbox.db"
    monkeypatch.setenv("MIRA_DB_PATH", str(db_path))
    return str(db_path)


@pytest.fixture
def client(db, monkeypatch):
    """AtlasCMMSClient with no real httpx use — _post_work_order is mocked
    per-test.

    Also collapses the retry sleep so tests don't burn the 1+2 = 3 seconds
    of real backoff between attempts.
    """
    monkeypatch.setattr("shared.integrations.atlas_cmms._BASE_BACKOFF", 0.0)
    return AtlasCMMSClient(base_url="http://test", api_key="x")


# ---------------------------------------------------------------------------
# Retry behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_attempt_success_no_retry_no_outbox(client, db):
    with patch.object(
        client, "_post_work_order", new=AsyncMock(return_value={"id": 42, "title": "ok"})
    ) as post:
        result = await client.create_work_order(title="t", description="d")
    assert result == {"id": 42, "title": "ok"}
    assert post.await_count == 1
    assert wo_outbox.stats(db_path=db)["total"] == 0


@pytest.mark.asyncio
async def test_5xx_retried_then_succeeds(client, db):
    attempts = AsyncMock(side_effect=[
        _http_status_error(503, "service unavailable"),
        _http_status_error(502, "bad gateway"),
        {"id": 7},
    ])
    with patch.object(client, "_post_work_order", new=attempts):
        result = await client.create_work_order(title="t", description="d")
    assert result == {"id": 7}
    assert attempts.await_count == 3
    assert wo_outbox.stats(db_path=db)["total"] == 0


@pytest.mark.asyncio
async def test_5xx_three_failures_enqueues_outbox(client, db):
    attempts = AsyncMock(side_effect=[
        _http_status_error(503),
        _http_status_error(503),
        _http_status_error(503),
    ])
    with patch.object(client, "_post_work_order", new=attempts):
        result = await client.create_work_order(title="late wo", description="d")
    assert "error" in result
    assert "outbox_id" in result
    assert attempts.await_count == 3

    rows = wo_outbox.list_pending(db_path=db)
    assert len(rows) == 1
    assert rows[0].payload["title"] == "late wo"
    assert "503" in (rows[0].last_error or "")


@pytest.mark.asyncio
async def test_4xx_not_retried_no_outbox(client, db):
    """Auth/validation errors are permanent — retry would be wasted work."""
    attempts = AsyncMock(side_effect=[_http_status_error(401, "unauthorized")])
    with patch.object(client, "_post_work_order", new=attempts):
        result = await client.create_work_order(title="t", description="d")
    assert "error" in result
    assert "outbox_id" not in result
    assert attempts.await_count == 1
    assert wo_outbox.stats(db_path=db)["total"] == 0


@pytest.mark.asyncio
async def test_timeout_retried_then_outbox(client, db):
    attempts = AsyncMock(side_effect=[
        httpx.TimeoutException("read"),
        httpx.TimeoutException("read"),
        httpx.TimeoutException("read"),
    ])
    with patch.object(client, "_post_work_order", new=attempts):
        result = await client.create_work_order(title="timing", description="d")
    assert "outbox_id" in result
    assert attempts.await_count == 3
    rows = wo_outbox.list_pending(db_path=db)
    assert len(rows) == 1
    assert "TimeoutException" in (rows[0].last_error or "")


@pytest.mark.asyncio
async def test_connect_error_retried_then_outbox(client, db):
    attempts = AsyncMock(side_effect=[
        httpx.ConnectError("refused"),
        httpx.ConnectError("refused"),
        httpx.ConnectError("refused"),
    ])
    with patch.object(client, "_post_work_order", new=attempts):
        result = await client.create_work_order(title="net", description="d")
    assert "outbox_id" in result
    assert attempts.await_count == 3


# ---------------------------------------------------------------------------
# Outbox primitives
# ---------------------------------------------------------------------------


def test_enqueue_then_list_pending_round_trip(db):
    rid = wo_outbox.enqueue({"title": "x", "description": "d"}, "boom", db_path=db)
    rows = wo_outbox.list_pending(db_path=db)
    assert len(rows) == 1
    assert rows[0].id == rid
    assert rows[0].payload == {"title": "x", "description": "d"}
    assert rows[0].attempts == 1
    assert rows[0].last_error == "boom"


def test_mark_sent_excludes_from_pending(db):
    rid = wo_outbox.enqueue({"title": "x", "description": "d"}, "boom", db_path=db)
    wo_outbox.mark_sent(rid, atlas_wo_id=999, db_path=db)
    assert wo_outbox.list_pending(db_path=db) == []
    assert wo_outbox.stats(db_path=db)["sent"] == 1


def test_mark_attempt_increments_counter_and_updates_error(db):
    rid = wo_outbox.enqueue({"title": "x", "description": "d"}, "first", db_path=db)
    wo_outbox.mark_attempt(rid, "second", db_path=db)
    wo_outbox.mark_attempt(rid, "third", db_path=db)
    rows = wo_outbox.list_pending(db_path=db)
    assert rows[0].attempts == 3
    assert rows[0].last_error == "third"


# ---------------------------------------------------------------------------
# Drain behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drain_once_marks_sent_when_submit_succeeds(db):
    wo_outbox.enqueue({"title": "x", "description": "d"}, "boom", db_path=db)

    async def submit_ok(payload: dict) -> dict:
        return {"id": 1234}

    result = await wo_outbox.drain_once(submit_ok, db_path=db)
    assert result == {"sent": 1, "still_pending": 0, "newly_alerted": 0}
    assert wo_outbox.list_pending(db_path=db) == []


@pytest.mark.asyncio
async def test_drain_once_marks_attempt_when_submit_returns_error(db):
    wo_outbox.enqueue({"title": "x", "description": "d"}, "boom", db_path=db)

    async def submit_fail(payload: dict) -> dict:
        return {"error": "still down"}

    result = await wo_outbox.drain_once(submit_fail, db_path=db)
    assert result == {"sent": 0, "still_pending": 1, "newly_alerted": 0}
    rows = wo_outbox.list_pending(db_path=db)
    assert rows[0].attempts == 2  # was 1 from enqueue, now 2
    assert rows[0].last_error == "still down"


@pytest.mark.asyncio
async def test_drain_once_handles_submit_raising(db):
    """A buggy submit_fn that raises must not abort the entire drain pass."""
    wo_outbox.enqueue({"title": "x", "description": "d"}, "boom", db_path=db)

    async def submit_raise(payload: dict) -> dict:
        raise RuntimeError("kaboom")

    result = await wo_outbox.drain_once(submit_raise, db_path=db)
    assert result["still_pending"] == 1
    rows = wo_outbox.list_pending(db_path=db)
    assert "submit_fn raised" in (rows[0].last_error or "")


@pytest.mark.asyncio
async def test_alert_fires_once_for_stale_row(db):
    rid = wo_outbox.enqueue({"title": "old", "description": "d"}, "boom", db_path=db)

    async def submit_fail(payload: dict) -> dict:
        return {"error": "atlas still down"}

    alerts: list[int] = []

    async def alert_fn(row):
        alerts.append(row.id)

    fake_now = time.time() + wo_outbox.ALERT_AFTER_SECONDS + 60
    await wo_outbox.drain_once(submit_fail, alert_fn, db_path=db, now=fake_now)
    await wo_outbox.drain_once(submit_fail, alert_fn, db_path=db, now=fake_now + 1)

    assert alerts == [rid]


@pytest.mark.asyncio
async def test_alert_does_not_fire_for_fresh_row(db):
    wo_outbox.enqueue({"title": "fresh", "description": "d"}, "boom", db_path=db)

    async def submit_fail(payload: dict) -> dict:
        return {"error": "atlas still down"}

    alerts: list[int] = []

    async def alert_fn(row):
        alerts.append(row.id)

    await wo_outbox.drain_once(submit_fail, alert_fn, db_path=db)
    assert alerts == []

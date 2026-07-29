"""Tests for PhotoBatchQueue — the SQLite-backed photo-burst queue.

Covers bounds (per-burst cap, queue-depth cap), FIFO ordering, caption
preservation across photos in a burst, and recovery of orphaned
``processing`` rows on worker restart.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "mira-bots"))

from shared.photo_batch_queue import (  # noqa: E402
    BURST_WINDOW_SECONDS,  # noqa: F401  (re-export sanity)
    MAX_PHOTOS_PER_BURST,
    MAX_QUEUE_DEPTH,
    BurstFull,
    PhotoBatchQueue,
    PhotoBatchRecord,
    QueueFull,
)
from shared.photo_handler import DEFAULT_PHOTO_CAPTION  # noqa: E402


@pytest.fixture
def queue(tmp_path):
    db = tmp_path / "photo_batches.db"
    q = PhotoBatchQueue(str(db))
    yield q
    q.close()


# --- producer side ----------------------------------------------------------


@pytest.mark.asyncio
async def test_first_photo_creates_collecting_batch(queue):
    batch_id, count = await queue.add_photo_to_burst(
        chat_id="42", platform="telegram", photo_b64="aGVsbG8=", caption="VFD pump"
    )
    assert batch_id > 0
    assert count == 1
    stats = queue.stats()
    assert stats == {"collecting": 1}


@pytest.mark.asyncio
async def test_second_photo_joins_existing_burst(queue):
    bid1, _ = await queue.add_photo_to_burst("42", "telegram", "aaaa", "first cap")
    bid2, count = await queue.add_photo_to_burst("42", "telegram", "bbbb", DEFAULT_PHOTO_CAPTION)
    assert bid1 == bid2
    assert count == 2


@pytest.mark.asyncio
async def test_first_real_caption_survives_default_followups(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "aa", "VFD pump-3 alarm 47")
    await queue.add_photo_to_burst("42", "telegram", "bb", DEFAULT_PHOTO_CAPTION)
    await queue.add_photo_to_burst("42", "telegram", "cc", DEFAULT_PHOTO_CAPTION)

    await queue.close_burst(bid)
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    assert rec.caption == "VFD pump-3 alarm 47"


@pytest.mark.asyncio
async def test_burst_cap_enforced(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "p1", "cap")
    for _ in range(MAX_PHOTOS_PER_BURST - 1):
        await queue.add_photo_to_burst("42", "telegram", "p", DEFAULT_PHOTO_CAPTION)
    with pytest.raises(BurstFull):
        await queue.add_photo_to_burst("42", "telegram", "overflow", DEFAULT_PHOTO_CAPTION)


@pytest.mark.asyncio
async def test_different_chats_do_not_share_burst(queue):
    bid_a, _ = await queue.add_photo_to_burst("A", "telegram", "a1", "alpha")
    bid_b, _ = await queue.add_photo_to_burst("B", "telegram", "b1", "bravo")
    assert bid_a != bid_b


# --- queue-depth cap --------------------------------------------------------


@pytest.mark.asyncio
async def test_queue_full_raises(queue):
    open_ids = []
    for chat in range(MAX_QUEUE_DEPTH):
        bid, _ = await queue.add_photo_to_burst(
            chat_id=f"chat-{chat}", platform="telegram", photo_b64="x", caption="c"
        )
        await queue.close_burst(bid)
        open_ids.append(bid)

    bid_full, _ = await queue.add_photo_to_burst(
        chat_id="chat-overflow", platform="telegram", photo_b64="x", caption="c"
    )
    with pytest.raises(QueueFull):
        await queue.close_burst(bid_full)


# --- consumer side ----------------------------------------------------------


@pytest.mark.asyncio
async def test_dequeue_returns_oldest_queued_first(queue):
    bid_a, _ = await queue.add_photo_to_burst("A", "telegram", "a1", "first")
    bid_b, _ = await queue.add_photo_to_burst("B", "telegram", "b1", "second")
    await queue.close_burst(bid_a)
    await asyncio.sleep(0.01)
    await queue.close_burst(bid_b)

    rec1 = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    rec2 = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    assert rec1.id == bid_a
    assert rec2.id == bid_b


@pytest.mark.asyncio
async def test_dequeue_blocks_until_close(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "a", "c")

    async def closer():
        await asyncio.sleep(0.05)
        await queue.close_burst(bid)

    closer_task = asyncio.create_task(closer())
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    await closer_task
    assert rec.id == bid
    assert isinstance(rec, PhotoBatchRecord)


@pytest.mark.asyncio
async def test_close_burst_idempotent(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "a", "c")
    assert await queue.close_burst(bid) is True
    assert await queue.close_burst(bid) is False


@pytest.mark.asyncio
async def test_mark_done_records_reply(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "a", "c")
    await queue.close_burst(bid)
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    await queue.mark_done(rec.id, "diagnosis: replace bearing on pump-3")

    row = queue._conn.execute(
        "SELECT status, reply_text FROM photo_batches WHERE id = ?", (rec.id,)
    ).fetchone()
    assert row[0] == "done"
    assert row[1] == "diagnosis: replace bearing on pump-3"


@pytest.mark.asyncio
async def test_mark_failed_records_error(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "a", "c")
    await queue.close_burst(bid)
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    await queue.mark_failed(rec.id, "vision pipeline timeout after 90s")

    row = queue._conn.execute(
        "SELECT status, error_message FROM photo_batches WHERE id = ?", (rec.id,)
    ).fetchone()
    assert row[0] == "failed"
    assert "vision pipeline timeout" in row[1]


# --- recovery ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_recover_orphans_resets_processing_to_queued(tmp_path):
    db = tmp_path / "photo_batches.db"
    q1 = PhotoBatchQueue(str(db))
    bid, _ = await q1.add_photo_to_burst("42", "telegram", "a", "c")
    await q1.close_burst(bid)
    rec = await asyncio.wait_for(q1.dequeue(), timeout=1.0)
    assert rec.id == bid
    assert q1.stats() == {"processing": 1}
    q1.close()

    q2 = PhotoBatchQueue(str(db))
    n = await q2.recover_orphans()
    assert n == 1
    assert q2.stats() == {"queued": 1}

    rec_again = await asyncio.wait_for(q2.dequeue(), timeout=1.0)
    assert rec_again.id == bid
    q2.close()


@pytest.mark.asyncio
async def test_recover_orphans_renotifies_existing_queued(tmp_path):
    db = tmp_path / "photo_batches.db"
    q1 = PhotoBatchQueue(str(db))
    bid, _ = await q1.add_photo_to_burst("42", "telegram", "a", "c")
    await q1.close_burst(bid)
    q1.close()

    q2 = PhotoBatchQueue(str(db))
    await q2.recover_orphans()
    rec = await asyncio.wait_for(q2.dequeue(), timeout=1.0)
    assert rec.id == bid
    q2.close()


# --- ack message id ---------------------------------------------------------


@pytest.mark.asyncio
async def test_ack_message_id_round_trip(queue):
    bid, _ = await queue.add_photo_to_burst(
        "42", "telegram", "a", "c", ack_message_id=12345
    )
    await queue.close_burst(bid)
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    assert rec.ack_message_id == 12345


@pytest.mark.asyncio
async def test_ack_message_id_can_be_set_late(queue):
    bid, _ = await queue.add_photo_to_burst("42", "telegram", "a", "c")
    await queue.set_ack_message(bid, 99999)
    await queue.close_burst(bid)
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)
    assert rec.ack_message_id == 99999


@pytest.mark.asyncio
async def test_raw_photo_payload_round_trips_separately_from_resized(queue):
    bid, _ = await queue.add_photo_to_burst(
        "42",
        "telegram",
        "resized-page-1",
        "what do these mean together",
        raw_photo_b64="raw-page-1",
    )
    await queue.add_photo_to_burst(
        "42",
        "telegram",
        "resized-page-2",
        DEFAULT_PHOTO_CAPTION,
        raw_photo_b64="raw-page-2",
    )

    await queue.close_burst(bid)
    rec = await asyncio.wait_for(queue.dequeue(), timeout=1.0)

    assert rec.photos_b64 == ["resized-page-1", "resized-page-2"]
    assert rec.raw_photos_b64 == ["raw-page-1", "raw-page-2"]

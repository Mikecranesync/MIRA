"""Discovery→ingestion lifecycle ledger: "seen" means **successfully ingested**.

## The defect this replaces

`tasks/rss.py` recorded a GUID as seen, and `tasks/sitemaps.py` persisted a
`lastmod`, **immediately after `ingest_url.delay(...)` returned** — i.e. after
the item was *enqueued*, not after it was ingested. Enqueue only proves a
message reached the broker. Everything that can go wrong afterwards —
curation refusal, a download 404, an embedding failure, a worker crash — leaves
the item marked permanently processed and never ingested. It is invisible,
because the producer's own logs say "queued" and the counter went up.

The CU-03 curation gate makes this worse rather than better: it adds a *new*
rejection path downstream of the enqueue, so more items get marked seen while
being refused.

## The lifecycle

```
discovered ─▶ pending ─▶ committed          (ingestion verified in the corpus)
                 │
                 ├─▶ retryable   (still pending; re-enqueued after the TTL)
                 └─▶ dead-letter (permanent rejection, with a reason, not retried)
```

**Committed is not self-reported.** A producer cannot mark its own work
successful; `reconcile()` promotes `pending → committed` only when the URL is
actually present in `knowledge_entries`. The corpus is the authority, which is
the one definition of "ingested" that cannot drift from reality.

That choice also keeps `tasks/ingest.py` untouched: no callback, no result
backend, no extra task kwarg threaded through Celery. It costs one batched
`SELECT` per poll.

## Properties

* **Idempotent across restarts.** State is keyed by a stable id (GUID / URL).
  Re-running `mark_pending` on an item already pending or committed is a no-op.
* **A crash after enqueue does not suppress the item.** It stays `pending`; once
  `PENDING_TTL_SEC` elapses without appearing in the corpus, it becomes eligible
  again and is re-enqueued by the next poll.
* **Duplicate delivery does not duplicate chunks.** Dedup stays where it already
  is (`ingest.store.chunk_exists`, keyed on `source_url` + `chunk_index`); the
  ledger never inserts anything.
* **Permanent rejection is explicit.** Dead-lettered items carry a reason and
  are not retried, so a refused source cannot spin forever.

Redis layout, per flow (`kind` is ``rss`` or ``sitemaps``):

| key | type | holds |
|---|---|---|
| ``mira:{kind}:pending`` | hash | id → ``{"url", "first_seen", "attempts", "meta"}`` |
| ``mira:{kind}:committed`` | hash | id → ``{"url", "committed_at", "meta"}`` |
| ``mira:{kind}:deadletter`` | hash | id → ``{"url", "reason", "failed_at"}`` |
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Iterable, Optional

logger = logging.getLogger("mira-crawler.ingest.ledger")

__all__ = [
    "PENDING_TTL_SEC",
    "MAX_ATTEMPTS",
    "pending_key",
    "committed_key",
    "deadletter_key",
    "mark_pending",
    "is_settled",
    "eligible_for_enqueue",
    "reconcile",
    "committed_meta",
]

#: How long an item may sit pending before it is considered lost and re-enqueued.
#: Sized above the worst-case Celery retry ladder in `tasks/ingest.py`
#: (3 retries, exponential backoff capped at 300 s) so a normally-retrying item
#: is not re-enqueued underneath itself.
PENDING_TTL_SEC = 6 * 3600

#: Re-enqueue attempts before an item is dead-lettered as permanently stuck.
MAX_ATTEMPTS = 3


def pending_key(kind: str) -> str:
    return f"mira:{kind}:pending"


def committed_key(kind: str) -> str:
    return f"mira:{kind}:committed"


def deadletter_key(kind: str) -> str:
    return f"mira:{kind}:deadletter"


def _load(raw: Any) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {}


def is_settled(r, kind: str, item_id: str) -> bool:
    """True when the item needs no further work — committed or dead-lettered."""
    try:
        if r.hexists(committed_key(kind), item_id):
            return True
        return bool(r.hexists(deadletter_key(kind), item_id))
    except Exception as exc:  # fail OPEN: a Redis outage must not wedge polling
        logger.warning("ledger is_settled failed for %s/%s: %s", kind, item_id, exc)
        return False


def eligible_for_enqueue(r, kind: str, item_id: str, *, now: Optional[float] = None) -> bool:
    """True when this item should be enqueued on this poll.

    Eligible when it is **not settled** and either has never been seen, or has
    been pending longer than the TTL (the crash-after-enqueue case — the message
    is gone and nothing will ever settle it).
    """
    if is_settled(r, kind, item_id):
        return False
    now = time.time() if now is None else now
    try:
        rec = _load(r.hget(pending_key(kind), item_id))
    except Exception as exc:
        logger.warning("ledger eligible check failed for %s/%s: %s", kind, item_id, exc)
        return True  # fail OPEN toward doing the work
    if not rec:
        return True
    return (now - float(rec.get("first_seen", 0))) > PENDING_TTL_SEC


def mark_pending(
    r,
    kind: str,
    item_id: str,
    url: str,
    *,
    meta: Optional[dict] = None,
    now: Optional[float] = None,
) -> None:
    """Record that ``item_id`` was enqueued. **This is not success.**

    Idempotent: re-marking an already-pending item preserves its original
    ``first_seen`` (so the TTL measures age, not the last poll) and increments
    ``attempts``.
    """
    now = time.time() if now is None else now
    try:
        rec = _load(r.hget(pending_key(kind), item_id))
        rec = {
            "url": url,
            "first_seen": rec.get("first_seen", now),
            "attempts": int(rec.get("attempts", 0)) + 1,
            "last_enqueued": now,
            "meta": meta or rec.get("meta") or {},
        }
        r.hset(pending_key(kind), item_id, json.dumps(rec))
    except Exception as exc:
        logger.warning("ledger mark_pending failed for %s/%s: %s", kind, item_id, exc)


def committed_meta(r, kind: str, item_id: str) -> dict:
    """Metadata stored alongside a commit (e.g. a sitemap's ``lastmod``)."""
    try:
        return _load(r.hget(committed_key(kind), item_id)).get("meta") or {}
    except Exception:
        return {}


def reconcile(
    r,
    kind: str,
    *,
    ingested_urls: Iterable[str],
    now: Optional[float] = None,
) -> dict:
    """Settle pending items against reality.

    ``ingested_urls`` is the set of source URLs **verified present in the
    corpus** — supplied by the caller so this module never opens a DB
    connection and stays trivially testable.

    * present in the corpus            → **committed**
    * pending past the TTL, attempts left → left pending; the next poll re-enqueues
    * pending past the TTL, attempts exhausted → **dead-lettered** (`stuck`)

    Returns counts: ``committed``, ``retryable``, ``dead_lettered``.
    """
    now = time.time() if now is None else now
    ingested = set(ingested_urls)
    out = {"committed": 0, "retryable": 0, "dead_lettered": 0}
    try:
        pending = r.hgetall(pending_key(kind)) or {}
    except Exception as exc:
        logger.warning("ledger reconcile could not read pending for %s: %s", kind, exc)
        return out

    for item_id, raw in pending.items():
        rec = _load(raw)
        url = rec.get("url", "")
        try:
            if url in ingested:
                r.hset(
                    committed_key(kind),
                    item_id,
                    json.dumps({"url": url, "committed_at": now, "meta": rec.get("meta") or {}}),
                )
                r.hdel(pending_key(kind), item_id)
                out["committed"] += 1
                continue

            age = now - float(rec.get("first_seen", now))
            if age <= PENDING_TTL_SEC:
                continue  # still in flight; not our business yet

            if int(rec.get("attempts", 0)) >= MAX_ATTEMPTS:
                r.hset(
                    deadletter_key(kind),
                    item_id,
                    json.dumps(
                        {
                            "url": url,
                            "reason": f"stuck pending > {PENDING_TTL_SEC}s after "
                            f"{rec.get('attempts')} attempts — never appeared in the corpus",
                            "failed_at": now,
                        }
                    ),
                )
                r.hdel(pending_key(kind), item_id)
                out["dead_lettered"] += 1
                logger.warning("Dead-lettered %s/%s (%s)", kind, item_id, url[:80])
            else:
                out["retryable"] += 1
        except Exception as exc:
            logger.warning("ledger reconcile failed for %s/%s: %s", kind, item_id, exc)

    if any(out.values()):
        logger.info("ledger reconcile %s: %s", kind, out)
    return out


def dead_letter(
    r, kind: str, item_id: str, url: str, reason: str, *, now: Optional[float] = None
) -> None:
    """Record a permanent rejection — a refusal that retrying cannot fix."""
    now = time.time() if now is None else now
    try:
        r.hset(
            deadletter_key(kind),
            item_id,
            json.dumps({"url": url, "reason": reason, "failed_at": now}),
        )
        r.hdel(pending_key(kind), item_id)
        logger.info("Dead-lettered %s/%s: %s", kind, item_id, reason)
    except Exception as exc:
        logger.warning("ledger dead_letter failed for %s/%s: %s", kind, item_id, exc)

"""Gate 7 — "seen" means successfully ingested, for RSS and sitemaps.

Six scenarios per flow: success, curation rejection, transient failure, worker
crash, retry, duplicate delivery.

The defect these lock: both flows marked an item permanently processed
**immediately after `ingest_url.delay(...)` returned**. Enqueue proves a broker
accepted a message; it proves nothing about ingestion. Every downstream failure —
curation refusal, 404, embedding error, worker crash — left the item recorded as
done and never ingested, invisibly, because the producer's own log said "queued".

No Redis server and no database: a fake Redis implements the hash/set surface the
ledger uses, and corpus membership is injected, so every scenario is deterministic.
"""

from __future__ import annotations

import json

import pytest
from ingest import ingest_ledger as ledger


class FakeRedis:
    """Just enough Redis: hashes + sets, with the decode_responses=True shape."""

    def __init__(self) -> None:
        self.h: dict[str, dict[str, str]] = {}
        self.s: dict[str, set[str]] = {}

    # hashes
    def hset(self, key, field=None, value=None, mapping=None):
        d = self.h.setdefault(key, {})
        if mapping:
            d.update({str(k): str(v) for k, v in mapping.items()})
        if field is not None:
            d[str(field)] = str(value)

    def hget(self, key, field):
        return self.h.get(key, {}).get(str(field))

    def hgetall(self, key):
        return dict(self.h.get(key, {}))

    def hexists(self, key, field):
        return str(field) in self.h.get(key, {})

    def hdel(self, key, field):
        self.h.get(key, {}).pop(str(field), None)

    # sets
    def sadd(self, key, *vals):
        self.s.setdefault(key, set()).update(str(v) for v in vals)

    def smembers(self, key):
        return set(self.s.get(key, set()))


KIND = "rss"
URL = "https://feed.invalid/article-1"
GUID = "guid-1"


def _pending(r, kind=KIND):
    return r.hgetall(ledger.pending_key(kind))


def _committed(r, kind=KIND):
    return r.hgetall(ledger.committed_key(kind))


def _dead(r, kind=KIND):
    return r.hgetall(ledger.deadletter_key(kind))


# ---------------------------------------------------------------------------
# The ledger contract — the six scenarios, flow-agnostic
# ---------------------------------------------------------------------------


class TestLifecycleScenarios:
    def test_1_success_commits_only_after_the_corpus_confirms(self):
        r = FakeRedis()
        ledger.mark_pending(r, KIND, GUID, URL)

        # Enqueued is NOT seen.
        assert _pending(r) and not _committed(r)
        assert ledger.is_settled(r, KIND, GUID) is False

        ledger.reconcile(r, KIND, ingested_urls={URL})

        assert not _pending(r)
        assert GUID in _committed(r)
        assert ledger.is_settled(r, KIND, GUID) is True

    def test_2_curation_rejection_dead_letters_and_is_not_retried(self):
        r = FakeRedis()
        ledger.mark_pending(r, KIND, GUID, URL)
        ledger.dead_letter(r, KIND, GUID, URL, reason="uncurated_source")

        assert not _pending(r)
        assert not _committed(r), "a refused item must never be recorded as ingested"
        assert json.loads(_dead(r)[GUID])["reason"] == "uncurated_source"
        assert ledger.eligible_for_enqueue(r, KIND, GUID) is False, "must not spin forever"

    def test_3_transient_failure_stays_pending_and_is_not_marked_seen(self):
        r = FakeRedis()
        ledger.mark_pending(r, KIND, GUID, URL, now=1_000.0)

        # Ingestion failed; the URL never reached the corpus.
        ledger.reconcile(r, KIND, ingested_urls=set(), now=1_000.0 + 60)

        assert GUID in _pending(r)
        assert not _committed(r)
        # Inside the TTL the retry ladder owns it — don't re-enqueue underneath it.
        assert ledger.eligible_for_enqueue(r, KIND, GUID, now=1_000.0 + 60) is False

    def test_4_worker_crash_after_enqueue_does_not_suppress_the_item(self):
        """The crash case: the message is gone, nothing will ever settle it."""
        r = FakeRedis()
        ledger.mark_pending(r, KIND, GUID, URL, now=1_000.0)

        later = 1_000.0 + ledger.PENDING_TTL_SEC + 1
        assert ledger.eligible_for_enqueue(r, KIND, GUID, now=later) is True
        assert not _committed(r), "a crashed item must never look successful"

    def test_5_retry_preserves_age_and_exhausts_into_dead_letter(self):
        r = FakeRedis()
        ledger.mark_pending(r, KIND, GUID, URL, now=1_000.0)
        for i in range(1, ledger.MAX_ATTEMPTS):
            ledger.mark_pending(r, KIND, GUID, URL, now=1_000.0 + i)

        rec = json.loads(_pending(r)[GUID])
        assert rec["first_seen"] == 1_000.0, "TTL must measure age, not the last poll"
        assert rec["attempts"] == ledger.MAX_ATTEMPTS

        stale = 1_000.0 + ledger.PENDING_TTL_SEC + 1
        ledger.reconcile(r, KIND, ingested_urls=set(), now=stale)

        assert GUID in _dead(r), "attempts exhausted -> dead-letter, not infinite retry"
        assert not _committed(r)

    def test_6_duplicate_delivery_is_idempotent(self):
        r = FakeRedis()
        ledger.mark_pending(r, KIND, GUID, URL)
        ledger.reconcile(r, KIND, ingested_urls={URL})

        # The same item arrives again — a duplicate broker delivery, or a
        # re-poll of an unchanged feed.
        ledger.mark_pending(r, KIND, GUID, URL)
        ledger.reconcile(r, KIND, ingested_urls={URL})

        assert len(_committed(r)) == 1, "duplicate delivery must not duplicate state"
        assert ledger.eligible_for_enqueue(r, KIND, GUID) is False, (
            "a committed item must not be re-enqueued — that is what prevents duplicate chunks"
        )

    def test_redis_outage_fails_open_toward_doing_the_work(self):
        """A ledger outage must not wedge polling, nor fabricate a commit."""

        class Broken(FakeRedis):
            def hexists(self, *a, **k):
                raise RuntimeError("redis down")

            def hget(self, *a, **k):
                raise RuntimeError("redis down")

        r = Broken()
        assert ledger.eligible_for_enqueue(r, KIND, GUID) is True
        assert ledger.is_settled(r, KIND, GUID) is False


# ---------------------------------------------------------------------------
# Both production flows: nothing is marked successful at enqueue time
# ---------------------------------------------------------------------------


class TestProductionFlowsDoNotCommitAtEnqueue:
    def test_rss_marks_pending_not_seen(self, monkeypatch):
        """End to end through the real task: enqueue records PENDING, not seen."""
        pytest.importorskip("feedparser", reason="tasks/rss.py imports feedparser at module scope")
        from unittest.mock import MagicMock, patch

        import tasks.rss as rss

        r = FakeRedis()
        sample = (
            '<?xml version="1.0"?><rss version="2.0"><channel>'
            f"<item><title>t</title><link>{URL}</link><guid>{GUID}</guid></item>"
            "</channel></rss>"
        )
        resp = MagicMock()
        resp.text = sample
        resp.content = sample.encode()
        resp.status_code = 200
        resp.raise_for_status = MagicMock()

        monkeypatch.setattr(rss, "RSS_FEEDS", [{"name": "f", "url": "https://feed.invalid/rss"}])
        with (
            patch.object(rss, "_get_redis", return_value=r),
            patch.object(rss.httpx, "get", return_value=resp),
            patch("tasks.ingest.ingest_url", MagicMock()),
        ):
            rss.poll_rss_feeds()

        assert GUID in _pending(r, "rss"), "enqueue must record PENDING"
        assert not _committed(r, "rss"), "enqueue must NOT record success"
        assert GUID not in r.smembers(rss._REDIS_SEEN_KEY), (
            "the legacy enqueue-time seen-set must not be written any more"
        )

    @pytest.mark.parametrize("fname,kind", [("rss.py", "rss"), ("sitemaps.py", "sitemaps")])
    def test_flow_declares_a_ledger_namespace(self, fname, kind):
        """Structural, so it fences without the feed/celery deps installed."""
        import ast
        import pathlib

        src = pathlib.Path(__file__).resolve().parents[1] / "tasks" / fname
        tree = ast.parse(src.read_text(encoding="utf-8", errors="replace"))
        found = {
            t.id: n.value.value
            for n in ast.walk(tree)
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant)
            for t in n.targets
            if isinstance(t, ast.Name)
        }
        assert found.get("_LEDGER_KIND") == kind

    @pytest.mark.parametrize("fname", ["rss.py", "sitemaps.py"])
    def test_flow_marks_pending_at_enqueue(self, fname):
        """Both flows must record PENDING at enqueue, and consult the ledger."""
        import pathlib

        src = (pathlib.Path(__file__).resolve().parents[1] / "tasks" / fname).read_text()
        assert "ledger.mark_pending(" in src, f"{fname} must record PENDING at enqueue"
        assert "eligible_for_enqueue(" in src, f"{fname} must consult the ledger before enqueue"

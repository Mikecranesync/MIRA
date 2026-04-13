"""RSS task — poll RSS/Atom feeds and queue new entries for ingest."""
from __future__ import annotations

import logging

import feedparser
import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

try:
    from mira_crawler.tasks._shared import get_redis
except ImportError:
    from tasks._shared import get_redis

logger = logging.getLogger("mira-crawler.tasks.rss")

# Module-level alias so tests can patch via patch.object(rss_mod, "_get_redis", ...)
_get_redis = get_redis

# ---------------------------------------------------------------------------
# Feed registry — industrial maintenance sources
# ---------------------------------------------------------------------------

RSS_FEEDS: list[dict] = [
    {
        "name": "Fluke Blog",
        "url": "https://www.fluke.com/en-us/learn/blog/rss",
    },
    {
        "name": "Plant Services",
        "url": "https://www.plantservices.com/rss/all",
    },
    {
        "name": "ReliabilityWeb",
        "url": "https://reliabilityweb.com/rss.xml",
    },
    {
        "name": "Maintenance Phoenix",
        "url": "https://maintenancephoenix.com/feed/",
    },
    {
        "name": "ABB News",
        "url": "https://new.abb.com/news/rss",
    },
    {
        "name": "Emerson Automation Experts",
        "url": "https://www.emersonautomationexperts.com/feed/",
    },
    {
        "name": "SKF Evolution",
        "url": "https://evolution.skf.com/feed/",
    },
    {
        "name": "Machinery Lubrication",
        "url": "https://www.machinerylubrication.com/rss/All",
    },
    {
        "name": "Efficient Plant",
        "url": "https://www.efficientplantmag.com/feed/",
    },
    {
        "name": "Automation World",
        "url": "https://www.automationworld.com/rss.xml",
    },
]

# Redis key for GUID deduplication
_REDIS_SEEN_KEY = "mira:rss:seen_guids"

# HTTP fetch timeout in seconds
_FETCH_TIMEOUT = 20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_feed(content: str) -> list[dict]:
    """Parse RSS/Atom feed content and return a list of entry dicts.

    Each entry contains: title, url, guid, summary.
    Entries missing a usable URL are silently dropped.
    """
    try:
        parsed = feedparser.parse(content)
    except Exception as exc:
        logger.warning("feedparser raised an exception: %s", exc)
        return []

    entries: list[dict] = []
    for entry in parsed.get("entries", []):
        url = entry.get("link", "").strip()
        if not url:
            continue

        # Prefer id/guid over link as the dedup key
        guid = entry.get("id", "").strip() or url

        title = entry.get("title", "").strip()
        summary = entry.get("summary", "").strip()

        entries.append(
            {
                "title": title,
                "url": url,
                "guid": guid,
                "summary": summary,
            }
        )

    return entries


def _filter_new_entries(entries: list[dict], seen_guids: set[str]) -> list[dict]:
    """Return only entries whose GUID is not in *seen_guids*."""
    return [e for e in entries if e["guid"] not in seen_guids]


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.rss.poll_rss_feeds")
def poll_rss_feeds() -> dict:
    """Poll all RSS_FEEDS, detect new entries, and queue them for ingest.

    Steps:
      1. Load seen GUIDs from Redis set ``mira:rss:seen_guids``.
      2. For each feed: fetch via httpx, parse with feedparser, filter new.
      3. For each new entry: call ``ingest_url.delay()`` and immediately
         persist the GUID to Redis (incremental dedup — M2 fix).
      4. Return summary counts.
    """
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    # 1. Load seen GUIDs
    try:
        r = _get_redis()
        seen_guids: set[str] = r.smembers(_REDIS_SEEN_KEY)  # type: ignore[assignment]
    except Exception as exc:
        logger.error("Redis connection failed — aborting poll_rss_feeds: %s", exc)
        return {"feeds_checked": 0, "new_articles": 0, "error": str(exc)}

    feeds_checked = 0
    new_articles = 0

    for feed in RSS_FEEDS:
        feed_name = feed["name"]
        feed_url = feed["url"]

        # 2. Fetch feed
        try:
            resp = httpx.get(
                feed_url,
                timeout=_FETCH_TIMEOUT,
                follow_redirects=True,
                headers={"User-Agent": "MIRA-RSSBot/1.0 (KB builder)"},
            )
            resp.raise_for_status()
            content = resp.text
        except Exception as exc:
            logger.warning("Failed to fetch feed %r (%s): %s", feed_name, feed_url[:60], exc)
            continue

        feeds_checked += 1

        # 3. Parse + filter
        entries = _parse_feed(content)
        new_entries = _filter_new_entries(entries, seen_guids)

        logger.info(
            "Feed %r: %d entries, %d new",
            feed_name,
            len(entries),
            len(new_entries),
        )

        # 4. Queue new entries — persist each GUID to Redis immediately after
        #    successful queue so a mid-run crash does not lose dedup state (M2).
        for entry in new_entries:
            try:
                ingest_url.delay(url=entry["url"], source_type="rss_article")
                r.sadd(_REDIS_SEEN_KEY, entry["guid"])  # incremental persist
                seen_guids.add(entry["guid"])            # within-run dedup
                new_articles += 1
            except Exception as exc:
                logger.warning(
                    "Failed to queue entry %r from %r: %s",
                    entry["url"][:80],
                    feed_name,
                    exc,
                )

    logger.info(
        "poll_rss_feeds complete: %d feeds checked, %d new articles queued",
        feeds_checked,
        new_articles,
    )
    return {"feeds_checked": feeds_checked, "new_articles": new_articles}

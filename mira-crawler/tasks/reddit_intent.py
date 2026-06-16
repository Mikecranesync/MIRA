"""Reddit intent scanner — surfaces buying-signal posts to Mike via Telegram.

Runs every 6h via Celery Beat. Scans a fixed list of maintenance/automation
subreddits for keyword matches, scores each result with Groq, stores
``intent_score >= 60`` rows in NeonDB, and alerts on ``>= 75``.

Uses public Reddit JSON endpoints (no OAuth) — same convention as
``tasks.reddit``. Dedup via Redis (90-day TTL) plus NeonDB unique constraint.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app  # type: ignore[no-redef]

try:
    from mira_crawler.tasks._intent_scorer import score_intent
    from mira_crawler.tasks._intent_store import insert_signal
    from mira_crawler.tasks._shared import REDIS_SEEN_TTL_SEC, get_redis
except ImportError:
    from tasks._intent_scorer import score_intent  # type: ignore[no-redef]
    from tasks._intent_store import insert_signal  # type: ignore[no-redef]
    from tasks._shared import REDIS_SEEN_TTL_SEC, get_redis  # type: ignore[no-redef]

logger = logging.getLogger("mira-crawler.tasks.reddit_intent")

SUBREDDITS: list[str] = [
    "PLC",
    "maintenance",
    "manufacturing",
    "IndustrialAutomation",
    "SCADA",
    "ControlTheory",
    "industrialengineering",
    "Ignition",
    "automationtechnology",
]

KEYWORDS: list[str] = [
    "CMMS recommendation",
    "maintenance software",
    "looking for CMMS",
    "alternative to MaintainX",
    "alternative to UpKeep",
    "alternative to Limble",
    "alternative to Fiix",
    "digital transformation manufacturing",
    "digitize maintenance",
    "paper work orders",
    "replace paper",
    "PLC troubleshooting",
    "fault code",
    "Allen Bradley alarm",
    "Micro820",
    "VFD fault",
    "predictive maintenance",
    "PM schedule software",
    "preventive maintenance tracking",
    "maintenance knowledge base",
    "tribal knowledge",
    "technician training",
    "QR code asset",
    "equipment tracking",
    "asset management small manufacturer",
]

_REDIS_SEEN_KEY = "mira:intent:reddit:seen"
_TELEGRAM_ALERT_THRESHOLD = 75
_PERSIST_THRESHOLD = 60
_REDDIT_REQ_DELAY_S = 1.1  # 60 req/min ceiling


def _user_agent() -> str:
    username = os.environ.get("REDDIT_USERNAME", "mike")
    return f"mira-intent-monitor/0.1 by /u/{username}"


def _search_subreddit(client: httpx.Client, sub: str, keyword: str) -> list[dict]:
    """Search one subreddit for a keyword. Returns raw post dicts."""
    url = (
        f"https://www.reddit.com/r/{sub}/search.json"
        f"?q={httpx.QueryParams({'q': keyword})['q']}"
        f"&restrict_sr=1&sort=new&t=week&limit=25"
    )
    try:
        resp = client.get(url, timeout=15)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("reddit search failed (%s, %s): %s", sub, keyword, exc)
        return []

    try:
        children = resp.json().get("data", {}).get("children", [])
    except ValueError:
        return []

    posts: list[dict] = []
    for child in children:
        data = (child or {}).get("data") or {}
        post_id = data.get("id", "").strip()
        if not post_id:
            continue
        posts.append(
            {
                "post_id": post_id,
                "subreddit": data.get("subreddit", sub),
                "title": (data.get("title") or "").strip(),
                "selftext": (data.get("selftext") or "").strip(),
                "author": data.get("author", ""),
                "permalink": data.get("permalink", ""),
            }
        )
    return posts


def _notify_telegram(post: dict, score: int, category: str, reply: str) -> None:
    try:
        from mira_crawler.reporting.telegram_notify import notify
    except ImportError:
        try:
            from reporting.telegram_notify import notify  # type: ignore[no-redef]
        except ImportError:
            logger.debug("telegram_notify unavailable — skipping alert")
            return

    url = f"https://reddit.com{post['permalink']}"
    msg = (
        f"🔥 *Reddit intent signal* (score {score} / {category})\n\n"
        f"r/{post['subreddit']} — _{post['title'][:140]}_\n\n"
        f"u/{post['author']}\n"
        f"{url}\n\n"
        f"*Suggested reply:* {reply or '_(none)_'}"
    )
    notify("intent_scout", msg)


@app.task(
    name="tasks.reddit_intent.scan_reddit_intent",
    bind=True,
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    max_retries=2,
)
def scan_reddit_intent(self, max_posts_per_query: Optional[int] = None) -> dict:  # noqa: ARG001
    """Scan subreddits for buying-intent posts.

    Returns a summary dict (logged + usable in tests).
    """
    redis = None
    try:
        redis = get_redis()
    except Exception as exc:
        logger.warning("Redis unavailable — dedup degraded to DB-only: %s", exc)

    seen_ids: set[str] = set()
    if redis is not None:
        try:
            seen_ids = set(redis.smembers(_REDIS_SEEN_KEY))
        except Exception as exc:
            logger.warning("smembers failed: %s", exc)

    stats = {
        "queries_run": 0,
        "posts_seen": 0,
        "scored": 0,
        "persisted": 0,
        "alerted": 0,
        "errors": 0,
    }

    headers = {"User-Agent": _user_agent()}
    with httpx.Client(headers=headers) as client:
        for sub in SUBREDDITS:
            for kw in KEYWORDS:
                stats["queries_run"] += 1
                posts = _search_subreddit(client, sub, kw)
                if max_posts_per_query:
                    posts = posts[:max_posts_per_query]

                for post in posts:
                    stats["posts_seen"] += 1
                    pid = post["post_id"]
                    if pid in seen_ids:
                        continue
                    seen_ids.add(pid)

                    title = post["title"]
                    body = post["selftext"]
                    if not title and not body:
                        continue

                    score, category, reply = score_intent(
                        title=title,
                        content=body,
                        source_hint=f"reddit r/{post['subreddit']}",
                    )
                    stats["scored"] += 1

                    if score < _PERSIST_THRESHOLD:
                        continue

                    inserted = insert_signal(
                        source="reddit",
                        platform_id=pid,
                        url=f"https://reddit.com{post['permalink']}",
                        intent_score=score,
                        intent_category=category,
                        suggested_reply=reply,
                        author=post["author"],
                        author_profile_url=f"https://reddit.com/u/{post['author']}"
                        if post["author"]
                        else None,
                        title=title,
                        content=body,
                    )
                    if inserted:
                        stats["persisted"] += 1

                    if score >= _TELEGRAM_ALERT_THRESHOLD and inserted:
                        _notify_telegram(post, score, category, reply)
                        stats["alerted"] += 1

                time.sleep(_REDDIT_REQ_DELAY_S)

    if redis is not None and seen_ids:
        try:
            redis.sadd(_REDIS_SEEN_KEY, *seen_ids)
            redis.expire(_REDIS_SEEN_KEY, REDIS_SEEN_TTL_SEC)
        except Exception as exc:
            logger.warning("redis sadd failed: %s", exc)

    logger.info("reddit_intent done: %s", stats)
    return stats

"""YouTube comment intent scanner.

Runs daily. Strategy keeps YouTube Data API v3 quota under 2K units/day:

  * 8 keyword searches × 100 units = 800 units
  * Channel video pulls = cached after first run; quota varies
  * commentThreads.list = 1 unit per call

Top-level comments scored via Groq. Score >= 60 persists; >= 75 alerts.
"""

from __future__ import annotations

import logging
import os
from typing import Iterable

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

logger = logging.getLogger("mira-crawler.tasks.youtube_intent")

_YT_BASE = "https://www.googleapis.com/youtube/v3"
_REDIS_SEEN_KEY = "mira:intent:youtube:seen"
_TELEGRAM_ALERT_THRESHOLD = 75
_PERSIST_THRESHOLD = 60

# Channel handles map to the actual YouTube channel IDs (resolved once via
# search.list?type=channel&q=<handle>). Listed by display name + handle so a
# human can spot-check the mapping; ID is what the API needs.
MONITORED_CHANNELS: dict[str, str] = {
    "Walker Reynolds (4.0 Solutions)": "UCcOhZxq3vqXkPRrYWVdJOMw",
    "RealPars": "UC1zZE_kJ8rQHgLTVfobLi_g",
    "Rockwell Automation": "UCfO5_VkM3wHvW2nO_pUKnHA",
    "Inductive Automation": "UCQjFm-XSDw1xVqVw0pE3MUg",
    "MaintainX": "UCcvqj8GgzPSjLi3jBlCqVAQ",
    "UpKeep": "UCnDt2tIVNZ_yLpUNbiZAhpQ",
    "Limble CMMS": "UC2llXbtbWFM-z4awzVl-FFA",
    "The Automation Blog": "UCD2K8qb7yFs7-bExVMnFypg",
}

# Keep top-N keywords most likely to surface buying intent (search.list is
# the expensive call at 100 units each — cap aggressively).
SEARCH_KEYWORDS: list[str] = [
    "CMMS recommendation",
    "looking for CMMS",
    "alternative to MaintainX",
    "alternative to UpKeep",
    "digitize maintenance paper work orders",
    "preventive maintenance software small shop",
    "PLC troubleshooting CMMS",
    "Allen Bradley fault code maintenance",
]


def _yt_get(client: httpx.Client, path: str, params: dict, api_key: str) -> dict:
    params = {**params, "key": api_key}
    try:
        resp = client.get(f"{_YT_BASE}/{path}", params=params, timeout=20)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as exc:
        logger.warning("youtube %s failed: %s", path, exc)
        return {}


def _search_videos(client: httpx.Client, api_key: str, keyword: str) -> list[str]:
    data = _yt_get(
        client,
        "search",
        {
            "part": "snippet",
            "q": keyword,
            "type": "video",
            "maxResults": 10,
            "order": "date",
            "publishedAfter": _published_after_iso(days=7),
        },
        api_key,
    )
    out: list[str] = []
    for item in data.get("items", []):
        vid = (item.get("id") or {}).get("videoId")
        if vid:
            out.append(vid)
    return out


def _channel_videos(client: httpx.Client, api_key: str, channel_id: str) -> list[str]:
    data = _yt_get(
        client,
        "search",
        {
            "part": "snippet",
            "channelId": channel_id,
            "type": "video",
            "maxResults": 5,
            "order": "date",
        },
        api_key,
    )
    out: list[str] = []
    for item in data.get("items", []):
        vid = (item.get("id") or {}).get("videoId")
        if vid:
            out.append(vid)
    return out


def _comment_threads(client: httpx.Client, api_key: str, video_id: str) -> list[dict]:
    data = _yt_get(
        client,
        "commentThreads",
        {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": 50,
            "order": "relevance",
            "textFormat": "plainText",
        },
        api_key,
    )
    out: list[dict] = []
    for item in data.get("items", []):
        snip = (
            (item.get("snippet") or {})
            .get("topLevelComment", {})
            .get("snippet", {})
        )
        cid = (
            (item.get("snippet") or {}).get("topLevelComment", {}).get("id")
            or item.get("id", "")
        )
        if not cid:
            continue
        out.append(
            {
                "comment_id": cid,
                "video_id": video_id,
                "author": snip.get("authorDisplayName", ""),
                "author_channel_url": snip.get("authorChannelUrl", ""),
                "text": snip.get("textDisplay", ""),
            }
        )
    return out


def _published_after_iso(days: int) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _notify_telegram(item: dict, score: int, category: str, reply: str) -> None:
    try:
        from mira_crawler.reporting.telegram_notify import notify
    except ImportError:
        try:
            from reporting.telegram_notify import notify  # type: ignore[no-redef]
        except ImportError:
            return

    url = f"https://youtube.com/watch?v={item['video_id']}&lc={item['comment_id']}"
    msg = (
        f"🔥 *YouTube intent signal* (score {score} / {category})\n\n"
        f"@{item['author']}: _{item['text'][:200]}_\n\n"
        f"{url}\n\n"
        f"*Suggested reply:* {reply or '_(none)_'}"
    )
    notify("intent_scout", msg)


def _all_video_ids(client: httpx.Client, api_key: str) -> Iterable[str]:
    """Union of recent search-hit videos and monitored-channel uploads."""
    seen: set[str] = set()
    for kw in SEARCH_KEYWORDS:
        for vid in _search_videos(client, api_key, kw):
            if vid not in seen:
                seen.add(vid)
                yield vid
    for cid in MONITORED_CHANNELS.values():
        for vid in _channel_videos(client, api_key, cid):
            if vid not in seen:
                seen.add(vid)
                yield vid


@app.task(
    name="tasks.youtube_intent.scan_youtube_intent",
    bind=True,
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    max_retries=2,
)
def scan_youtube_intent(self) -> dict:  # noqa: ARG001
    api_key = os.environ.get("YOUTUBE_DATA_API_KEY", "")
    if not api_key:
        logger.warning("YOUTUBE_DATA_API_KEY not set — task skipped")
        return {"error": "missing_api_key"}

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
        "videos_scanned": 0,
        "comments_seen": 0,
        "scored": 0,
        "persisted": 0,
        "alerted": 0,
    }

    with httpx.Client() as client:
        for vid in _all_video_ids(client, api_key):
            stats["videos_scanned"] += 1
            threads = _comment_threads(client, api_key, vid)
            for item in threads:
                stats["comments_seen"] += 1
                cid = item["comment_id"]
                if cid in seen_ids:
                    continue
                seen_ids.add(cid)

                text = item["text"]
                if not text:
                    continue

                score, category, reply = score_intent(
                    title="",
                    content=text,
                    source_hint=f"youtube video {vid}",
                )
                stats["scored"] += 1

                if score < _PERSIST_THRESHOLD:
                    continue

                inserted = insert_signal(
                    source="youtube",
                    platform_id=cid,
                    url=f"https://youtube.com/watch?v={vid}&lc={cid}",
                    intent_score=score,
                    intent_category=category,
                    suggested_reply=reply,
                    author=item["author"],
                    author_profile_url=item["author_channel_url"] or None,
                    title=None,
                    content=text,
                )
                if inserted:
                    stats["persisted"] += 1
                if score >= _TELEGRAM_ALERT_THRESHOLD and inserted:
                    _notify_telegram(item, score, category, reply)
                    stats["alerted"] += 1

    if redis is not None and seen_ids:
        try:
            redis.sadd(_REDIS_SEEN_KEY, *seen_ids)
            redis.expire(_REDIS_SEEN_KEY, REDIS_SEEN_TTL_SEC)
        except Exception as exc:
            logger.warning("redis sadd failed: %s", exc)

    logger.info("youtube_intent done: %s", stats)
    return stats

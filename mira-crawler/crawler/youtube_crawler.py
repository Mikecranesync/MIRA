"""YouTube video discovery crawler using YouTube Data API v3.

Searches configured keyword seeds, ranks results by engagement, and
writes new video records to NeonDB youtube_videos table for downstream
transcript + keyframe processing.

Quota management:
  - 10,000 units/day free tier
  - Each search costs 100 units → max ~100 searches/day
  - Daily counter tracked in Redis (youtube:api_quota:YYYY-MM-DD)
  - Discovery skips if counter >= QUOTA_PAUSE_THRESHOLD (9,500)
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta

import httpx
import yaml

logger = logging.getLogger("mira-crawler.youtube")

_SOURCES_YAML = os.path.join(os.path.dirname(__file__), "..", "sources.yaml")

# Stop discovery for the day when this close to the quota ceiling
QUOTA_PAUSE_THRESHOLD = int(os.getenv("YOUTUBE_QUOTA_PAUSE", "9500"))
# Units consumed per search request
_SEARCH_COST = 100
# Units consumed per videos.list call (1 per video)
_VIDEO_DETAIL_COST = 1

_YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
# Videos published within this many days are eligible
_MAX_AGE_DAYS = int(os.getenv("YOUTUBE_MAX_AGE_DAYS", "1825"))  # 5 years


def _load_keywords() -> list[str]:
    """Load YouTube keyword seeds from sources.yaml."""
    try:
        with open(_SOURCES_YAML) as f:
            data = yaml.safe_load(f)
        return data.get("youtube", {}).get("keywords", [])
    except Exception as e:
        logger.error("Failed to load sources.yaml: %s", e)
        return []


def _redis_client():
    """Return a Redis client using CELERY_BROKER_URL."""
    import redis

    url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    return redis.from_url(url, decode_responses=True)


def get_quota_used() -> int:
    """Return units consumed today (resets at midnight UTC)."""
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    key = f"youtube:api_quota:{today}"
    try:
        r = _redis_client()
        val = r.get(key)
        return int(val) if val else 0
    except Exception as e:
        logger.warning("Redis quota check failed: %s", e)
        return 0


def _increment_quota(units: int) -> None:
    """Add units to today's quota counter. Key expires at midnight UTC."""
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    key = f"youtube:api_quota:{today}"
    try:
        r = _redis_client()
        pipe = r.pipeline()
        pipe.incrby(key, units)
        # Expire at next midnight UTC
        now = datetime.now(UTC)
        midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        pipe.expireat(key, int(midnight.timestamp()))
        pipe.execute()
    except Exception as e:
        logger.warning("Redis quota increment failed: %s", e)


def _neon_engine():
    """SQLAlchemy NullPool engine for NeonDB."""
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ["NEON_DATABASE_URL"]
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _video_exists(video_id: str) -> bool:
    """Check if video_id is already in youtube_videos."""
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            count = conn.execute(
                text("SELECT COUNT(*) FROM youtube_videos WHERE video_id = :vid"),
                {"vid": video_id},
            ).scalar()
        return (count or 0) > 0
    except Exception as e:
        logger.warning("DB check failed for %s: %s", video_id, e)
        return False


def _insert_video(
    video_id: str,
    channel_id: str,
    channel_name: str,
    title: str,
    duration_s: int | None,
    view_count: int | None,
    like_count: int | None,
    published_at: datetime | None,
) -> bool:
    """Insert a new video record. Returns True on success."""
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO youtube_videos
                        (video_id, channel_id, channel_name, title,
                         duration_s, view_count, like_count, published_at)
                    VALUES
                        (:vid, :cid, :cname, :title,
                         :dur, :views, :likes, :pub)
                    ON CONFLICT (video_id) DO NOTHING
                """),
                {
                    "vid": video_id,
                    "cid": channel_id,
                    "cname": channel_name,
                    "title": title,
                    "dur": duration_s,
                    "views": view_count,
                    "likes": like_count,
                    "pub": published_at,
                },
            )
            conn.commit()
        return True
    except Exception as e:
        logger.error("Insert youtube_video failed (%s): %s", video_id, e)
        return False


def _parse_iso8601_duration(duration: str) -> int | None:
    """Convert ISO 8601 duration (PT4M13S) to seconds. Returns None on parse error."""
    import re

    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration or "")
    if not m:
        return None
    h, mn, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mn * 60 + s


def discover_videos(dry_run: bool = False) -> dict:
    """Run one discovery pass: rotate through keywords, query YouTube API.

    Returns {searched, found, inserted, quota_used, skipped_quota}.
    """
    api_key = os.getenv("YOUTUBE_DATA_API_KEY", "")
    if not api_key:
        logger.error("YOUTUBE_DATA_API_KEY not set — skipping discovery")
        return {"searched": 0, "found": 0, "inserted": 0, "quota_used": 0, "skipped_quota": True}

    quota_used = get_quota_used()
    if quota_used >= QUOTA_PAUSE_THRESHOLD:
        logger.info(
            "Daily quota near limit (%d/%d units) — skipping discovery run",
            quota_used, QUOTA_PAUSE_THRESHOLD,
        )
        return {"searched": 0, "found": 0, "inserted": 0, "quota_used": quota_used, "skipped_quota": True}

    keywords = _load_keywords()
    if not keywords:
        logger.warning("No YouTube keywords configured in sources.yaml")
        return {"searched": 0, "found": 0, "inserted": 0, "quota_used": quota_used, "skipped_quota": False}

    # Rotate keyword based on current minute so each run hits a different keyword
    minute_slot = datetime.now(UTC).minute + datetime.now(UTC).hour * 60
    keyword = keywords[minute_slot % len(keywords)]

    logger.info("Discovery run: keyword=%r quota_used=%d", keyword, quota_used)

    published_after = (datetime.now(UTC) - timedelta(days=_MAX_AGE_DAYS)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    stats = {"searched": 0, "found": 0, "inserted": 0, "quota_used": quota_used, "skipped_quota": False}

    try:
        with httpx.Client(timeout=30) as client:
            # Search request: 100 quota units
            resp = client.get(
                f"{_YOUTUBE_API_BASE}/search",
                params={
                    "part": "id,snippet",
                    "q": keyword,
                    "type": "video",
                    "videoDuration": "medium",  # 4-20 min; use 'long' separately if needed
                    "videoCaption": "closedCaption",
                    "order": "relevance",
                    "publishedAfter": published_after,
                    "maxResults": 25,
                    "key": api_key,
                },
            )
            resp.raise_for_status()
            _increment_quota(_SEARCH_COST)
            stats["quota_used"] += _SEARCH_COST
            stats["searched"] += 1

            search_items = resp.json().get("items", [])
            video_ids = [item["id"]["videoId"] for item in search_items if item.get("id", {}).get("videoId")]

            if not video_ids:
                logger.info("No videos found for keyword %r", keyword)
                return stats

            # Fetch video details (views, likes, duration): 1 unit per video
            detail_resp = client.get(
                f"{_YOUTUBE_API_BASE}/videos",
                params={
                    "part": "snippet,statistics,contentDetails",
                    "id": ",".join(video_ids),
                    "key": api_key,
                },
            )
            detail_resp.raise_for_status()
            _increment_quota(len(video_ids) * _VIDEO_DETAIL_COST)
            stats["quota_used"] += len(video_ids) * _VIDEO_DETAIL_COST

            for item in detail_resp.json().get("items", []):
                video_id = item["id"]
                snippet = item.get("snippet", {})
                stats_data = item.get("statistics", {})
                content = item.get("contentDetails", {})

                title = snippet.get("title", "")
                channel_id = snippet.get("channelId", "")
                channel_name = snippet.get("channelTitle", "")
                published_str = snippet.get("publishedAt", "")
                duration_str = content.get("duration", "")

                view_count = int(stats_data.get("viewCount", 0) or 0)
                like_count = int(stats_data.get("likeCount", 0) or 0)
                duration_s = _parse_iso8601_duration(duration_str)

                published_at = None
                if published_str:
                    try:
                        published_at = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
                    except ValueError:
                        pass

                stats["found"] += 1

                if dry_run:
                    logger.info(
                        "[DRY RUN] Would queue: %s | %s | views=%d dur=%ss",
                        video_id, title[:60], view_count, duration_s,
                    )
                    continue

                if _video_exists(video_id):
                    logger.debug("Already queued: %s", video_id)
                    continue

                if _insert_video(
                    video_id=video_id,
                    channel_id=channel_id,
                    channel_name=channel_name,
                    title=title,
                    duration_s=duration_s,
                    view_count=view_count,
                    like_count=like_count,
                    published_at=published_at,
                ):
                    stats["inserted"] += 1
                    logger.info("Queued: %s | %s | views=%d", video_id, title[:60], view_count)

    except httpx.HTTPStatusError as e:
        logger.error("YouTube API error %s: %s", e.response.status_code, e.response.text[:200])
    except Exception as e:
        logger.error("Discovery failed: %s", e)

    logger.info(
        "Discovery complete: keyword=%r found=%d inserted=%d quota_today=%d",
        keyword, stats["found"], stats["inserted"], stats["quota_used"],
    )
    return stats

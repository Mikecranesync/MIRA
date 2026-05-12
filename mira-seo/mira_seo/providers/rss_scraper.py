"""RSS + YouTube channel RSS feed scraper.

YouTube provides a free per-channel Atom feed (no API key):
  https://www.youtube.com/feeds/videos.xml?channel_id={id}
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import feedparser
import httpx
import yaml

from mira_seo.models.content import FeedItem

logger = logging.getLogger("mira-seo.rss-scraper")

_CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "feeds.yml"
_YT_RSS_TEMPLATE = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
_MAX_AGE_HOURS = 48
_MAX_ITEMS = 25


def _load_config(config_path: Path = _CONFIG_PATH) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def _parse_published(entry: dict) -> datetime | None:
    """Extract publish datetime from feedparser entry."""
    if entry.get("published_parsed"):
        return datetime.fromtimestamp(time.mktime(entry["published_parsed"]), tz=timezone.utc)
    return None


def _is_recent(published_at: datetime | None) -> bool:
    if published_at is None:
        return True  # include if unknown age
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=_MAX_AGE_HOURS)
    return published_at >= cutoff


def _parse_feed_bytes(raw: bytes, url: str, category: str) -> list[FeedItem]:
    """Parse raw RSS/Atom bytes into FeedItem list."""
    parsed = feedparser.parse(raw)
    items = []
    for entry in parsed.entries:
        published_at = _parse_published(entry)
        if not _is_recent(published_at):
            continue
        summary = entry.get("summary", "") or entry.get("description", "")
        # Strip HTML tags from summary
        summary = re.sub(r"<[^>]+>", "", summary)[:500]

        # Extract source domain from feed URL
        source = urlparse(url).netloc or url

        items.append(
            FeedItem(
                title=entry.get("title", "")[:200],
                url=entry.get("link", ""),
                summary=summary,
                source=source,
                published_at=published_at,
                category=category,  # type: ignore[arg-type]
            )
        )
    return items


async def _fetch_feed(client: httpx.AsyncClient, url: str, category: str) -> list[FeedItem]:
    """Fetch a single RSS/Atom feed URL and parse into FeedItems."""
    try:
        resp = await client.get(url, follow_redirects=True, timeout=15)
        resp.raise_for_status()
        return _parse_feed_bytes(resp.content, url, category)
    except Exception as exc:
        logger.warning("Failed to fetch feed %s: %s", url, exc)
        return []


async def fetch_all(config_path: Path = _CONFIG_PATH) -> list[FeedItem]:
    """Fetch all RSS feeds + YouTube channel RSS concurrently.

    Returns up to _MAX_ITEMS deduplicated FeedItems sorted newest-first.
    """
    config = _load_config(config_path)

    tasks: list[tuple[str, str]] = []  # (url, category)

    # Standard RSS feeds
    for feed in config.get("rss_feeds", []):
        tasks.append((feed["url"], feed.get("category", "industrial")))

    # YouTube channel RSS feeds (free, no API key)
    for channel in config.get("youtube_channels", []):
        yt_url = _YT_RSS_TEMPLATE.format(channel["id"])
        tasks.append((yt_url, "industrial"))

    async with httpx.AsyncClient(
        headers={"User-Agent": "FactoryLM-SEO-Bot/1.0"},
        timeout=20,
    ) as client:
        results = await asyncio.gather(
            *[_fetch_feed(client, url, cat) for url, cat in tasks],
            return_exceptions=False,
        )

    # Flatten, deduplicate by URL, sort by published_at descending
    seen_urls: set[str] = set()
    all_items: list[FeedItem] = []
    for batch in results:
        for item in batch:
            if item.url and item.url not in seen_urls:
                seen_urls.add(item.url)
                all_items.append(item)

    all_items.sort(
        key=lambda x: x.published_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    logger.info("Fetched %d unique items from %d feeds", len(all_items), len(tasks))
    return all_items[:_MAX_ITEMS]

"""Sitemaps task — crawl XML sitemaps and queue discovered URLs for ingest."""

from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

try:
    from mira_crawler.tasks._shared import get_redis
except ImportError:
    from tasks._shared import get_redis

try:
    from mira_crawler.crawler.robots_checker import RobotsChecker
except ImportError:
    from crawler.robots_checker import RobotsChecker

logger = logging.getLogger("mira-crawler.tasks.sitemaps")

# ---------------------------------------------------------------------------
# Sitemap registry — industrial manufacturer documentation sites
# ---------------------------------------------------------------------------

SITEMAP_URLS: list[str] = [
    "https://literature.rockwellautomation.com/sitemap.xml",
    "https://new.abb.com/sitemap.xml",
    "https://www.se.com/us/en/sitemap.xml",
    "https://www.emerson.com/sitemap_index.xml",
    "https://www.siemens.com/sitemap.xml",
    "https://www.danfoss.com/sitemap.xml",
    "https://www.yaskawa.com/sitemap.xml",
]

_REDIS_LASTMOD_KEY = "mira:sitemaps:lastmod"
_FETCH_TIMEOUT = 30

# XML namespace for sitemaps
_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


# ---------------------------------------------------------------------------
# Pure helper functions (testable without Redis/Celery)
# ---------------------------------------------------------------------------


def _parse_sitemap(xml_content: str) -> list[dict]:
    """Parse a sitemap XML string and return a list of URL records.

    Each record contains: ``loc`` (str) and ``lastmod`` (str or empty string).
    Handles both standard sitemaps and sitemap index files.
    Handles XML with or without default namespace declarations.
    Malformed XML is caught and returns an empty list.

    Args:
        xml_content: Raw XML string from the sitemap endpoint.

    Returns:
        List of dicts with keys ``loc`` and ``lastmod``.
    """
    records: list[dict] = []
    if not xml_content:
        return records

    try:
        root = ET.fromstring(xml_content.strip())
    except ET.ParseError as exc:
        logger.warning("Failed to parse sitemap XML: %s", exc)
        return records

    # Extract namespace URI from root tag, e.g. {http://...}urlset → http://...
    # Then build a namespace dict for findall queries.
    raw_tag = root.tag
    ns_uri = ""
    if raw_tag.startswith("{"):
        ns_uri = raw_tag[1 : raw_tag.index("}")]

    # Build ns_map for ElementTree findall; fall back to _NS if no ns detected
    if ns_uri:
        ns_map = {"sm": ns_uri}
    else:
        ns_map = _NS

    # Strip namespace prefix from local tag name for type comparison
    local_tag = raw_tag.split("}")[-1] if "}" in raw_tag else raw_tag

    def _find_children(parent: ET.Element, local_name: str) -> list[ET.Element]:
        """Find child elements by local name, handling namespaced and plain tags."""
        # Try namespaced first (works for both default-ns and explicit-ns docs)
        found = parent.findall(f"sm:{local_name}", ns_map)
        if not found:
            # No-namespace documents (rare but valid)
            found = parent.findall(local_name)
        return found

    def _find_child_text(parent: ET.Element, local_name: str) -> str:
        """Return stripped text of first matching child, or empty string."""
        el = parent.find(f"sm:{local_name}", ns_map)
        if el is None:
            el = parent.find(local_name)
        return (el.text or "").strip() if el is not None else ""

    if local_tag == "sitemapindex":
        # Sitemap index — each <sitemap><loc> points to another sitemap file
        for sitemap_el in _find_children(root, "sitemap"):
            loc = _find_child_text(sitemap_el, "loc")
            lastmod = _find_child_text(sitemap_el, "lastmod")
            if loc:
                records.append({"loc": loc, "lastmod": lastmod})
    else:
        # Standard sitemap — each <url><loc>
        for url_el in _find_children(root, "url"):
            loc = _find_child_text(url_el, "loc")
            lastmod = _find_child_text(url_el, "lastmod")
            if loc:
                records.append({"loc": loc, "lastmod": lastmod})

    return records


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.sitemaps.check_sitemaps")
def check_sitemaps() -> dict:
    """Download sitemaps, diff against stored lastmod, and queue changed URLs.

    Steps:
      1. Load stored lastmod values from Redis hash ``mira:sitemaps:lastmod``.
      2. For each sitemap URL: fetch via httpx, parse URL list + lastmod dates.
      3. For each URL whose lastmod has changed (or is new): queue via ingest_url.delay().
      4. Persist updated lastmod values to Redis.
      5. Return summary counts.
    """
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    # 1. Load stored lastmod values
    try:
        r = get_redis()
        stored_lastmod: dict[str, str] = r.hgetall(_REDIS_LASTMOD_KEY)  # type: ignore[assignment]
    except Exception as exc:
        logger.error("Redis connection failed — aborting check_sitemaps: %s", exc)
        return {"sitemaps_checked": 0, "new_urls": 0, "error": str(exc)}

    sitemaps_checked = 0
    sitemaps_skipped_robots = 0
    new_urls = 0
    updated_lastmod: dict[str, str] = {}

    # 2. Check robots.txt compliance before fetching each sitemap (#114).
    # User-agent matches the one used for the fetch below.
    cache_dir = Path(os.environ.get("ROBOTS_CACHE_DIR", "/tmp/mira-robots"))
    robots = RobotsChecker(cache_dir=cache_dir, user_agent="MIRA-KB/1.0")

    with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
        for sitemap_url in SITEMAP_URLS:
            # Robots.txt check
            try:
                if not robots.is_allowed(sitemap_url):
                    logger.info(
                        "Skipping %s — disallowed by robots.txt",
                        sitemap_url[:80],
                    )
                    sitemaps_skipped_robots += 1
                    continue
            except Exception as exc:
                # Fail open — robots.txt check failure shouldn't block the whole job
                logger.warning(
                    "robots.txt check failed for %s (proceeding): %s",
                    sitemap_url[:80], exc,
                )

            # 3. Fetch sitemap
            try:
                resp = client.get(
                    sitemap_url,
                    headers={"User-Agent": "MIRA-KB/1.0 (sitemap monitor)"},
                )
                resp.raise_for_status()
                xml_content = resp.text
            except Exception as exc:
                logger.warning("Failed to fetch sitemap %s: %s", sitemap_url[:80], exc)
                continue

            sitemaps_checked += 1
            records = _parse_sitemap(xml_content)
            logger.info("Sitemap %s: %d URLs parsed", sitemap_url[:60], len(records))

            # 3. Diff against stored lastmod
            for record in records:
                loc = record["loc"]
                lastmod = record["lastmod"]

                stored = stored_lastmod.get(loc, "")
                is_new = loc not in stored_lastmod
                is_updated = not is_new and lastmod and lastmod != stored

                if is_new or is_updated:
                    try:
                        ingest_url.delay(url=loc, source_type="equipment_manual")
                        new_urls += 1
                        logger.debug(
                            "Queued %s (new=%s, updated=%s, lastmod=%s)",
                            loc[:80], is_new, is_updated, lastmod,
                        )
                    except Exception as exc:
                        logger.warning("Failed to queue URL %s: %s", loc[:80], exc)

                # Always update stored lastmod if we have a date
                if lastmod:
                    updated_lastmod[loc] = lastmod

    # 4. Persist updated lastmod to Redis
    if updated_lastmod:
        try:
            r.hset(_REDIS_LASTMOD_KEY, mapping=updated_lastmod)
            logger.info("Updated %d lastmod entries in Redis", len(updated_lastmod))
        except Exception as exc:
            logger.error("Failed to persist lastmod to Redis: %s", exc)

    logger.info(
        "check_sitemaps complete: %d checked, %d skipped (robots.txt), "
        "%d new/updated URLs queued",
        sitemaps_checked,
        sitemaps_skipped_robots,
        new_urls,
    )
    return {
        "sitemaps_checked": sitemaps_checked,
        "sitemaps_skipped_robots": sitemaps_skipped_robots,
        "new_urls": new_urls,
    }

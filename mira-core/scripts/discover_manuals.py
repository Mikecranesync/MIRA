#!/usr/bin/env python3
"""Apify-powered manual discovery — crawl manufacturer portals for PDF URLs.

Runs weekly (Sunday 3am) via cron. For each manufacturer, launches an Apify
website-content-crawler actor, collects discovered PDF/manual URLs, and
inserts new rows into manual_cache for next ingest run.

Usage:
    doppler run --project factorylm --config prd -- \\
      uv run --with apify-client --with psycopg2-binary --with sqlalchemy \\
      python mira-core/scripts/discover_manuals.py
"""

from __future__ import annotations

import logging
import os
import re
import sys
import time

# ---------------------------------------------------------------------------
# sys.path: make db.neon importable when run from repo root
# ---------------------------------------------------------------------------

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_INGEST_DIR = os.path.join(os.path.dirname(_SCRIPT_DIR), "mira-ingest")
if _INGEST_DIR not in sys.path:
    sys.path.insert(0, _INGEST_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("discover_manuals")

# ---------------------------------------------------------------------------
# Manufacturer crawl targets
# ---------------------------------------------------------------------------

CRAWL_TARGETS = [
    {
        "manufacturer": "Rockwell Automation",
        "start_url": "https://literature.rockwellautomation.com",
        "crawler_type": "cheerio",
        "max_pages": 200,
    },
    {
        "manufacturer": "Siemens",
        "start_url": "https://support.industry.siemens.com/cs/ww/en/ps/15338",
        "crawler_type": "playwright:chrome",
        "max_pages": 150,
    },
    {
        "manufacturer": "ABB",
        "start_url": "https://library.e.abb.com",
        "crawler_type": "cheerio",
        "max_pages": 200,
    },
    {
        "manufacturer": "Schneider Electric",
        "start_url": "https://download.schneider-electric.com",
        "crawler_type": "cheerio",
        "max_pages": 200,
    },
    {
        "manufacturer": "Mitsubishi Electric",
        "start_url": "https://dl.mitsubishielectric.com",
        "crawler_type": "playwright:chrome",
        "max_pages": 150,
    },
    # GS10 is the centerpiece of the demo F05 escalation pattern (Pump-001);
    # AutomationDirect documentation must be crawlable to keep that corpus
    # current. (#142)
    {
        "manufacturer": "AutomationDirect",
        "start_url": "https://www.automationdirect.com/support/manuals",
        "crawler_type": "cheerio",
        "max_pages": 200,
    },
    # SEW-Eurodrive — Conv-001 gearmotor fleet unit
    {
        "manufacturer": "SEW-Eurodrive",
        "start_url": "https://www.sew-eurodrive.com/support/software-download-area.html",
        "crawler_type": "playwright:chrome",
        "max_pages": 150,
    },
    # Ingersoll Rand — Comp-001 compressor fleet unit
    {
        "manufacturer": "Ingersoll Rand",
        "start_url": "https://www.ingersollrand.com/en-us/service-and-support/technical-library",
        "crawler_type": "playwright:chrome",
        "max_pages": 100,
    },
    # Dake — Press-001 hydraulic press fleet unit
    {
        "manufacturer": "Dake",
        "start_url": "https://www.dakecorp.com/customer-service/manuals",
        "crawler_type": "cheerio",
        "max_pages": 100,
    },
    # FANUC — Robot-001 industrial robot fleet unit
    {
        "manufacturer": "FANUC",
        "start_url": "https://www.fanucamerica.com/support",
        "crawler_type": "playwright:chrome",
        "max_pages": 100,
    },
    # Yaskawa — A1000/V1000/J1000/GA500/GA700 VFD families
    {
        "manufacturer": "Yaskawa",
        "start_url": "https://www.yaskawa.com/downloads/search-manuals",
        "crawler_type": "playwright:chrome",
        "max_pages": 150,
    },
    # Danfoss — VLT FC Series (seeded fault codes)
    {
        "manufacturer": "Danfoss",
        "start_url": "https://www.danfoss.com/en/service-and-support/downloads",
        "crawler_type": "playwright:chrome",
        "max_pages": 150,
    },
    # Lenze — i500/E84 VFD families (#374)
    {
        "manufacturer": "Lenze",
        "start_url": "https://www.lenze.com/en/service/downloads/",
        "crawler_type": "playwright:chrome",
        "max_pages": 150,
    },
]

# Link patterns that suggest manuals / technical docs
MANUAL_LINK_SELECTOR = (
    "a[href$='.pdf'], a[href*='download'], a[href*='manual'], a[href*='instruction']"
)

PDF_URL_RE = re.compile(r"https?://\S+\.pdf", re.IGNORECASE)

# Patterns to detect plausible model numbers in page title / URL
MODEL_RE = re.compile(
    r"\b([A-Z][A-Z0-9\-]{3,20})\b",
    re.IGNORECASE,
)


def _extract_model_from_text(text: str) -> str | None:
    m = MODEL_RE.search(text or "")
    return m.group(1).upper() if m else None


# ---------------------------------------------------------------------------
# Apify runner
# ---------------------------------------------------------------------------


def _run_apify_crawl(target: dict, apify_token: str) -> list[dict]:
    """Launch one Apify crawl and return dataset items."""
    try:
        from apify_client import ApifyClient
    except ImportError:
        log.error("apify-client not installed — add it to your uv run --with args")
        return []

    client = ApifyClient(apify_token)
    mfr = target["manufacturer"]
    log.info("Starting Apify crawl for %s (%s)...", mfr, target["start_url"])

    run_input = {
        "startUrls": [{"url": target["start_url"]}],
        "maxCrawlDepth": 2,
        "maxCrawlPages": target.get("max_pages", 200),
        "crawlerType": target.get("crawler_type", "cheerio"),
        "linkSelector": MANUAL_LINK_SELECTOR,
        "globs": [{"glob": "**/*.pdf"}, {"glob": "**/*manual*"}, {"glob": "**/*download*"}],
        "keepUrlFragment": False,
        "useExtendedUniqueKey": False,
    }

    try:
        run = client.actor("apify/website-content-crawler").call(
            run_input=run_input,
            timeout_secs=600,
        )
    except Exception as exc:
        log.error("[FAIL] Apify crawl for %s: %s", mfr, exc)
        return []

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        log.warning("[WARN] No dataset returned for %s", mfr)
        return []

    items = client.dataset(dataset_id).list_items().items
    log.info("Crawl for %s returned %d items", mfr, len(items))
    return items


def _extract_urls_from_items(items: list[dict], manufacturer: str) -> list[dict]:
    """Pull PDF/manual URLs from Apify dataset items."""
    found: list[dict] = []
    seen: set[str] = set()

    for item in items:
        page_url = item.get("url", "")
        title = item.get("title", "") or ""
        text = item.get("text", "") or ""

        # Direct PDF links from crawled URL
        if page_url.lower().endswith(".pdf") and page_url not in seen:
            seen.add(page_url)
            model = _extract_model_from_text(title) or _extract_model_from_text(page_url)
            found.append({"url": page_url, "title": title, "model": model})

        # PDF links embedded in page text / metadata
        for match in PDF_URL_RE.finditer(text):
            url = match.group(0)
            if url not in seen:
                seen.add(url)
                model = _extract_model_from_text(title)
                found.append({"url": url, "title": title, "model": model})

    return found


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    apify_token = os.getenv("APIFY_API_KEY")
    if not apify_token:
        log.error("APIFY_API_KEY not set — cannot run discovery. Exiting.")
        sys.exit(1)

    from db.neon import insert_manual_cache_url  # noqa: E402

    total_new = 0

    for target in CRAWL_TARGETS:
        mfr = target["manufacturer"]
        items = _run_apify_crawl(target, apify_token)
        if not items:
            continue

        urls = _extract_urls_from_items(items, mfr)
        log.info("Extracted %d PDF URLs for %s", len(urls), mfr)

        inserted_for_mfr = 0
        for entry in urls:
            try:
                inserted = insert_manual_cache_url(
                    manufacturer=mfr,
                    model=entry.get("model"),
                    manual_url=entry["url"],
                    manual_title=entry.get("title") or None,
                    source="apify",
                    confidence=0.8,
                )
                if inserted:
                    inserted_for_mfr += 1
            except Exception as exc:
                log.warning("[WARN] DB insert failed for %s: %s", entry["url"], exc)

        log.info("[OK] %s — %d new URLs added to manual_cache", mfr, inserted_for_mfr)
        total_new += inserted_for_mfr

        # Polite pause between manufacturers
        time.sleep(2)

    log.info("Discovery complete. %d total new URLs added to manual_cache.", total_new)


if __name__ == "__main__":
    main()

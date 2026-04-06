"""Apify-powered manufacturer discovery tasks.

Launches website-content-crawler actors per manufacturer, collects PDF URLs,
and queues ingest tasks for each discovered document.
"""

from __future__ import annotations

import logging
import os
import re

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.discover")

APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN", "")
PDF_URL_RE = re.compile(r"https?://\S+\.pdf", re.IGNORECASE)

MANUFACTURER_TARGETS = [
    {
        "manufacturer": "Rockwell Automation",
        "start_url": "https://literature.rockwellautomation.com",
        "crawler_type": "cheerio",
        "max_pages": 200,
    },
    {
        "manufacturer": "Siemens",
        "start_url": "https://support.industry.siemens.com/cs/ww/en/ps/15338",
        "crawler_type": "playwright",
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
        "crawler_type": "playwright",
        "max_pages": 150,
    },
]

MANUAL_LINK_SELECTOR = (
    "a[href$='.pdf'], a[href*='download'], a[href*='manual'], a[href*='instruction']"
)


@app.task(bind=True, max_retries=3, default_retry_delay=60)
def discover_manufacturer(self, manufacturer: str, start_url: str,
                          crawler_type: str = "cheerio", max_pages: int = 200):
    """Launch Apify crawl for one manufacturer, queue ingest tasks for results."""
    if not APIFY_API_TOKEN:
        logger.error("APIFY_API_TOKEN not set — skipping discovery for %s", manufacturer)
        return {"manufacturer": manufacturer, "urls_found": 0, "error": "no_token"}

    try:
        from apify_client import ApifyClient
    except ImportError:
        logger.error("apify-client not installed — run: uv pip install apify-client")
        return {"manufacturer": manufacturer, "urls_found": 0, "error": "no_apify_client"}

    client = ApifyClient(APIFY_API_TOKEN)

    run_input = {
        "startUrls": [{"url": start_url}],
        "maxCrawlDepth": 2,
        "maxCrawlPages": max_pages,
        "crawlerType": crawler_type,
        "linkSelector": MANUAL_LINK_SELECTOR,
        "globs": [{"glob": "**/*.pdf"}, {"glob": "**/*manual*"}],
        "keepUrlFragment": False,
    }

    try:
        logger.info("Starting Apify crawl for %s (%s, max %d pages)",
                     manufacturer, start_url, max_pages)
        run = client.actor("apify/website-content-crawler").call(
            run_input=run_input,
            timeout_secs=600,
        )
    except Exception as exc:
        logger.warning("Apify crawl failed for %s: %s — retrying", manufacturer, exc)
        raise self.retry(exc=exc)

    # Extract PDF URLs from dataset
    dataset_items = client.dataset(run["defaultDatasetId"]).list_items().items
    pdf_urls: list[str] = []

    for item in dataset_items:
        page_url = item.get("url", "")
        page_text = item.get("text", "")

        if page_url.lower().endswith(".pdf"):
            pdf_urls.append(page_url)

        # Also extract PDF links from page content
        for match in PDF_URL_RE.finditer(page_text):
            pdf_urls.append(match.group())

    # Deduplicate
    pdf_urls = list(set(pdf_urls))
    logger.info("Discovered %d PDF URLs for %s", len(pdf_urls), manufacturer)

    # Queue ingest task for each URL
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    for url in pdf_urls:
        ingest_url.delay(
            url=url,
            manufacturer=manufacturer,
            model="",
            source_type="equipment_manual",
        )

    return {"manufacturer": manufacturer, "urls_found": len(pdf_urls)}


@app.task
def discover_all_manufacturers():
    """Fan out discovery tasks for all configured manufacturers."""
    logger.info("Starting weekly manufacturer discovery (%d targets)",
                len(MANUFACTURER_TARGETS))
    for target in MANUFACTURER_TARGETS:
        discover_manufacturer.delay(
            manufacturer=target["manufacturer"],
            start_url=target["start_url"],
            crawler_type=target["crawler_type"],
            max_pages=target["max_pages"],
        )
    return {"targets_queued": len(MANUFACTURER_TARGETS)}

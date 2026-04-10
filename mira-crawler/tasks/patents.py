"""Patents task — fetch and ingest industrial equipment patents from Google Patents."""

from __future__ import annotations

import logging
import os
import time
from urllib.parse import quote_plus

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

try:
    from mira_crawler.tasks._shared import get_redis, ingest_text_inline
except ImportError:
    from tasks._shared import get_redis, ingest_text_inline

logger = logging.getLogger("mira-crawler.tasks.patents")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PATENT_QUERIES: list[str] = [
    "VFD fault detection",
    "bearing condition monitoring",
    "motor protection relay",
    "PLC diagnostic",
    "industrial vibration sensor",
]

_GOOGLE_PATENTS_BASE = "https://patents.google.com"
_USER_AGENT = "MIRA-KB/1.0 (patent research bot)"
_REQUEST_DELAY_SEC = 3
_FETCH_TIMEOUT = 30
# Redis key for patent deduplication (M5 fix — was missing entirely).
_REDIS_PATENTS_SEEN_KEY = "mira:patents:seen_ids"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_search_url(query: str) -> str:
    """Build a Google Patents search URL for a given query string."""
    return (
        f"{_GOOGLE_PATENTS_BASE}/xhr/query"
        f"?url=q%3D{quote_plus(query)}&exp=&download=false"
    )


def _parse_patents_from_response(data: dict) -> list[dict]:
    """Extract patent records from Google Patents XHR JSON response.

    Returns list of dicts with keys: patent_id, title, abstract.
    """
    patents: list[dict] = []
    try:
        results = data.get("results", {}).get("cluster", [])
        for cluster in results:
            for result in cluster.get("result", []):
                patent_data = result.get("patent", {})
                patent_id = patent_data.get("publication_number", "").strip()
                title = patent_data.get("title", "").strip()
                abstract = patent_data.get("abstract", "").strip()
                if patent_id and (title or abstract):
                    patents.append(
                        {
                            "patent_id": patent_id,
                            "title": title,
                            "abstract": abstract,
                        }
                    )
    except Exception as exc:
        logger.warning("Error parsing patent response: %s", exc)
    return patents


def _parse_patents_from_html(html_content: str, query: str) -> list[dict]:
    """Parse patent records from Google Patents search HTML page.

    Falls back to HTML scraping when the XHR endpoint returns an unexpected format.
    Extracts patent titles and abstracts using BeautifulSoup.
    """
    patents: list[dict] = []
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        logger.warning("BeautifulSoup not available — cannot parse patent HTML")
        return patents

    try:
        soup = BeautifulSoup(html_content, "html.parser")

        # Google Patents search results: each result is in search-result-item
        result_items = soup.find_all("search-result-item") or soup.find_all(
            "article", class_="search-result-item"
        )

        for item in result_items:
            # Title is in h3.result-title or span[data-field="title"]
            title_el = item.find("h3") or item.find(attrs={"data-field": "title"})
            title = title_el.get_text(strip=True) if title_el else ""

            # Abstract
            abstract_el = item.find("div", class_="abstract") or item.find(
                attrs={"data-field": "abstract"}
            )
            abstract = abstract_el.get_text(strip=True) if abstract_el else ""

            # Patent ID from link
            link_el = item.find("a", href=True)
            patent_id = ""
            if link_el:
                href = link_el.get("href", "")
                # e.g. /patent/US9876543B2/en
                parts = href.strip("/").split("/")
                if len(parts) >= 2 and parts[0] == "patent":
                    patent_id = parts[1]

            if title or abstract:
                patents.append(
                    {
                        "patent_id": patent_id or f"unknown-{query[:20]}-{len(patents)}",
                        "title": title,
                        "abstract": abstract,
                    }
                )

        logger.debug("HTML parse found %d patents for query %r", len(patents), query)
    except Exception as exc:
        logger.warning("HTML patent parse error for query %r: %s", query, exc)

    return patents


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.patents.scrape_patents")
def scrape_patents() -> dict:
    """Search Google Patents for industrial maintenance terms and ingest results.

    Steps:
      1. Load seen patent IDs from Redis set ``mira:patents:seen_ids`` (M5 fix).
      2. For each query in PATENT_QUERIES: hit Google Patents search.
      3. Parse patent title + abstract from the response.
      4. Skip already-ingested patents via Redis dedup.
      5. Build combined text and ingest inline (chunk + embed + store).
      6. Persist each new patent ID to Redis immediately after ingest.
      7. Return summary counts.
    """
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest patents")
        return {"queries_run": 0, "patents_ingested": 0, "error": "no_tenant_id"}

    # 1. Load seen patent IDs (M5: dedup was missing entirely).
    try:
        r = get_redis()
        seen_ids: set[str] = r.smembers(_REDIS_PATENTS_SEEN_KEY)  # type: ignore[assignment]
    except Exception as exc:
        logger.error("Redis connection failed — aborting scrape_patents: %s", exc)
        return {"queries_run": 0, "patents_ingested": 0, "error": str(exc)}

    queries_run = 0
    patents_ingested = 0

    with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
        for query in PATENT_QUERIES:
            logger.info("Searching Google Patents for: %r", query)
            time.sleep(_REQUEST_DELAY_SEC)

            # Try XHR JSON endpoint first, fall back to HTML
            patents: list[dict] = []
            try:
                xhr_url = _build_search_url(query)
                resp = client.get(xhr_url, headers={"User-Agent": _USER_AGENT})
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "")
                if "json" in content_type:
                    patents = _parse_patents_from_response(resp.json())
                else:
                    patents = _parse_patents_from_html(resp.text, query)
            except Exception as exc:
                logger.warning("XHR fetch failed for %r: %s — trying HTML", query, exc)
                # Fall back to plain search page
                try:
                    html_url = f"{_GOOGLE_PATENTS_BASE}/search?q={quote_plus(query)}"
                    time.sleep(_REQUEST_DELAY_SEC)
                    resp = client.get(html_url, headers={"User-Agent": _USER_AGENT})
                    resp.raise_for_status()
                    patents = _parse_patents_from_html(resp.text, query)
                except Exception as exc2:
                    logger.warning("HTML fetch also failed for %r: %s", query, exc2)
                    continue

            queries_run += 1
            logger.info("Query %r: %d patents found", query, len(patents))

            for patent in patents:
                title = patent.get("title", "")
                abstract = patent.get("abstract", "")
                patent_id = patent.get("patent_id", "")

                if not title and not abstract:
                    continue

                # Skip patents already ingested (M5 dedup).
                if patent_id and patent_id in seen_ids:
                    logger.debug("Patent %s already seen — skipping", patent_id)
                    continue

                combined_text = f"Patent: {title}\n\nAbstract: {abstract}".strip()
                source_url = (
                    f"{_GOOGLE_PATENTS_BASE}/patent/{patent_id}/en"
                    if patent_id
                    else f"{_GOOGLE_PATENTS_BASE}/search?q={query}"
                )

                try:
                    n = ingest_text_inline(
                        text=combined_text,
                        source_url=source_url,
                        source_type="patent",
                        tenant_id=tenant_id,
                        ollama_url=ollama_url,
                        embed_model=embed_model,
                    )
                    if n > 0:
                        patents_ingested += 1
                    # Persist to Redis immediately so a crash won't re-ingest.
                    if patent_id:
                        r.sadd(_REDIS_PATENTS_SEEN_KEY, patent_id)
                        seen_ids.add(patent_id)
                except Exception as exc:
                    logger.warning(
                        "Failed to ingest patent %s: %s", patent_id or query, exc
                    )

    logger.info(
        "scrape_patents complete: %d queries run, %d patents ingested",
        queries_run,
        patents_ingested,
    )
    return {"queries_run": queries_run, "patents_ingested": patents_ingested}

"""Playwright crawler task — render and extract content from JavaScript-heavy pages."""

from __future__ import annotations

import logging
import time
from urllib.parse import urljoin, urlparse

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.playwright_crawler")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_USER_AGENT = "MIRA-KB/1.0 (site crawler)"
_PAGE_DELAY_SEC = 5
_FETCH_TIMEOUT_MS = 30_000  # 30 seconds in Playwright ms units
_PDF_EXTENSIONS = frozenset({".pdf"})
_ARTICLE_PATH_KEYWORDS = frozenset(
    {"article", "blog", "manual", "guide", "support", "knowledge", "documentation", "docs"}
)

# ---------------------------------------------------------------------------
# Playwright availability guard
# ---------------------------------------------------------------------------

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _PLAYWRIGHT_AVAILABLE = False
    logger.warning(
        "playwright not installed — crawl_js_site tasks will be skipped. "
        "Install with: pip install playwright && playwright install chromium"
    )

    # Stub so type checker is happy
    PlaywrightTimeoutError = Exception  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_same_domain(url: str, base_url: str) -> bool:
    """Return True if url is on the same domain as base_url."""
    try:
        return urlparse(url).netloc == urlparse(base_url).netloc
    except Exception:
        return False


def _is_pdf_url(url: str) -> bool:
    """Return True if the URL points to a PDF file."""
    path = urlparse(url).path.lower()
    return path.endswith(".pdf")


def _is_article_url(url: str) -> bool:
    """Return True if the URL path contains article/documentation keywords."""
    path = urlparse(url).path.lower()
    return any(kw in path for kw in _ARTICLE_PATH_KEYWORDS)


def _check_robots(url: str) -> bool:
    """Check robots.txt permission for a URL. Fail open on errors."""
    try:
        from pathlib import Path

        try:
            from mira_crawler.crawler.robots_checker import RobotsChecker
        except ImportError:
            from crawler.robots_checker import RobotsChecker

        cache_dir = Path("/tmp/mira_robots_cache")
        checker = RobotsChecker(cache_dir=cache_dir, user_agent=_USER_AGENT)
        return checker.is_allowed(url)
    except Exception as exc:
        logger.debug("robots.txt check failed for %s (fail open): %s", url[:60], exc)
        return True


def _extract_links(page_html: str, base_url: str) -> list[str]:
    """Extract all href links from a rendered page HTML string."""
    links: list[str] = []
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(page_html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith("#") or href.startswith("mailto:"):
                continue
            absolute = urljoin(base_url, href)
            # Normalise: drop fragment
            parsed = urlparse(absolute)
            clean = parsed._replace(fragment="").geturl()
            links.append(clean)
    except Exception as exc:
        logger.warning("Link extraction failed: %s", exc)
    return links


def _extract_text(page_html: str) -> str:
    """Extract readable text content from rendered page HTML."""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(page_html, "html.parser")
        # Remove scripts, styles, nav, footer boilerplate
        for tag in soup.find_all(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)
    except Exception as exc:
        logger.warning("Text extraction failed: %s", exc)
        return ""


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.playwright_crawler.crawl_js_site")
def crawl_js_site(start_url: str, max_pages: int = 50) -> dict:
    """Crawl a JS-heavy site using Playwright, queue discovered content for ingest.

    Steps:
      1. Check that Playwright is available; skip gracefully if not.
      2. Launch headless Chromium.
      3. BFS crawl from start_url up to max_pages, respecting robots.txt.
      4. For each rendered page: extract text (inline ingest) + collect links.
      5. Queue discovered PDF URLs via ingest_url.delay().
      6. Return summary counts.
    """
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    import os

    if not _PLAYWRIGHT_AVAILABLE:
        logger.warning(
            "Playwright not available — skipping crawl of %s. "
            "Install with: pip install playwright && playwright install chromium",
            start_url,
        )
        return {"pages_crawled": 0, "urls_queued": 0, "error": "playwright_not_installed"}

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest crawled pages")
        return {"pages_crawled": 0, "urls_queued": 0, "error": "no_tenant_id"}

    pages_crawled = 0
    urls_queued = 0

    visited: set[str] = set()
    queue: list[str] = [start_url]

    logger.info("Starting Playwright crawl: %s (max_pages=%d)", start_url, max_pages)

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=_USER_AGENT,
                extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
            )
            page = context.new_page()

            while queue and pages_crawled < max_pages:
                url = queue.pop(0)
                if url in visited:
                    continue
                if not _is_same_domain(url, start_url):
                    continue
                if not _check_robots(url):
                    logger.debug("robots.txt disallows: %s", url[:80])
                    continue

                visited.add(url)
                time.sleep(_PAGE_DELAY_SEC)

                # Navigate
                try:
                    page.goto(url, timeout=_FETCH_TIMEOUT_MS, wait_until="domcontentloaded")
                    html_content = page.content()
                except PlaywrightTimeoutError:
                    logger.warning("Page load timed out: %s", url[:80])
                    continue
                except Exception as exc:
                    logger.warning("Page navigation failed for %s: %s", url[:80], exc)
                    continue

                pages_crawled += 1
                logger.debug("Crawled page %d/%d: %s", pages_crawled, max_pages, url[:80])

                # Extract and ingest text
                text = _extract_text(html_content)
                if text and len(text) >= 200:
                    try:
                        _ingest_text_inline(
                            text=text,
                            source_url=url,
                            source_type="knowledge_article",
                            tenant_id=tenant_id,
                            ollama_url=ollama_url,
                            embed_model=embed_model,
                        )
                    except Exception as exc:
                        logger.warning("Inline ingest failed for %s: %s", url[:80], exc)

                # Discover new links
                links = _extract_links(html_content, url)
                for link in links:
                    if link in visited or link in queue:
                        continue
                    if not _is_same_domain(link, start_url):
                        continue
                    # Queue PDFs for dedicated ingest
                    if _is_pdf_url(link):
                        try:
                            ingest_url.delay(url=link, source_type="equipment_manual")
                            urls_queued += 1
                        except Exception as exc:
                            logger.warning("Failed to queue PDF %s: %s", link[:80], exc)
                    elif _is_article_url(link):
                        queue.append(link)

            browser.close()

    except Exception as exc:
        logger.error("Playwright crawl failed for %s: %s", start_url, exc)
        return {
            "pages_crawled": pages_crawled,
            "urls_queued": urls_queued,
            "error": str(exc),
        }

    logger.info(
        "crawl_js_site complete: %d pages crawled, %d URLs queued (start=%s)",
        pages_crawled,
        urls_queued,
        start_url,
    )
    return {"pages_crawled": pages_crawled, "urls_queued": urls_queued}


# ---------------------------------------------------------------------------
# Shared inline ingest helper (also used by reddit and patents tasks)
# ---------------------------------------------------------------------------


def _ingest_text_inline(
    text: str,
    source_url: str,
    source_type: str,
    tenant_id: str,
    ollama_url: str,
    embed_model: str,
) -> int:
    """Chunk, embed, and store a text string. Returns number of chunks inserted."""
    try:
        from ingest.chunker import chunk_blocks
        from ingest.embedder import embed_text
        from ingest.store import chunk_exists, insert_chunk
    except ImportError:
        from mira_crawler.ingest.chunker import chunk_blocks
        from mira_crawler.ingest.embedder import embed_text
        from mira_crawler.ingest.store import chunk_exists, insert_chunk

    blocks = [{"text": text, "page_num": None, "section": ""}]
    chunks = chunk_blocks(
        blocks,
        source_url=source_url,
        source_type=source_type,
        max_chars=2000,
        min_chars=80,
        overlap=200,
    )

    inserted = 0
    for chunk in chunks:
        chunk_idx = chunk.get("chunk_index", 0)
        if chunk_exists(tenant_id, source_url, chunk_idx):
            continue
        embedding = embed_text(chunk["text"], ollama_url=ollama_url, model=embed_model)
        if embedding is None:
            continue
        entry_id = insert_chunk(
            tenant_id=tenant_id,
            content=chunk["text"],
            embedding=embedding,
            source_url=source_url,
            source_type=source_type,
            chunk_index=chunk_idx,
            chunk_type=chunk.get("chunk_type", "text"),
        )
        if entry_id:
            inserted += 1

    return inserted

"""Technical SEO crawler — async site auditing with link extraction and validation.

Uses aiohttp + BeautifulSoup to crawl a domain, extract metadata, and identify
technical SEO issues (missing alt text, broken links, etc.).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger("mira-seo.crawler")

USER_AGENT = "mira-seo-crawler/0.1"
TIMEOUT = 15
CONCURRENT_REQUESTS = 10
MAX_CONTENT_SIZE = 10 * 1024 * 1024  # 10 MB max response body


@dataclass
class PageAudit:
    """Technical SEO audit result for a single page."""

    url: str
    status_code: int
    title: str | None
    meta_description: str | None
    h1_tags: list[str]
    canonical: str | None
    robots_meta: str | None
    missing_alt_images: int
    response_time_ms: float
    word_count: int
    internal_links: list[str]
    external_links: list[str]
    broken_links: list[str]
    error: str | None = None


async def crawl(base_url: str, max_pages: int = 200) -> list[PageAudit]:
    """
    BFS crawl starting from base_url.

    Follows only internal links (same scheme + netloc), respects max_pages limit,
    skips non-HTML content types, fragments, mailto:, tel:, etc.

    Uses asyncio.Semaphore(CONCURRENT_REQUESTS) to limit parallel fetches.
    Timeout per request: TIMEOUT seconds.
    User-Agent: USER_AGENT.

    Args:
        base_url: Starting URL (must be http/https)
        max_pages: Maximum pages to crawl (default 200)

    Returns:
        List of PageAudit objects (one per visited page)
    """
    parsed_base = urlparse(base_url)
    base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"

    # Normalize base_url
    if not base_url.endswith("/"):
        base_url = base_url + "/"

    audits: list[PageAudit] = []
    visited: set[str] = set()
    to_visit: list[str] = [base_url]
    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)

    headers = {"User-Agent": USER_AGENT}
    timeout = aiohttp.ClientTimeout(total=TIMEOUT)

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        while to_visit and len(visited) < max_pages:
            # Fetch and process one page
            url = to_visit.pop(0)
            if url in visited:
                continue
            visited.add(url)

            audit = await _fetch_and_audit(session, url, semaphore)
            audits.append(audit)

            # If page fetch succeeded, extract internal links for queue
            if audit.error is None:
                for link in audit.internal_links:
                    normalized = _normalize_url(link)
                    if (
                        normalized not in visited
                        and len(visited) < max_pages
                        and _is_same_domain(normalized, base_domain)
                    ):
                        to_visit.append(normalized)

        # Post-crawl: mark broken links
        # A broken link is an internal link that points to a page we fetched with 4xx/5xx status
        status_by_url = {audit.url: audit.status_code for audit in audits}
        for audit in audits:
            broken = [
                link
                for link in audit.internal_links
                if _normalize_url(link) in status_by_url
                and status_by_url[_normalize_url(link)] >= 400
            ]
            audit.broken_links.extend(broken)

    return audits


async def _fetch_and_audit(
    session: aiohttp.ClientSession, url: str, semaphore: asyncio.Semaphore
) -> PageAudit:
    """Fetch a page and extract SEO audit data."""
    async with semaphore:
        start = time.monotonic()
        try:
            async with session.get(url, allow_redirects=True, ssl=False) as response:
                response_time_ms = (time.monotonic() - start) * 1000
                status_code = response.status

                # Check Content-Type
                content_type = response.headers.get("Content-Type", "")
                if "text/html" not in content_type:
                    return PageAudit(
                        url=url,
                        status_code=status_code,
                        title=None,
                        meta_description=None,
                        h1_tags=[],
                        canonical=None,
                        robots_meta=None,
                        missing_alt_images=0,
                        response_time_ms=response_time_ms,
                        word_count=0,
                        internal_links=[],
                        external_links=[],
                        broken_links=[],
                        error=f"Non-HTML content type: {content_type}",
                    )

                # Read body with size limit
                body = await response.read()
                if len(body) > MAX_CONTENT_SIZE:
                    return PageAudit(
                        url=url,
                        status_code=status_code,
                        title=None,
                        meta_description=None,
                        h1_tags=[],
                        canonical=None,
                        robots_meta=None,
                        missing_alt_images=0,
                        response_time_ms=response_time_ms,
                        word_count=0,
                        internal_links=[],
                        external_links=[],
                        broken_links=[],
                        error=f"Response body exceeds {MAX_CONTENT_SIZE} bytes",
                    )

                # Parse HTML
                soup = BeautifulSoup(body, "lxml")
                audit = _extract_seo_data(url, status_code, response_time_ms, soup)
                return audit

        except asyncio.TimeoutError:
            response_time_ms = (time.monotonic() - start) * 1000
            return PageAudit(
                url=url,
                status_code=0,
                title=None,
                meta_description=None,
                h1_tags=[],
                canonical=None,
                robots_meta=None,
                missing_alt_images=0,
                response_time_ms=response_time_ms,
                word_count=0,
                internal_links=[],
                external_links=[],
                broken_links=[],
                error="Request timeout",
            )
        except Exception as e:
            response_time_ms = (time.monotonic() - start) * 1000
            logger.error(f"Error fetching {url}: {e}")
            return PageAudit(
                url=url,
                status_code=0,
                title=None,
                meta_description=None,
                h1_tags=[],
                canonical=None,
                robots_meta=None,
                missing_alt_images=0,
                response_time_ms=response_time_ms,
                word_count=0,
                internal_links=[],
                external_links=[],
                broken_links=[],
                error=str(e),
            )


def _extract_seo_data(
    url: str, status_code: int, response_time_ms: float, soup: BeautifulSoup
) -> PageAudit:
    """Extract SEO metadata from parsed HTML."""
    # Title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else None

    # Meta description
    meta_desc_tag = soup.find("meta", attrs={"name": "description"})
    meta_description = meta_desc_tag.get("content") if meta_desc_tag else None

    # H1 tags
    h1_tags = [h1.get_text(strip=True) for h1 in soup.find_all("h1")]

    # Canonical
    canonical_tag = soup.find("link", attrs={"rel": "canonical"})
    canonical = canonical_tag.get("href") if canonical_tag else None

    # Robots meta
    robots_tag = soup.find("meta", attrs={"name": "robots"})
    robots_meta = robots_tag.get("content") if robots_tag else None

    # Missing alt images
    all_imgs = soup.find_all("img")
    missing_alt_images = sum(
        1 for img in all_imgs if not img.get("alt") or not img.get("alt").strip()
    )

    # Word count
    text = soup.get_text()
    word_count = len(text.split())

    # Internal and external links
    internal_links: list[str] = []
    external_links: list[str] = []
    base_domain = f"{urlparse(url).scheme}://{urlparse(url).netloc}"

    for a_tag in soup.find_all("a", href=True):
        href = a_tag.get("href")
        if not href:
            continue
        # Skip fragments, mailto:, tel:
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        # Normalize
        normalized = _normalize_url(urljoin(url, href))
        if _is_same_domain(normalized, base_domain):
            internal_links.append(normalized)
        else:
            external_links.append(normalized)

    return PageAudit(
        url=url,
        status_code=status_code,
        title=title,
        meta_description=meta_description,
        h1_tags=h1_tags,
        canonical=canonical,
        robots_meta=robots_meta,
        missing_alt_images=missing_alt_images,
        response_time_ms=response_time_ms,
        word_count=word_count,
        internal_links=internal_links,
        external_links=external_links,
        broken_links=[],
    )


def _normalize_url(url: str) -> str:
    """Remove fragment and normalize query params."""
    parsed = urlparse(url)
    # Remove fragment
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{parsed.query}".rstrip("?")


def _is_same_domain(url: str, base_domain: str) -> bool:
    """Check if URL belongs to the same domain."""
    parsed = urlparse(url)
    url_domain = f"{parsed.scheme}://{parsed.netloc}"
    return url_domain == base_domain

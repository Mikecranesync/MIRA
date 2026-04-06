"""Abstract base crawler — fetch → convert → chunk → embed → store.

All crawlers inherit from this class and implement `discover_urls()`.
The base class handles robots.txt, rate limiting, dedup, and the full
ingest pipeline.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx
from config import CrawlerConfig
from ingest.chunker import chunk_blocks
from ingest.converter import extract_from_docling, extract_from_html, extract_from_pdf
from ingest.dedup import DedupStore
from ingest.embedder import embed_batch
from ingest.store import store_chunks

from crawler.rate_limiter import RateLimiter
from crawler.robots_checker import RobotsChecker

logger = logging.getLogger("mira-crawler.base")


class BaseCrawler:
    """Abstract base for all crawlers."""

    def __init__(self, config: CrawlerConfig) -> None:
        self.config = config
        self.robots = RobotsChecker(
            cache_dir=config.cache_dir,
            user_agent=config.user_agent,
            ttl_hours=config.robots_cache_ttl_hours,
        )
        self.rate_limiter = RateLimiter(min_delay_sec=config.rate_limit_sec)
        self.dedup = DedupStore(db_path=config.dedup_db_path)
        self._client: httpx.Client | None = None

    def _get_client(self) -> httpx.Client:
        """Lazy HTTP client with our user agent."""
        if self._client is None:
            self._client = httpx.Client(
                timeout=60.0,
                follow_redirects=True,
                headers={"User-Agent": self.config.user_agent},
            )
        return self._client

    def discover_urls(self) -> list[dict]:
        """Return list of URLs to crawl.

        Each entry: {url, source_type, manufacturer, equipment_id, format}
        Subclasses MUST override this.
        """
        raise NotImplementedError

    def fetch(self, url: str) -> bytes | None:
        """Download a URL, respecting robots.txt and rate limits.

        Returns bytes on success, None if blocked or failed.
        """
        # robots.txt check
        if not self.robots.is_allowed(url):
            logger.info("Blocked by robots.txt: %s", url)
            return None

        # URL-level dedup
        if self.dedup.is_url_indexed(url):
            logger.info("Already indexed (URL dedup): %s", url)
            return None

        # Rate limit
        domain = urlparse(url).netloc
        self.rate_limiter.wait(domain)

        # Fetch
        try:
            resp = self._get_client().get(url)
            resp.raise_for_status()
            data = resp.content
            logger.info("Fetched %s (%d bytes)", url, len(data))
            return data
        except Exception as e:
            logger.warning("Fetch failed for %s: %s", url, e)
            return None

    def process(self, url: str, data: bytes, entry: dict) -> int:
        """Run the full ingest pipeline on fetched data.

        Returns number of chunks stored.
        """
        fmt = entry.get("format", "pdf")
        source_type = entry.get("source_type", "equipment_manual")
        manufacturer = entry.get("manufacturer", "")
        equipment_id = entry.get("equipment_id", "")
        filename = url.rsplit("/", 1)[-1] if "/" in url else ""

        # Content-level dedup
        if self.dedup.is_already_indexed(data):
            logger.info("Already indexed (content dedup): %s", url)
            return 0

        # Convert
        if fmt == "html":
            blocks = extract_from_html(data, min_chars=self.config.chunk_min_chars)
        elif self.config.use_docling:
            blocks = extract_from_docling(data, min_chars=self.config.chunk_min_chars)
            if not blocks:
                blocks = extract_from_pdf(data, min_chars=self.config.chunk_min_chars)
        else:
            blocks = extract_from_pdf(data, min_chars=self.config.chunk_min_chars)

        if not blocks:
            logger.warning("No blocks extracted from %s", url)
            return 0

        # Chunk
        chunks = chunk_blocks(
            blocks,
            source_url=url,
            source_file=filename,
            source_type=source_type,
            equipment_id=equipment_id,
            max_chars=self.config.chunk_max_chars,
            min_chars=self.config.chunk_min_chars,
        )

        if not chunks:
            logger.warning("No chunks after chunking from %s", url)
            return 0

        # Embed
        embedded = embed_batch(
            chunks,
            ollama_url=self.config.ollama_base_url,
            model=self.config.embed_model,
            batch_size=self.config.embed_batch_size,
        )

        # Filter out failed embeddings
        valid = [(c, v) for c, v in embedded if v is not None]
        if not valid:
            logger.warning("All embeddings failed for %s", url)
            return 0

        # Store
        stored = store_chunks(
            valid,
            tenant_id=self.config.mira_tenant_id,
            manufacturer=manufacturer,
        )

        # Mark as indexed
        self.dedup.mark_indexed(
            data,
            source_url=url,
            source_type=source_type,
            equipment_id=equipment_id,
            chunk_count=stored,
        )

        logger.info("Ingested %s: %d chunks stored", url, stored)
        return stored

    def crawl(self, dry_run: bool = False) -> dict:
        """Run the full crawl: discover → fetch → process.

        Returns {total_urls, fetched, skipped, stored_chunks, errors}.
        """
        urls = self.discover_urls()
        logger.info("Discovered %d URLs to crawl", len(urls))

        stats = {
            "total_urls": len(urls),
            "fetched": 0,
            "skipped": 0,
            "stored_chunks": 0,
            "errors": 0,
        }

        if dry_run:
            for entry in urls:
                logger.info("[DRY RUN] Would crawl: %s", entry["url"])
            return stats

        for entry in urls:
            url = entry["url"]
            try:
                data = self.fetch(url)
                if data is None:
                    stats["skipped"] += 1
                    continue

                stats["fetched"] += 1
                chunks_stored = self.process(url, data, entry)
                stats["stored_chunks"] += chunks_stored
            except Exception as e:
                logger.error("Error crawling %s: %s", url, e)
                stats["errors"] += 1

        logger.info(
            "Crawl complete: %d fetched, %d skipped, %d chunks, %d errors",
            stats["fetched"], stats["skipped"],
            stats["stored_chunks"], stats["errors"],
        )
        return stats

    def close(self) -> None:
        """Close HTTP client."""
        if self._client:
            self._client.close()
            self._client = None

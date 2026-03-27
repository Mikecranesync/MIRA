"""Manufacturer crawler — OEM documentation portals.

Crawls manufacturer-specific documentation portals defined in
sources.yaml under the 3_manufacturer tier.

Supports two crawl patterns:
- direct: single PDF URL, fetch directly
- index: crawl an index page, extract PDF links, fetch each
"""

from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

import yaml

from config import CrawlerConfig
from crawler.base_crawler import BaseCrawler

logger = logging.getLogger("mira-crawler.manufacturer")


class ManufacturerCrawler(BaseCrawler):
    """Crawl manufacturer documentation portals."""

    def __init__(
        self, config: CrawlerConfig, manufacturers: list[str] | None = None
    ) -> None:
        super().__init__(config)
        self.manufacturers = manufacturers  # None = all manufacturers

    def _discover_index_urls(self, base_url: str, entry: dict) -> list[dict]:
        """Crawl an index page and extract PDF links."""
        data = self.fetch(base_url)
        if data is None:
            return []

        # Extract PDF links from HTML
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            return []

        pdf_urls: list[dict] = []
        for match in re.finditer(r'href=["\']([^"\']*\.pdf)["\']', text, re.IGNORECASE):
            pdf_url = urljoin(base_url, match.group(1))
            pdf_urls.append({
                "url": pdf_url,
                "source_type": "equipment_manual",
                "format": "pdf",
                "manufacturer": entry.get("manufacturer", ""),
                "equipment_id": "",
            })

        logger.info("Index %s yielded %d PDF links", base_url, len(pdf_urls))
        return pdf_urls

    def discover_urls(self) -> list[dict]:
        """Read manufacturer URLs from sources.yaml."""
        sources_file = self.config.sources_file
        if not sources_file.exists():
            logger.error("sources.yaml not found at %s", sources_file)
            return []

        data = yaml.safe_load(sources_file.read_text())
        tiers = data.get("tiers", {})
        urls: list[dict] = []

        for tier_key, sources in tiers.items():
            if "manufacturer" not in tier_key:
                continue

            if not isinstance(sources, dict):
                continue

            for source_id, source_def in sources.items():
                if not isinstance(source_def, dict):
                    continue

                # Filter by manufacturer name if specified
                manufacturer = source_def.get("manufacturer", source_id)
                if self.manufacturers:
                    if not any(
                        m.lower() in manufacturer.lower() or m.lower() in source_id.lower()
                        for m in self.manufacturers
                    ):
                        continue

                crawl_pattern = source_def.get("crawl_pattern", "direct")

                if crawl_pattern == "index":
                    base_url = source_def.get("base_url") or source_def.get("url", "")
                    if base_url:
                        index_urls = self._discover_index_urls(base_url, {
                            "manufacturer": manufacturer,
                        })
                        urls.extend(index_urls)
                else:
                    url = source_def.get("url")
                    if url:
                        urls.append({
                            "url": url,
                            "source_type": "equipment_manual",
                            "format": source_def.get("format", "pdf"),
                            "manufacturer": manufacturer,
                            "equipment_id": source_def.get("equipment_id", ""),
                        })

        logger.info(
            "Discovered %d manufacturer URLs (filter=%s)",
            len(urls), self.manufacturers or "all",
        )
        return urls

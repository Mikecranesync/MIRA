"""Curriculum crawler — free educational and standards sources.

Tier 1: Kuphaldt CC-licensed textbooks (highest priority)
Tier 2: Government / public domain (OSHA)
Tier 4: Open educational resources
Tier 5: Technical reference sites

All URLs defined in sources.yaml. This crawler reads the manifest and
produces URL lists for the base crawler pipeline.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from config import CrawlerConfig
from crawler.base_crawler import BaseCrawler

logger = logging.getLogger("mira-crawler.curriculum")


class CurriculumCrawler(BaseCrawler):
    """Crawl free educational and standards sources."""

    def __init__(self, config: CrawlerConfig, tiers: list[str] | None = None) -> None:
        super().__init__(config)
        self.tiers = tiers  # None = all tiers

    def discover_urls(self) -> list[dict]:
        """Read curriculum URLs from sources.yaml."""
        sources_file = self.config.sources_file
        if not sources_file.exists():
            logger.error("sources.yaml not found at %s", sources_file)
            return []

        data = yaml.safe_load(sources_file.read_text())
        tiers = data.get("tiers", {})
        urls: list[dict] = []

        for tier_key, sources in tiers.items():
            # Filter by tier if specified
            if self.tiers and not any(t in tier_key for t in self.tiers):
                continue

            # Skip manufacturer tier (handled by ManufacturerCrawler)
            if "manufacturer" in tier_key:
                continue

            if not isinstance(sources, dict):
                continue

            for source_id, source_def in sources.items():
                if not isinstance(source_def, dict):
                    continue

                url = source_def.get("url")
                if not url:
                    continue

                urls.append({
                    "url": url,
                    "source_type": source_def.get("type", "curriculum"),
                    "format": source_def.get("format", "pdf"),
                    "manufacturer": "",
                    "equipment_id": "",
                    "source_id": source_id,
                    "license": source_def.get("license", ""),
                })

        logger.info("Discovered %d curriculum URLs (tiers=%s)", len(urls), self.tiers or "all")
        return urls

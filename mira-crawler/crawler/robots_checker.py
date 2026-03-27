"""robots.txt compliance checker with disk-backed TTL cache.

Checks robots.txt before every domain crawl. Results cached for 24 hours
to avoid hammering the same robots.txt repeatedly.

Usage:
    checker = RobotsChecker(cache_dir=Path("/app/cache"), user_agent="MiraCrawler/1.0")
    if checker.is_allowed("https://example.com/manuals/guide.pdf"):
        # safe to fetch
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

logger = logging.getLogger("mira-crawler.robots")

DEFAULT_TTL_HOURS = 24


class RobotsChecker:
    """Check URLs against robots.txt with a disk-backed cache."""

    def __init__(
        self,
        cache_dir: Path,
        user_agent: str = "MiraCrawler/1.0",
        ttl_hours: int = DEFAULT_TTL_HOURS,
    ) -> None:
        self.cache_dir = cache_dir / "robots"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.user_agent = user_agent
        self.ttl_seconds = ttl_hours * 3600
        self._parsers: dict[str, RobotFileParser | None] = {}

    def _cache_key(self, domain: str) -> Path:
        """Get cache file path for a domain."""
        safe = hashlib.md5(domain.encode()).hexdigest()
        return self.cache_dir / f"{safe}.json"

    def _load_cached(self, domain: str) -> str | None:
        """Load cached robots.txt content if still valid."""
        path = self._cache_key(domain)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            if time.time() - data.get("fetched_at", 0) < self.ttl_seconds:
                return data.get("content", "")
        except (json.JSONDecodeError, KeyError):
            pass
        return None

    def _save_cache(self, domain: str, content: str) -> None:
        """Save robots.txt content to disk cache."""
        path = self._cache_key(domain)
        path.write_text(json.dumps({"fetched_at": time.time(), "content": content}))

    def _fetch_robots(self, domain: str) -> str:
        """Fetch robots.txt from a domain. Returns empty string on failure."""
        url = f"https://{domain}/robots.txt"
        try:
            resp = httpx.get(url, timeout=10.0, follow_redirects=True)
            if resp.status_code == 200:
                content = resp.text
                logger.info("Fetched robots.txt from %s (%d bytes)", domain, len(content))
                return content
            logger.info("No robots.txt at %s (HTTP %d) — allowing all", domain, resp.status_code)
            return ""
        except Exception as e:
            logger.warning("Failed to fetch robots.txt from %s: %s — allowing all", domain, e)
            return ""

    def _get_parser(self, domain: str) -> RobotFileParser:
        """Get or create a RobotFileParser for a domain."""
        if domain in self._parsers:
            parser = self._parsers[domain]
            if parser is not None:
                return parser

        # Check cache first
        content = self._load_cached(domain)
        if content is None:
            content = self._fetch_robots(domain)
            self._save_cache(domain, content)

        parser = RobotFileParser()
        parser.parse(content.splitlines())
        self._parsers[domain] = parser
        return parser

    def is_allowed(self, url: str) -> bool:
        """Check if a URL is allowed by its domain's robots.txt.

        Returns True if:
        - robots.txt allows crawling for our user agent
        - robots.txt doesn't exist (404/error → allow all)
        - URL is malformed (fail-open with warning)
        """
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            if not domain:
                logger.warning("Cannot parse domain from URL: %s — allowing", url)
                return True
            parser = self._get_parser(domain)
            path = parsed.path or "/"
            allowed = parser.can_fetch(self.user_agent, path)
            if not allowed:
                logger.info("BLOCKED by robots.txt: %s", url)
            return allowed
        except Exception as e:
            logger.warning("robots.txt check failed for %s: %s — allowing", url, e)
            return True

    def clear_cache(self) -> int:
        """Clear all cached robots.txt files. Returns count of files removed."""
        count = 0
        for f in self.cache_dir.glob("*.json"):
            f.unlink()
            count += 1
        self._parsers.clear()
        return count

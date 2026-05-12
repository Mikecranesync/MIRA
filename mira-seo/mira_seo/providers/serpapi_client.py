"""SerpAPI async client for Google search queries."""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("mira-seo.serpapi")

SERPAPI_URL = "https://serpapi.com/search.json"


class SerpAPIClient:
    """Async httpx-based wrapper around the SerpAPI REST API.

    Tracks monthly call count and warns at 80 calls (free tier limit: 100/mo).
    """

    def __init__(self) -> None:
        self.api_key = os.getenv("SERPAPI_KEY", "")
        self._call_count = 0
        self._warn_threshold = 80
        self._free_limit = 100

        if not self.api_key:
            logger.warning("SERPAPI_KEY not set — SerpAPI queries will return empty results")

    async def search_organic(self, query: str, num: int = 10) -> list[dict]:
        """Search Google and return organic results.

        Args:
            query: Search query string
            num: Number of results to return (default 10)

        Returns:
            List of organic results with keys: position, title, url, snippet
        """
        if not self.api_key:
            logger.warning("SERPAPI_KEY not set — search_organic returning empty results")
            return []

        async with httpx.AsyncClient(timeout=30) as client:
            params = {
                "engine": "google",
                "q": query,
                "num": num,
                "api_key": self.api_key,
            }
            try:
                resp = await client.get(SERPAPI_URL, params=params)
                resp.raise_for_status()
            except httpx.HTTPError as e:
                logger.error("SerpAPI request failed: %s", e)
                return []

        self._call_count += 1
        if self._call_count >= self._warn_threshold:
            logger.warning(
                "SerpAPI call count at %d (free tier limit: %d/mo)",
                self._call_count,
                self._free_limit,
            )

        body = resp.json()
        results = []
        for item in body.get("organic_results", []):
            results.append(
                {
                    "position": item.get("position", 0),
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("snippet", ""),
                }
            )
        return results

    async def domain_top_pages(self, domain: str, num: int = 10) -> list[dict]:
        """Search for top pages on a domain.

        Args:
            domain: Domain to search (e.g., "example.com")
            num: Number of results to return (default 10)

        Returns:
            List of results with keys: position, title, url, snippet
        """
        if not self.api_key:
            logger.warning("SERPAPI_KEY not set — domain_top_pages returning empty results")
            return []

        query = f"site:{domain}"
        return await self.search_organic(query, num)

    def quota_status(self) -> dict:
        """Return current quota status.

        Returns:
            Dict with keys: calls_this_session, warn_threshold, free_limit
        """
        return {
            "calls_this_session": self._call_count,
            "warn_threshold": self._warn_threshold,
            "free_limit": self._free_limit,
        }

"""Open PageRank API client wrapper."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("mira-seo.openpagerank")


class OpenPageRankClient:
    """Open PageRank API client for domain rank queries."""

    BASE_URL = "https://openpagerank.com/api/v1.0/getPageRank"

    def __init__(self) -> None:
        """Initialize Open PageRank client from environment variable."""
        self.api_key = os.getenv("OPENPAGERANK_KEY", "")
        if not self.api_key:
            logger.warning("OPENPAGERANK_KEY not set — Open PageRank API unavailable")

    async def get_domain_rank(self, domains: list[str]) -> list[dict[str, Any]]:
        """Get domain ranks from Open PageRank API.

        Args:
            domains: List of domain names to query

        Returns:
            List of dicts with keys: domain, page_rank_integer, rank, status_code
            - page_rank_integer: int (0-10 scale)
            - rank: int (global rank, 0 if unknown)
            - status_code: int (200 = success, others = error for that domain)
            Returns empty list if API key is missing or HTTP error occurs.
        """
        if not self.api_key:
            logger.warning("OPENPAGERANK_KEY not set; cannot fetch domain ranks")
            return []

        if not domains:
            return []

        # Build query parameters: domains[]=domain1&domains[]=domain2&...
        params = {"domains[]": domains}

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(
                    self.BASE_URL,
                    params=params,
                    headers={"API-OPR": self.api_key},
                )
                response.raise_for_status()

                data = response.json()

                # API response format: {"status_code": 200, "response": [{...}, ...]}
                if data.get("status_code") != 200:
                    logger.warning(
                        f"Open PageRank API returned status_code {data.get('status_code')}"
                    )
                    return []

                result_list = data.get("response", [])

                # Each item in response: {"page_rank_integer": N, "rank": N, "status_code": 200, "domain": "..."}
                return result_list

        except httpx.HTTPError as e:
            logger.error(f"Open PageRank API HTTP error: {e}")
            return []
        except Exception as e:
            logger.error(f"Error fetching Open PageRank data: {e}")
            return []

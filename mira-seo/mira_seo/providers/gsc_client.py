"""Google Search Console API client wrapper."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any

from google.oauth2.service_account import Credentials
from googleapiclient import discovery

logger = logging.getLogger("mira-seo.gsc")


class GSCClient:
    """Google Search Console API client."""

    def __init__(self) -> None:
        """Initialize GSC client from service account env var."""
        self._service: Any = None
        self._available = False

        env_val = os.getenv("GSC_SERVICE_ACCOUNT_JSON", "")
        if not env_val:
            logger.warning("GSC_SERVICE_ACCOUNT_JSON not set — Google Search Console unavailable")
            return

        try:
            decoded = base64.b64decode(env_val)
            service_account_info = json.loads(decoded)

            credentials = Credentials.from_service_account_info(
                service_account_info,
                scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
            )

            self._service = discovery.build(
                "searchconsole", "v1", credentials=credentials, cache_discovery=False
            )
            self._available = True
            logger.info("Google Search Console client initialized successfully")
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to initialize Google Search Console client: {e}")

    def is_available(self) -> bool:
        """Check if service account credentials were loaded successfully."""
        return self._available

    async def get_top_queries(
        self, site_url: str, days: int = 90
    ) -> list[dict[str, Any]]:
        """Get top search queries for a site.

        Args:
            site_url: Site URL (e.g., "sc-domain:factorylm.com" or "https://factorylm.com/")
            days: Number of days to look back (default: 90)

        Returns:
            List of dicts with keys: query, clicks, impressions, position, ctr
        """
        if not self._available:
            logger.warning("Google Search Console unavailable; returning empty results")
            return []

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._fetch_top_queries_sync, site_url, days
        )

    async def get_top_pages(
        self, site_url: str, days: int = 90
    ) -> list[dict[str, Any]]:
        """Get top pages for a site.

        Args:
            site_url: Site URL (e.g., "sc-domain:factorylm.com" or "https://factorylm.com/")
            days: Number of days to look back (default: 90)

        Returns:
            List of dicts with keys: page, clicks, impressions, position, ctr
        """
        if not self._available:
            logger.warning("Google Search Console unavailable; returning empty results")
            return []

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_top_pages_sync, site_url, days)

    def _fetch_top_queries_sync(self, site_url: str, days: int) -> list[dict[str, Any]]:
        """Synchronous helper to fetch top queries."""
        return self._fetch_data_sync(site_url, days, ["query"])

    def _fetch_top_pages_sync(self, site_url: str, days: int) -> list[dict[str, Any]]:
        """Synchronous helper to fetch top pages."""
        return self._fetch_data_sync(site_url, days, ["page"])

    def _fetch_data_sync(
        self, site_url: str, days: int, dimensions: list[str]
    ) -> list[dict[str, Any]]:
        """Synchronous helper to query Search Console Performance API."""
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)

            request_body = {
                "startDate": start_date.strftime("%Y-%m-%d"),
                "endDate": end_date.strftime("%Y-%m-%d"),
                "dimensions": dimensions,
                "rowLimit": 100,
            }

            response = (
                self._service.searchanalytics()
                .query(siteUrl=site_url, body=request_body)
                .execute()
            )

            rows = response.get("rows", [])
            results = []

            for row in rows:
                keys = row.get("keys", [])
                key_name = dimensions[0]  # "query" or "page"

                result = {
                    key_name: keys[0] if keys else "",
                    "clicks": int(row.get("clicks", 0)),
                    "impressions": int(row.get("impressions", 0)),
                    "position": round(float(row.get("position", 0)), 2),
                    "ctr": round(float(row.get("ctr", 0)), 2),
                }
                results.append(result)

            return results

        except Exception as e:
            logger.error(f"Error fetching Search Console data for {site_url}: {e}")
            return []

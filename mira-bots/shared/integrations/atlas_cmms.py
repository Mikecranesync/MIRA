"""Atlas CMMS thin client — bot-adapter side.

Calls the mira-mcp REST proxy (/api/cmms/work-orders) rather than Atlas
directly.  Auth is handled by mira-mcp using ATLAS_API_USER / ATLAS_API_PASSWORD;
this client only needs the MCP_REST_API_KEY bearer token.

Usage in engine.py:
    client = AtlasCMMSClient(base_url=self.mcp_base_url, api_key=self.mcp_api_key)
    result = await client.create_work_order(title, description, priority)
    wo_id  = result.get("id")
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("mira-gsd")

_TIMEOUT = 15  # seconds


class AtlasCMMSClient:
    """Thin async wrapper around mira-mcp's /api/cmms REST surface."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("MCP_BASE_URL", "http://mira-mcp:8001")).rstrip("/")
        self.api_key = api_key or os.getenv("MCP_REST_API_KEY", "")

    @property
    def configured(self) -> bool:
        """True when mira-mcp URL is set (api_key is optional on dev installs)."""
        return bool(self.base_url)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: int = 0,
        category: str = "CORRECTIVE",
    ) -> dict:
        """POST /api/cmms/work-orders via mira-mcp.

        Returns the work-order dict on success (always contains "id").
        Returns {"error": "..."} on any failure — never raises.
        """
        payload = {
            "title": title[:100],
            "description": description[:2000],
            "priority": priority,
            "asset_id": asset_id,
            "category": category,
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/api/cmms/work-orders",
                    headers=self._headers(),
                    json=payload,
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(
                "CMMS WO create HTTP %d: %s",
                e.response.status_code,
                e.response.text[:200],
            )
            return {"error": f"HTTP {e.response.status_code}: {e.response.text[:100]}"}
        except Exception as e:
            logger.error("CMMS WO create failed: %s", e)
            return {"error": str(e)}

    async def health_check(self) -> bool:
        """GET /health — returns True when mira-mcp responds 200."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{self.base_url}/health",
                    headers=self._headers(),
                )
                return resp.status_code == 200
        except Exception as e:
            logger.warning("CMMS health check failed: %s", e)
            return False

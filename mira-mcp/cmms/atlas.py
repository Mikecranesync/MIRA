"""Atlas CMMS adapter — REST API client with JWT auth.

Atlas API runs at http://atlas-api:8080 inside Docker (core-net).
Refactored from the original atlas_client.py into the CMMSAdapter pattern.
"""

from __future__ import annotations

import logging
import os
import time

import httpx

from cmms.base import CMMSAdapter

logger = logging.getLogger("mira-cmms.atlas")


class AtlasCMMS(CMMSAdapter):
    """Atlas CMMS integration via REST API + JWT auth."""

    def __init__(self) -> None:
        self.api_url = os.environ.get("ATLAS_API_URL", "http://atlas-api:8080")
        self.user = os.environ.get("ATLAS_API_USER", "")
        self.password = os.environ.get("ATLAS_API_PASSWORD", "")
        self._token: str = ""
        self._token_expires: float = 0

    @property
    def configured(self) -> bool:
        return bool(self.user and self.password)

    async def _get_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token

        if not self.configured:
            logger.warning("ATLAS_API_USER or ATLAS_API_PASSWORD not set — CMMS disabled")
            return ""

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self.api_url}/auth/signin",
                json={"email": self.user, "password": self.password},
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data.get("accessToken", data.get("token", ""))
        self._token_expires = time.time() + 82800  # 23 hours
        logger.info("Atlas CMMS JWT acquired for user=%s", self.user)
        return self._token

    def _headers(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def _get(self, path: str, params: dict | None = None) -> dict:
        token = await self._get_token()
        if not token:
            return {"error": "Atlas CMMS not configured (missing credentials)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.api_url}{path}", headers=self._headers(token), params=params
            )
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, payload: dict) -> dict:
        token = await self._get_token()
        if not token:
            return {"error": "Atlas CMMS not configured (missing credentials)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.api_url}{path}", headers=self._headers(token), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    async def _patch(self, path: str, payload: dict) -> dict:
        token = await self._get_token()
        if not token:
            return {"error": "Atlas CMMS not configured (missing credentials)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(
                f"{self.api_url}{path}", headers=self._headers(token), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    # ── CMMSAdapter interface ────────────────────────────────────

    async def health_check(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.api_url}/health-check")
                resp.raise_for_status()
                return {"status": "ok", "provider": "atlas", "url": self.api_url}
        except Exception as e:
            return {"status": "unreachable", "provider": "atlas", "error": str(e)}

    async def list_work_orders(self, status: str = "", limit: int = 20) -> list[dict]:
        payload: dict = {"pageSize": limit, "pageNum": 0}
        if status:
            payload["status"] = status
        try:
            data = await self._post("/work-orders/search", payload)
            return data if isinstance(data, list) else data.get("content", [])
        except httpx.HTTPStatusError as e:
            logger.error("Atlas list_work_orders failed: %s", e)
            return []

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: str | None = None,
        category: str = "CORRECTIVE",
    ) -> dict:
        payload = {
            "title": title,
            "description": description,
            "priority": priority,
            "category": category,
            "status": "OPEN",
        }
        if asset_id is not None:
            payload["asset"] = {"id": int(asset_id)}
        try:
            result = await self._post("/work-orders", payload)
            logger.info("Atlas work order created: id=%s title=%s", result.get("id"), title)
            return result
        except httpx.HTTPStatusError as e:
            logger.error("Atlas create_work_order failed: %s %s", e.response.status_code, e.response.text[:200])
            return {"error": str(e)}

    async def complete_work_order(self, work_order_id: str, feedback: str = "") -> dict:
        payload: dict = {"status": "COMPLETE"}
        if feedback:
            payload["feedback"] = feedback
        try:
            return await self._patch(f"/work-orders/{work_order_id}", payload)
        except httpx.HTTPStatusError as e:
            logger.error("Atlas complete_work_order failed: %s", e)
            return {"error": str(e)}

    async def list_assets(self, limit: int = 50) -> list[dict]:
        try:
            data = await self._post("/assets/search", {"pageSize": limit, "pageNum": 0})
            return data if isinstance(data, list) else data.get("content", [])
        except httpx.HTTPStatusError as e:
            logger.error("Atlas list_assets failed: %s", e)
            return []

    async def get_asset(self, asset_id: str) -> dict:
        try:
            return await self._get(f"/assets/{asset_id}")
        except httpx.HTTPStatusError as e:
            logger.error("Atlas get_asset(%s) failed: %s", asset_id, e)
            return {"error": str(e)}

    async def list_pm_schedules(self, asset_id: str | None = None, limit: int = 20) -> list[dict]:
        payload: dict = {"pageSize": limit, "pageNum": 0}
        if asset_id is not None:
            payload["asset"] = {"id": int(asset_id)}
        try:
            data = await self._post("/preventive-maintenances/search", payload)
            return data if isinstance(data, list) else data.get("content", [])
        except httpx.HTTPStatusError as e:
            logger.error("Atlas list_pm_schedules failed: %s", e)
            return []

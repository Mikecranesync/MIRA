"""Limble CMMS adapter — REST API client with API key auth.

Limble API: https://api.limblecmms.com/v2
Auth: API key in header (x-api-key)
Free tier: basic work orders + asset management.

Sign up: https://limble.com/pricing (Free plan)
API docs: https://docs.limblecmms.com
"""

from __future__ import annotations

import logging
import os

import httpx

from cmms.base import CMMSAdapter

logger = logging.getLogger("mira-cmms.limble")

API_BASE = "https://api.limblecmms.com/v2"


class LimbleCMMS(CMMSAdapter):
    """Limble CMMS integration via REST API + API key."""

    def __init__(self) -> None:
        self.api_key = os.environ.get("LIMBLE_API_KEY", "")
        if not self.api_key:
            logger.warning("LIMBLE_API_KEY not set — Limble CMMS disabled")

    def _headers(self) -> dict:
        return {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    async def _get(self, path: str, params: dict | None = None) -> dict:
        if not self.api_key:
            return {"error": "Limble not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{API_BASE}{path}", headers=self._headers(), params=params
            )
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            return {"error": "Limble not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    async def _patch(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            return {"error": "Limble not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(
                f"{API_BASE}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    # ── CMMSAdapter interface ────────────────────────────────────

    async def health_check(self) -> dict:
        try:
            await self._get("/assets", params={"limit": 1})
            return {"status": "ok", "provider": "limble"}
        except Exception as e:
            return {"status": "unreachable", "provider": "limble", "error": str(e)}

    async def list_work_orders(self, status: str = "", limit: int = 20) -> list[dict]:
        params: dict = {"limit": limit}
        if status:
            params["status"] = status.lower()
        try:
            data = await self._get("/tasks", params=params)
            return data.get("data", data.get("tasks", []))
        except httpx.HTTPStatusError as e:
            logger.error("Limble list_work_orders failed: %s", e)
            return []

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: str | None = None,
        category: str = "CORRECTIVE",
    ) -> dict:
        # Limble priority: 1 (low) to 4 (critical)
        priority_map = {"NONE": 1, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
        payload = {
            "name": title,
            "description": description,
            "priority": priority_map.get(priority.upper(), 2),
            "type": "unplanned" if category.upper() in ("CORRECTIVE", "EMERGENCY") else "planned",
        }
        if asset_id:
            try:
                payload["assetId"] = int(asset_id)
            except ValueError:
                return {"error": f"Invalid asset_id '{asset_id}' — must be numeric for Limble"}
        try:
            result = await self._post("/tasks", payload)
            logger.info("Limble work order created: id=%s title=%s", result.get("id"), title)
            return result
        except httpx.HTTPStatusError as e:
            logger.error("Limble create_work_order failed: %s", e)
            return {"error": str(e)}

    async def complete_work_order(self, work_order_id: str, feedback: str = "") -> dict:
        payload: dict = {"status": "completed"}
        if feedback:
            payload["completionNotes"] = feedback
        try:
            return await self._patch(f"/tasks/{work_order_id}", payload)
        except httpx.HTTPStatusError as e:
            logger.error("Limble complete_work_order failed: %s", e)
            return {"error": str(e)}

    async def list_assets(self, limit: int = 50) -> list[dict]:
        try:
            data = await self._get("/assets", params={"limit": limit})
            return data.get("data", data.get("assets", []))
        except httpx.HTTPStatusError as e:
            logger.error("Limble list_assets failed: %s", e)
            return []

    async def get_asset(self, asset_id: str) -> dict:
        try:
            return await self._get(f"/assets/{asset_id}")
        except httpx.HTTPStatusError as e:
            logger.error("Limble get_asset(%s) failed: %s", asset_id, e)
            return {"error": str(e)}

    async def list_pm_schedules(self, asset_id: str | None = None, limit: int = 20) -> list[dict]:
        params: dict = {"limit": limit, "type": "planned"}
        if asset_id:
            params["assetId"] = asset_id
        try:
            data = await self._get("/tasks", params=params)
            return data.get("data", data.get("tasks", []))
        except httpx.HTTPStatusError as e:
            logger.error("Limble list_pm_schedules failed: %s", e)
            return []

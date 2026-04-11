"""MaintainX CMMS adapter — REST API client with API key auth.

MaintainX API: https://api.getmaintainx.com/v1
Auth: Bearer token (API key from Settings → Integrations)
Free tier: unlimited work orders, API access included.

Sign up: https://www.getmaintainx.com/pricing (Free plan)
API docs: https://developers.getmaintainx.com
"""

from __future__ import annotations

import logging
import os

import httpx

from cmms.base import CMMSAdapter

logger = logging.getLogger("mira-cmms.maintainx")

API_BASE = "https://api.getmaintainx.com/v1"


class MaintainXCMMS(CMMSAdapter):
    """MaintainX CMMS integration via REST API + API key."""

    def __init__(self) -> None:
        self.api_key = os.environ.get("MAINTAINX_API_KEY", "")
        if not self.api_key:
            logger.warning("MAINTAINX_API_KEY not set — MaintainX CMMS disabled")

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _get(self, path: str, params: dict | None = None) -> dict:
        if not self.api_key:
            return {"error": "MaintainX not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{API_BASE}{path}", headers=self._headers(), params=params
            )
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            return {"error": "MaintainX not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{API_BASE}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    async def _patch(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            return {"error": "MaintainX not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(
                f"{API_BASE}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    # ── CMMSAdapter interface ────────────────────────────────────

    async def health_check(self) -> dict:
        try:
            result = await self._get("/users/me")
            return {"status": "ok", "provider": "maintainx", "user": result.get("email", "")}
        except Exception as e:
            return {"status": "unreachable", "provider": "maintainx", "error": str(e)}

    async def list_work_orders(self, status: str = "", limit: int = 20) -> list[dict]:
        params: dict = {"limit": limit}
        if status:
            params["status"] = status.upper()
        try:
            data = await self._get("/workorders", params=params)
            return data.get("workOrders", data.get("data", []))
        except httpx.HTTPStatusError as e:
            logger.error("MaintainX list_work_orders failed: %s", e)
            return []

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: str | None = None,
        category: str = "CORRECTIVE",
    ) -> dict:
        # MaintainX priority: NONE, LOW, MEDIUM, HIGH
        # MaintainX category: REACTIVE, PREVENTIVE, INSPECTION, etc.
        category_map = {
            "CORRECTIVE": "REACTIVE",
            "PREVENTIVE": "PREVENTIVE",
            "CONDITION_BASED": "INSPECTION",
            "EMERGENCY": "REACTIVE",
        }
        payload = {
            "title": title,
            "description": description,
            "priority": priority.upper(),
            "categories": [category_map.get(category.upper(), "REACTIVE")],
        }
        if asset_id:
            try:
                payload["assetId"] = int(asset_id)
            except ValueError:
                return {"error": f"Invalid asset_id '{asset_id}' — must be numeric for MaintainX"}
        try:
            result = await self._post("/workorders", payload)
            logger.info(
                "MaintainX work order created: id=%s title=%s",
                result.get("id"),
                title,
            )
            return result
        except httpx.HTTPStatusError as e:
            logger.error("MaintainX create_work_order failed: %s", e)
            return {"error": str(e)}

    async def complete_work_order(self, work_order_id: str, feedback: str = "") -> dict:
        payload: dict = {"status": "DONE"}
        if feedback:
            payload["completionComment"] = feedback
        try:
            return await self._patch(f"/workorders/{work_order_id}", payload)
        except httpx.HTTPStatusError as e:
            logger.error("MaintainX complete_work_order failed: %s", e)
            return {"error": str(e)}

    async def list_assets(self, limit: int = 50) -> list[dict]:
        try:
            data = await self._get("/assets", params={"limit": limit})
            return data.get("assets", data.get("data", []))
        except httpx.HTTPStatusError as e:
            logger.error("MaintainX list_assets failed: %s", e)
            return []

    async def get_asset(self, asset_id: str) -> dict:
        try:
            return await self._get(f"/assets/{asset_id}")
        except httpx.HTTPStatusError as e:
            logger.error("MaintainX get_asset(%s) failed: %s", asset_id, e)
            return {"error": str(e)}

    async def list_pm_schedules(self, asset_id: str | None = None, limit: int = 20) -> list[dict]:
        params: dict = {"limit": limit, "categories": "PREVENTIVE"}
        if asset_id:
            params["assetId"] = asset_id
        try:
            # MaintainX models PMs as recurring work orders
            data = await self._get("/workorders", params=params)
            return data.get("workOrders", data.get("data", []))
        except httpx.HTTPStatusError as e:
            logger.error("MaintainX list_pm_schedules failed: %s", e)
            return []

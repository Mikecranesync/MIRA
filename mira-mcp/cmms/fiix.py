"""Fiix CMMS adapter — REST API client with API key auth.

Fiix (by Rockwell Automation) API: https://api.fiixsoftware.com
Auth: API key (bearer token)
Free Basic tier available.

Sign up: https://fiixsoftware.com
API docs: https://fiixsoftware.com/developers/
"""

from __future__ import annotations

import logging
import os

import httpx

from cmms.base import CMMSAdapter

logger = logging.getLogger("mira-cmms.fiix")


class FiixCMMS(CMMSAdapter):
    """Fiix CMMS integration via REST API + API key.

    Fiix is owned by Rockwell Automation — same customer base as MIRA
    (Allen-Bradley PLC shops). Strong strategic alignment.
    """

    def __init__(self) -> None:
        self.api_key = os.environ.get("FIIX_API_KEY", "")
        self.api_url = os.environ.get("FIIX_API_URL", "https://api.fiixsoftware.com/v2")
        if not self.api_key:
            logger.warning("FIIX_API_KEY not set — Fiix CMMS disabled")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _get(self, path: str, params: dict | None = None) -> dict:
        if not self.api_key:
            return {"error": "Fiix not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.api_url}{path}", headers=self._headers(), params=params
            )
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            return {"error": "Fiix not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.api_url}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    async def _patch(self, path: str, payload: dict) -> dict:
        if not self.api_key:
            return {"error": "Fiix not configured (missing API key)"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(
                f"{self.api_url}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

    # ── CMMSAdapter interface ────────────────────────────────────

    async def health_check(self) -> dict:
        try:
            await self._get("/account")
            return {"status": "ok", "provider": "fiix"}
        except Exception as e:
            return {"status": "unreachable", "provider": "fiix", "error": str(e)}

    async def list_work_orders(self, status: str = "", limit: int = 20) -> list[dict]:
        params: dict = {"limit": limit}
        if status:
            # Fiix uses intMaintenanceTypeID for status filtering
            params["status"] = status
        try:
            data = await self._get("/work-orders", params=params)
            return data.get("data", data.get("workOrders", []))
        except httpx.HTTPStatusError as e:
            logger.error("Fiix list_work_orders failed: %s", e)
            return []

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: str | None = None,
        category: str = "CORRECTIVE",
    ) -> dict:
        # Fiix priority: 0=None, 1=Lowest, 2=Low, 3=Medium, 4=High, 5=Highest
        priority_map = {"NONE": 0, "LOW": 2, "MEDIUM": 3, "HIGH": 4, "CRITICAL": 5}
        payload = {
            "strDescription": title,
            "strLongDescription": description,
            "intPriorityID": priority_map.get(priority.upper(), 3),
        }
        if asset_id:
            payload["intAssetID"] = int(asset_id)
        try:
            result = await self._post("/work-orders", payload)
            logger.info("Fiix work order created: id=%s title=%s", result.get("id"), title)
            return result
        except httpx.HTTPStatusError as e:
            logger.error("Fiix create_work_order failed: %s", e)
            return {"error": str(e)}

    async def complete_work_order(self, work_order_id: str, feedback: str = "") -> dict:
        payload: dict = {"intWorkOrderStatusID": 2}  # 2 = Completed in Fiix
        if feedback:
            payload["strCompletionNotes"] = feedback
        try:
            return await self._patch(f"/work-orders/{work_order_id}", payload)
        except httpx.HTTPStatusError as e:
            logger.error("Fiix complete_work_order failed: %s", e)
            return {"error": str(e)}

    async def list_assets(self, limit: int = 50) -> list[dict]:
        try:
            data = await self._get("/assets", params={"limit": limit})
            return data.get("data", data.get("assets", []))
        except httpx.HTTPStatusError as e:
            logger.error("Fiix list_assets failed: %s", e)
            return []

    async def get_asset(self, asset_id: str) -> dict:
        try:
            return await self._get(f"/assets/{asset_id}")
        except httpx.HTTPStatusError as e:
            logger.error("Fiix get_asset(%s) failed: %s", asset_id, e)
            return {"error": str(e)}

    async def list_pm_schedules(self, asset_id: str | None = None, limit: int = 20) -> list[dict]:
        params: dict = {"limit": limit}
        if asset_id:
            params["intAssetID"] = asset_id
        try:
            data = await self._get("/scheduled-maintenances", params=params)
            return data.get("data", data.get("scheduledMaintenances", []))
        except httpx.HTTPStatusError as e:
            logger.error("Fiix list_pm_schedules failed: %s", e)
            return []

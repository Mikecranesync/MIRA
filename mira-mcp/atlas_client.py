"""Atlas CMMS REST API client for MIRA integration.

Thin httpx wrapper — handles JWT auth, work orders, assets, PM schedules.
Atlas API runs at http://atlas-api:8080 inside Docker (core-net).
"""

import logging
import os
import time

import httpx

logger = logging.getLogger("mira-atlas")

ATLAS_API_URL = os.environ.get("ATLAS_API_URL", "http://atlas-api:8080")
ATLAS_USER = os.environ.get("ATLAS_API_USER", "")
ATLAS_PASSWORD = os.environ.get("ATLAS_API_PASSWORD", "")

# JWT token cache
_token: str = ""
_token_expires: float = 0


async def _get_token() -> str:
    """Authenticate and cache JWT token."""
    global _token, _token_expires

    if _token and time.time() < _token_expires:
        return _token

    if not ATLAS_USER or not ATLAS_PASSWORD:
        logger.warning("ATLAS_API_USER or ATLAS_API_PASSWORD not set — CMMS disabled")
        return ""

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{ATLAS_API_URL}/api/auth/signin",
            json={"email": ATLAS_USER, "password": ATLAS_PASSWORD},
        )
        resp.raise_for_status()
        data = resp.json()

    _token = data.get("accessToken", data.get("token", ""))
    # Cache for 23 hours (JWT typically valid 24h)
    _token_expires = time.time() + 82800
    logger.info("Atlas CMMS JWT acquired for user=%s", ATLAS_USER)
    return _token


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


async def _get(path: str, params: dict | None = None) -> dict:
    """Authenticated GET request to Atlas API."""
    token = await _get_token()
    if not token:
        return {"error": "Atlas CMMS not configured (missing credentials)"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{ATLAS_API_URL}{path}",
            headers=_headers(token),
            params=params,
        )
        resp.raise_for_status()
        return resp.json()


async def _post(path: str, payload: dict) -> dict:
    """Authenticated POST request to Atlas API."""
    token = await _get_token()
    if not token:
        return {"error": "Atlas CMMS not configured (missing credentials)"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{ATLAS_API_URL}{path}",
            headers=_headers(token),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def _patch(path: str, payload: dict) -> dict:
    """Authenticated PATCH request to Atlas API."""
    token = await _get_token()
    if not token:
        return {"error": "Atlas CMMS not configured (missing credentials)"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(
            f"{ATLAS_API_URL}{path}",
            headers=_headers(token),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


# ── Work Orders ──────────────────────────────────────────────


async def list_work_orders(status: str = "", limit: int = 20) -> list[dict]:
    """List work orders, optionally filtered by status."""
    params = {"pageSize": limit}
    if status:
        params["status"] = status
    try:
        data = await _get("/api/work-orders", params)
        return data if isinstance(data, list) else data.get("content", [data])
    except httpx.HTTPStatusError as e:
        logger.error("Atlas list_work_orders failed: %s", e)
        return []


async def create_work_order(
    title: str,
    description: str,
    priority: str = "MEDIUM",
    asset_id: int | None = None,
    category: str = "CORRECTIVE",
) -> dict:
    """Create a work order in Atlas CMMS.

    Args:
        title: Short summary (e.g., "VFD overcurrent fault on Pump-001")
        description: Full diagnostic context from MIRA
        priority: NONE, LOW, MEDIUM, HIGH
        asset_id: Atlas asset ID (if known)
        category: CORRECTIVE, PREVENTIVE, CONDITION_BASED, EMERGENCY
    """
    payload = {
        "title": title,
        "description": description,
        "priority": priority,
        "category": category,
        "status": "OPEN",
    }
    if asset_id is not None:
        payload["asset"] = {"id": asset_id}
    try:
        result = await _post("/api/work-orders", payload)
        logger.info("Atlas work order created: id=%s title=%s", result.get("id"), title)
        return result
    except httpx.HTTPStatusError as e:
        logger.error(
            "Atlas create_work_order failed: %s %s", e.response.status_code, e.response.text[:200]
        )
        return {"error": str(e)}


async def complete_work_order(work_order_id: int, feedback: str = "") -> dict:
    """Mark a work order as complete."""
    payload = {"status": "COMPLETE"}
    if feedback:
        payload["feedback"] = feedback
    try:
        return await _patch(f"/api/work-orders/{work_order_id}", payload)
    except httpx.HTTPStatusError as e:
        logger.error("Atlas complete_work_order failed: %s", e)
        return {"error": str(e)}


# ── Assets ───────────────────────────────────────────────────


async def list_assets(limit: int = 50) -> list[dict]:
    """List all equipment assets registered in Atlas CMMS."""
    try:
        data = await _get("/api/assets", {"pageSize": limit})
        return data if isinstance(data, list) else data.get("content", [data])
    except httpx.HTTPStatusError as e:
        logger.error("Atlas list_assets failed: %s", e)
        return []


async def get_asset(asset_id: int) -> dict:
    """Get a single asset by ID."""
    try:
        return await _get(f"/api/assets/{asset_id}")
    except httpx.HTTPStatusError as e:
        logger.error("Atlas get_asset(%s) failed: %s", asset_id, e)
        return {"error": str(e)}


# ── Preventive Maintenance ───────────────────────────────────


async def list_pm_schedules(asset_id: int | None = None, limit: int = 20) -> list[dict]:
    """List preventive maintenance schedules."""
    params = {"pageSize": limit}
    if asset_id is not None:
        params["asset"] = asset_id
    try:
        data = await _get("/api/preventive-maintenances", params)
        return data if isinstance(data, list) else data.get("content", [data])
    except httpx.HTTPStatusError as e:
        logger.error("Atlas list_pm_schedules failed: %s", e)
        return []


# ── Health ───────────────────────────────────────────────────


async def health_check() -> dict:
    """Check Atlas CMMS API availability."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{ATLAS_API_URL}/actuator/health")
            resp.raise_for_status()
            return {"status": "ok", "atlas_url": ATLAS_API_URL}
    except Exception as e:
        return {"status": "unreachable", "error": str(e), "atlas_url": ATLAS_API_URL}

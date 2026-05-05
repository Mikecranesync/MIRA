from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("mira-scan.monday")

MONDAY_API_TOKEN = os.getenv("MONDAY_API_TOKEN", "")
MONDAY_API_URL = os.getenv("MONDAY_API_URL", "https://api.monday.com/v2")
MONDAY_API_VERSION = os.getenv("MONDAY_API_VERSION", "2024-01")


class MondayError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    if not MONDAY_API_TOKEN:
        raise MondayError("MONDAY_API_TOKEN is not configured")
    return {
        "Authorization": MONDAY_API_TOKEN,
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
    }


async def _gql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            MONDAY_API_URL,
            headers=_headers(),
            json={"query": query, "variables": variables},
        )
        resp.raise_for_status()
        data = resp.json()
    if data.get("errors"):
        raise MondayError(json.dumps(data["errors"]))
    return data.get("data") or {}


UPDATE_QUERY = """
mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
  change_multiple_column_values(
    board_id: $boardId,
    item_id: $itemId,
    column_values: $columnValues
  ) {
    id
  }
}
""".strip()


async def update_item_columns(
    board_id: str,
    item_id: str,
    columns: dict[str, Any],
) -> str:
    """Update one or more column values on a monday.com item.

    `columns` keys are monday column ids; values follow the shape monday
    expects per column type (text → str, status → {"label": "..."}, etc.).
    """
    variables = {
        "boardId": str(board_id),
        "itemId": str(item_id),
        "columnValues": json.dumps(columns),
    }
    data = await _gql(UPDATE_QUERY, variables)
    payload = data.get("change_multiple_column_values") or {}
    new_id = payload.get("id")
    if not new_id:
        raise MondayError(f"monday returned no item id: {data!r}")
    return str(new_id)


def asset_plate_to_columns(plate_dict: dict[str, Any]) -> dict[str, Any]:
    """Convert an AssetPlate dict to monday-friendly column values.

    Column ids are configurable via env so a board admin can map them
    without touching code.
    """
    cmap = {
        "make": os.getenv("MONDAY_COL_MAKE", "make"),
        "model": os.getenv("MONDAY_COL_MODEL", "model"),
        "serial": os.getenv("MONDAY_COL_SERIAL", "serial"),
        "voltage": os.getenv("MONDAY_COL_VOLTAGE", "voltage"),
        "hp": os.getenv("MONDAY_COL_HP", "hp"),
        "rpm": os.getenv("MONDAY_COL_RPM", "rpm"),
        "hz": os.getenv("MONDAY_COL_HZ", "hz"),
        "frame": os.getenv("MONDAY_COL_FRAME", "frame"),
    }
    out: dict[str, Any] = {}
    for field, col_id in cmap.items():
        val = plate_dict.get(field)
        if val is None or val == "":
            continue
        out[col_id] = str(val)
    return out

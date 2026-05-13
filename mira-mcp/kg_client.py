"""HTTP client for the mira-hub internal KG dispatch endpoint (Phase 5).

mira-hub owns the database. This module is a thin proxy so FastMCP tools
can expose the multi-hop traversal API to MCP clients (Open WebUI,
Claude Desktop, external agents) without duplicating SQL.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_HUB_URL = os.environ.get("MIRA_HUB_URL", "http://mira-hub:3000")
DEFAULT_TIMEOUT_S = float(os.environ.get("MIRA_HUB_TIMEOUT_S", "12"))


class KgClientError(RuntimeError):
    """Raised when the hub returns an error response."""


def _client_kwargs() -> dict[str, Any]:
    api_key = os.environ.get("INTERNAL_KG_API_KEY", "")
    return {
        "base_url": DEFAULT_HUB_URL,
        "timeout": DEFAULT_TIMEOUT_S,
        "headers": {
            "Authorization": f"Bearer {api_key}" if api_key else "",
            "Content-Type": "application/json",
        },
    }


def _post(op: str, tenant_id: str, args: dict[str, Any]) -> Any:
    if not os.environ.get("INTERNAL_KG_API_KEY"):
        raise KgClientError("INTERNAL_KG_API_KEY unset; KG tools disabled")
    body = {"op": op, "tenantId": tenant_id, "args": args}
    try:
        with httpx.Client(**_client_kwargs()) as client:
            resp = client.post("/api/internal/kg", json=body)
    except httpx.HTTPError as exc:
        raise KgClientError(f"hub unreachable: {exc}") from exc
    if resp.status_code >= 400:
        raise KgClientError(f"hub {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    if not data.get("ok"):
        raise KgClientError(data.get("error", "unknown error"))
    return data.get("result")


# ── Public client functions (one per op) ──────────────────────────────────


def maintenance_context(
    tenant_id: str,
    equipment_entity_id: str = "",
    *,
    uns_path: Optional[str] = None,
    include_similar: bool = False,
    fault_window_days: Optional[int] = None,
    max_work_orders: Optional[int] = None,
) -> Any:
    """Aggregated maintenance context. Pass `equipment_entity_id` OR `uns_path`.

    The hub-side `resolveEntityArg` accepts either an entity UUID or an
    `unsPath` ltree address — see mira-hub/src/app/api/internal/kg/route.ts.
    """
    args: dict[str, Any] = {"includeSimilar": include_similar}
    if equipment_entity_id:
        args["equipmentEntityId"] = equipment_entity_id
    if uns_path:
        args["unsPath"] = uns_path
    if fault_window_days is not None:
        args["faultWindowDays"] = fault_window_days
    if max_work_orders is not None:
        args["maxWorkOrders"] = max_work_orders
    return _post("maintenance_context", tenant_id, args)


def resolve_uns_path(tenant_id: str, uns_path: str) -> Any:
    """Resolve an ltree UNS path to a kg_entities row.

    Returns the entity record (id, entity_type, name, uns_path, properties)
    or raises KgClientError if no match. Hub op: `resolve_uns_path`.
    """
    return _post("resolve_uns_path", tenant_id, {"unsPath": uns_path})


def entities_under_uns_path(
    tenant_id: str,
    uns_path: str,
    *,
    limit: Optional[int] = None,
) -> Any:
    """List entities living under a UNS subtree (descendants of `uns_path`).

    Uses Postgres ltree `<@` (is-descendant) on the hub side. Hub op:
    `entities_under_uns_path`.
    """
    args: dict[str, Any] = {"unsPath": uns_path}
    if limit is not None:
        args["limit"] = limit
    return _post("entities_under_uns_path", tenant_id, args)


def impact_analysis(tenant_id: str, entity_id: str) -> Any:
    return _post("impact_analysis", tenant_id, {"entityId": entity_id})


def root_cause_chain(tenant_id: str, fault_entity_id: str) -> Any:
    return _post("root_cause_chain", tenant_id, {"faultEntityId": fault_entity_id})


def traverse_chain(
    tenant_id: str,
    start_entity_id: str,
    relationship_chain: list[str],
    max_depth: Optional[int] = None,
) -> Any:
    args: dict[str, Any] = {
        "startEntityId": start_entity_id,
        "relationshipChain": relationship_chain,
    }
    if max_depth is not None:
        args["maxDepth"] = max_depth
    return _post("traverse_chain", tenant_id, args)


def flag_pm_mismatches(
    tenant_id: str,
    *,
    lookback_days: Optional[int] = None,
    equipment_entity_id: Optional[str] = None,
) -> Any:
    args: dict[str, Any] = {}
    if lookback_days is not None:
        args["lookbackDays"] = lookback_days
    if equipment_entity_id is not None:
        args["equipmentEntityId"] = equipment_entity_id
    return _post("flag_pm_mismatches", tenant_id, args)


def upsert_schematic(
    tenant_id: str,
    payload: dict[str, Any],
    *,
    parent_equipment_id: Optional[str] = None,
) -> Any:
    """Persist the entities + relationships from a schematic_intelligence
    pipeline result. ``payload`` is the dict returned by ``to_kg_payload``.
    ``parent_equipment_id`` overrides the value embedded in payload (used by
    the bot's ``store_documentation`` action to scope a previously-extracted
    schematic to a named plant/equipment).
    """
    args = {
        "schematic_type": payload.get("schematic_type"),
        "parent_equipment_id": parent_equipment_id or payload.get("parent_equipment_id"),
        "entities": payload.get("entities", []),
        "relationships": payload.get("relationships", []),
    }
    return _post("schematic_upsert", tenant_id, args)

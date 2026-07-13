"""MCP tool wrapper for the FactoryLM external AI conveyor demo."""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from .conveyor_context import ConveyorContextSDK

TOOL_NAMES = [
    "factorylm_find_asset",
    "factorylm_get_asset_context",
    "factorylm_list_asset_tags",
    "factorylm_get_tag_context",
    "factorylm_search_evidence",
    "factorylm_list_related_assets",
    "factorylm_get_diagnostic_context",
    "factorylm_get_live_value",
    "factorylm_get_conveyor_status",
]

BASE_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["status", "asset_id", "asset_name", "uns_path", "approval_status", "confidence", "warnings"],
    "additionalProperties": True,
    "properties": {
        "status": {"type": "string"},
        "asset_id": {"type": "string"},
        "asset_name": {"type": "string"},
        "uns_path": {"type": "string"},
        "approval_status": {"type": "string"},
        "confidence": {"type": "number"},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
}

READ_ONLY_ANNOTATIONS = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "openWorldHint": False,
    "idempotentHint": True,
}


def build_mcp_toolset(sdk: ConveyorContextSDK | None = None) -> dict[str, dict[str, Any]]:
    """Return MCP tool metadata plus handlers without requiring FastMCP imports."""

    sdk = sdk or ConveyorContextSDK()
    return {
        "factorylm_find_asset": _definition(
            "Find an approved FactoryLM asset by name or UNS path.",
            {"query": {"type": "string", "description": "Asset query, such as conveyor."}},
            lambda query="conveyor": sdk.find_asset(query),
        ),
        "factorylm_get_asset_context": _definition(
            "Get approved FactoryLM context for the garage conveyor asset.",
            {"asset_id": {"type": "string", "description": "Asset id or UNS path."}},
            lambda asset_id="conveyor_1": sdk.get_asset_context(asset_id),
        ),
        "factorylm_list_asset_tags": _definition(
            "List approved tags belonging to the conveyor asset.",
            {"asset_id": {"type": "string", "description": "Asset id or UNS path."}},
            lambda asset_id="conveyor_1": sdk.list_asset_tags(asset_id),
        ),
        "factorylm_get_tag_context": _definition(
            "Get approved context for one conveyor tag.",
            {"tag_id": {"type": "string", "description": "Approved tag id or source tag path."}},
            lambda tag_id: sdk.get_tag_context(tag_id),
        ),
        "factorylm_search_evidence": _definition(
            "Search approved evidence documents for the conveyor.",
            {"query": {"type": "string", "description": "Evidence search query."}},
            lambda query: sdk.search_evidence(query),
        ),
        "factorylm_list_related_assets": _definition(
            "List approved components related to the conveyor.",
            {"asset_id": {"type": "string", "description": "Asset id or UNS path."}},
            lambda asset_id="conveyor_1": sdk.list_related_assets(asset_id),
        ),
        "factorylm_get_diagnostic_context": _definition(
            "Get evidence-backed diagnostic context for conveyor questions without control actions.",
            {"question": {"type": "string", "description": "Diagnostic question."}},
            lambda question="": sdk.get_diagnostic_context(question),
        ),
        "factorylm_get_live_value": _definition(
            "Read an approved conveyor live value through the safe read-only path.",
            {"tag_id": {"type": "string", "description": "Approved tag id or source tag path."}},
            lambda tag_id: sdk.get_live_value(tag_id),
        ),
        "factorylm_get_conveyor_status": _definition(
            "Return a convenience status summary for the garage conveyor.",
            {"asset_id": {"type": "string", "description": "Asset id or UNS path."}},
            lambda asset_id="conveyor_1": sdk.get_conveyor_status(asset_id),
        ),
    }


def create_fastmcp_server(sdk: ConveyorContextSDK | None = None):
    """Create a FastMCP server for remote ChatGPT/App connector development."""

    try:
        from fastmcp import FastMCP
    except ModuleNotFoundError as exc:
        raise RuntimeError("fastmcp is required to run the FactoryLM external AI MCP server") from exc

    mcp = FastMCP("factorylm-conveyor")
    tools = build_mcp_toolset(sdk)

    async def factorylm_find_asset(query: str = "conveyor") -> dict[str, Any]:
        return sdk.find_asset(query)

    async def factorylm_get_asset_context(asset_id: str = "conveyor_1") -> dict[str, Any]:
        return sdk.get_asset_context(asset_id)

    async def factorylm_list_asset_tags(asset_id: str = "conveyor_1") -> dict[str, Any]:
        return sdk.list_asset_tags(asset_id)

    async def factorylm_get_tag_context(tag_id: str) -> dict[str, Any]:
        return sdk.get_tag_context(tag_id)

    async def factorylm_search_evidence(query: str) -> dict[str, Any]:
        return sdk.search_evidence(query)

    async def factorylm_list_related_assets(asset_id: str = "conveyor_1") -> dict[str, Any]:
        return sdk.list_related_assets(asset_id)

    async def factorylm_get_diagnostic_context(question: str = "") -> dict[str, Any]:
        return sdk.get_diagnostic_context(question)

    async def factorylm_get_live_value(tag_id: str) -> dict[str, Any]:
        return sdk.get_live_value(tag_id)

    async def factorylm_get_conveyor_status(asset_id: str = "conveyor_1") -> dict[str, Any]:
        return sdk.get_conveyor_status(asset_id)

    for func in (
        factorylm_find_asset,
        factorylm_get_asset_context,
        factorylm_list_asset_tags,
        factorylm_get_tag_context,
        factorylm_search_evidence,
        factorylm_list_related_assets,
        factorylm_get_diagnostic_context,
        factorylm_get_live_value,
        factorylm_get_conveyor_status,
    ):
        _register_tool(mcp, func.__name__, tools[func.__name__], func)
    return mcp


def _definition(
    description: str,
    properties: dict[str, Any],
    handler: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    return {
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "additionalProperties": False,
        },
        "output_schema": BASE_OUTPUT_SCHEMA,
        "annotations": READ_ONLY_ANNOTATIONS,
        "handler": handler,
    }


def _register_tool(mcp: Any, name: str, definition: dict[str, Any], func: Callable[..., Any]) -> None:
    func.__doc__ = definition["description"]
    # FastMCP versions differ in how much descriptor metadata they accept. The
    # docstring and type-hinted handler remain the compatibility baseline.
    try:
        mcp.tool(
            name=name,
            description=definition["description"],
            annotations=definition["annotations"],
        )(func)
    except TypeError:
        mcp.tool(func)


def main() -> None:
    mcp = create_fastmcp_server()
    host = os.environ.get("FACTORYLM_EXTERNAL_AI_HOST", "0.0.0.0")
    port = int(os.environ.get("FACTORYLM_EXTERNAL_AI_PORT", "8012"))
    mcp.run(transport="streamable-http", host=host, port=port)


if __name__ == "__main__":
    main()

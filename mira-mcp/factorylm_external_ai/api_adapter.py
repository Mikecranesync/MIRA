"""HTTP API adapter for the FactoryLM external AI context SDK."""

from __future__ import annotations

from typing import Any

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from .conveyor_context import ConveyorContextSDK


def create_api_app(sdk: ConveyorContextSDK | None = None) -> Starlette:
    """Create a read-only HTTP API that wraps the FactoryLM context SDK."""

    sdk = sdk or ConveyorContextSDK()

    async def health(request):
        return JSONResponse({"status": "ok", "service": "factorylm-external-ai-api"})

    async def asset_search(request):
        result = sdk.find_asset(request.query_params.get("q", ""))
        return _json(result)

    async def asset_context(request):
        result = sdk.get_asset_context(request.path_params["asset_id"])
        return _json(result)

    async def asset_tags(request):
        result = sdk.list_asset_tags(request.path_params["asset_id"])
        return _json(result)

    async def tag_context(request):
        result = sdk.get_tag_context(request.path_params["tag_id"])
        return _json(result)

    async def evidence_search(request):
        result = sdk.search_evidence(
            request.path_params["asset_id"],
            request.query_params.get("q", ""),
        )
        return _json(result)

    async def diagnostic_context(request):
        result = sdk.get_diagnostic_context(
            request.path_params["asset_id"],
            request.query_params.get("q", ""),
        )
        return _json(result)

    async def live_value(request):
        result = sdk.get_live_value(request.path_params["tag_id"])
        status_code = 200 if result["status"] in {"ok", "not_available"} else 404
        return JSONResponse(result, status_code=status_code)

    async def conveyor_status(request):
        result = sdk.get_conveyor_status(request.path_params.get("asset_id", "conveyor_1"))
        return _json(result)

    return Starlette(
        routes=[
            Route("/health", health, methods=["GET"]),
            Route("/api/external-ai/assets/search", asset_search, methods=["GET"]),
            Route("/api/external-ai/assets/{asset_id:str}/context", asset_context, methods=["GET"]),
            Route("/api/external-ai/assets/{asset_id:str}/tags", asset_tags, methods=["GET"]),
            Route("/api/external-ai/tags/{tag_id:str}/context", tag_context, methods=["GET"]),
            Route("/api/external-ai/assets/{asset_id:str}/evidence", evidence_search, methods=["GET"]),
            Route("/api/external-ai/assets/{asset_id:str}/diagnostics", diagnostic_context, methods=["GET"]),
            Route("/api/external-ai/live/{tag_id:str}", live_value, methods=["GET"]),
            Route("/api/external-ai/assets/{asset_id:str}/status", conveyor_status, methods=["GET"]),
        ]
    )


def _json(result: dict[str, Any]) -> JSONResponse:
    status_code = 200 if result.get("status") == "ok" else 404
    return JSONResponse(result, status_code=status_code)

"""Public HTTPS-ready HTTP surface. Bearer on every tool call. No CAO bind."""

from __future__ import annotations

import json
from typing import Any

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from fleet_gateway.auth import configured_bearer
from fleet_gateway.errors import FleetGatewayError
from fleet_gateway.mcp_rpc import mcp_get, mcp_post
from fleet_gateway.service import FleetGatewayService


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Require Authorization: Bearer {FLEET_GATEWAY_BEARER} except /health."""

    def __init__(self, app, token: str) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.token = token

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path == "/health":
            return await call_next(request)
        from fleet_gateway.auth import require_bearer
        from fleet_gateway.errors import AuthenticationError

        try:
            require_bearer(self.token, request.headers.get("Authorization"))
        except AuthenticationError as exc:
            return JSONResponse({"error": "unauthorized", "detail": str(exc)}, status_code=401)
        return await call_next(request)


def create_http_app(service: FleetGatewayService) -> Starlette:
    async def health(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "service": "fleet-gateway"})

    async def list_tools(_request: Request) -> JSONResponse:
        return JSONResponse({"tools": service.list_tools()})

    async def invoke_tool(request: Request) -> JSONResponse:
        name = request.path_params["name"]
        if request.method == "GET" and name in {"fleet_status", "task_status"}:
            params: dict[str, Any] = dict(request.query_params)
        else:
            if request.headers.get("content-type", "").startswith("application/json"):
                try:
                    body = await request.json()
                except json.JSONDecodeError:
                    return JSONResponse({"error": "invalid json"}, status_code=400)
                params = body if isinstance(body, dict) else {}
            else:
                params = {}
        requester = request.headers.get("X-Fleet-Requester") or service.default_requester
        try:
            result = service.invoke(
                name,
                params,
                authorization=request.headers.get("Authorization"),
                requester=requester,
            )
        except FleetGatewayError as exc:
            return JSONResponse(
                {"error": type(exc).__name__, "detail": str(exc)},
                status_code=exc.http_status,
            )
        return JSONResponse(result)

    app = Starlette(
        routes=[
            Route("/health", health),
            Route("/mcp", mcp_post, methods=["POST"]),
            Route("/mcp", mcp_get, methods=["GET"]),
            Route("/tools", list_tools),
            Route("/tools/{name}", invoke_tool, methods=["GET", "POST"]),
        ]
    )
    app.add_middleware(BearerAuthMiddleware, token=service.bearer_token)
    app.state.service = service
    return app


def default_bind_host() -> str:
    """Gateway defaults to loopback. Public bind is a later Mike-approved step."""
    import os

    return (os.environ.get("FLEET_GATEWAY_HOST") or "127.0.0.1").strip() or "127.0.0.1"


def default_bind_port() -> int:
    import os

    raw = (os.environ.get("FLEET_GATEWAY_PORT") or "8765").strip()
    return int(raw)


def env_configured() -> bool:
    return bool(configured_bearer())

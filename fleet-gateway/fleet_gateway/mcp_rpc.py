"""MCP JSON-RPC 2.0 over HTTP POST /mcp. Incoming bearer is required (middleware + invoke)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from fleet_gateway import FLEET_GATEWAY_VERSION
from fleet_gateway.contract import ALLOWED_TOOLS
from fleet_gateway.errors import FleetGatewayError
from fleet_gateway.service import FleetGatewayService

JSONRPC = "2.0"
SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
DEFAULT_PROTOCOL_VERSION = "2025-03-26"

TOOL_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": "fleet_status",
        "description": (
            "Node/CAO/Claude/Codex health, session, heartbeat, context. No IPs/ports/secrets."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "task_status",
        "description": "Task ID, node/provider, git identity, checks, review, blockers, commit-match.",
        "inputSchema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_legacy_sessions",
        "description": (
            "Read-only discover running legacy Claude/Codex sessions on one physical node."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"role": {"type": "string", "enum": ["bravo", "charlie", "alpha"]}},
            "required": ["role"],
            "additionalProperties": False,
        },
    },
    {
        "name": "launch_worker",
        "description": "Launch bravo|charlie on claude|codex in an isolated worktree. No merge/deploy.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "role": {"type": "string", "enum": ["bravo", "charlie"]},
                "provider": {"type": "string", "enum": ["claude", "codex"]},
                "task_id": {"type": "string"},
                "github_ref": {"type": "string"},
                "base_commit": {"type": "string"},
                "acceptance_criteria": {"type": "string"},
                "isolated_worktree": {"type": "boolean", "default": True},
            },
            "required": [
                "role",
                "provider",
                "task_id",
                "github_ref",
                "base_commit",
                "acceptance_criteria",
            ],
        },
    },
    {
        "name": "message_worker",
        "description": "Send text to one session id. Chat is never treated as done.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["session_id", "text"],
        },
    },
    {
        "name": "request_handoff",
        "description": "Write a durable HANDOFF artifact and stop claiming the task.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "task_id": {"type": "string"},
            },
            "required": ["session_id", "task_id"],
        },
    },
    {
        "name": "request_review",
        "description": "Charlie-only independent review of an exact Git ref (not a Bravo summary).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "git_ref": {"type": "string"},
                "task_id": {"type": "string"},
            },
            "required": ["session_id", "git_ref"],
        },
    },
    {
        "name": "stop_worker",
        "description": "Stop one session id. Not a node, not CAO, not a worktree delete.",
        "inputSchema": {
            "type": "object",
            "properties": {"session_id": {"type": "string"}},
            "required": ["session_id"],
        },
    },
    {
        "name": "adopt_legacy_session",
        "description": (
            "Adopt exactly one uniquely mapped legacy session into Gateway ownership. No launch."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "role": {"type": "string", "enum": ["bravo", "charlie", "alpha"]},
                "external_id": {"type": "string"},
            },
            "required": ["role", "external_id"],
        },
    },
)

assert tuple(item["name"] for item in TOOL_DEFINITIONS) == ALLOWED_TOOLS


def _result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC, "id": req_id, "result": result}


def _error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC, "id": req_id, "error": {"code": code, "message": message}}


def _wants_sse(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    return "text/event-stream" in accept and "application/json" not in accept


def _encode_payload(request: Request, payload: dict[str, Any], *, status: int = 200) -> Response:
    if _wants_sse(request):
        data = json.dumps(payload, separators=(",", ":"))
        body = f"event: message\ndata: {data}\n\n"

        async def gen():  # type: ignore[no-untyped-def]
            yield body.encode("utf-8")

        return StreamingResponse(
            gen(),
            status_code=status,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )
    return JSONResponse(payload, status_code=status)


def handle_rpc(
    service: FleetGatewayService,
    payload: dict[str, Any],
    *,
    authorization: str | None,
    requester: str,
) -> tuple[dict[str, Any] | None, int]:
    """Return (jsonrpc body or None, http status). None body means notification (202)."""
    if payload.get("jsonrpc") != JSONRPC:
        return _error(payload.get("id"), -32600, "invalid jsonrpc version"), 200
    method = payload.get("method")
    req_id = payload.get("id")
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    is_notification = "id" not in payload or method == "notifications/initialized"

    if method == "notifications/initialized" or (
        isinstance(method, str)
        and method.startswith("notifications/")
        and is_notification
        and method != "ping"
    ):
        if method == "notifications/initialized" or (is_notification and req_id is None):
            return None, 202

    if method == "initialize":
        requested = str(params.get("protocolVersion") or DEFAULT_PROTOCOL_VERSION)
        version = (
            requested if requested in SUPPORTED_PROTOCOL_VERSIONS else DEFAULT_PROTOCOL_VERSION
        )
        return (
            _result(
                req_id,
                {
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "fleet-gateway", "version": FLEET_GATEWAY_VERSION},
                },
            ),
            200,
        )

    if method == "ping":
        return _result(req_id, {}), 200

    if method == "tools/list":
        return _result(req_id, {"tools": [dict(item) for item in TOOL_DEFINITIONS]}), 200

    if method == "tools/call":
        name = str(params.get("name") or "").strip()
        arguments = params.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {}
        if not name:
            return _error(req_id, -32602, "tools/call requires params.name"), 200
        try:
            result = service.invoke(
                name,
                arguments,
                authorization=authorization,
                requester=requester,
            )
        except FleetGatewayError as exc:
            return (
                _result(
                    req_id,
                    {
                        "content": [{"type": "text", "text": str(exc)}],
                        "isError": True,
                    },
                ),
                200,
            )
        text = json.dumps(result, sort_keys=True)
        return (
            _result(
                req_id,
                {
                    "content": [{"type": "text", "text": text}],
                    "isError": False,
                    "structuredContent": result,
                },
            ),
            200,
        )

    if isinstance(method, str) and method.startswith("notifications/"):
        return None, 202

    return _error(req_id, -32601, f"method not found: {method}"), 200


async def mcp_post(request: Request) -> Response:
    service: FleetGatewayService = request.app.state.service
    try:
        payload = await request.json()
    except (json.JSONDecodeError, ValueError):
        return _encode_payload(
            request,
            _error(None, -32700, "parse error"),
            status=400,
        )
    if not isinstance(payload, dict):
        return _encode_payload(
            request,
            _error(None, -32600, "invalid request"),
            status=400,
        )
    requester = request.headers.get("X-Fleet-Requester") or service.default_requester
    body, status = handle_rpc(
        service,
        payload,
        authorization=request.headers.get("Authorization"),
        requester=requester,
    )
    if body is None:
        return Response(status_code=202)
    response = _encode_payload(request, body, status=status)
    if payload.get("method") == "initialize":
        response.headers["Mcp-Session-Id"] = uuid.uuid4().hex
        response.headers["MCP-Protocol-Version"] = str(
            (body.get("result") or {}).get("protocolVersion") or DEFAULT_PROTOCOL_VERSION
        )
    return response


async def mcp_get(request: Request) -> Response:
    accept = (request.headers.get("accept") or "").lower()
    if "text/event-stream" in accept:

        async def gen():  # type: ignore[no-untyped-def]
            yield b": connected\n\n"

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )
    return JSONResponse(
        {"error": "method not allowed; POST JSON-RPC to /mcp"},
        status_code=405,
    )

from __future__ import annotations

from pathlib import Path

from fleet_gateway.contract import ALLOWED_TOOLS, DENIED_TOOLS
from fleet_gateway.http_app import create_http_app
from helpers import LAUNCH_OK
from starlette.testclient import TestClient


def _rpc(
    client: TestClient, method: str, *, auth: str | None, params=None, req_id=1, extra_headers=None
):
    headers = {}
    if auth:
        headers["Authorization"] = auth
    if extra_headers:
        headers.update(extra_headers)
    payload = {"jsonrpc": "2.0", "method": method}
    if req_id is not None:
        payload["id"] = req_id
    if params is not None:
        payload["params"] = params
    return client.post("/mcp", json=payload, headers=headers)


def test_mcp_unauthenticated_401(service):
    client = TestClient(create_http_app(service))
    response = _rpc(client, "initialize", auth=None, params={"protocolVersion": "2025-03-26"})
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"
    get_resp = client.get("/mcp")
    assert get_resp.status_code == 401


def test_mcp_tools_list_matches_contract(service, auth):
    client = TestClient(create_http_app(service))
    response = _rpc(client, "tools/list", auth=auth)
    assert response.status_code == 200
    tools = response.json()["result"]["tools"]
    names = [item["name"] for item in tools]
    assert names == list(ALLOWED_TOOLS)
    assert len(names) == 9
    assert DENIED_TOOLS.isdisjoint(set(names))
    assert "merge" not in names


def test_mcp_tools_call_fleet_status(service, auth):
    client = TestClient(create_http_app(service))
    response = _rpc(
        client,
        "tools/call",
        auth=auth,
        params={"name": "fleet_status", "arguments": {}},
    )
    assert response.status_code == 200
    body = response.json()["result"]
    assert body["isError"] is False
    text = body["content"][0]["text"]
    assert "node_health" in text
    assert "cao_health" in text


def test_mcp_tools_call_deny_merge(service, auth):
    client = TestClient(create_http_app(service))
    response = _rpc(
        client,
        "tools/call",
        auth=auth,
        params={"name": "merge", "arguments": {}},
    )
    assert response.status_code == 200
    body = response.json()["result"]
    assert body["isError"] is True
    blob = str(body).lower()
    assert "denied" in blob or "not" in blob
    listed = _rpc(client, "tools/list", auth=auth).json()["result"]["tools"]
    assert "merge" not in [item["name"] for item in listed]


def test_mcp_tools_call_specialized_rejected(service, auth):
    client = TestClient(create_http_app(service))
    response = _rpc(
        client,
        "tools/call",
        auth=auth,
        params={"name": "launch_worker", "arguments": {**LAUNCH_OK, "role": "specialized"}},
    )
    assert response.status_code == 200
    body = response.json()["result"]
    assert body["isError"] is True
    text = body["content"][0]["text"].lower()
    assert "refused" in text or "bravo" in text


def test_mcp_tools_call_launch_creates_worktree(service, auth, worktree_parent):
    client = TestClient(create_http_app(service))
    response = _rpc(
        client,
        "tools/call",
        auth=auth,
        params={"name": "launch_worker", "arguments": dict(LAUNCH_OK)},
    )
    assert response.status_code == 200
    body = response.json()["result"]
    assert body["isError"] is False
    structured = body["structuredContent"]
    worktree = Path(structured["worktree"])
    assert worktree.is_dir()
    assert worktree.parent == worktree_parent
    assert worktree.name.startswith("fleet-e2e-")
    readme = worktree / "README.md"
    assert readme.is_file()


def test_mcp_initialize_and_ping(service, auth):
    client = TestClient(create_http_app(service))
    init = _rpc(
        client,
        "initialize",
        auth=auth,
        params={
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "test"},
        },
    )
    assert init.status_code == 200
    result = init.json()["result"]
    assert result["protocolVersion"] in {"2025-03-26", "2025-06-18", "2024-11-05"}
    assert result["serverInfo"]["name"] == "fleet-gateway"
    assert "Mcp-Session-Id" in init.headers or "mcp-session-id" in {k.lower() for k in init.headers}
    notice = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={"Authorization": auth},
    )
    assert notice.status_code == 202
    ping = _rpc(client, "ping", auth=auth)
    assert ping.status_code == 200
    assert ping.json()["result"] == {}


def test_rest_tools_still_work(service, auth):
    client = TestClient(create_http_app(service))
    response = client.get("/tools/fleet_status", headers={"Authorization": auth})
    assert response.status_code == 200
    assert "node_health" in response.json()

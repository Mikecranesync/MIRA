"""Regression: tools/list launch_worker.role enum must equal sorted(ALLOWED_ROLES).

Charlie FAIL on FLEET-ALPHA-NODE-001: enum was ["bravo", "charlie"], omitting "alpha".
"""

from __future__ import annotations

from fleet_gateway.contract import ALLOWED_ROLES
from fleet_gateway.http_app import create_http_app
from starlette.testclient import TestClient


def test_launch_worker_role_enum_matches_allowed_roles(service, auth):
    client = TestClient(create_http_app(service))
    response = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Authorization": auth},
    )
    assert response.status_code == 200
    tools = response.json()["result"]["tools"]
    lw = next(t for t in tools if t["name"] == "launch_worker")
    role_enum = lw["inputSchema"]["properties"]["role"]["enum"]
    assert role_enum == sorted(ALLOWED_ROLES), (
        f"launch_worker.role enum {role_enum!r} != sorted(ALLOWED_ROLES) {sorted(ALLOWED_ROLES)!r}"
    )
    assert "alpha" in role_enum
    assert "bravo" in role_enum
    assert "charlie" in role_enum

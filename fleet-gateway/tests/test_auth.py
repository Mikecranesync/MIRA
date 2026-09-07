from __future__ import annotations

import pytest
from fleet_gateway.errors import AuthenticationError
from fleet_gateway.service import build_service
from starlette.testclient import TestClient

from fleet_gateway.http_app import create_http_app


def test_unauthenticated_rejected(service):
    with pytest.raises(AuthenticationError):
        service.invoke("fleet_status", {}, authorization=None)


def test_missing_bearer_rejected(service):
    with pytest.raises(AuthenticationError):
        service.invoke("fleet_status", {}, authorization="")


def test_wrong_bearer_rejected(service):
    with pytest.raises(AuthenticationError):
        service.invoke("fleet_status", {}, authorization="Bearer wrong-token")


def test_empty_configured_bearer_refuses_even_matching(tmp_path, cao):
    svc = build_service(bearer_token="", cao=cao, data_dir=tmp_path)
    with pytest.raises(AuthenticationError):
        svc.invoke("fleet_status", {}, authorization="Bearer ")


def test_http_unauthenticated_rejected(service):
    client = TestClient(create_http_app(service))
    response = client.get("/tools/fleet_status")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"


def test_http_wrong_token_rejected(service):
    client = TestClient(create_http_app(service))
    response = client.get("/tools/fleet_status", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_http_health_has_no_topology(service):
    client = TestClient(create_http_app(service))
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    blob = str(body).lower()
    assert "127.0.0.1" not in blob
    assert "tailscale" not in blob
    assert "cao_url" not in blob


def test_http_authorized_fleet_status(service, auth):
    client = TestClient(create_http_app(service))
    response = client.get("/tools/fleet_status", headers={"Authorization": auth})
    assert response.status_code == 200
    assert "node_health" in response.json()

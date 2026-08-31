"""Assemble a gateway from env. CAO is fake unless a loopback URL is set."""

from __future__ import annotations

import os
from pathlib import Path

from fleet_gateway.auth import configured_bearer
from fleet_gateway.cao import FakeCAO, LoopbackCAOClient
from fleet_gateway.service import FleetGatewayService, build_service


def data_dir_from_env() -> Path:
    raw = (os.environ.get("FLEET_GATEWAY_DATA_DIR") or "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent.parent / "var"


def cao_from_env():
    url = (os.environ.get("FLEET_GATEWAY_CAO_URL") or "").strip()
    if not url:
        return FakeCAO()
    return LoopbackCAOClient(url)


def service_from_env(*, requester: str = "unknown") -> FleetGatewayService:
    return build_service(
        bearer_token=configured_bearer(),
        cao=cao_from_env(),
        data_dir=data_dir_from_env(),
        requester=requester,
    )

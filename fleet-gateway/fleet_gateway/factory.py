"""Assemble a gateway from env. CAO is fake unless a loopback URL is set."""

from __future__ import annotations

import os
from pathlib import Path

from fleet_gateway.auth import configured_bearer
from fleet_gateway.cao import FakeCAO, LoopbackCAOClient
from fleet_gateway.service import FleetGatewayService, build_service
from fleet_gateway.worktree import worktrees_from_env


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


def load_local_env() -> None:
    """Load fleet-gateway/.env into os.environ for unset keys. Never logs values."""
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value


def service_from_env(*, requester: str = "unknown") -> FleetGatewayService:
    return build_service(
        bearer_token=configured_bearer(),
        cao=cao_from_env(),
        data_dir=data_dir_from_env(),
        requester=requester,
        worktrees=worktrees_from_env(),
    )

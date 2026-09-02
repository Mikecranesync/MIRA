"""Assemble a gateway from env. CAO is fake unless a loopback URL is set."""

from __future__ import annotations

import os
from pathlib import Path

from fleet_gateway.auth import configured_bearer
from fleet_gateway.cao import FakeCAO, LoopbackCAOClient
from fleet_gateway.node_config import (
    BRAVO_EXPECTED_HOSTNAME,
    BRAVO_REPO,
    BRAVO_WORKTREE_PARENT,
    CHARLIE_EXPECTED_HOSTNAME,
    CHARLIE_REPO,
    CHARLIE_WORKTREE_PARENT,
    NodeConfig,
    make_bravo_config,
    make_charlie_config,
)
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


def _path_env(name: str, default: Path) -> Path:
    raw = (os.environ.get(name) or "").strip()
    return Path(raw) if raw else default


def node_configs_from_env() -> dict[str, NodeConfig]:
    """Build role configs. Legacy FLEET_GATEWAY_CAO_URL is Bravo-only."""
    bravo_url = (
        os.environ.get("FLEET_GATEWAY_BRAVO_CAO_URL")
        or os.environ.get("FLEET_GATEWAY_CAO_URL")
        or ""
    ).strip()
    bravo_cao = LoopbackCAOClient(bravo_url) if bravo_url else FakeCAO()
    configs: dict[str, NodeConfig] = {
        "bravo": make_bravo_config(
            cao=bravo_cao,
            repo=_path_env("FLEET_GATEWAY_BRAVO_REPO", _path_env("FLEET_GATEWAY_REPO", BRAVO_REPO)),
            worktree_parent=_path_env(
                "FLEET_GATEWAY_BRAVO_WORKTREE_PARENT",
                _path_env("FLEET_GATEWAY_WORKTREE_PARENT", BRAVO_WORKTREE_PARENT),
            ),
            expected_hostname=(
                os.environ.get("FLEET_GATEWAY_BRAVO_EXPECTED_HOSTNAME")
                or BRAVO_EXPECTED_HOSTNAME
            ),
        )
    }

    charlie_url = (os.environ.get("FLEET_GATEWAY_CHARLIE_CAO_URL") or "").strip()
    if charlie_url:
        configs["charlie"] = make_charlie_config(
            cao=LoopbackCAOClient(charlie_url),
            repo=_path_env("FLEET_GATEWAY_CHARLIE_REPO", CHARLIE_REPO),
            worktree_parent=_path_env(
                "FLEET_GATEWAY_CHARLIE_WORKTREE_PARENT",
                CHARLIE_WORKTREE_PARENT,
            ),
            expected_hostname=(
                os.environ.get("FLEET_GATEWAY_CHARLIE_EXPECTED_HOSTNAME")
                or CHARLIE_EXPECTED_HOSTNAME
            ),
        )
    return configs


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
        data_dir=data_dir_from_env(),
        requester=requester,
        node_configs=node_configs_from_env(),
    )

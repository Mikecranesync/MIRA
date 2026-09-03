"""Assemble a gateway from env. CAO is fake unless a loopback URL is set."""

from __future__ import annotations

import os
from pathlib import Path

from fleet_gateway.auth import configured_bearer
from fleet_gateway.cao import FakeCAO, LoopbackCAOClient, RoutingCAOClient
from fleet_gateway.contract import ALLOWED_ROLES
from fleet_gateway.service import FleetGatewayService, build_service
from fleet_gateway.worktree import worktrees_from_env

# Per-node CAO URL env var, one per role: FLEET_GATEWAY_CAO_URL_BRAVO, …_CHARLIE.
# Driven off ALLOWED_ROLES so adding a node is a contract + env change, never a
# code change here. Roles in contract.REJECTED_ROLES are refused upstream in
# service.py and are deliberately unreachable from this map.
_ROLE_URL_ENV = "FLEET_GATEWAY_CAO_URL_{role}"


def data_dir_from_env() -> Path:
    raw = (os.environ.get("FLEET_GATEWAY_DATA_DIR") or "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent.parent / "var"


def cao_urls_from_env() -> tuple[dict[str, str], str]:
    """Return ``({role: url}, default_url)`` read from the environment.

    Every URL is validated as loopback by ``LoopbackCAOClient``; this only reads.
    """
    per_role: dict[str, str] = {}
    for role in sorted(ALLOWED_ROLES):
        raw = (os.environ.get(_ROLE_URL_ENV.format(role=role.upper())) or "").strip()
        if raw:
            per_role[role] = raw
    default_url = (os.environ.get("FLEET_GATEWAY_CAO_URL") or "").strip()
    return per_role, default_url


def cao_from_env():
    """Resolve the CAO adapter.

    Precedence, chosen so existing single-node deployments keep working byte-for-byte:

    1. No URL at all              → ``FakeCAO`` (tests, local dev).
    2. Only ``FLEET_GATEWAY_CAO_URL`` → a single ``LoopbackCAOClient`` (v1 behavior).
    3. Any ``…_CAO_URL_<ROLE>`` set   → ``RoutingCAOClient`` routing per role, with
       ``FLEET_GATEWAY_CAO_URL`` (if set) as the fallback for unmapped roles.

    In case 3 a role that is neither mapped nor covered by a default fails closed
    with ``CaoConfigError`` at call time. It must never silently reach another
    node's CAO — that silent fallback is the #3552 defect.
    """
    per_role, default_url = cao_urls_from_env()
    if not per_role:
        if not default_url:
            return FakeCAO()
        return LoopbackCAOClient(default_url)
    clients = {role: LoopbackCAOClient(url) for role, url in per_role.items()}
    default = LoopbackCAOClient(default_url) if default_url else None
    return RoutingCAOClient(clients, default=default)


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

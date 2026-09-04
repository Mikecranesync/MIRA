"""Assemble a gateway from env. CAO is fake unless a loopback URL is set."""

from __future__ import annotations

import os
from pathlib import Path

from fleet_gateway.auth import configured_bearer
from fleet_gateway.cao import CAOClient, FakeCAO, LoopbackCAOClient
from fleet_gateway.legacy import FilesystemClaudeProbe
from fleet_gateway.router import NodeRouter, NodeTarget
from fleet_gateway.service import FleetGatewayService, build_service
from fleet_gateway.worktree import (
    alpha_worktrees_from_env,
    bravo_worktrees_from_env,
    charlie_worktrees_from_env,
)

# Per-node CAO defaults. Charlie's CAO is reached at 127.0.0.1:19889 — the
# loopback END of the SSH tunnel to Charlie's real 127.0.0.1:9889 — so it still
# satisfies the loopback-only invariant (assert_loopback_cao_url).
DEFAULT_BRAVO_CAO_URL = "http://127.0.0.1:9889"
DEFAULT_CHARLIE_CAO_URL = "http://127.0.0.1:19889"
DEFAULT_ALPHA_CAO_URL = "http://127.0.0.1:29889"


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


def _cao_for_node(url_env: str) -> CAOClient:
    """Build a node's CAO. Per the #3533 HOLD, runtime defaults to FakeCAO;
    a real loopback CAO is used only when its URL env var is explicitly set."""
    url = (os.environ.get(url_env) or "").strip()
    if not url:
        return FakeCAO()
    return LoopbackCAOClient(url)


def router_from_env() -> NodeRouter:
    """Three physical nodes, each with its own CAO + node-local worktrees.

    Node is a computer name, separate from provider/profile. Bravo runs the
    Gateway (local worktrees); Charlie (127.0.0.1:19889) and Alpha
    (127.0.0.1:29889) are each reached over their own loopback SSH tunnel and
    their worktrees are created ON that node via SSH.
    """
    bravo = NodeTarget(
        "bravo",
        _cao_for_node("FLEET_GATEWAY_CAO_URL_BRAVO"),
        bravo_worktrees_from_env(),
    )
    charlie = NodeTarget(
        "charlie",
        _cao_for_node("FLEET_GATEWAY_CAO_URL_CHARLIE"),
        charlie_worktrees_from_env(),
    )
    alpha = NodeTarget(
        "alpha",
        _cao_for_node("FLEET_GATEWAY_CAO_URL_ALPHA"),
        alpha_worktrees_from_env(),
    )
    return NodeRouter(
        {"bravo": bravo, "charlie": charlie, "alpha": alpha},
        default_node="bravo",
    )


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


def _pid_alive(pid: int) -> bool:
    """POSIX liveness only (signal 0). Never sends a killing signal.

    Non-positive pids are refused before the syscall: ``os.kill(0, 0)`` signals
    the caller's whole process GROUP and succeeds, and a negative pid targets a
    group too — neither is evidence that a specific session is alive.
    """
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def bravo_legacy_probe_from_env() -> FilesystemClaudeProbe:
    raw = (os.environ.get("FLEET_GATEWAY_CLAUDE_SESSIONS_DIR") or "").strip()
    sessions_dir = Path(raw) if raw else Path.home() / ".claude" / "sessions"
    return FilesystemClaudeProbe(node="bravo", sessions_dir=sessions_dir, pid_alive=_pid_alive)


def service_from_env(*, requester: str = "unknown") -> FleetGatewayService:
    return build_service(
        bearer_token=configured_bearer(),
        router=router_from_env(),
        data_dir=data_dir_from_env(),
        requester=requester,
        probe=bravo_legacy_probe_from_env(),
    )

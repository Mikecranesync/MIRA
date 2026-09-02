"""Per-role physical node configuration for Fleet Gateway launches."""

from __future__ import annotations

import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from fleet_gateway.cao import CAOClient, FakeCAO, LoopbackCAOClient
from fleet_gateway.errors import NodeRoutingError
from fleet_gateway.worktree import DEFAULT_PARENT, DEFAULT_REPO, WorktreeProvisioner

BRAVO_REPO = DEFAULT_REPO
BRAVO_WORKTREE_PARENT = DEFAULT_PARENT
BRAVO_EXPECTED_HOSTNAME = "FactoryLM-Bravo.local"
BRAVO_EXPECTED_PATH_PREFIX = Path("/Users/bravonode")

CHARLIE_REPO = Path("/Users/charlienode/Mira")
CHARLIE_WORKTREE_PARENT = Path("/Users/charlienode/Mira-worktrees")
CHARLIE_EXPECTED_HOSTNAME = "CharlieNodes-Mac-mini.local"
CHARLIE_EXPECTED_PATH_PREFIX = Path("/Users/charlienode")

HostnameProvider = Callable[[], str]


@dataclass(frozen=True)
class NodeConfig:
    """Config for one physical Fleet node.

    ``expected_path_prefix`` is deliberately independent of repo/worktree values. It
    lets Charlie fail closed when someone misconfigures Charlie to Bravo paths.
    """

    role: str
    cao: CAOClient
    repo: Path
    worktree_parent: Path
    expected_hostname: str
    expected_path_prefix: Path | None = None
    require_cao_health: bool = False

    def worktrees(self) -> WorktreeProvisioner:
        return WorktreeProvisioner(repo=self.repo, parent=self.worktree_parent)


def current_hostname() -> str:
    return socket.getfqdn() or socket.gethostname()


def _host_token(value: str) -> str:
    host = (value or "").strip().lower().rstrip(".")
    return host.removesuffix(".local")


def _hostname_matches(actual: str, expected: str) -> bool:
    return _host_token(actual) == _host_token(expected)


def _is_relative_to(path: Path, prefix: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(prefix.resolve(strict=False))
        return True
    except ValueError:
        return False


def validate_launch_target(
    config: NodeConfig,
    *,
    hostname_provider: HostnameProvider = current_hostname,
) -> None:
    """Fail closed before launching a worker on a configured physical node."""
    role = config.role.strip().lower()
    if role != "charlie":
        return

    actual_hostname = hostname_provider()
    if not _hostname_matches(actual_hostname, config.expected_hostname):
        raise NodeRoutingError(
            "Charlie launch refused: host identity mismatch "
            f"(expected {config.expected_hostname}, got {actual_hostname or 'unknown'})"
        )

    if config.expected_path_prefix is not None:
        for label, path in (
            ("repo", config.repo),
            ("worktree_parent", config.worktree_parent),
        ):
            if not _is_relative_to(Path(path), config.expected_path_prefix):
                raise NodeRoutingError(
                    "Charlie launch refused: "
                    f"{label} path {path} is outside {config.expected_path_prefix}"
                )

    if config.require_cao_health:
        try:
            snapshot = config.cao.fleet_snapshot()
        except Exception as exc:
            raise NodeRoutingError(
                "Charlie launch refused: Charlie CAO health check failed"
            ) from exc
        if snapshot.get("cao_health") != "ok":
            raise NodeRoutingError("Charlie launch refused: Charlie CAO is unavailable")


def verify_worktree_path(config: NodeConfig, worktree: Path) -> None:
    """Ensure the provisioned worktree stayed inside the target node parent."""
    if not _is_relative_to(Path(worktree), config.worktree_parent):
        raise NodeRoutingError(
            f"{config.role} launch refused: worktree {worktree} is outside {config.worktree_parent}"
        )
    if config.role == "charlie" and config.expected_path_prefix is not None:
        if not _is_relative_to(Path(worktree), config.expected_path_prefix):
            raise NodeRoutingError(
                "Charlie launch refused: "
                f"worktree path {worktree} is outside {config.expected_path_prefix}"
            )


def make_bravo_config(
    *,
    cao: CAOClient,
    repo: Path = BRAVO_REPO,
    worktree_parent: Path = BRAVO_WORKTREE_PARENT,
    expected_hostname: str = BRAVO_EXPECTED_HOSTNAME,
) -> NodeConfig:
    return NodeConfig(
        role="bravo",
        cao=cao,
        repo=Path(repo),
        worktree_parent=Path(worktree_parent),
        expected_hostname=expected_hostname,
        expected_path_prefix=BRAVO_EXPECTED_PATH_PREFIX,
        require_cao_health=False,
    )


def make_charlie_config(
    *,
    cao: CAOClient,
    repo: Path = CHARLIE_REPO,
    worktree_parent: Path = CHARLIE_WORKTREE_PARENT,
    expected_hostname: str = CHARLIE_EXPECTED_HOSTNAME,
    expected_path_prefix: Path | None = CHARLIE_EXPECTED_PATH_PREFIX,
    require_cao_health: bool = True,
) -> NodeConfig:
    return NodeConfig(
        role="charlie",
        cao=cao,
        repo=Path(repo),
        worktree_parent=Path(worktree_parent),
        expected_hostname=expected_hostname,
        expected_path_prefix=expected_path_prefix,
        require_cao_health=require_cao_health,
    )


def cao_for_url(url: str | None, *, allow_fake: bool) -> CAOClient:
    clean = (url or "").strip()
    if clean:
        return LoopbackCAOClient(clean)
    if allow_fake:
        return FakeCAO()
    raise NodeRoutingError("Charlie node config missing: FLEET_GATEWAY_CHARLIE_CAO_URL is required")

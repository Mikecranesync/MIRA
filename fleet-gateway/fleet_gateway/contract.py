"""Locked Fleet Gateway MCP contract — nine tools, deny-by-construction."""

from __future__ import annotations

ALLOWED_TOOLS: tuple[str, ...] = (
    "fleet_status",
    "task_status",
    "list_legacy_sessions",
    "launch_worker",
    "message_worker",
    "request_handoff",
    "request_review",
    "stop_worker",
    "adopt_legacy_session",
)

MUTATE_TOOLS: frozenset[str] = frozenset(
    {
        "launch_worker",
        "message_worker",
        "request_handoff",
        "request_review",
        "stop_worker",
        "adopt_legacy_session",
    }
)

READ_TOOLS: frozenset[str] = frozenset(
    {"fleet_status", "task_status", "list_legacy_sessions"}
)

# Physical fleet nodes (COMPUTER NAMES, not providers/profiles). Each one must
# have a real CAO reachable on loopback and a node-local worktree provisioner —
# see fleet_gateway.router / fleet_gateway.factory. Alpha joined 2026-09-01 when
# a real cao-server was installed on it (tunnelled to Bravo 127.0.0.1:29889).
ALLOWED_ROLES: frozenset[str] = frozenset({"bravo", "charlie", "alpha"})
ALLOWED_PROVIDERS: frozenset[str] = frozenset({"claude", "codex"})

# Specialized / PLC / Ignition nodes are out of scope for v1 and must be refused.
REJECTED_ROLES: frozenset[str] = frozenset(
    {
        "specialized",
        "plc",
        "ignition",
        "delta",
        "foreman",
        "root",
        "admin",
    }
)

LAUNCH_REQUIRED_FIELDS: tuple[str, ...] = (
    "provider",
    "task_id",
    "github_ref",
    "base_commit",
    "acceptance_criteria",
)

FLEET_STATUS_FIELDS: tuple[str, ...] = (
    "node_health",
    "cao_health",
    "claude_readiness",
    "claude_auth",
    "codex_readiness",
    "codex_auth",
    "current_session",
    "current_task",
    "heartbeat",
    "context_used",
    "context_remaining",
)

# Tools that must never exist. invoke() refuses these by name; they are not registered.
DENIED_TOOLS: frozenset[str] = frozenset(
    {
        "merge",
        "merge_pr",
        "merge_to_main",
        "deploy",
        "deploy_production",
        "production_mutate",
        "delete_worktree",
        "delete_data",
        "rm_worktree",
        "change_credentials",
        "change_secrets",
        "rotate_secrets",
        "network_change",
        "tailscale_change",
        "tailscale_up",
        "tailscale_down",
        "release_sign",
        "sign_release",
        "plc",
        "plc_write",
        "ignition",
        "ignition_write",
        "com3",
        "cao_config",
        "cao_ports",
        "bind_cao",
        "shell",
        "unrestricted_shell",
        "root",
        "root_shell",
        "push_main",
        "push_to_main",
    }
)

INDEPENDENT_REVIEWER_PROFILE: dict[str, object] = {
    "role": "charlie",
    "independent": True,
    "capabilities": ["tests", "type-check", "inspect-files"],
    "reviews": "exact_git_ref",
    "does_not_review": "bravo_summary",
}

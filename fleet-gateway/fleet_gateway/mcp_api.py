"""Optional FastMCP registration. Exactly the seven locked tools; deny-list absent."""

from __future__ import annotations

from typing import Any

from fleet_gateway.contract import ALLOWED_TOOLS
from fleet_gateway.service import FleetGatewayService


def mcp_tool_names() -> tuple[str, ...]:
    return ALLOWED_TOOLS


def register_fastmcp(mcp: Any, service: FleetGatewayService) -> None:
    """Register the seven tools on a FastMCP instance. Deny-list tools are omitted."""

    @mcp.tool
    def fleet_status() -> dict:
        """Node/CAO/Claude/Codex health, session, heartbeat, context. No IPs/ports/secrets."""
        return service.invoke("fleet_status", {}, authorization=f"Bearer {service.bearer_token}")

    @mcp.tool
    def task_status(task_id: str) -> dict:
        """Task ID, node/provider, git identity, checks, review, blockers, commit-match."""
        return service.invoke(
            "task_status",
            {"task_id": task_id},
            authorization=f"Bearer {service.bearer_token}",
        )

    @mcp.tool
    def launch_worker(
        role: str,
        provider: str,
        task_id: str,
        github_ref: str,
        base_commit: str,
        acceptance_criteria: str,
        isolated_worktree: bool = True,
    ) -> dict:
        """Launch bravo|charlie|alpha on claude|codex in an isolated worktree. No merge/deploy."""
        return service.invoke(
            "launch_worker",
            {
                "role": role,
                "provider": provider,
                "task_id": task_id,
                "github_ref": github_ref,
                "base_commit": base_commit,
                "acceptance_criteria": acceptance_criteria,
                "isolated_worktree": isolated_worktree,
            },
            authorization=f"Bearer {service.bearer_token}",
        )

    @mcp.tool
    def message_worker(session_id: str, text: str) -> dict:
        """Send text to one session id. Chat is never treated as done."""
        return service.invoke(
            "message_worker",
            {"session_id": session_id, "text": text},
            authorization=f"Bearer {service.bearer_token}",
        )

    @mcp.tool
    def request_handoff(session_id: str, task_id: str) -> dict:
        """Write a durable HANDOFF artifact and stop claiming the task."""
        return service.invoke(
            "request_handoff",
            {"session_id": session_id, "task_id": task_id},
            authorization=f"Bearer {service.bearer_token}",
        )

    @mcp.tool
    def request_review(session_id: str, git_ref: str, task_id: str = "") -> dict:
        """Charlie-only independent review of an exact Git ref (not a Bravo summary)."""
        params: dict[str, str] = {"session_id": session_id, "git_ref": git_ref}
        if task_id:
            params["task_id"] = task_id
        return service.invoke(
            "request_review",
            params,
            authorization=f"Bearer {service.bearer_token}",
        )

    @mcp.tool
    def stop_worker(session_id: str) -> dict:
        """Stop one session id. Not a node, not CAO, not a worktree delete."""
        return service.invoke(
            "stop_worker",
            {"session_id": session_id},
            authorization=f"Bearer {service.bearer_token}",
        )

    # Bind so linters see the registrations as used.
    _ = (
        fleet_status,
        task_status,
        launch_worker,
        message_worker,
        request_handoff,
        request_review,
        stop_worker,
    )

from __future__ import annotations

TEST_BEARER = "test-fleet-gateway-bearer"
AUTH_HEADER = f"Bearer {TEST_BEARER}"

LAUNCH_OK = {
    "role": "bravo",
    "provider": "claude",
    "task_id": "issue-3532",
    "github_ref": "feat/fleet-gateway-mcp-v1",
    "base_commit": "583cda81ab398c9b4cf40c390242b343bd78e4b0",
    "acceptance_criteria": "seven tools, auth, deny list, audit, tests green",
    "isolated_worktree": True,
}

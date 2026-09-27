"""Charlie review lanes must be able to execute, or be rejected — never left idling (#3817).

CAO's built-in `reviewer` role is fs_read/fs_list only. Every lane launched on it preflighted
BLOCKED and sat in tmux. These tests pin the fix at both layers:
  * the real LoopbackCAOClient requests the reviewer tools and reads back what it got;
  * the service fails closed (stop session, remove worktree, record, raise) on a gap.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fleet_gateway.cao import (
    REVIEWER_ALLOWED_TOOLS,
    LoopbackCAOClient,
    review_capability_gap,
)
from fleet_gateway.errors import ContractViolation, ReviewerCapabilityError
from fleet_gateway.worktree import WorktreeProvisioner
from helpers import LAUNCH_OK

_CAO_URL = "http://127.0.0.1:9999"
_NO_BASH = ["@builtin", "fs_read", "fs_list", "@cao-mcp-server"]  # CAO built-in `reviewer`
_CHARLIE_SPEC = {
    "task_id": "pr-1234-ir",
    "role": "charlie",
    "provider": "claude",
    "github_ref": "feat/x",
    "base_commit": "abc123",
    "acceptance_criteria": "review",
    "working_directory": "/tmp/wt/pr-1234-ir",
}


def _stub_client(responses: dict[tuple[str, str], Any]) -> tuple[LoopbackCAOClient, list]:
    """LoopbackCAOClient whose _request replays canned responses keyed by (method, path)."""
    client = LoopbackCAOClient(_CAO_URL)
    calls: list[tuple[str, str, dict | None]] = []

    def fake_request(method, path, payload=None, *, params=None, timeout=None):  # noqa: ARG001
        calls.append((method, path, params))
        resp = responses.get((method, path))
        if isinstance(resp, Exception):
            raise resp
        return resp or {}

    client._request = fake_request  # type: ignore[method-assign]
    return client, calls


# ── the gap rule ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("tools", "ok"),
    [
        (list(REVIEWER_ALLOWED_TOOLS), True),
        (["*"], True),
        (_NO_BASH, False),
        ([], False),
        (None, False),  # unknown is a gap, never assumed access
        ("execute_bash", False),  # not a list → unknown
    ],
)
def test_review_capability_gap(tools, ok):
    assert (review_capability_gap(tools) is None) is ok


def test_reviewer_tool_list_executes_but_cannot_write_and_keeps_mcp():
    assert "execute_bash" in REVIEWER_ALLOWED_TOOLS
    # an explicit list skips CAO's automatic MCP append → must name it or send_message is lost
    assert "@cao-mcp-server" in REVIEWER_ALLOWED_TOOLS
    assert not {"fs_write", "fs_*", "*", "@builtin"} & set(REVIEWER_ALLOWED_TOOLS)


# ── the real client ─────────────────────────────────────────────────────────────


def test_loopback_charlie_launch_requests_tools_and_reads_them_back():
    client, calls = _stub_client(
        {
            ("POST", "/sessions"): {
                "id": "t1",
                "session_name": "s1",
                "allowed_tools": list(REVIEWER_ALLOWED_TOOLS),
            }
        }
    )
    result = client.launch_worker(dict(_CHARLIE_SPEC))
    assert len(calls) == 1
    assert calls[0][2]["allowed_tools"] == ",".join(REVIEWER_ALLOWED_TOOLS)
    assert result["allowed_tools"] == list(REVIEWER_ALLOWED_TOOLS)
    assert client.get_session  # stored for request_review
    assert client._sessions["s1"]["allowed_tools"] == list(REVIEWER_ALLOWED_TOOLS)


def test_loopback_missing_field_falls_back_to_terminal_get():
    client, calls = _stub_client(
        {
            ("POST", "/sessions"): {"id": "t1", "session_name": "s1"},
            ("GET", "/terminals/t1"): {"id": "t1", "allowed_tools": _NO_BASH},
        }
    )
    result = client.launch_worker(dict(_CHARLIE_SPEC))
    assert [c[:2] for c in calls] == [("POST", "/sessions"), ("GET", "/terminals/t1")]
    assert result["allowed_tools"] == _NO_BASH
    assert review_capability_gap(result["allowed_tools"]) is not None


def test_loopback_unreadable_tools_are_unknown_not_granted():
    client, _calls = _stub_client(
        {
            ("POST", "/sessions"): {"id": "t1", "session_name": "s1"},
            ("GET", "/terminals/t1"): OSError("cao down"),
        }
    )
    result = client.launch_worker(dict(_CHARLIE_SPEC))
    assert result["allowed_tools"] is None
    gap = review_capability_gap(result["allowed_tools"])
    assert gap is not None and "unknown" in gap


def test_loopback_bravo_launch_is_unchanged():
    client, calls = _stub_client({("POST", "/sessions"): {"id": "t1", "session_name": "s1"}})
    client.launch_worker({**_CHARLIE_SPEC, "role": "bravo"})
    assert len(calls) == 1
    assert "allowed_tools" not in calls[0][2]


# ── the service gate ────────────────────────────────────────────────────────────


def _charlie_launch(service, auth, task_id="issue-3817-ir"):
    return service.invoke(
        "launch_worker", {**LAUNCH_OK, "role": "charlie", "task_id": task_id}, authorization=auth
    )


def test_service_rejects_lane_that_cannot_execute(service, cao, auth, worktree_parent: Path):
    cao.allowed_tools_by_role["charlie"] = list(_NO_BASH)
    with pytest.raises(ReviewerCapabilityError) as exc:
        _charlie_launch(service, auth)
    msg = str(exc.value)
    assert "no execute_bash" in msg
    assert "session stopped" in msg and "worktree removed" in msg
    # not left idling: the session is stopped …
    (sess,) = cao.sessions.values()
    assert sess["status"] == "stopped"
    # … the Gateway's worktree is gone …
    assert not any(p.name.startswith("fleet-e2e-") for p in worktree_parent.iterdir())
    # … and the rejection is durable
    record = service.artifacts.read_task("issue-3817-ir")
    assert record["status"] == "rejected"
    assert any("cannot execute" in b for b in record["blockers"])


def test_service_rejects_unknown_tools(service, cao, auth):
    cao.allowed_tools_by_role["charlie"] = None
    with pytest.raises(ReviewerCapabilityError, match="unknown"):
        _charlie_launch(service, auth)


def test_cleanup_failure_does_not_mask_the_capability_error(service, cao, auth, monkeypatch):
    cao.allowed_tools_by_role["charlie"] = list(_NO_BASH)

    def boom(session_id):  # noqa: ARG001
        raise RuntimeError("tmux gone")

    monkeypatch.setattr(cao, "stop_worker", boom)
    with pytest.raises(ReviewerCapabilityError, match="session stop FAILED"):
        _charlie_launch(service, auth)


def test_service_accepts_executing_lane_and_review_proceeds(service, auth):
    launched = _charlie_launch(service, auth)
    result = service.invoke(
        "request_review",
        {
            "session_id": launched["session_id"],
            "task_id": "issue-3817-ir",
            "git_ref": LAUNCH_OK["base_commit"],
        },
        authorization=auth,
    )
    assert result["status"] == "review_requested"


def test_request_review_refuses_session_without_execution(service, cao, auth):
    launched = _charlie_launch(service, auth)
    cao.sessions[launched["session_id"]]["allowed_tools"] = list(_NO_BASH)
    with pytest.raises(ReviewerCapabilityError):
        service.invoke(
            "request_review",
            {
                "session_id": launched["session_id"],
                "task_id": "issue-3817-ir",
                "git_ref": LAUNCH_OK["base_commit"],
            },
            authorization=auth,
        )


def test_bravo_launch_is_not_gated(service, cao, auth):
    cao.allowed_tools_by_role.pop("bravo", None)  # developer lanes report nothing
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    assert launched["ok"] is True


# ── worktree removal is scoped to what the provisioner created ──────────────────


def test_worktree_remove_refuses_paths_outside_parent(tmp_path: Path):
    prov = WorktreeProvisioner(repo=tmp_path / "repo", parent=tmp_path / "wts")
    for bad in (
        tmp_path / "elsewhere" / "fleet-e2e-x",
        tmp_path / "wts" / "not-ours",
        tmp_path / "wts" / "a" / "fleet-e2e-x",
    ):
        with pytest.raises(ContractViolation, match="refusing"):
            prov.remove(bad)

"""FLEET-SESSION-LIFETIME-001 — session liveness and request_review prompt tests.

Bug 1: task_snapshot marked stopped on terminal_status='completed' (turn-complete).
  CAO 'completed' means the AI turn finished — session still accepts /input.
  Only mark stopped when confirmed dead: GET 404, terminal error, or empty terminals.

Bug 2: request_review sent the raw git SHA as the terminal message.
  Charlie needs a real independent-review prompt, not just a SHA.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch
from urllib.error import HTTPError


from fleet_gateway.cao import LoopbackCAOClient

_CAO_URL = "http://127.0.0.1:9889"


def _make_client(session_name: str, task_id: str, status: str = "running") -> LoopbackCAOClient:
    client = LoopbackCAOClient(_CAO_URL)
    client._sessions[session_name] = {
        "terminal_id": "term-0001",
        "session_name": session_name,
        "task_id": task_id,
        "role": "bravo",
        "provider": "claude",
        "status": status,
        "worktree": "/tmp/wt",
        "claimed": True,
        "chat_claimed_done": False,
    }
    client._session_order.append(session_name)
    return client


def _cao_resp(terminal_status: str) -> dict[str, Any]:
    return {
        "session": {"id": "s", "name": "s", "status": "detached"},
        "terminals": [{"id": "term-0001", "status": terminal_status, "provider": "claude_code"}],
    }


def _cao_resp_no_terminals() -> dict[str, Any]:
    return {
        "session": {"id": "s", "name": "s", "status": "detached"},
        "terminals": [],
    }


# ---------------------------------------------------------------------------
# Bug 1: session liveness — turn-complete must not mark stopped
# ---------------------------------------------------------------------------


def test_completed_terminal_does_not_mark_stopped() -> None:
    """'completed' terminal = turn done, session alive. Must NOT mark stopped."""
    client = _make_client("sess-a", "task-a")
    with patch.object(client, "_request", return_value=_cao_resp("completed")):
        snap = client.task_snapshot("task-a")
    assert snap is not None
    assert snap["status"] == "running", f"expected running, got: {snap['status']}"
    assert client._sessions["sess-a"]["status"] == "running"


def test_error_terminal_marks_stopped() -> None:
    """'error' terminal = session crashed. Must mark stopped."""
    client = _make_client("sess-b", "task-b")
    with patch.object(client, "_request", return_value=_cao_resp("error")):
        snap = client.task_snapshot("task-b")
    assert snap is not None
    assert snap["status"] == "stopped", f"expected stopped, got: {snap['status']}"
    assert client._sessions["sess-b"]["status"] == "stopped"


def test_processing_terminal_stays_running() -> None:
    """'processing' terminal = actively running. Must NOT mark stopped."""
    client = _make_client("sess-c", "task-c")
    with patch.object(client, "_request", return_value=_cao_resp("processing")):
        snap = client.task_snapshot("task-c")
    assert snap is not None
    assert snap["status"] == "running", snap


def test_session_404_marks_stopped() -> None:
    """GET /sessions returning 404 = session confirmed gone. Must mark stopped."""
    client = _make_client("sess-d", "task-d")
    http_404 = HTTPError(
        url="http://127.0.0.1:9889/sessions/sess-d", code=404, msg="Not Found", hdrs=None, fp=None
    )  # type: ignore[arg-type]
    with patch.object(client, "_request", side_effect=http_404):
        snap = client.task_snapshot("task-d")
    assert snap is not None
    assert snap["status"] == "stopped", f"expected stopped on 404, got: {snap['status']}"
    assert client._sessions["sess-d"]["status"] == "stopped"


def test_no_terminals_marks_stopped() -> None:
    """GET succeeds but terminals=[] = no active terminal. Must mark stopped."""
    client = _make_client("sess-e", "task-e")
    with patch.object(client, "_request", return_value=_cao_resp_no_terminals()):
        snap = client.task_snapshot("task-e")
    assert snap is not None
    assert snap["status"] == "stopped", (
        f"expected stopped on empty terminals, got: {snap['status']}"
    )
    assert client._sessions["sess-e"]["status"] == "stopped"


def test_transient_network_error_preserves_running() -> None:
    """Transient GET failure (not 404) must NOT mark stopped — don't kill on a hiccup."""
    client = _make_client("sess-f", "task-f")
    with patch.object(client, "_request", side_effect=OSError("connection refused")):
        snap = client.task_snapshot("task-f")
    assert snap is not None
    assert snap["status"] == "running", (
        f"expected running on transient error, got: {snap['status']}"
    )


# ---------------------------------------------------------------------------
# Bug 2: request_review must send a real prompt, not just the raw SHA
# ---------------------------------------------------------------------------

_REVIEW_SPEC: dict[str, Any] = {
    "session_id": "charlie-sess",
    "git_ref": "abc123def456abc123def456abc123def456abc1",
    "task_id": "FLEET-SESSION-LIFETIME-001",
    "reviewer_profile": {
        "role": "charlie",
        "independent": True,
        "capabilities": ["tests", "type-check", "inspect-files"],
        "reviews": "exact_git_ref",
    },
}


def _make_charlie_client() -> LoopbackCAOClient:
    client = LoopbackCAOClient(_CAO_URL)
    client._sessions["charlie-sess"] = {
        "terminal_id": "term-charlie",
        "session_name": "charlie-sess",
        "task_id": "FLEET-SESSION-LIFETIME-001",
        "role": "charlie",
        "provider": "codex",
        "status": "running",
        "worktree": "/tmp/charlie-wt",
        "claimed": True,
        "chat_claimed_done": False,
    }
    client._session_order.append("charlie-sess")
    return client


def test_request_review_sends_prompt_not_raw_sha() -> None:
    """request_review must send a full review prompt, not just the bare git SHA."""
    client = _make_charlie_client()
    captured: list[dict[str, Any]] = []

    def fake_request(method: str, path: str, payload: Any = None, **kwargs: Any) -> dict[str, Any]:
        captured.append({"method": method, "path": path, "kwargs": kwargs})
        return {}

    with patch.object(client, "_request", side_effect=fake_request):
        client.request_review(_REVIEW_SPEC)

    assert captured, "expected at least one _request call"
    msg = captured[-1]["kwargs"].get("params", {}).get("message", "")
    git_ref = _REVIEW_SPEC["git_ref"]
    # Must not be just the raw SHA
    assert msg != git_ref, "prompt must not be the bare SHA"
    # Must contain the SHA so Charlie knows what to review
    assert git_ref in msg, f"git_ref missing from prompt: {msg!r}"


def test_request_review_prompt_contains_independent_reviewer() -> None:
    """The prompt must identify Charlie as an independent reviewer."""
    client = _make_charlie_client()
    captured: list[dict[str, Any]] = []

    def fake_request(method: str, path: str, payload: Any = None, **kwargs: Any) -> dict[str, Any]:
        captured.append({"kwargs": kwargs})
        return {}

    with patch.object(client, "_request", side_effect=fake_request):
        client.request_review(_REVIEW_SPEC)

    msg = captured[-1]["kwargs"]["params"]["message"]
    assert "independent" in msg.lower(), f"prompt lacks 'independent': {msg!r}"
    assert "Charlie" in msg or "charlie" in msg.lower(), f"prompt lacks Charlie role: {msg!r}"


def test_request_review_prompt_contains_capabilities() -> None:
    """The prompt must enumerate the review capabilities (tests, type-check, inspect-files)."""
    client = _make_charlie_client()
    captured: list[dict[str, Any]] = []

    def fake_request(method: str, path: str, payload: Any = None, **kwargs: Any) -> dict[str, Any]:
        captured.append({"kwargs": kwargs})
        return {}

    with patch.object(client, "_request", side_effect=fake_request):
        client.request_review(_REVIEW_SPEC)

    msg = captured[-1]["kwargs"]["params"]["message"]
    assert "tests" in msg, f"'tests' missing from prompt: {msg!r}"
    assert "type-check" in msg, f"'type-check' missing from prompt: {msg!r}"
    assert "inspect-files" in msg, f"'inspect-files' missing from prompt: {msg!r}"


def test_request_review_prompt_contains_task_id() -> None:
    """The prompt must include the task_id so the session log is traceable."""
    client = _make_charlie_client()
    captured: list[dict[str, Any]] = []

    def fake_request(method: str, path: str, payload: Any = None, **kwargs: Any) -> dict[str, Any]:
        captured.append({"kwargs": kwargs})
        return {}

    with patch.object(client, "_request", side_effect=fake_request):
        client.request_review(_REVIEW_SPEC)

    msg = captured[-1]["kwargs"]["params"]["message"]
    assert _REVIEW_SPEC["task_id"] in msg, f"task_id missing from prompt: {msg!r}"


def test_build_review_prompt_is_deterministic() -> None:
    """_build_review_prompt is a pure function — same spec → same output."""
    p1 = LoopbackCAOClient._build_review_prompt(_REVIEW_SPEC)
    p2 = LoopbackCAOClient._build_review_prompt(_REVIEW_SPEC)
    assert p1 == p2
    assert len(p1) > len(_REVIEW_SPEC["git_ref"])  # definitely more than the bare SHA

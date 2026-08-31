"""CAO adapter: loopback-only client + fake/stub used by tests and default runtime.

This module never binds a socket. It never accepts a non-127.0.0.1 URL.
Public CAO exposure (tunnel/VPS) is a later Mike-approved step, not v1.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fleet_gateway.errors import CaoConfigError, NotFoundError

# Only literal loopback IPv4. localhost / ::1 / 0.0.0.0 / LAN / Tailscale refused.
LOOPBACK_HOST = "127.0.0.1"


class CAOClient(Protocol):
    """Private control-plane adapter. Implementations must not expose topology."""

    def fleet_snapshot(self) -> dict[str, Any]: ...

    def task_snapshot(self, task_id: str) -> dict[str, Any] | None: ...

    def launch_worker(self, spec: dict[str, Any]) -> dict[str, Any]: ...

    def message_worker(self, session_id: str, text: str) -> dict[str, Any]: ...

    def request_handoff(self, session_id: str, task_id: str) -> dict[str, Any]: ...

    def request_review(self, spec: dict[str, Any]) -> dict[str, Any]: ...

    def stop_worker(self, session_id: str) -> dict[str, Any]: ...

    def get_session(self, session_id: str) -> dict[str, Any] | None: ...


def assert_loopback_cao_url(url: str) -> str:
    """Refuse anything that is not http(s)://127.0.0.1[:port][/path]."""
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise CaoConfigError("CAO URL must be http or https on 127.0.0.1")
    if parsed.username or parsed.password:
        raise CaoConfigError("CAO URL must not contain credentials")
    if parsed.hostname != LOOPBACK_HOST:
        raise CaoConfigError("CAO client is loopback-only (127.0.0.1); refusing non-loopback URL")
    return parsed.geturl()


class FakeCAO:
    """In-process stub. Default in tests and when FLEET_GATEWAY_CAO_URL is unset."""

    def __init__(self) -> None:
        self.sessions: dict[str, dict[str, Any]] = {}
        self.tasks: dict[str, dict[str, Any]] = {}
        self.messages: dict[str, list[str]] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.node_health = "ok"
        self.cao_health = "stub"
        self.claude_readiness = "ready"
        self.claude_auth = "ok"
        self.codex_readiness = "ready"
        self.codex_auth = "ok"
        self.context_used = 0
        self.context_remaining = 100000

    def fleet_snapshot(self) -> dict[str, Any]:
        current = next(iter(self.sessions.values()), None)
        return {
            "node_health": self.node_health,
            "cao_health": self.cao_health,
            "claude_readiness": self.claude_readiness,
            "claude_auth": self.claude_auth,
            "codex_readiness": self.codex_readiness,
            "codex_auth": self.codex_auth,
            "current_session": None if current is None else current["session_id"],
            "current_task": None if current is None else current.get("task_id"),
            "heartbeat": datetime.now(timezone.utc).isoformat(),
            "context_used": self.context_used,
            "context_remaining": self.context_remaining,
        }

    def task_snapshot(self, task_id: str) -> dict[str, Any] | None:
        for session in self.sessions.values():
            if session.get("task_id") == task_id:
                return dict(session)
        stored = self.tasks.get(task_id)
        return None if stored is None else dict(stored)

    def launch_worker(self, spec: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("launch_worker", dict(spec)))
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        session = {
            "session_id": session_id,
            "task_id": spec["task_id"],
            "role": spec["role"],
            "provider": spec["provider"],
            "github_ref": spec["github_ref"],
            "base_commit": spec["base_commit"],
            "claimed_commit": spec["base_commit"],
            "branch": spec.get("branch") or spec["github_ref"],
            "worktree": f"isolated:{spec['task_id']}",
            "isolated_worktree": True,
            "acceptance_criteria": spec["acceptance_criteria"],
            "status": "running",
            "claimed": True,
            "tests": "not_run",
            "type_check": "not_run",
            "build": "not_run",
            "review_verdict": None,
            "blockers": [],
            "handoff": None,
            "chat_claimed_done": False,
        }
        self.sessions[session_id] = session
        self.tasks[spec["task_id"]] = dict(session)
        return {"session_id": session_id, "status": "running", "isolated_worktree": True}

    def message_worker(self, session_id: str, text: str) -> dict[str, Any]:
        self.calls.append(("message_worker", {"session_id": session_id, "text": text}))
        session = self.sessions.get(session_id)
        if session is None:
            raise NotFoundError(f"session not found: {session_id}")
        self.messages.setdefault(session_id, []).append(text)
        # Chat is never treated as done, even if the text claims it.
        if "done" in text.lower():
            session["chat_claimed_done"] = True
        return {"session_id": session_id, "accepted": True, "chat_is_not_done": True}

    def request_handoff(self, session_id: str, task_id: str) -> dict[str, Any]:
        self.calls.append(("request_handoff", {"session_id": session_id, "task_id": task_id}))
        session = self.sessions.get(session_id)
        if session is None:
            raise NotFoundError(f"session not found: {session_id}")
        session["claimed"] = False
        session["status"] = "handed_off"
        session["handoff"] = "written"
        task = self.tasks.get(task_id) or session
        task["claimed"] = False
        task["status"] = "handed_off"
        self.tasks[task_id] = task
        return {"session_id": session_id, "task_id": task_id, "claimed": False}

    def request_review(self, spec: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("request_review", dict(spec)))
        session_id = spec["session_id"]
        session = self.sessions.get(session_id)
        if session is None:
            raise NotFoundError(f"session not found: {session_id}")
        session["status"] = "review_requested"
        session["review_git_ref"] = spec["git_ref"]
        session["review_verdict"] = "pending"
        task_id = session["task_id"]
        self.tasks[task_id] = dict(session)
        return {
            "session_id": session_id,
            "git_ref": spec["git_ref"],
            "reviewer_profile": spec["reviewer_profile"],
            "status": "review_requested",
        }

    def stop_worker(self, session_id: str) -> dict[str, Any]:
        self.calls.append(("stop_worker", {"session_id": session_id}))
        session = self.sessions.get(session_id)
        if session is None:
            raise NotFoundError(f"session not found: {session_id}")
        session["status"] = "stopped"
        session["claimed"] = False
        self.tasks[session["task_id"]] = dict(session)
        return {"session_id": session_id, "status": "stopped"}

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        session = self.sessions.get(session_id)
        return None if session is None else dict(session)


class LoopbackCAOClient:
    """HTTP client that may only target 127.0.0.1. Never binds. Never logs secrets."""

    def __init__(self, base_url: str, timeout_s: float = 2.0) -> None:
        self.base_url = assert_loopback_cao_url(base_url).rstrip("/")
        self.timeout_s = timeout_s

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        # Path-only join; base_url already validated as 127.0.0.1.
        url = self.base_url + path
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        with urlopen(req, timeout=self.timeout_s) as resp:  # noqa: S310 — URL host pinned to 127.0.0.1
            body = resp.read().decode("utf-8")
        if not body:
            return {}
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise CaoConfigError("CAO returned a non-object payload")
        return parsed

    def fleet_snapshot(self) -> dict[str, Any]:
        try:
            return self._request("GET", "/status")
        except Exception:
            return {
                "node_health": "unknown",
                "cao_health": "unavailable",
                "claude_readiness": "unknown",
                "claude_auth": "unknown",
                "codex_readiness": "unknown",
                "codex_auth": "unknown",
                "current_session": None,
                "current_task": None,
                "heartbeat": datetime.now(timezone.utc).isoformat(),
                "context_used": None,
                "context_remaining": None,
            }

    def task_snapshot(self, task_id: str) -> dict[str, Any] | None:
        try:
            return self._request("GET", f"/tasks/{task_id}")
        except Exception:
            return None

    def launch_worker(self, spec: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/workers", spec)

    def message_worker(self, session_id: str, text: str) -> dict[str, Any]:
        return self._request("POST", f"/sessions/{session_id}/messages", {"text": text})

    def request_handoff(self, session_id: str, task_id: str) -> dict[str, Any]:
        return self._request("POST", f"/sessions/{session_id}/handoff", {"task_id": task_id})

    def request_review(self, spec: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/sessions/{spec['session_id']}/review", spec)

    def stop_worker(self, session_id: str) -> dict[str, Any]:
        return self._request("POST", f"/sessions/{session_id}/stop", {})

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        try:
            return self._request("GET", f"/sessions/{session_id}")
        except Exception:
            return None

"""CAO adapter: loopback-only client + fake/stub used by tests and default runtime.

This module never binds a socket. It never accepts a non-127.0.0.1 URL.
Public CAO exposure (tunnel/VPS) is a later Mike-approved step, not v1.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from fleet_gateway.errors import CaoConfigError, NotFoundError

# Only literal loopback IPv4. localhost / ::1 / 0.0.0.0 / LAN / Tailscale refused.
LOOPBACK_HOST = "127.0.0.1"

# CAO agent_profile mapping: no local bravo/charlie profiles; use CAO built-ins.
# bravo → developer, charlie → reviewer
_ROLE_TO_PROFILE: dict[str, str] = {"bravo": "developer", "charlie": "reviewer"}

# CAO provider mapping: claude → claude_code, codex → codex
_PROVIDER_TO_CAO: dict[str, str] = {"claude": "claude_code", "codex": "codex"}


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

    def record_worktree(self, session_id: str, worktree: str) -> None: ...


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
        self._latest_by_task: dict[str, str] = {}  # task_id → latest session_id
        # tasks dict kept for test backward-compat; snapshot reads from live sessions, not here
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
        # Prefer latest running session (scan in reverse insertion order)
        current: dict[str, Any] | None = None
        for sess in reversed(list(self.sessions.values())):
            if sess.get("status") not in ("stopped", "handed_off"):
                current = sess
                break
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
        # Return the LIVE latest session for this task_id (not a stale tasks copy).
        # Using the live sessions dict captures chat_claimed_done and other mutable state.
        sid = self._latest_by_task.get(task_id)
        if sid is None:
            return None
        sess = self.sessions.get(sid)
        return None if sess is None else dict(sess)

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
            # Use working_directory from spec if provided (Gateway-provisioned worktree)
            "worktree": spec.get("working_directory") or f"isolated:{spec['task_id']}",
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
        # Track latest session per task (overwrite so latest always wins)
        self._latest_by_task[spec["task_id"]] = session_id
        # Also keep tasks dict in sync for backward-compat (tests may write to it)
        self.tasks[spec["task_id"]] = session
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
        return {"session_id": session_id, "status": "stopped"}

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        session = self.sessions.get(session_id)
        return None if session is None else dict(session)

    def record_worktree(self, session_id: str, worktree: str) -> None:
        session = self.sessions.get(session_id)
        if session is None:
            return
        session["worktree"] = worktree


class LoopbackCAOClient:
    """HTTP client that may only target 127.0.0.1. Never binds. Never logs secrets.

    Maps to CAO 2.5.0 endpoints:
      fleet_snapshot  → GET /health
      launch_worker   → POST /sessions?agent_profile=&provider=&session_name=&working_directory=
      message_worker  → POST /terminals/{id}/input?message=
      stop_worker     → POST /terminals/{id}/exit + DELETE /sessions/{name}
      get_session     → GET /sessions/{session_name}
      task_snapshot   → in-process session map (CAO has no task index)
      request_handoff → soft terminal message; artifact is durable truth
      request_review  → POST git_ref to terminal as message
      record_worktree → update in-process map

    Agent profile mapping (local CAO has no bravo/charlie profiles):
      bravo → developer, charlie → reviewer
    Provider mapping:
      claude → claude_code, codex → codex
    """

    def __init__(self, base_url: str, timeout_s: float = 2.0) -> None:
        self.base_url = assert_loopback_cao_url(base_url).rstrip("/")
        self.timeout_s = timeout_s
        # In-process session map: session_name → {terminal_id, task_id, role, worktree, status}
        self._sessions: dict[str, dict[str, Any]] = {}
        # Insertion order for "latest running" queries
        self._session_order: list[str] = []

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        # Path-only join; base_url already validated as 127.0.0.1.
        url = self.base_url + path
        if params:
            url += "?" + urlencode({k: str(v) for k, v in params.items()})
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = Request(url, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        t = timeout if timeout is not None else self.timeout_s
        with urlopen(req, timeout=t) as resp:  # noqa: S310 — URL host pinned to 127.0.0.1
            body = resp.read().decode("utf-8")
        if not body:
            return {}
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise CaoConfigError("CAO returned a non-object payload")
        return parsed

    def _get_json(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        """Like _request but allows list or dict responses (e.g. /agents/providers)."""
        url = self.base_url + path
        if params:
            url += "?" + urlencode({k: str(v) for k, v in params.items()})
        req = Request(url, method="GET")
        req.add_header("Accept", "application/json")
        t = timeout if timeout is not None else self.timeout_s
        with urlopen(req, timeout=t) as resp:  # noqa: S310 — URL host pinned to 127.0.0.1
            body = resp.read().decode("utf-8")
        return json.loads(body) if body else None

    def fleet_snapshot(self) -> dict[str, Any]:
        try:
            resp = self._request("GET", "/health", timeout=2.0)
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
        status = resp.get("status")
        components = resp.get("components") or {}
        cao_ok = status == "ok" and components.get("cao") == "ok"
        claude_comp = components.get("claude", "unknown")

        # Map claude component status → readiness/auth
        if claude_comp == "ok":
            claude_readiness, claude_auth = "ready", "ok"
        elif claude_comp == "unavailable":
            claude_readiness, claude_auth = "unavailable", "unavailable"
        else:
            claude_readiness, claude_auth = "unknown", "unknown"

        # Probe /agents/providers for codex (returns list or dict; best-effort)
        try:
            providers_raw = self._get_json("/agents/providers", timeout=2.0)
            if isinstance(providers_raw, list):
                provider_names = [
                    (p.get("name") if isinstance(p, dict) else str(p)) for p in providers_raw
                ]
            elif isinstance(providers_raw, dict):
                provider_names = list(providers_raw.keys())
            else:
                provider_names = []
            codex_present = any("codex" in str(n).lower() for n in provider_names)
        except Exception:
            codex_present = False
        codex_readiness = "ready" if codex_present else "unknown"
        codex_auth = "ok" if codex_present else "unknown"

        # Current session: latest non-stopped from in-process map
        current_session = None
        current_task = None
        for sid in reversed(self._session_order):
            sess = self._sessions.get(sid)
            if sess and sess.get("status") not in ("stopped", "handed_off"):
                current_session = sid
                current_task = sess.get("task_id")
                break

        return {
            "node_health": "ok" if cao_ok else "unknown",
            "cao_health": "ok" if cao_ok else "unavailable",
            "claude_readiness": claude_readiness,
            "claude_auth": claude_auth,
            "codex_readiness": codex_readiness,
            "codex_auth": codex_auth,
            "current_session": current_session,
            "current_task": current_task,
            "heartbeat": datetime.now(timezone.utc).isoformat(),
            "context_used": None,
            "context_remaining": None,
        }

    def task_snapshot(self, task_id: str) -> dict[str, Any] | None:
        # CAO has no task index; use in-process session map, returning latest for this task.
        latest_name: str | None = None
        for sid in reversed(self._session_order):
            sess = self._sessions.get(sid)
            if sess and sess.get("task_id") == task_id:
                latest_name = sid
                break
        if latest_name is None:
            return None
        # Refresh live terminal status to detect truly-dead sessions.
        # "completed" means the AI turn finished — CAO still accepts /input — session is ALIVE.
        # Only mark stopped when confirmed dead: GET 404, terminal error, or empty terminals.
        live = self.get_session(latest_name)
        if live is None:
            # GET /sessions returned 404 — session confirmed gone.
            stored = self._sessions.get(latest_name)
            if stored:
                stored["status"] = "stopped"
            result = dict(stored or {})
            result["status"] = "stopped"
            result["session_id"] = latest_name
            return result
        t_status = live.get("terminal_status")
        confirmed = live.get("_session_confirmed", False)
        terminals_in_resp = live.get("_terminals_in_response", False)
        # Dead when: terminal crashed ("error") OR GET confirmed no terminals at all.
        # "completed" = turn done, alive → do NOT mark stopped.
        dead = t_status == "error" or (confirmed and terminals_in_resp and t_status is None)
        if dead:
            live["status"] = "stopped"
            stored = self._sessions.get(latest_name)
            if stored:
                stored["status"] = "stopped"
        result = live if live else dict(self._sessions.get(latest_name) or {})
        result["session_id"] = latest_name
        return result

    def launch_worker(self, spec: dict[str, Any]) -> dict[str, Any]:
        task_id = str(spec.get("task_id") or "").strip()
        role = str(spec.get("role") or "bravo").strip().lower()
        provider = str(spec.get("provider") or "claude").strip().lower()
        working_directory = str(spec.get("working_directory") or "").strip()
        acceptance_criteria = str(spec.get("acceptance_criteria") or "").strip()

        # Profile/provider mapping (no local bravo/charlie CAO profiles; use built-ins)
        agent_profile = _ROLE_TO_PROFILE.get(role, "developer")
        cao_provider = _PROVIDER_TO_CAO.get(provider, "claude_code")

        # Unique session name with task_id slug + random suffix so retries don't collide
        safe_task = re.sub(r"[^A-Za-z0-9-]", "-", task_id)[:32].strip("-")
        session_name = f"{safe_task}-{uuid.uuid4().hex[:8]}"

        query: dict[str, Any] = {
            "agent_profile": agent_profile,
            "provider": cao_provider,
            "session_name": session_name,
        }
        if working_directory:
            query["working_directory"] = working_directory

        body: dict[str, Any] | None = None
        if acceptance_criteria:
            body = {"initial_message": acceptance_criteria}

        resp = self._request("POST", "/sessions", body, params=query, timeout=60.0)

        # Terminal response: id (8 hex) + session_name
        terminal_id = str(resp.get("id") or resp.get("terminal_id") or "")
        actual_name = str(resp.get("session_name") or session_name)

        self._sessions[actual_name] = {
            "terminal_id": terminal_id,
            "session_name": actual_name,
            "task_id": task_id,
            "role": role,
            "provider": provider,
            "status": "running",
            "worktree": working_directory,
            "claimed": True,
            "chat_claimed_done": False,
        }
        self._session_order.append(actual_name)

        return {
            "session_id": actual_name,
            "terminal_id": terminal_id,
            "status": "running",
            "isolated_worktree": True,
        }

    def message_worker(self, session_id: str, text: str) -> dict[str, Any]:
        stored = self._sessions.get(session_id)
        if stored is None:
            raise NotFoundError(f"session not found: {session_id}")
        terminal_id = stored["terminal_id"]
        self._request(
            "POST",
            f"/terminals/{terminal_id}/input",
            params={"message": text},
            timeout=10.0,
        )
        return {"session_id": session_id, "accepted": True, "chat_is_not_done": True}

    def request_handoff(self, session_id: str, task_id: str) -> dict[str, Any]:
        # Durable truth is the Gateway HANDOFF artifact; optionally signal the terminal.
        stored = self._sessions.get(session_id)
        if stored:
            try:
                terminal_id = stored["terminal_id"]
                self._request(
                    "POST",
                    f"/terminals/{terminal_id}/input",
                    params={"message": f"orchestration_type=handoff task_id={task_id}"},
                    timeout=5.0,
                )
            except Exception:
                pass  # non-fatal; artifact is the durable record
            stored["status"] = "handed_off"
            stored["claimed"] = False
        return {"session_id": session_id, "task_id": task_id, "claimed": False}

    @staticmethod
    def _build_review_prompt(spec: dict[str, Any]) -> str:
        """Compose an independent-review prompt for Charlie. Never a raw SHA."""
        git_ref = spec["git_ref"]
        task_id = spec.get("task_id") or ""
        profile = spec.get("reviewer_profile") or {}
        caps = profile.get("capabilities") or ["tests", "type-check", "inspect-files"]
        task_clause = f" (task: {task_id})" if task_id else ""
        return (
            f"[CAO Handoff] Independent review requested{task_clause}. "
            f"You are Charlie — an independent reviewer. "
            f"Review the EXACT git ref: {git_ref}. "
            f"Run: {', '.join(caps)}. "
            f"Do NOT accept Bravo's summary — verify independently from the code and tests. "
            f"Report your verdict with evidence."
        )

    def request_review(self, spec: dict[str, Any]) -> dict[str, Any]:
        # CAO has no /review; send a full independent-review prompt to the Charlie terminal.
        # Sending the prompt (not just a raw SHA) is required — not silently swallowed.
        session_id = spec["session_id"]
        git_ref = spec["git_ref"]
        stored = self._sessions.get(session_id)
        if stored is None:
            raise NotFoundError(f"session not found: {session_id}")
        terminal_id = stored["terminal_id"]
        prompt = self._build_review_prompt(spec)
        self._request(
            "POST",
            f"/terminals/{terminal_id}/input",
            params={"message": prompt},
            timeout=5.0,
        )
        stored["status"] = "review_requested"
        return {
            "session_id": session_id,
            "git_ref": git_ref,
            "reviewer_profile": spec.get("reviewer_profile"),
            "status": "review_requested",
        }

    def stop_worker(self, session_id: str) -> dict[str, Any]:
        stored = self._sessions.get(session_id)
        if stored is None:
            raise NotFoundError(f"session not found: {session_id}")
        terminal_id = stored["terminal_id"]
        # Soft stop: exit terminal (tmux only; does NOT delete worktrees)
        try:
            self._request("POST", f"/terminals/{terminal_id}/exit", timeout=30.0)
        except Exception:
            pass  # best-effort
        # Delete CAO session (tmux teardown; never touches Gateway worktrees)
        try:
            self._request("DELETE", f"/sessions/{session_id}", timeout=30.0)
        except Exception:
            pass  # best-effort
        stored["status"] = "stopped"
        stored["claimed"] = False
        return {"session_id": session_id, "status": "stopped"}

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        stored = self._sessions.get(session_id)
        if stored is None:
            return None
        try:
            resp = self._request("GET", f"/sessions/{session_id}", timeout=2.0)
            # Real CAO returns {"session": {...}, "terminals": [...]}
            # Extract session-level fields and first terminal's id/status.
            merged: dict[str, Any] = {}
            merged["_session_confirmed"] = True  # GET succeeded; used by task_snapshot
            session_obj = resp.get("session")
            if isinstance(session_obj, dict):
                # Skip 'status' — CAO session.status is a tmux concept ("detached"/"attached"),
                # not the task/terminal status; let the in-process stored status win.
                for k, v in session_obj.items():
                    if k != "status":
                        merged[k] = v
            raw_terminals = resp.get("terminals")
            if raw_terminals is not None:
                terminals = raw_terminals if isinstance(raw_terminals, list) else []
                merged["_terminals_in_response"] = True
                if terminals and isinstance(terminals[0], dict):
                    t = terminals[0]
                    merged["terminal_id"] = t.get("id") or stored.get("terminal_id", "")
                    merged["terminal_status"] = t.get("status")
                # else: terminals key present but empty → _terminals_in_response=True, no terminal_status
            # In-process data fills any gaps CAO doesn't know (role, task_id, etc.)
            for k, v in stored.items():
                merged.setdefault(k, v)
            merged["session_id"] = session_id
            return merged
        except HTTPError as exc:
            if exc.code == 404:
                return None  # session confirmed gone
            return dict(stored)
        except Exception:
            return dict(stored)

    def record_worktree(self, session_id: str, worktree: str) -> None:
        stored = self._sessions.get(session_id)
        if stored is not None:
            stored["worktree"] = worktree

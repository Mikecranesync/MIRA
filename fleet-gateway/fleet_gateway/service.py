"""Fleet Gateway service: auth, exactly seven tools, mutate audit, hard deny."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fleet_gateway.audit import AuditLog
from fleet_gateway.auth import require_bearer
from fleet_gateway.cao import CAOClient, review_capability_gap
from fleet_gateway.contract import (
    ALLOWED_PROVIDERS,
    ALLOWED_ROLES,
    ALLOWED_TOOLS,
    DENIED_TOOLS,
    FLEET_STATUS_FIELDS,
    INDEPENDENT_REVIEWER_PROFILE,
    LAUNCH_REQUIRED_FIELDS,
    MUTATE_TOOLS,
    REJECTED_ROLES,
)
from fleet_gateway.errors import (
    ContractViolation,
    DeniedToolError,
    FleetGatewayError,
    NotFoundError,
    ReviewerCapabilityError,
)
from fleet_gateway.lane_health import check_repo_trust, derive_lane_state, format_reset
from fleet_gateway.redact import sanitize_public_payload
from fleet_gateway.router import NodeRouter
from fleet_gateway.store import ArtifactStore
from fleet_gateway.worktree import WorktreeProvisioner, worktrees_from_env

logger = logging.getLogger("fleet-gateway")


def _nonempty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    return str(value).strip() != ""


class FleetGatewayService:
    """Bounded control plane. Callers must pass a bearer on every invoke.

    Physical routing: every CAO/worktree operation goes through ``self.router``,
    which maps a computer name (bravo / charlie) to that node's CAO instance and
    node-local worktree provisioner. A ``launch_worker`` for ``charlie`` reaches
    the Charlie CAO and provisions a Charlie-local worktree; a ``bravo`` launch
    stays on Bravo. Session-addressed tools re-resolve the owning node from the
    stored artifact and fail closed if it cannot be resolved — never defaulting
    to Bravo (defaulting to Bravo was #3552).
    """

    def __init__(
        self,
        *,
        bearer_token: str,
        audit: AuditLog,
        artifacts: ArtifactStore,
        default_requester: str = "unknown",
        router: NodeRouter | None = None,
        cao: CAOClient | None = None,
        worktrees: WorktreeProvisioner | None = None,
    ) -> None:
        # Router is the routing authority. Legacy callers pass a single ``cao``
        # (+ optional ``worktrees``); we wrap it so both nodes resolve to it —
        # correct only when there is genuinely one node.
        if router is None:
            if cao is None:
                raise ValueError("FleetGatewayService requires either router or cao")
            wt = worktrees if worktrees is not None else worktrees_from_env()
            router = NodeRouter.single(cao, wt)
        self.bearer_token = bearer_token
        self.router = router
        self.audit = audit
        self.artifacts = artifacts
        self.default_requester = default_requester
        # session_id → physical node, recorded at launch for later routing.
        self._session_nodes: dict[str, str] = {}
        # node → blocked_until timestamp (Unix epoch) for usage limits
        self._blocked_until: dict[str, float] = {}
        # session_id → (refusal line, reset epoch) from the FIRST sighting of THAT refusal.
        # Dropped once the lane answers anything else, so a later refusal re-pins.
        self._limit_pins: dict[str | None, tuple[str, float]] = {}
        # node → task_ids launched there, refreshed before each launch on that node
        self._tasks_by_node: dict[str, list[str]] = {}
        # Injected trust reader for testing
        self._trust_reader: Any = None

    def list_tools(self) -> list[str]:
        return list(ALLOWED_TOOLS)

    def invoke(
        self,
        tool: str,
        params: dict[str, Any] | None = None,
        *,
        authorization: str | None,
        requester: str | None = None,
    ) -> dict[str, Any]:
        require_bearer(self.bearer_token, authorization)
        params = dict(params or {})
        who = (requester or self.default_requester or "unknown").strip() or "unknown"

        if tool in DENIED_TOOLS:
            self._audit_denied(who, tool, params)
            raise DeniedToolError(f"tool {tool!r} is hard-denied and is not available")
        if tool not in ALLOWED_TOOLS:
            if tool in MUTATE_TOOLS or tool in DENIED_TOOLS:
                self._audit_denied(who, tool, params)
            raise DeniedToolError(f"tool {tool!r} is not on the Fleet Gateway v1 surface")

        handler = {
            "fleet_status": self._fleet_status,
            "task_status": self._task_status,
            "launch_worker": self._launch_worker,
            "message_worker": self._message_worker,
            "request_handoff": self._request_handoff,
            "request_review": self._request_review,
            "stop_worker": self._stop_worker,
        }[tool]

        if tool in MUTATE_TOOLS:
            return self._mutate(tool, params, who, handler)
        return handler(params, who)

    def _audit_denied(self, requester: str, tool: str, params: dict[str, Any]) -> None:
        self.audit.write(
            requester=requester,
            tool=tool,
            task_id=_as_str(params.get("task_id")),
            target_node=_as_str(params.get("role") or params.get("node")),
            target_session=_as_str(params.get("session_id")),
            parameters=params,
            outcome="denied",
            error="hard-denied",
        )

    def _mutate(
        self,
        tool: str,
        params: dict[str, Any],
        requester: str,
        handler: Callable[[dict[str, Any], str], dict[str, Any]],
    ) -> dict[str, Any]:
        task_id = _as_str(params.get("task_id"))
        session_id = _as_str(params.get("session_id"))
        node = _as_str(params.get("role") or params.get("node"))
        try:
            result = handler(params, requester)
        except FleetGatewayError as exc:
            self.audit.write(
                requester=requester,
                tool=tool,
                task_id=task_id or _as_str(params.get("task_id")),
                target_node=node,
                target_session=session_id or _as_str(params.get("session_id")),
                parameters=params,
                outcome="rejected",
                error=str(exc),
            )
            raise
        except Exception as exc:
            self.audit.write(
                requester=requester,
                tool=tool,
                task_id=task_id,
                target_node=node,
                target_session=session_id,
                parameters=params,
                outcome="error",
                error=type(exc).__name__,
            )
            raise
        self.audit.write(
            requester=requester,
            tool=tool,
            task_id=_as_str(result.get("task_id")) or task_id,
            target_node=_as_str(result.get("role")) or node,
            target_session=_as_str(result.get("session_id")) or session_id,
            parameters=params,
            outcome="ok",
        )
        return result

    # ── physical-node resolution ─────────────────────────────────────────────
    def _resolve_node(self, session_id: str | None, task_id: str | None = None) -> str:
        """Which physical node owns this session/task. Fail closed if unknown."""
        node: str | None = None
        if session_id:
            node = self._session_nodes.get(session_id)
        if not node and task_id:
            art = self.artifacts.read_task(task_id) or {}
            node = _as_str(art.get("role") or art.get("node"))
        if not node and session_id:
            tid = self.artifacts.find_task_id_for_session(session_id)
            if tid:
                art = self.artifacts.read_task(tid) or {}
                node = _as_str(art.get("role") or art.get("node"))
        if not node:
            raise NotFoundError(
                f"cannot resolve physical node for session {session_id!r} / task {task_id!r}"
            )
        return node

    def _cao_for_session(self, session_id: str, task_id: str | None = None) -> CAOClient:
        if self.router.is_single():
            return self.router.default_target().cao
        return self.router.target(self._resolve_node(session_id, task_id)).cao

    def _cao_for_task(self, task_id: str) -> CAOClient | None:
        """CAO that owns a task's session, if resolvable; else None (no snapshot)."""
        if self.router.is_single():
            return self.router.default_target().cao
        art = self.artifacts.read_task(task_id) or {}
        node = _as_str(art.get("role") or art.get("node"))
        return self.router.target(node).cao if node else None

    def _fleet_status(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del params, requester
        # Node-less op → the node the Gateway physically runs on (default/bravo).
        raw = self.router.default_target().cao.fleet_snapshot()
        sanitized = sanitize_public_payload(raw if isinstance(raw, dict) else {})
        out: dict[str, Any] = {}
        for field in FLEET_STATUS_FIELDS:
            out[field] = sanitized.get(field)
        return out

    def _task_status(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        task_id = _as_str(params.get("task_id"))
        if not task_id:
            raise ContractViolation("task_id is required")
        artifact = self.artifacts.read_task(task_id) or {}
        task_cao = self._cao_for_task(task_id)
        snapshot = (task_cao.task_snapshot(task_id) if task_cao else None) or {}
        if not artifact and not snapshot:
            raise NotFoundError(f"task not found: {task_id}")
        # Start from artifact; overlay live-session fields where snapshot is authoritative.
        # Snapshot wins for current-state fields; artifact wins for durable fields (handoff).
        merged = dict(artifact)
        _SNAPSHOT_WINS = (
            "status",
            "session_id",
            "worktree",
            "claimed_commit",
            "branch",
            "blockers",
            "chat_claimed_done",
            "review_verdict",
            "review_git_ref",
        )
        for f in _SNAPSHOT_WINS:
            if f in snapshot:
                merged[f] = snapshot[f]
        # Artifact handoff is always durable truth.
        if artifact.get("handoff"):
            merged["handoff"] = artifact["handoff"]
        # claimed_commit: snapshot (live CAO) wins over stale artifact
        claimed = _as_str(snapshot.get("claimed_commit") or merged.get("claimed_commit"))
        recorded = _as_str(artifact.get("claimed_commit") or artifact.get("base_commit"))
        matches = bool(claimed) and bool(recorded) and claimed == recorded
        # Chat claiming "done" is ignored — only durable artifacts matter.
        chat_claimed = bool(merged.get("chat_claimed_done"))
        status = merged.get("status") or "unknown"
        done = False  # v1 never treats a task as done from chat or inference
        if chat_claimed:
            blockers = list(merged.get("blockers") or [])
            if "chat_is_not_done" not in blockers:
                blockers.append("chat_is_not_done")
        else:
            blockers = list(merged.get("blockers") or [])
        # Derive lane state
        lane_state, lane_error = derive_lane_state(snapshot, time.time())

        node_name = merged.get("role") or merged.get("node")
        sid = _as_str(merged.get("session_id") or snapshot.get("session_id"))
        lane_state, limit_error = self._apply_limit(snapshot, lane_state, node_name, sid)
        lane_error = limit_error or lane_error

        payload = {
            "task_id": task_id,
            "node": node_name,
            "provider": merged.get("provider"),
            "branch": merged.get("branch"),
            "worktree": merged.get("worktree"),
            "commit": claimed or recorded or merged.get("base_commit"),
            "handoff": merged.get("handoff"),
            "tests": merged.get("tests"),
            "type_check": merged.get("type_check"),
            "build": merged.get("build"),
            "review_verdict": merged.get("review_verdict"),
            "blockers": blockers,
            "claimed_commit_matches_artifact": matches,
            "status": status,
            "done": done,
            "session_id": merged.get("session_id"),
            "lane_state": lane_state,
        }
        if lane_error:
            payload["lane_error"] = lane_error
        if snapshot.get("blocked_until"):
            blocked_until = snapshot["blocked_until"]
            # Store as Unix timestamp (integer) to avoid redaction of ISO8601
            if isinstance(blocked_until, (int, float)):
                payload["blocked_until"] = int(blocked_until)
            else:
                payload["blocked_until"] = str(blocked_until)
        return sanitize_public_payload(payload)

    def _launch_worker(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        role = str(params.get("role") or "").strip().lower()
        if role in REJECTED_ROLES or role == "specialized":
            raise ContractViolation("specialized/PLC/non-fleet roles are refused")
        if role not in ALLOWED_ROLES:
            allowed = ", ".join(sorted(ALLOWED_ROLES))
            raise ContractViolation(f"role must be one of: {allowed}")
        provider = str(params.get("provider") or "").strip().lower()
        if provider not in ALLOWED_PROVIDERS:
            raise ContractViolation("provider must be claude or codex")
        missing = [name for name in LAUNCH_REQUIRED_FIELDS if not _nonempty(params.get(name))]
        if missing:
            raise ContractViolation("launch_worker missing required fields: " + ", ".join(missing))
        isolated = params.get("isolated_worktree", True)
        if isolated is not True:
            raise ContractViolation("launch_worker requires isolated_worktree=true")
        self._reject_denied_actions(params)

        # Check usage limit blocking (fail-closed before any side effect)
        self._refresh_node_limits(role)
        self._check_usage_limit_block(role)

        # Check repository trust preflight (for claude provider)
        if provider == "claude":
            self._check_repo_trust(role)

        import uuid  # noqa: PLC0415 — local import avoids unused-import lint when rare

        spec = {
            "role": role,
            "provider": provider,
            "task_id": str(params["task_id"]).strip(),
            "github_ref": str(params["github_ref"]).strip(),
            "base_commit": str(params["base_commit"]).strip(),
            "acceptance_criteria": str(params["acceptance_criteria"]).strip(),
            "isolated_worktree": True,
            "branch": str(params.get("branch") or params["github_ref"]).strip(),
        }
        # Resolve the physical node FIRST and fail closed before any side effect
        # (worktree or CAO session). role IS the computer name here; the contract
        # layer already restricts it to bravo/charlie, and the router is the
        # defense-in-depth backstop that maps it to that node's CAO + worktrees.
        target = self.router.target(role)
        # Create the node-local worktree FIRST so CAO receives the real path.
        # For charlie this runs ON Charlie over SSH; for bravo it is local.
        # Use a temporary placeholder session id (real one comes back from CAO).
        temp_session = uuid.uuid4().hex[:12]
        worktree_path = target.worktrees.create(
            task_id=spec["task_id"],
            session_id=temp_session,
            base_commit=spec["base_commit"],
        )
        target.worktrees.maybe_write_proof(
            worktree_path,
            task_id=spec["task_id"],
            acceptance_criteria=spec["acceptance_criteria"],
        )
        worktree = str(worktree_path)
        spec["working_directory"] = worktree
        launched = target.cao.launch_worker(spec)
        session_id = str(launched.get("session_id") or "")
        terminal_id = str(launched.get("terminal_id") or "")
        # Record node ownership so every later session-scoped op routes back to
        # the SAME node's CAO — never inferred from the session id, never Bravo.
        if session_id:
            self._session_nodes[session_id] = role
        self._tasks_by_node.setdefault(role, []).append(spec["task_id"])
        if hasattr(target.cao, "record_worktree"):
            target.cao.record_worktree(session_id, worktree)
        if role == "charlie":
            self._reject_lane_without_execution(
                target, launched, session_id, worktree_path, spec, terminal_id
            )
        record = {
            **spec,
            "session_id": session_id,
            "cao_session_name": session_id,
            "terminal_id": terminal_id,
            "claimed_commit": spec["base_commit"],
            "status": launched.get("status") or "running",
            "claimed": True,
            "handoff": None,
            "tests": "not_run",
            "type_check": "not_run",
            "build": "not_run",
            "review_verdict": None,
            "blockers": [],
            "worktree": worktree,
        }
        artifact_path = self.artifacts.write_task(record)
        # Get lane_state from the response or derive it
        lane_state = launched.get("lane_state", "initializing")
        return sanitize_public_payload(
            {
                "ok": True,
                "session_id": session_id,
                "task_id": spec["task_id"],
                "role": role,
                "provider": provider,
                "github_ref": spec["github_ref"],
                "base_commit": spec["base_commit"],
                "isolated_worktree": True,
                "worktree": worktree,
                "artifact": str(artifact_path.name),
                "lane_state": lane_state,
            }
        )

    def _apply_limit(
        self, snapshot: dict[str, Any], lane_state: str, node: str | None, sid: str | None
    ) -> tuple[str, str | None]:
        """D1: record a node block from a lane's limit refusal; returns (lane_state, error).

        The refusal stays in scrollback, and re-parsing "resets 12am" after it passes would
        yield the NEXT midnight and block forever, so the reset is pinned to the first
        sighting of that refusal line on that session.
        """
        now = time.time()
        if lane_state != "blocked_usage_limit" or not snapshot.get("blocked_until"):
            self._limit_pins.pop(sid, None)  # lane answered something else: re-arm
            return lane_state, None
        line = str(snapshot.get("limit_line") or "")
        pin = self._limit_pins.get(sid)
        if pin is None or pin[0] != line:
            pin = (line, float(snapshot["blocked_until"]))
            self._limit_pins[sid] = pin
        blocked_until = pin[1]
        snapshot["blocked_until"] = blocked_until
        if now >= blocked_until:
            return derive_lane_state(snapshot, now, ignore_limit=True)
        if node:
            self._blocked_until[node] = max(self._blocked_until.get(node, 0.0), blocked_until)
        return lane_state, f"usage limit reached on {node}; resets {format_reset(blocked_until)}"

    def _refresh_node_limits(self, node: str) -> None:
        """Re-read this node's own lanes before launching, so a refusal blocks the next
        launch even when no task_status poll ran in between. Fail-open per lane."""
        tasks = self._tasks_by_node.get(node, [])[-10:]
        if not tasks:
            return
        cao = self.router.target(node).cao
        for tid in tasks:
            try:
                snap = cao.task_snapshot(tid)
                if snap:
                    state, _ = derive_lane_state(snap, time.time())
                    self._apply_limit(snap, state, node, _as_str(snap.get("session_id")))
            except Exception:  # noqa: BLE001 — a dead lane must not block launching
                logger.warning("usage-limit refresh failed for task %s on %s", tid, node)

    def _check_usage_limit_block(self, node: str) -> None:
        """Check if node is currently blocked due to usage limit.

        Raises: ContractViolation if the node is blocked and reset time has not passed.
        """
        blocked_until = self._blocked_until.get(node)
        if blocked_until is None:
            return

        now = time.time()
        if now >= blocked_until:
            # Block has expired, clear it
            del self._blocked_until[node]
            return

        # Still blocked; format the reset time and refuse
        raise ContractViolation(
            f"node {node} is blocked due to usage limit; resets at {format_reset(blocked_until)}"
        )

    def _check_repo_trust(self, node: str) -> None:
        """Check if repository is trusted before launching on this node.

        D2: Reads ~/.claude.json ON THE TARGET NODE when provisioner has ssh_host.

        Raises: ContractViolation if trust check fails.
        """
        try:
            # Get the repo path and provisioner from the target node
            target = self.router.target(node)
            repo = target.worktrees.repo

            # Use injected reader if available (for testing)
            if self._trust_reader is not None:
                trusted = self._trust_reader(str(repo))
            else:
                # D2: Pass provisioner so check_repo_trust can read on target node if ssh_host is set
                trusted = check_repo_trust(str(repo), provisioner=target.worktrees)

            if not trusted:
                raise ContractViolation(
                    f"Repository {repo} is not trusted. "
                    f"Run: open Claude once in a worktree of {repo} and choose 'Yes, I trust this folder'"
                )
        except ValueError as e:
            # Trust state cannot be determined
            raise ContractViolation(f"Repository trust check failed: {e}")

    def _reject_lane_without_execution(
        self,
        target: Any,
        launched: dict[str, Any],
        session_id: str,
        worktree_path: Path,
        spec: dict[str, Any],
        terminal_id: str,
    ) -> None:
        """Fail closed when a Charlie review lane cannot execute (#3817).

        A lane without Bash preflights BLOCKED and idles in tmux forever. Stop it, remove
        the Gateway's own fresh worktree, record why, and raise — never leave it running.
        Cleanup failures are logged but never mask the capability error.
        """
        gap = review_capability_gap(launched.get("allowed_tools"))
        if gap is None:
            return
        cleanup: list[str] = []
        try:
            target.cao.stop_worker(session_id)
            cleanup.append("session stopped")
        except Exception as exc:  # noqa: BLE001 — must not mask the capability error
            logger.warning("reviewer-capability reject: stop %s failed: %s", session_id, exc)
            cleanup.append(f"session stop FAILED ({exc})")
        try:
            target.worktrees.remove(worktree_path)
            cleanup.append("worktree removed")
        except Exception as exc:  # noqa: BLE001
            logger.warning("reviewer-capability reject: remove %s failed: %s", worktree_path, exc)
            cleanup.append(f"worktree removal FAILED ({exc})")
        self.artifacts.write_task(
            {
                **spec,
                "session_id": session_id,
                "terminal_id": terminal_id,
                "status": "rejected",
                "claimed": False,
                "blockers": [f"reviewer lane cannot execute: {gap}"],
                "worktree": str(worktree_path),
            }
        )
        raise ReviewerCapabilityError(
            f"charlie review lane cannot execute ({gap}); {', '.join(cleanup)}. "
            "Grant execute_bash via the CAO launch (the Gateway requests it) or a local "
            "reviewer profile override on that node."
        )

    def _message_worker(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        session_id = _as_str(params.get("session_id"))
        text = params.get("text")
        if not session_id:
            raise ContractViolation("session_id is required")
        if not isinstance(text, str) or not text.strip():
            raise ContractViolation("text is required")
        cao = self._cao_for_session(session_id, _as_str(params.get("task_id")))
        result = cao.message_worker(session_id, text)
        result.setdefault("chat_is_not_done", True)
        result.setdefault("session_id", session_id)
        return sanitize_public_payload(result)

    def _request_handoff(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        session_id = _as_str(params.get("session_id"))
        task_id = _as_str(params.get("task_id"))
        if not session_id:
            raise ContractViolation("session_id is required")
        if not task_id:
            # Recover task_id from artifact scan via CAO snapshot when omitted.
            raise ContractViolation("task_id is required")
        existing = self.artifacts.read_task(task_id) or {}
        cao = self._cao_for_session(session_id, task_id)
        cao.request_handoff(session_id, task_id)
        handoff_path = self.artifacts.write_handoff(
            task_id=task_id, session_id=session_id, record=existing
        )
        updated = {
            **existing,
            "task_id": task_id,
            "session_id": session_id,
            "claimed": False,
            "status": "handed_off",
            "handoff": str(handoff_path.name),
        }
        self.artifacts.write_task(updated)
        return sanitize_public_payload(
            {
                "ok": True,
                "task_id": task_id,
                "session_id": session_id,
                "claimed": False,
                "handoff": str(handoff_path.name),
                "status": "handed_off",
            }
        )

    def _request_review(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        session_id = _as_str(params.get("session_id"))
        git_ref = _as_str(params.get("git_ref") or params.get("github_ref"))
        if not session_id:
            raise ContractViolation("session_id is required")
        if not git_ref:
            raise ContractViolation("request_review requires the exact Git ref to review")
        if _nonempty(params.get("bravo_summary")):
            raise ContractViolation("request_review reviews the exact Git ref, not a Bravo summary")
        # Role is taken from the stored session/artifact, never from the caller.
        task_id = _as_str(params.get("task_id"))
        artifact = self.artifacts.read_task(task_id) if task_id else None
        cao = self._cao_for_session(session_id, task_id)
        stored = cao.get_session(session_id) or {}
        session_role = str(stored.get("role") or (artifact or {}).get("role") or "").strip().lower()
        if session_role != "charlie":
            raise ContractViolation("request_review is Charlie only")
        gap = review_capability_gap(stored.get("allowed_tools"))
        if gap:
            raise ReviewerCapabilityError(
                f"session {session_id} cannot run an independent review: {gap}"
            )
        spec = {
            "session_id": session_id,
            "git_ref": git_ref,
            "task_id": task_id,
            "reviewer_profile": dict(INDEPENDENT_REVIEWER_PROFILE),
        }
        result = cao.request_review(spec)
        if artifact:
            artifact = {
                **artifact,
                "review_verdict": "pending",
                "review_git_ref": git_ref,
                "status": "review_requested",
            }
            self.artifacts.write_task(artifact)
        result.setdefault("session_id", session_id)
        result.setdefault("git_ref", git_ref)
        result.setdefault("reviewer_profile", spec["reviewer_profile"])
        return sanitize_public_payload(result)

    def _stop_worker(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        if _nonempty(params.get("node")) or _nonempty(params.get("node_id")):
            raise ContractViolation("stop_worker stops one session, not a node")
        if _nonempty(params.get("cao")) or params.get("stop_cao") is True:
            raise ContractViolation("stop_worker does not stop CAO")
        if (
            _nonempty(params.get("worktree"))
            or params.get("delete_worktree") is True
            or params.get("delete") is True
        ):
            raise ContractViolation("stop_worker does not delete a worktree")
        session_id = _as_str(params.get("session_id"))
        if not session_id:
            raise ContractViolation("session_id is required")
        cao = self._cao_for_session(session_id, _as_str(params.get("task_id")))
        result = cao.stop_worker(session_id)
        task_id = _as_str(params.get("task_id"))
        # Resolve task_id from artifact store when only session_id was provided.
        if not task_id:
            task_id = self.artifacts.find_task_id_for_session(session_id)
        if task_id:
            existing = self.artifacts.read_task(task_id) or {"task_id": task_id}
            existing["status"] = "stopped"
            existing["claimed"] = False
            self.artifacts.write_task(existing)
        result.setdefault("session_id", session_id)
        result.setdefault("status", "stopped")
        return sanitize_public_payload(result)

    def _reject_denied_actions(self, params: dict[str, Any]) -> None:
        forbidden_flags = (
            "merge",
            "deploy",
            "push_main",
            "shell",
            "delete_worktree",
            "plc",
            "ignition",
            "com3",
        )
        for flag in forbidden_flags:
            if params.get(flag) is True or str(params.get(flag) or "").lower() in {"1", "yes"}:
                raise DeniedToolError(f"{flag} is hard-denied")


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def build_service(
    *,
    bearer_token: str,
    data_dir: Path,
    requester: str = "unknown",
    router: NodeRouter | None = None,
    cao: CAOClient | None = None,
    worktrees: WorktreeProvisioner | None = None,
) -> FleetGatewayService:
    """Build the service. Prefer ``router`` (multi-node); ``cao``/``worktrees``
    remain accepted for legacy single-node callers (wrapped into a router)."""
    data_dir = Path(data_dir)
    return FleetGatewayService(
        bearer_token=bearer_token,
        audit=AuditLog(data_dir / "audit.jsonl"),
        artifacts=ArtifactStore(data_dir),
        default_requester=requester,
        router=router,
        cao=cao,
        worktrees=worktrees,
    )

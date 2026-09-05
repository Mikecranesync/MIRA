"""Fleet Gateway service: auth, locked tools, mutate audit, hard deny."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fleet_gateway.audit import AuditLog
from fleet_gateway.auth import require_bearer
from fleet_gateway.cao import CAOClient
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
    OwnershipError,
)
from fleet_gateway.legacy import EmptyProbe, LegacySession, LegacySessionProbe, classify_name
from fleet_gateway.redact import sanitize_public_payload
from fleet_gateway.router import NodeRouter
from fleet_gateway.store import ArtifactStore
from fleet_gateway.worktree import WorktreeProvisioner, worktrees_from_env


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
        probe: LegacySessionProbe | None = None,
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
        self.probe: LegacySessionProbe = probe if probe is not None else EmptyProbe()
        # session_id → physical node, recorded at launch for later routing.
        self._session_nodes: dict[str, str] = {}

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
            "list_legacy_sessions": self._list_legacy_sessions,
            "launch_worker": self._launch_worker,
            "message_worker": self._message_worker,
            "request_handoff": self._request_handoff,
            "request_review": self._request_review,
            "stop_worker": self._stop_worker,
            "adopt_legacy_session": self._adopt_legacy_session,
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
        payload = {
            "task_id": task_id,
            "node": merged.get("role") or merged.get("node"),
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
        }
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
        if hasattr(target.cao, "record_worktree"):
            target.cao.record_worktree(session_id, worktree)
        record = {
            **spec,
            "session_id": session_id,
            "cao_session_name": session_id,
            "terminal_id": terminal_id,
            "claimed_commit": spec["base_commit"],
            "status": launched.get("status") or "running",
            "claimed": True,
            "fleet_owned": True,
            "handoff": None,
            "tests": "not_run",
            "type_check": "not_run",
            "build": "not_run",
            "review_verdict": None,
            "blockers": [],
            "worktree": worktree,
        }
        artifact_path = self.artifacts.write_task(record)
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
            }
        )

    def _message_worker(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        session_id = _as_str(params.get("session_id"))
        text = params.get("text")
        if not session_id:
            raise ContractViolation("session_id is required")
        if not isinstance(text, str) or not text.strip():
            raise ContractViolation("text is required")
        self._require_fleet_ownership(session_id)
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
        self._require_fleet_ownership(session_id)
        self._require_task_owns_session(task_id, session_id)
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
        self._require_fleet_ownership(session_id)
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

    def _require_fleet_ownership(self, session_id: str) -> None:
        """Raise OwnershipError if the fleet cannot prove it owns session_id.

        Artifact store is the durable source of truth. No CAO call is made
        when ownership cannot be proven (fail-closed).
        """
        if not self.artifacts.is_fleet_owned(session_id):
            raise OwnershipError(
                f"refuse: cannot prove fleet owns session '{session_id}' — "
                "no matching fleet artifact; no action taken"
            )

    def _require_task_owns_session(self, task_id: str, session_id: str) -> None:
        """Raise unless the artifact store binds THIS session to THIS task.

        Fleet-ownership alone only proves the session belongs to *some* task; a
        mismatched pair could hand off session A while rewriting task B.
        """
        owner = self.artifacts.find_task_id_for_session(session_id)
        if owner != task_id:
            raise OwnershipError(
                f"refuse: task '{task_id}' does not own session '{session_id}' "
                f"(owner: {owner or 'none'}); no action taken"
            )

    def _require_role(self, params: dict[str, Any]) -> str:
        role = str(params.get("role") or params.get("node") or "").strip().lower()
        if role in REJECTED_ROLES or role == "specialized":
            raise ContractViolation("specialized/PLC/non-fleet roles are refused")
        if role not in ALLOWED_ROLES:
            allowed = ", ".join(sorted(ALLOWED_ROLES))
            raise ContractViolation(f"role must be one of: {allowed}")
        return role

    def _list_legacy_sessions(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        role = self._require_role(params)
        sessions = [item.to_public_dict() for item in self.probe.list_sessions(role)]
        return sanitize_public_payload(
            {"ok": True, "role": role, "node": role, "sessions": sessions}
        )

    def _adopt_legacy_session(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        role = self._require_role(params)
        external_id = _as_str(params.get("external_id") or params.get("session_id"))
        if not external_id:
            raise ContractViolation("external_id is required")
        chosen = self._resolve_legacy_match(role, external_id)
        local_id = chosen.local_session_id
        if self.artifacts.is_fleet_owned(local_id):
            raise ContractViolation(
                f"already-owned: session '{local_id}' is already fleet-owned; no mutation"
            )
        task_id = f"legacy-adopt-{local_id}"
        provenance = {
            "external_id": external_id,
            "match_field": _match_field(chosen, external_id),
            "probe": type(self.probe).__name__,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        record = {
            "task_id": task_id,
            "session_id": local_id,
            "role": role,
            "node": role,
            "provider": chosen.provider,
            "cwd": chosen.cwd,
            "pid": chosen.pid,
            "tmux_name": chosen.tmux_name,
            "bridge_session_id": chosen.bridge_session_id,
            "local_session_id": local_id,
            "status": "running",
            "claimed": True,
            "fleet_owned": True,
            "adopted": True,
            "provenance": provenance,
            "handoff": None,
            "tests": "not_run",
            "type_check": "not_run",
            "build": "not_run",
            "review_verdict": None,
            "blockers": [],
            "worktree": chosen.cwd,
        }
        target = (
            self.router.target(role)
            if not self.router.is_single()
            else self.router.default_target()
        )
        # CAO-side ownership: a session another task already claims must never be
        # silently rewritten, even when no local artifact exists.
        self._reject_foreign_cao_owner(target.cao, local_id, task_id)
        # Prove the binding FIRST. Ownership is conferred by the artifact, so it
        # is written only after CAO has accepted the session — a failed bind must
        # leave no ownership behind.
        target.cao.register_adopted_session(
            local_id,
            {
                "task_id": task_id,
                "role": role,
                "provider": chosen.provider,
                "cwd": chosen.cwd,
            },
        )
        artifact_path = self.artifacts.write_task(record)
        self._session_nodes[local_id] = role
        return sanitize_public_payload(
            {
                "ok": True,
                "session_id": local_id,
                "task_id": task_id,
                "role": role,
                "node": role,
                "provider": chosen.provider,
                "cwd": chosen.cwd,
                "pid": chosen.pid,
                "tmux_name": chosen.tmux_name,
                "bridge_session_id": chosen.bridge_session_id,
                "provenance": provenance,
                "artifact": str(artifact_path.name),
            }
        )

    def _reject_foreign_cao_owner(self, cao: Any, session_id: str, task_id: str) -> None:
        """Refuse when CAO already reports the session claimed by another task.

        Best-effort by design: a CAO that cannot answer must not block adoption,
        but an answer naming a DIFFERENT owner is decisive and fails closed.
        """
        getter = getattr(cao, "get_session", None)
        if getter is None:
            return
        try:
            existing = getter(session_id)
        except Exception:
            return
        if not isinstance(existing, dict):
            return
        owner = str(existing.get("task_id") or "").strip()
        if owner and owner != task_id and existing.get("claimed"):
            raise ContractViolation(
                f"already-owned: CAO reports session '{session_id}' claimed by "
                f"task '{owner}'; no mutation"
            )

    def _resolve_legacy_match(self, role: str, external_id: str) -> LegacySession:
        on_node = [item for item in self.probe.list_sessions(role) if item.matches(external_id)]
        elsewhere: list[LegacySession] = []
        for other in ALLOWED_ROLES:
            if other == role:
                continue
            elsewhere.extend(
                item for item in self.probe.list_sessions(other) if item.matches(external_id)
            )
        if not on_node:
            if elsewhere:
                nodes = ", ".join(sorted({item.node for item in elsewhere}))
                raise ContractViolation(
                    f"wrong-node: identifier {external_id!r} is not on {role}; seen on {nodes}"
                )
            raise NotFoundError(f"no live legacy session matches {external_id!r} on {role}")
        if len(on_node) > 1:
            ids = ", ".join(item.local_session_id for item in on_node)
            raise ContractViolation(
                f"ambiguous: identifier {external_id!r} matches multiple sessions on {role}: {ids}"
            )
        if elsewhere:
            # An identifier that also resolves on another node is ambiguous, not
            # "found here". Previously `elsewhere` was ignored whenever the
            # requested node matched, so the local candidate won silently.
            nodes = ", ".join(sorted({item.node for item in elsewhere} | {role}))
            raise ContractViolation(
                f"ambiguous: identifier {external_id!r} matches sessions on multiple nodes: {nodes}"
            )
        chosen = on_node[0]
        if chosen.classification == "stale":
            raise ContractViolation(
                f"stale: identifier {external_id!r} maps to dead session '{chosen.local_session_id}'"
            )
        # Re-derive protection from the name instead of trusting the inventory's
        # own label — a probe that mislabels a protected session must not be able
        # to make it adoptable.
        derived, derived_adoptable = classify_name(chosen.tmux_name, running=True)
        if (
            chosen.classification == "protected"
            or not chosen.adoptable
            or derived == "protected"
            or not derived_adoptable
        ):
            raise ContractViolation(
                f"protected: session '{chosen.local_session_id}' is not adoptable"
            )
        return chosen

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


def _match_field(session: LegacySession, external_id: str) -> str:
    needle = (external_id or "").strip()
    if session.bridge_session_id == needle:
        return "bridge_session_id"
    if session.local_session_id == needle:
        return "local_session_id"
    if session.tmux_name == needle:
        return "tmux_name"
    if session.pid is not None and str(session.pid) == needle:
        return "pid"
    return "unknown"


def build_service(
    *,
    bearer_token: str,
    data_dir: Path,
    requester: str = "unknown",
    router: NodeRouter | None = None,
    cao: CAOClient | None = None,
    worktrees: WorktreeProvisioner | None = None,
    probe: LegacySessionProbe | None = None,
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
        probe=probe,
    )

"""Fleet Gateway service: auth, exactly seven tools, mutate audit, hard deny."""

from __future__ import annotations

from collections.abc import Callable
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
)
from fleet_gateway.redact import sanitize_public_payload
from fleet_gateway.store import ArtifactStore
from fleet_gateway.worktree import WorktreeProvisioner, worktrees_from_env


def _nonempty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    return str(value).strip() != ""


class FleetGatewayService:
    """Bounded control plane. Callers must pass a bearer on every invoke."""

    def __init__(
        self,
        *,
        bearer_token: str,
        cao: CAOClient,
        audit: AuditLog,
        artifacts: ArtifactStore,
        default_requester: str = "unknown",
        worktrees: WorktreeProvisioner | None = None,
    ) -> None:
        self.bearer_token = bearer_token
        self.cao = cao
        self.audit = audit
        self.artifacts = artifacts
        self.default_requester = default_requester
        self.worktrees = worktrees if worktrees is not None else worktrees_from_env()

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

    def _fleet_status(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del params, requester
        raw = self.cao.fleet_snapshot()
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
        snapshot = self.cao.task_snapshot(task_id) or {}
        merged = {**snapshot, **artifact}
        if artifact.get("handoff"):
            merged["handoff"] = artifact["handoff"]
        if snapshot.get("blockers") or snapshot.get("chat_claimed_done"):
            merged["blockers"] = snapshot.get("blockers") or merged.get("blockers")
            merged["chat_claimed_done"] = snapshot.get("chat_claimed_done")
        if not merged:
            raise NotFoundError(f"task not found: {task_id}")
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
        }
        return sanitize_public_payload(payload)

    def _launch_worker(self, params: dict[str, Any], requester: str) -> dict[str, Any]:
        del requester
        role = str(params.get("role") or "").strip().lower()
        if role in REJECTED_ROLES or role == "specialized":
            raise ContractViolation("specialized/PLC/non-bravo-charlie roles are refused")
        if role not in ALLOWED_ROLES:
            raise ContractViolation("role must be bravo or charlie")
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
        launched = self.cao.launch_worker(spec)
        session_id = str(launched.get("session_id") or "")
        worktree_path = self.worktrees.create(
            task_id=spec["task_id"],
            session_id=session_id,
            base_commit=spec["base_commit"],
        )
        self.worktrees.maybe_write_proof(
            worktree_path,
            task_id=spec["task_id"],
            acceptance_criteria=spec["acceptance_criteria"],
        )
        worktree = str(worktree_path)
        if hasattr(self.cao, "record_worktree"):
            self.cao.record_worktree(session_id, worktree)
        record = {
            **spec,
            "session_id": session_id,
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
        result = self.cao.message_worker(session_id, text)
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
        self.cao.request_handoff(session_id, task_id)
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
        stored = self.cao.get_session(session_id) or {}
        session_role = str(stored.get("role") or (artifact or {}).get("role") or "").strip().lower()
        if session_role != "charlie":
            raise ContractViolation("request_review is Charlie only")
        spec = {
            "session_id": session_id,
            "git_ref": git_ref,
            "task_id": task_id,
            "reviewer_profile": dict(INDEPENDENT_REVIEWER_PROFILE),
        }
        result = self.cao.request_review(spec)
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
        result = self.cao.stop_worker(session_id)
        task_id = _as_str(params.get("task_id"))
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
    cao: CAOClient,
    data_dir: Path,
    requester: str = "unknown",
    worktrees: WorktreeProvisioner | None = None,
) -> FleetGatewayService:
    data_dir = Path(data_dir)
    return FleetGatewayService(
        bearer_token=bearer_token,
        cao=cao,
        audit=AuditLog(data_dir / "audit.jsonl"),
        artifacts=ArtifactStore(data_dir),
        default_requester=requester,
        worktrees=worktrees,
    )

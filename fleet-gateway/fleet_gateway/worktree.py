"""Create real isolated git worktrees. Never delete them (deny-list)."""

from __future__ import annotations

import os
import re
import subprocess
import uuid
from pathlib import Path

from fleet_gateway.errors import ContractViolation

DEFAULT_REPO = Path("/Users/bravonode/Mira")
DEFAULT_PARENT = Path("/Users/bravonode/Mira-worktrees")

PROOF_TASK_ID = "foreman-gateway-proof"
PROOF_MARKER = "FOREMAN-GATEWAY-PROOF"
PROOF_FILENAME = "FOREMAN-GATEWAY-PROOF.txt"

_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(value: str, *, max_len: int = 48) -> str:
    cleaned = _SAFE_RE.sub("-", (value or "").strip()).strip("-.") or "task"
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned[:max_len]


def _short_session(session_id: str) -> str:
    compact = "".join(ch for ch in (session_id or "") if ch.isalnum())
    return (compact[-12:] or uuid.uuid4().hex[:12])[:12]


class WorktreeProvisioner:
    """``git worktree add --detach`` into a unique sibling directory. Never rm -rf."""

    def __init__(self, *, repo: Path, parent: Path) -> None:
        self.repo = Path(repo)
        self.parent = Path(parent)

    def create(self, *, task_id: str, session_id: str, base_commit: str) -> Path:
        if not self.repo.exists():
            raise ContractViolation("isolated worktree source repo is not available")
        commit = (base_commit or "").strip()
        if not commit:
            raise ContractViolation("base_commit is required to create an isolated worktree")
        self.parent.mkdir(parents=True, exist_ok=True)
        path = self.parent / f"fleet-e2e-{_safe_segment(task_id)}-{_short_session(session_id)}"
        while path.exists():
            path = self.parent / (
                f"fleet-e2e-{_safe_segment(task_id)}-{_short_session(session_id)}-"
                f"{uuid.uuid4().hex[:6]}"
            )
        cmd = [
            "git",
            "-C",
            str(self.repo),
            "worktree",
            "add",
            "--detach",
            str(path),
            commit,
        ]
        try:
            completed = subprocess.run(  # noqa: S603 — argv only, no shell
                cmd,
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ContractViolation("failed to create isolated worktree") from exc
        if completed.returncode != 0 or not path.is_dir():
            raise ContractViolation("failed to create isolated worktree")
        return path

    def maybe_write_proof(
        self,
        worktree: Path,
        *,
        task_id: str,
        acceptance_criteria: str,
    ) -> None:
        criteria = acceptance_criteria or ""
        if task_id != PROOF_TASK_ID and PROOF_MARKER not in criteria:
            return
        (Path(worktree) / PROOF_FILENAME).write_text(PROOF_MARKER, encoding="utf-8")


def worktrees_from_env() -> WorktreeProvisioner:
    repo_raw = (os.environ.get("FLEET_GATEWAY_REPO") or "").strip()
    parent_raw = (os.environ.get("FLEET_GATEWAY_WORKTREE_PARENT") or "").strip()
    repo = Path(repo_raw) if repo_raw else DEFAULT_REPO
    parent = Path(parent_raw) if parent_raw else DEFAULT_PARENT
    return WorktreeProvisioner(repo=repo, parent=parent)

"""Durable task artifacts (HANDOFF + launch record). Chat is never a done signal."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.tasks_dir = self.root / "tasks"
        self.handoffs_dir = self.root / "handoffs"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self.handoffs_dir.mkdir(parents=True, exist_ok=True)

    def _task_path(self, task_id: str) -> Path:
        safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in task_id)
        return self.tasks_dir / f"{safe}.json"

    def _handoff_path(self, task_id: str) -> Path:
        safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in task_id)
        return self.handoffs_dir / f"{safe}.HANDOFF.md"

    def write_task(self, record: dict[str, Any]) -> Path:
        path = self._task_path(str(record["task_id"]))
        payload = dict(record)
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return path

    def read_task(self, task_id: str) -> dict[str, Any] | None:
        path = self._task_path(task_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def write_handoff(self, *, task_id: str, session_id: str, record: dict[str, Any]) -> Path:
        path = self._handoff_path(task_id)
        lines = [
            f"# HANDOFF {task_id}",
            "",
            f"timestamp: {datetime.now(timezone.utc).isoformat()}",
            f"task_id: {task_id}",
            f"session_id: {session_id}",
            f"role: {record.get('role', '')}",
            f"provider: {record.get('provider', '')}",
            f"github_ref: {record.get('github_ref', '')}",
            f"base_commit: {record.get('base_commit', '')}",
            f"claimed_commit: {record.get('claimed_commit', '')}",
            f"branch: {record.get('branch', '')}",
            f"worktree: {record.get('worktree', '')}",
            "claimed: false",
            "status: handed_off",
            "",
            "This artifact is the durable handoff. Chat messages are not done.",
            "",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")
        return path

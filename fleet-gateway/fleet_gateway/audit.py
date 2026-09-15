"""Durable mutate audit log. Secrets are stripped before write."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fleet_gateway.redact import redact_params


class AuditLog:
    """Append-only JSONL audit. One record per mutate attempt (ok or rejected)."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(
        self,
        *,
        requester: str,
        tool: str,
        task_id: str | None,
        target_node: str | None,
        target_session: str | None,
        parameters: dict[str, Any],
        outcome: str,
        error: str | None = None,
    ) -> dict[str, Any]:
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "requester": requester,
            "tool": tool,
            "task_id": task_id,
            "target_node": target_node,
            "target_session": target_session,
            "parameters": redact_params(parameters),
            "outcome": outcome,
        }
        if error:
            record["error"] = error
        line = json.dumps(record, sort_keys=True, default=str)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        return record

    def read_all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        records: list[dict[str, Any]] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
        return records

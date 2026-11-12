"""SQLite store for mission control v2: GitHub events, agent reports, env versions.

Idempotent by construction: events are keyed by delivery id (webhook) or event id
(poll) and inserted with INSERT OR IGNORE; reports are keyed by comment id and
replaced on edit (DELIVERY.md updates lane comments in place).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  delivery_id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,
  repo TEXT, number INTEGER, actor TEXT, action TEXT, head_sha TEXT, url TEXT,
  received_at TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_received ON events(received_at DESC);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, lane TEXT NOT NULL, author TEXT NOT NULL, trusted INTEGER NOT NULL,
  updated_at TEXT NOT NULL, url TEXT NOT NULL, raw TEXT NOT NULL, parsed_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS env_versions (
  env TEXT PRIMARY KEY, git_sha TEXT, built_at TEXT, ok INTEGER NOT NULL, fetched_at TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(self.path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)

    def journal_mode(self) -> str:
        return self._db.execute("PRAGMA journal_mode").fetchone()[0]

    def add_event(self, row: dict) -> bool:
        """Insert one event; False when the delivery id was already stored."""
        with self._lock:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    row["delivery_id"],
                    row["source"],
                    row["kind"],
                    row.get("repo"),
                    row.get("number"),
                    row.get("actor"),
                    row.get("action"),
                    row.get("head_sha"),
                    row.get("url"),
                    row["received_at"],
                    json.dumps(row.get("payload", {}), sort_keys=True),
                ),
            )
            self._db.commit()
            return cur.rowcount == 1

    def events(self, limit: int = 50) -> list[dict]:
        rows = self._db.execute(
            "SELECT * FROM events ORDER BY received_at DESC, delivery_id DESC LIMIT ?", (limit,)
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["payload"] = json.loads(d.pop("payload_json"))
            out.append(d)
        return out

    def put_report(self, row: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO reports VALUES (?,?,?,?,?,?,?,?)",
                (
                    row["id"],
                    row["lane"],
                    row["author"],
                    int(row["trusted"]),
                    row["updated_at"],
                    row["url"],
                    row["raw"],
                    json.dumps(row["parsed"], sort_keys=True),
                ),
            )
            self._db.commit()

    def reports(self) -> list[dict]:
        rows = self._db.execute("SELECT * FROM reports ORDER BY updated_at DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["parsed"] = json.loads(d.pop("parsed_json"))
            out.append(d)
        return out

    def put_env(self, env: str, row: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO env_versions VALUES (?,?,?,?,?)",
                (env, row.get("git_sha"), row.get("built_at"), int(row["ok"]), row["fetched_at"]),
            )
            self._db.commit()

    def envs(self) -> dict[str, dict]:
        return {r["env"]: dict(r) for r in self._db.execute("SELECT * FROM env_versions")}

    def counts(self) -> dict[str, int]:
        n = lambda t: self._db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]  # noqa: E731
        return {"events": n("events"), "reports": n("reports")}

    def latest_event_time(self, source: Optional[str] = None) -> Optional[str]:
        q = "SELECT MAX(received_at) FROM events" + (" WHERE source = ?" if source else "")
        return self._db.execute(q, (source,) if source else ()).fetchone()[0]

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

FOREVER = "9999-12-31T23:59:59Z"  # tombstone stamp for a comment that no longer exists

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
CREATE TABLE IF NOT EXISTS report_tombstones (id INTEGER PRIMARY KEY, deleted_at TEXT NOT NULL);
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

    def put_report(self, row: dict) -> bool:
        """Upsert by comment id; False when an equal-or-newer version exists, or a tombstone
        at or after this version's updated_at (a deleted comment is tombstoned forever)."""
        with self._lock:
            stone = self._db.execute(
                "SELECT deleted_at FROM report_tombstones WHERE id = ?", (row["id"],)
            ).fetchone()
            if stone:
                if row["updated_at"] <= stone[0]:
                    return False
                self._db.execute("DELETE FROM report_tombstones WHERE id = ?", (row["id"],))
            cur = self._db.execute(
                "INSERT INTO reports VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "lane=excluded.lane, author=excluded.author, trusted=excluded.trusted, "
                "updated_at=excluded.updated_at, url=excluded.url, raw=excluded.raw, "
                "parsed_json=excluded.parsed_json WHERE excluded.updated_at > reports.updated_at",
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
            return cur.rowcount == 1

    def delete_report(
        self,
        comment_id: int,
        after: str = "",
        permanent: bool = False,
        if_updated_at: Optional[str] = None,
    ) -> None:
        """Remove a report. A withdrawal (marker edited away at `after`) blocks only versions
        up to that time, so a later edit can restore it; a deleted comment is final. With
        `if_updated_at`, only that exact stored version is removed (one statement, so a newer
        version written meanwhile survives untouched, tombstone included)."""
        stamp = FOREVER if permanent else after
        with self._lock:
            if if_updated_at is not None:
                cur = self._db.execute(
                    "DELETE FROM reports WHERE id = ? AND updated_at = ?",
                    (comment_id, if_updated_at),
                )
                if cur.rowcount != 1:
                    self._db.commit()
                    return
            elif permanent:
                self._db.execute("DELETE FROM reports WHERE id = ?", (comment_id,))
            else:  # a withdrawal removes only versions it postdates: a newer restore stands
                self._db.execute(
                    "DELETE FROM reports WHERE id = ? AND updated_at <= ?", (comment_id, after)
                )
            self._db.execute(
                "INSERT INTO report_tombstones VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET "
                "deleted_at = max(deleted_at, excluded.deleted_at)",
                (comment_id, stamp),
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

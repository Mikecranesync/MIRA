"""Local SQLite store — the offline twin of the Hub's contextualization schema.

Mirrors mira-hub migration 055 (contextualization_projects / ctx_sources / ctx_extractions) minus
the tenant_id / RLS columns (a desktop install is single-user). Stdlib-only (sqlite3), WAL mode,
JSON-encoded list/dict columns. Writes are serialized with a lock because the local HTTP server is
multi-threaded and shares one connection.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    profile_json TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_type   TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    file_path     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    extracted_json TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);
CREATE TABLE IF NOT EXISTS extractions (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id         TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    tag_name          TEXT NOT NULL,
    roles             TEXT NOT NULL DEFAULT '[]',
    uns_path_proposed TEXT,
    i3x_element_id    TEXT,
    evidence_json     TEXT NOT NULL DEFAULT '{}',
    confidence        REAL,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extractions_project ON extractions(project_id);
CREATE INDEX IF NOT EXISTS idx_extractions_source ON extractions(source_id);
CREATE TABLE IF NOT EXISTS exports (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    target      TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exports_project ON exports(project_id);
"""

# Machine-profile identity / metadata stored as a JSON dict in projects.profile_json. These are the
# fields a saved .miraprofile carries and the bundle's asset-matching block reads for Hub import.
PROFILE_FIELDS = (
    "machine_name", "asset_type", "manufacturer", "model", "serial_number",
    "controller_type", "controller_ip", "plc_program_name",
    "customer", "site", "area", "line",
    "proposed_uns_path", "hub_asset_id",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return uuid.uuid4().hex


class Store:
    """A single SQLite database file. Thread-safe for the local server's use."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._conn.commit()
        self._lock = threading.Lock()

    def _migrate(self) -> None:
        """Additive migrations for stores created before a column/table existed (SQLite's
        CREATE TABLE IF NOT EXISTS won't add columns to an existing table)."""
        cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(projects)").fetchall()}
        if "profile_json" not in cols:
            self._conn.execute("ALTER TABLE projects ADD COLUMN profile_json TEXT")

    def close(self) -> None:
        self._conn.close()

    # ── projects ──────────────────────────────────────────────────────────────
    def create_project(self, name: str, description: str | None = None,
                       profile: dict | None = None, pid: str | None = None) -> dict:
        name = (name or "").strip()
        if not name:
            raise ValueError("name is required")
        pid, now = pid or _uid(), _now()
        prof = {k: v for k, v in (profile or {}).items() if k in PROFILE_FIELDS and v not in (None, "")}
        with self._lock:
            self._conn.execute(
                "INSERT INTO projects (id, name, description, status, profile_json, created_at,"
                " updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
                (pid, name, (description or "").strip() or None,
                 json.dumps(prof) if prof else None, now, now),
            )
            self._conn.commit()
        return self.get_project(pid)  # type: ignore[return-value]

    def list_projects(self) -> list[dict]:
        rows = self._conn.execute(
            """SELECT p.*,
                  (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id) AS source_count,
                  (SELECT COUNT(*) FROM extractions e WHERE e.project_id = p.id) AS extraction_count,
                  (SELECT COUNT(*) FROM extractions e WHERE e.project_id = p.id
                       AND e.status = 'accepted') AS accepted_count
               FROM projects p ORDER BY p.updated_at DESC"""
        ).fetchall()
        return [self._project_row(r) for r in rows]

    def get_project(self, pid: str) -> dict | None:
        r = self._conn.execute(
            """SELECT p.*,
                  (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id) AS source_count,
                  (SELECT COUNT(*) FROM extractions e WHERE e.project_id = p.id) AS extraction_count,
                  (SELECT COUNT(*) FROM extractions e WHERE e.project_id = p.id
                       AND e.status = 'accepted') AS accepted_count
               FROM projects p WHERE p.id = ?""",
            (pid,),
        ).fetchone()
        return self._project_row(r) if r else None

    # ── sources ───────────────────────────────────────────────────────────────
    def create_source(
        self, pid: str, source_type: str, file_name: str,
        file_path: str | None = None, status: str = "pending",
    ) -> dict:
        sid, now = _uid(), _now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO sources (id, project_id, source_type, file_name, file_path, status,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (sid, pid, source_type, file_name, file_path, status, now, now),
            )
            self._conn.commit()
        return self._source_row(self._conn.execute("SELECT * FROM sources WHERE id = ?", (sid,)).fetchone())

    def set_source_status(self, sid: str, status: str, error: str | None = None) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE sources SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
                (status, (error or None) and error[:2000], _now(), sid),
            )
            self._conn.commit()

    def list_sources(self, pid: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM sources WHERE project_id = ? ORDER BY created_at", (pid,)
        ).fetchall()
        return [self._source_row(r) for r in rows]

    def set_source_extraction(self, sid: str, ir: dict | None) -> None:
        """Persist a document's extracted Document IR (P2 contextualization reads it)."""
        with self._lock:
            self._conn.execute(
                "UPDATE sources SET extracted_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(ir) if ir is not None else None, _now(), sid),
            )
            self._conn.commit()

    def get_source(self, sid: str) -> dict | None:
        r = self._conn.execute("SELECT * FROM sources WHERE id = ?", (sid,)).fetchone()
        if not r:
            return None
        row = self._source_row(r)
        row["extracted"] = json.loads(r["extracted_json"]) if r["extracted_json"] else None
        return row

    # ── extractions ─────────────────────────────────────────────────────────────
    def add_extractions(self, pid: str, sid: str, rows: list[dict]) -> int:
        now = _uid  # noqa: F841  (avoid confusing name; real timestamp below)
        ts = _now()
        params = [
            (
                _uid(), pid, sid, r["tag_name"], json.dumps(r.get("roles") or []),
                r.get("uns_path_proposed"), r.get("i3x_element_id"),
                json.dumps(r.get("evidence_json") or {}), r.get("confidence"),
                r.get("status") if r.get("status") in ("pending", "accepted", "rejected") else "pending",
                ts, ts,
            )
            for r in rows
        ]
        if not params:
            return 0
        with self._lock:
            self._conn.executemany(
                "INSERT INTO extractions (id, project_id, source_id, tag_name, roles,"
                " uns_path_proposed, i3x_element_id, evidence_json, confidence, status,"
                " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                params,
            )
            self._conn.commit()
        return len(params)

    def list_extractions(self, pid: str) -> list[dict]:
        rows = self._conn.execute(
            """SELECT e.*, s.file_name AS file_name FROM extractions e
                 LEFT JOIN sources s ON s.id = e.source_id
                WHERE e.project_id = ? ORDER BY e.tag_name""",
            (pid,),
        ).fetchall()
        return [self._extraction_row(r) for r in rows]

    def plc_tag_names(self, pid: str) -> list[str]:
        """Distinct tag names extracted from PLC sources — cross-reference targets for documents."""
        rows = self._conn.execute(
            """SELECT DISTINCT e.tag_name FROM extractions e JOIN sources s ON s.id = e.source_id
                WHERE e.project_id = ? AND s.source_type IN ('l5x','csv','st','plcopen','ccw')""",
            (pid,),
        ).fetchall()
        return [r["tag_name"] for r in rows]

    def set_extraction_status(self, eid: str, status: str) -> dict | None:
        if status not in ("pending", "accepted", "rejected"):
            raise ValueError("invalid status")
        with self._lock:
            cur = self._conn.execute(
                "UPDATE extractions SET status = ?, updated_at = ? WHERE id = ?",
                (status, _now(), eid),
            )
            self._conn.commit()
            if cur.rowcount == 0:
                return None
        r = self._conn.execute(
            """SELECT e.*, s.file_name AS file_name FROM extractions e
                 LEFT JOIN sources s ON s.id = e.source_id WHERE e.id = ?""",
            (eid,),
        ).fetchone()
        return self._extraction_row(r) if r else None

    # ── profile identity / metadata ─────────────────────────────────────────────
    def set_profile(self, pid: str, identity: dict) -> dict | None:
        """Merge machine-profile identity/metadata onto a project. Unknown keys are ignored so the
        stored shape stays the known PROFILE_FIELDS set; empty strings clear a field."""
        cur = self.get_profile(pid)
        for k, v in (identity or {}).items():
            if k in PROFILE_FIELDS:
                cur[k] = v
        clean = {k: v for k, v in cur.items() if v not in (None, "")}
        with self._lock:
            n = self._conn.execute(
                "UPDATE projects SET profile_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(clean), _now(), pid),
            ).rowcount
            self._conn.commit()
        return self.get_project(pid) if n else None

    def get_profile(self, pid: str) -> dict:
        r = self._conn.execute("SELECT profile_json FROM projects WHERE id = ?", (pid,)).fetchone()
        if not r or not r["profile_json"]:
            return {}
        return json.loads(r["profile_json"])

    # ── export history ──────────────────────────────────────────────────────────
    def add_export(self, pid: str, kind: str, target: str | None = None,
                   detail: dict | None = None) -> dict:
        eid, now = _uid(), _now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO exports (id, project_id, kind, target, detail_json, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (eid, pid, kind, target, json.dumps(detail or {}), now),
            )
            self._conn.commit()
        return {"id": eid, "kind": kind, "target": target, "detail": detail or {}, "createdAt": now}

    def list_exports(self, pid: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC", (pid,)
        ).fetchall()
        return [{"id": r["id"], "kind": r["kind"], "target": r["target"],
                 "detail": json.loads(r["detail_json"] or "{}"), "createdAt": r["created_at"]}
                for r in rows]

    # ── row mappers ───────────────────────────────────────────────────────────
    @staticmethod
    def _project_row(r: sqlite3.Row) -> dict:
        keys = r.keys()
        return {
            "id": r["id"], "name": r["name"], "description": r["description"],
            "status": r["status"], "sourceCount": r["source_count"],
            "extractionCount": r["extraction_count"], "acceptedCount": r["accepted_count"],
            "profile": json.loads(r["profile_json"]) if ("profile_json" in keys and r["profile_json"])
            else {},
            "createdAt": r["created_at"], "updatedAt": r["updated_at"],
        }

    @staticmethod
    def _source_row(r: sqlite3.Row) -> dict:
        return {
            "id": r["id"], "projectId": r["project_id"], "sourceType": r["source_type"],
            "fileName": r["file_name"], "filePath": r["file_path"], "status": r["status"],
            "errorMessage": r["error_message"], "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }

    @staticmethod
    def _extraction_row(r: sqlite3.Row) -> dict:
        return {
            "id": r["id"], "sourceId": r["source_id"], "fileName": r["file_name"],
            "tagName": r["tag_name"], "roles": json.loads(r["roles"] or "[]"),
            "unsPathProposed": r["uns_path_proposed"], "i3xElementId": r["i3x_element_id"],
            "evidenceJson": json.loads(r["evidence_json"] or "{}"), "confidence": r["confidence"],
            "status": r["status"], "createdAt": r["created_at"], "updatedAt": r["updated_at"],
        }

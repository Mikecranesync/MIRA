"""MIRA Benchmark DB — SQLite tables and CRUD for benchmark agents.

Six tables:
  - benchmark_questions: harvested Reddit questions
  - benchmark_runs: each benchmark execution
  - benchmark_results: per-question results within a run
  - prejudged_cases: cases with known ground truth
  - prejudged_runs: multi-turn benchmark executions
  - prejudged_conversations: per-case transcripts + judge scores
"""

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone

logger = logging.getLogger("mira-benchmark-db")

DB_PATH = os.getenv("MIRA_DB_PATH", "/data/mira.db")


def _get_db(db_path: str | None = None) -> sqlite3.Connection:
    db = sqlite3.connect(db_path or DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.row_factory = sqlite3.Row
    return db


def ensure_tables(db_path: str | None = None) -> None:
    """Create benchmark tables if they don't exist."""
    db = _get_db(db_path)
    db.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_questions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source        TEXT NOT NULL DEFAULT 'reddit',
            subreddit     TEXT,
            post_id       TEXT UNIQUE,
            title         TEXT NOT NULL,
            body          TEXT,
            score         INTEGER DEFAULT 0,
            url           TEXT,
            harvested_at  TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at    TEXT NOT NULL,
            finished_at   TEXT,
            question_count INTEGER DEFAULT 0,
            status        TEXT NOT NULL DEFAULT 'running',
            metadata      TEXT DEFAULT '{}'
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_results (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id        INTEGER NOT NULL REFERENCES benchmark_runs(id),
            question_id   INTEGER NOT NULL REFERENCES benchmark_questions(id),
            reply         TEXT,
            confidence    TEXT,
            trace_id      TEXT,
            next_state    TEXT,
            latency_ms    INTEGER,
            error         TEXT,
            created_at    TEXT NOT NULL
        )
    """)
    # Prejudged benchmark tables
    db.execute("""
        CREATE TABLE IF NOT EXISTS prejudged_cases (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            source          TEXT NOT NULL,
            source_id       TEXT UNIQUE,
            title           TEXT NOT NULL,
            equipment_type  TEXT,
            fault_category  TEXT,
            evidence_packet TEXT NOT NULL,
            ground_truth    TEXT NOT NULL,
            difficulty      TEXT DEFAULT 'medium',
            metadata        TEXT DEFAULT '{}',
            created_at      TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS prejudged_runs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TEXT NOT NULL,
            finished_at     TEXT,
            case_count      INTEGER DEFAULT 0,
            status          TEXT NOT NULL DEFAULT 'running',
            metadata        TEXT DEFAULT '{}'
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS prejudged_conversations (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id                INTEGER NOT NULL REFERENCES prejudged_runs(id),
            case_id               INTEGER NOT NULL REFERENCES prejudged_cases(id),
            transcript            TEXT NOT NULL,
            turn_count            INTEGER NOT NULL,
            reached_diagnosis     BOOLEAN NOT NULL,
            final_state           TEXT,
            total_latency_ms      INTEGER,
            evidence_utilization  REAL,
            path_efficiency       REAL,
            gsd_compliance        REAL,
            root_cause_alignment  REAL,
            expert_comparison     REAL,
            composite_score       REAL,
            verdict               TEXT,
            judge_reasoning       TEXT,
            error                 TEXT,
            created_at            TEXT NOT NULL
        )
    """)
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Questions CRUD
# ---------------------------------------------------------------------------


def insert_question(
    title: str,
    body: str = "",
    subreddit: str = "",
    post_id: str = "",
    score: int = 0,
    url: str = "",
    db_path: str | None = None,
) -> int:
    """Insert a harvested question. Returns row id. Skips duplicates by post_id."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    try:
        cur = db.execute(
            """INSERT INTO benchmark_questions
               (source, subreddit, post_id, title, body, score, url, harvested_at)
               VALUES ('reddit', ?, ?, ?, ?, ?, ?, ?)""",
            (subreddit, post_id, title, body, score, url, now),
        )
        db.commit()
        return cur.lastrowid
    except sqlite3.IntegrityError:
        logger.debug("Duplicate post_id=%s — skipped", post_id)
        return -1
    finally:
        db.close()


def list_questions(
    limit: int = 50,
    offset: int = 0,
    db_path: str | None = None,
) -> list[dict]:
    """Return harvested questions, newest first."""
    db = _get_db(db_path)
    rows = db.execute(
        "SELECT * FROM benchmark_questions ORDER BY id DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


def count_questions(db_path: str | None = None) -> int:
    db = _get_db(db_path)
    n = db.execute("SELECT COUNT(*) FROM benchmark_questions").fetchone()[0]
    db.close()
    return n


# ---------------------------------------------------------------------------
# Runs CRUD
# ---------------------------------------------------------------------------


def create_run(metadata: dict | None = None, db_path: str | None = None) -> int:
    """Create a new benchmark run. Returns run id."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute(
        "INSERT INTO benchmark_runs (started_at, status, metadata) VALUES (?, 'running', ?)",
        (now, json.dumps(metadata or {})),
    )
    db.commit()
    run_id = cur.lastrowid
    db.close()
    return run_id


def finish_run(
    run_id: int,
    status: str = "completed",
    question_count: int = 0,
    db_path: str | None = None,
) -> None:
    """Mark a benchmark run as finished."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE benchmark_runs SET finished_at=?, status=?, question_count=? WHERE id=?",
        (now, status, question_count, run_id),
    )
    db.commit()
    db.close()


def get_run(run_id: int, db_path: str | None = None) -> dict | None:
    db = _get_db(db_path)
    row = db.execute("SELECT * FROM benchmark_runs WHERE id=?", (run_id,)).fetchone()
    db.close()
    return dict(row) if row else None


def list_runs(limit: int = 20, db_path: str | None = None) -> list[dict]:
    db = _get_db(db_path)
    rows = db.execute("SELECT * FROM benchmark_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Results CRUD
# ---------------------------------------------------------------------------


def insert_result(
    run_id: int,
    question_id: int,
    reply: str = "",
    confidence: str = "",
    trace_id: str | None = None,
    next_state: str | None = None,
    latency_ms: int = 0,
    error: str = "",
    db_path: str | None = None,
) -> int:
    """Insert a single benchmark result row. Returns row id."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute(
        """INSERT INTO benchmark_results
           (run_id, question_id, reply, confidence, trace_id, next_state,
            latency_ms, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (run_id, question_id, reply, confidence, trace_id, next_state, latency_ms, error, now),
    )
    db.commit()
    rid = cur.lastrowid
    db.close()
    return rid


def list_results(
    run_id: int,
    db_path: str | None = None,
) -> list[dict]:
    """Return all results for a given run, joined with question title."""
    db = _get_db(db_path)
    rows = db.execute(
        """SELECT r.*, q.title AS question_title, q.subreddit
           FROM benchmark_results r
           JOIN benchmark_questions q ON r.question_id = q.id
           WHERE r.run_id = ?
           ORDER BY r.id""",
        (run_id,),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Prejudged Cases CRUD
# ---------------------------------------------------------------------------


def insert_prejudged_case(
    source: str,
    title: str,
    evidence_packet: str,
    ground_truth: dict | str,
    source_id: str = "",
    equipment_type: str = "",
    fault_category: str = "",
    difficulty: str = "medium",
    metadata: dict | None = None,
    db_path: str | None = None,
) -> int:
    """Insert a prejudged case. Returns row id. Skips duplicates by source_id."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    gt = json.dumps(ground_truth) if isinstance(ground_truth, dict) else ground_truth
    try:
        cur = db.execute(
            """INSERT INTO prejudged_cases
               (source, source_id, title, equipment_type, fault_category,
                evidence_packet, ground_truth, difficulty, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source,
                source_id or None,
                title,
                equipment_type,
                fault_category,
                evidence_packet,
                gt,
                difficulty,
                json.dumps(metadata or {}),
                now,
            ),
        )
        db.commit()
        return cur.lastrowid
    except sqlite3.IntegrityError:
        logger.debug("Duplicate source_id=%s — skipped", source_id)
        return -1
    finally:
        db.close()


def list_prejudged_cases(
    limit: int = 100,
    offset: int = 0,
    source: str | None = None,
    db_path: str | None = None,
) -> list[dict]:
    """Return prejudged cases, newest first. Optionally filter by source."""
    db = _get_db(db_path)
    if source:
        rows = db.execute(
            "SELECT * FROM prejudged_cases WHERE source=? ORDER BY id DESC LIMIT ? OFFSET ?",
            (source, limit, offset),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM prejudged_cases ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    db.close()
    return [dict(r) for r in rows]


def count_prejudged_cases(source: str | None = None, db_path: str | None = None) -> int:
    db = _get_db(db_path)
    if source:
        n = db.execute("SELECT COUNT(*) FROM prejudged_cases WHERE source=?", (source,)).fetchone()[
            0
        ]
    else:
        n = db.execute("SELECT COUNT(*) FROM prejudged_cases").fetchone()[0]
    db.close()
    return n


def get_prejudged_case(case_id: int, db_path: str | None = None) -> dict | None:
    db = _get_db(db_path)
    row = db.execute("SELECT * FROM prejudged_cases WHERE id=?", (case_id,)).fetchone()
    db.close()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Prejudged Runs CRUD
# ---------------------------------------------------------------------------


def create_prejudged_run(metadata: dict | None = None, db_path: str | None = None) -> int:
    """Create a new prejudged benchmark run. Returns run id."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute(
        "INSERT INTO prejudged_runs (started_at, status, metadata) VALUES (?, 'running', ?)",
        (now, json.dumps(metadata or {})),
    )
    db.commit()
    run_id = cur.lastrowid
    db.close()
    return run_id


def finish_prejudged_run(
    run_id: int,
    status: str = "completed",
    case_count: int = 0,
    db_path: str | None = None,
) -> None:
    """Mark a prejudged run as finished."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE prejudged_runs SET finished_at=?, status=?, case_count=? WHERE id=?",
        (now, status, case_count, run_id),
    )
    db.commit()
    db.close()


def get_prejudged_run(run_id: int, db_path: str | None = None) -> dict | None:
    db = _get_db(db_path)
    row = db.execute("SELECT * FROM prejudged_runs WHERE id=?", (run_id,)).fetchone()
    db.close()
    return dict(row) if row else None


def list_prejudged_runs(limit: int = 20, db_path: str | None = None) -> list[dict]:
    db = _get_db(db_path)
    rows = db.execute("SELECT * FROM prejudged_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Prejudged Conversations CRUD
# ---------------------------------------------------------------------------


def insert_prejudged_conversation(
    run_id: int,
    case_id: int,
    transcript: list[dict],
    turn_count: int,
    reached_diagnosis: bool,
    final_state: str | None = None,
    total_latency_ms: int = 0,
    error: str = "",
    db_path: str | None = None,
) -> int:
    """Insert a prejudged conversation record. Returns row id."""
    db = _get_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute(
        """INSERT INTO prejudged_conversations
           (run_id, case_id, transcript, turn_count, reached_diagnosis,
            final_state, total_latency_ms, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            run_id,
            case_id,
            json.dumps(transcript),
            turn_count,
            reached_diagnosis,
            final_state,
            total_latency_ms,
            error,
            now,
        ),
    )
    db.commit()
    conv_id = cur.lastrowid
    db.close()
    return conv_id


def update_prejudged_judge_scores(
    conv_id: int,
    evidence_utilization: float,
    path_efficiency: float,
    gsd_compliance: float,
    root_cause_alignment: float,
    expert_comparison: float,
    verdict: str,
    judge_reasoning: str = "",
    db_path: str | None = None,
) -> None:
    """Update judge scores on an existing conversation record."""
    weights = {
        "evidence_utilization": 0.20,
        "path_efficiency": 0.20,
        "gsd_compliance": 0.25,
        "root_cause_alignment": 0.25,
        "expert_comparison": 0.10,
    }
    composite = (
        evidence_utilization * weights["evidence_utilization"]
        + path_efficiency * weights["path_efficiency"]
        + gsd_compliance * weights["gsd_compliance"]
        + root_cause_alignment * weights["root_cause_alignment"]
        + expert_comparison * weights["expert_comparison"]
    )
    db = _get_db(db_path)
    db.execute(
        """UPDATE prejudged_conversations SET
            evidence_utilization=?, path_efficiency=?, gsd_compliance=?,
            root_cause_alignment=?, expert_comparison=?, composite_score=?,
            verdict=?, judge_reasoning=?
           WHERE id=?""",
        (
            evidence_utilization,
            path_efficiency,
            gsd_compliance,
            root_cause_alignment,
            expert_comparison,
            composite,
            verdict,
            judge_reasoning,
            conv_id,
        ),
    )
    db.commit()
    db.close()


def list_prejudged_conversations(
    run_id: int,
    db_path: str | None = None,
) -> list[dict]:
    """Return all conversations for a prejudged run, joined with case title."""
    db = _get_db(db_path)
    rows = db.execute(
        """SELECT c.*, p.title AS case_title, p.equipment_type, p.difficulty
           FROM prejudged_conversations c
           JOIN prejudged_cases p ON c.case_id = p.id
           WHERE c.run_id = ?
           ORDER BY c.id""",
        (run_id,),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

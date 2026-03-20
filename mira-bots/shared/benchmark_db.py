"""MIRA Benchmark DB — SQLite tables and CRUD for Reddit benchmark agent.

Three tables:
  - benchmark_questions: harvested Reddit questions
  - benchmark_runs: each benchmark execution
  - benchmark_results: per-question results within a run
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
    rows = db.execute(
        "SELECT * FROM benchmark_runs ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
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
        (run_id, question_id, reply, confidence, trace_id, next_state,
         latency_ms, error, now),
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

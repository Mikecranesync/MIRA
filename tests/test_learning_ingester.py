"""Tests for learning_ingester (#189) — 👍 feedback → FAQ chunks."""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from tools.learning_ingester import (
    LearningIngester,
    LearningIngesterConfig,
)


# ── Test helpers ───────────────────────────────────────────────────────────


def _make_db(tmp_path: Path) -> Path:
    """Create a mock mira.db with feedback_log + interactions schema."""
    db_path = tmp_path / "mira.db"
    con = sqlite3.connect(str(db_path))
    con.execute("""
        CREATE TABLE feedback_log (
            id INTEGER PRIMARY KEY,
            chat_id TEXT,
            feedback TEXT,
            reason TEXT,
            last_reply TEXT,
            created_at TIMESTAMP
        )
    """)
    con.execute("""
        CREATE TABLE interactions (
            id INTEGER PRIMARY KEY,
            chat_id TEXT,
            user_message TEXT,
            bot_response TEXT,
            created_at TIMESTAMP
        )
    """)
    con.commit()
    con.close()
    return db_path


def _make_ingester(tmp_path: Path, db_path: Path | None = None) -> LearningIngester:
    return LearningIngester(LearningIngesterConfig(
        db_path=db_path or _make_db(tmp_path),
        neon_url="postgres://fake",
        tenant_id="test-tenant",
        ollama_url="http://fake",
        embed_model="nomic-embed-text",
        state_path=tmp_path / "state.json",
    ))


# ── collect_positives_since tests ──────────────────────────────────────────


class TestCollectPositives:

    def test_empty_db_returns_empty(self, tmp_path):
        ingester = _make_ingester(tmp_path)
        assert ingester.collect_positives_since(None) == []

    def test_collects_good_feedback(self, tmp_path):
        db = _make_db(tmp_path)
        now = datetime.now(timezone.utc).isoformat()
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO feedback_log (chat_id, feedback, reason, last_reply, created_at) "
            "VALUES (?, 'good', 'helpful', 'reply text', ?)",
            ("chat1", now),
        )
        con.execute(
            "INSERT INTO feedback_log (chat_id, feedback, reason, last_reply, created_at) "
            "VALUES (?, 'bad', 'wrong answer', 'bad reply', ?)",
            ("chat2", now),
        )
        con.commit()
        con.close()

        ingester = _make_ingester(tmp_path, db_path=db)
        positives = ingester.collect_positives_since(None)
        assert len(positives) == 1
        assert positives[0]["chat_id"] == "chat1"

    def test_filters_by_checkpoint_ts(self, tmp_path):
        db = _make_db(tmp_path)
        con = sqlite3.connect(str(db))
        # Two entries, one before checkpoint, one after
        con.execute(
            "INSERT INTO feedback_log (chat_id, feedback, created_at) "
            "VALUES ('old', 'good', '2026-04-01T00:00:00+00:00')"
        )
        con.execute(
            "INSERT INTO feedback_log (chat_id, feedback, created_at) "
            "VALUES ('new', 'good', '2026-04-14T00:00:00+00:00')"
        )
        con.commit()
        con.close()

        ingester = _make_ingester(tmp_path, db_path=db)
        positives = ingester.collect_positives_since("2026-04-10T00:00:00+00:00")
        assert len(positives) == 1
        assert positives[0]["chat_id"] == "new"

    def test_respects_max_per_run(self, tmp_path):
        db = _make_db(tmp_path)
        now = datetime.now(timezone.utc).isoformat()
        con = sqlite3.connect(str(db))
        for i in range(100):
            con.execute(
                "INSERT INTO feedback_log (chat_id, feedback, created_at) "
                "VALUES (?, 'good', ?)",
                (f"chat{i}", now),
            )
        con.commit()
        con.close()

        ingester = _make_ingester(tmp_path, db_path=db)
        ingester.cfg.max_per_run = 10
        positives = ingester.collect_positives_since(None)
        assert len(positives) == 10


# ── reconstruct_qa tests ──────────────────────────────────────────────────


class TestReconstructQA:

    def test_returns_last_qa_pair(self, tmp_path):
        db = _make_db(tmp_path)
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES ('c1', 'earlier question', 'earlier answer longer than 20 chars', '2026-04-14T10:00:00+00:00')"
        )
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES ('c1', 'final question?', 'this is the final answer with enough content', '2026-04-14T11:00:00+00:00')"
        )
        con.commit()
        con.close()

        ingester = _make_ingester(tmp_path, db_path=db)
        qa = ingester.reconstruct_qa("c1", "2026-04-14T12:00:00+00:00")
        assert qa is not None
        question, answer = qa
        assert question == "final question?"

    def test_drops_short_qa(self, tmp_path):
        """Q&A too short is rejected (low signal)."""
        db = _make_db(tmp_path)
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES ('c1', 'hi', 'bye', '2026-04-14T10:00:00+00:00')"
        )
        con.commit()
        con.close()

        ingester = _make_ingester(tmp_path, db_path=db)
        assert ingester.reconstruct_qa("c1", "2026-04-14T12:00:00+00:00") is None

    def test_no_matching_chat_returns_none(self, tmp_path):
        ingester = _make_ingester(tmp_path)
        assert ingester.reconstruct_qa("ghost", "2026-04-14T12:00:00+00:00") is None


# ── Formatting tests ──────────────────────────────────────────────────────


class TestFormatFaq:

    def test_contains_question_and_answer(self):
        out = LearningIngester.format_faq(
            "What does F4 mean?",
            "F4 is undervoltage. Check input AC.",
            "chat123",
            "2026-04-14T12:00:00+00:00",
        )
        assert "What does F4 mean?" in out
        assert "F4 is undervoltage" in out

    def test_includes_provenance(self):
        """Provenance line with date and hashed chat_id."""
        out = LearningIngester.format_faq(
            "question", "answer text of sufficient length",
            "chat-secret-123", "2026-04-14T12:00:00+00:00",
        )
        assert "2026-04-14" in out
        # Raw chat_id should not appear — only a hash
        assert "chat-secret-123" not in out

    def test_markdown_structure(self):
        out = LearningIngester.format_faq(
            "q", "answer long enough for check",
            "c", "2026-04-14T12:00:00+00:00",
        )
        assert out.startswith("## Approved FAQ")
        assert "**Question:**" in out
        assert "**Answer:**" in out


# ── Orchestrator integration ──────────────────────────────────────────────


class TestOrchestrator:

    def test_empty_feedback_returns_ok(self, tmp_path):
        ingester = _make_ingester(tmp_path)
        result = ingester.run(dry_run=True)
        assert result["status"] == "ok"
        assert result["ingested"] == 0

    def test_dry_run_writes_to_disk(self, tmp_path):
        db = _make_db(tmp_path)
        now = datetime.now(timezone.utc).isoformat()
        con = sqlite3.connect(str(db))
        con.execute(
            "INSERT INTO feedback_log (chat_id, feedback, created_at) "
            "VALUES ('c1', 'good', ?)",
            (now,),
        )
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES ('c1', 'valid question', 'this answer is long enough to keep', ?)",
            (now,),
        )
        con.commit()
        con.close()

        ingester = _make_ingester(tmp_path, db_path=db)
        out_dir = tmp_path / "out"
        result = ingester.run(dry_run=True, output_dir=out_dir)
        assert result["ingested"] == 1
        assert result["dry_run"] is True
        # One file written
        files = list(out_dir.glob("*.md"))
        assert len(files) == 1

    def test_state_updated_after_run(self, tmp_path):
        ingester = _make_ingester(tmp_path)
        ingester.run(dry_run=True)
        state = json.loads(ingester.cfg.state_path.read_text())
        assert state["last_run_ts"] is not None

    def test_state_persists_across_runs(self, tmp_path):
        ingester = _make_ingester(tmp_path)
        ingester.run(dry_run=True)
        first_state = ingester._load_state()

        # Reuse the same DB so we don't recreate tables
        ingester2 = LearningIngester(LearningIngesterConfig(
            db_path=ingester.cfg.db_path,
            neon_url="postgres://fake",
            tenant_id="test-tenant",
            ollama_url="http://fake",
            embed_model="nomic-embed-text",
            state_path=ingester.cfg.state_path,
        ))
        state2 = ingester2._load_state()
        assert state2["last_run_ts"] == first_state["last_run_ts"]

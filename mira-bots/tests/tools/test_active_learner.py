"""Unit tests for mira-bots/tools/active_learner.py.

Tests cover:
  - collect_negatives_since: reads 'bad' rows from seeded SQLite
  - reconstruct_conversation: joins interactions by chat_id + timestamp
  - anonymize: PII stripped, vendor/model preserved (mocked Claude call)
  - infer_pass_criteria: doc-request-misrouted scenario, confidence gate
  - generate_fixture: correct YAML schema, user-turns-only
  - open_draft_pr: subprocess calls checked against expected args (mocked)
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from mira_bots.tools.active_learner import ActiveLearner


# ── Fixtures (pytest, not eval) ───────────────────────────────────────────────


def _make_db(path: str) -> sqlite3.Connection:
    """Create a minimal mira.db with feedback_log + interactions seeded."""
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE feedback_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id         TEXT NOT NULL,
            feedback        TEXT NOT NULL,
            reason          TEXT,
            last_reply      TEXT,
            exchange_count  INTEGER,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE interactions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id          TEXT NOT NULL,
            platform         TEXT NOT NULL DEFAULT 'telegram',
            user_message     TEXT NOT NULL,
            bot_response     TEXT NOT NULL,
            fsm_state        TEXT,
            intent           TEXT,
            has_photo        INTEGER DEFAULT 0,
            confidence       TEXT,
            response_time_ms INTEGER,
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Seed: three bad feedback rows
        INSERT INTO feedback_log (chat_id, feedback, reason, last_reply, exchange_count, created_at)
        VALUES
          ('chat_pilz_01', 'bad', 'asked for manual, got diagnostic', 'Let me diagnose that...', 2, '2026-04-14 10:00:00'),
          ('chat_dist_02', 'bad', 'safety hazard ignored', 'The fault code means...', 1, '2026-04-14 11:00:00'),
          ('chat_gs10_03', 'bad', 'wrong vendor identified', 'That looks like Allen-Bradley', 3, '2026-04-14 12:00:00');

        -- Seed: interactions for chat_pilz_01
        INSERT INTO interactions (chat_id, user_message, bot_response, fsm_state, intent, created_at)
        VALUES
          ('chat_pilz_01', 'I need a manual for our Pilz PSENcode', 'What fault are you seeing?', 'Q1', 'industrial', '2026-04-14 09:58:00'),
          ('chat_pilz_01', 'No fault, I just need the manual', 'Let me diagnose that PSENcode issue...', 'Q2', 'industrial', '2026-04-14 09:59:00');

        -- Seed: interactions for chat_dist_02
        INSERT INTO interactions (chat_id, user_message, bot_response, fsm_state, intent, created_at)
        VALUES
          ('chat_dist_02', 'I pulled cables from the live distribution block', 'The fault code means the circuit is open', 'Q1', 'industrial', '2026-04-14 10:59:00');

        -- One 'good' row that should NOT be collected
        INSERT INTO feedback_log (chat_id, feedback, reason, last_reply, exchange_count, created_at)
        VALUES ('chat_good_99', 'good', '', 'Great response', 1, '2026-04-14 09:00:00');
    """)
    db.close()
    return sqlite3.connect(path)


def _make_learner(db_path: str, state_path: str) -> ActiveLearner:
    return ActiveLearner(
        db_path=db_path,
        state_path=state_path,
        gh_token="ghp_test",
        anthropic_api_key="sk-ant-test",
        claude_model="claude-sonnet-4-6",
        min_confidence=0.6,
        max_fixtures_per_run=10,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_collect_negatives_since_returns_bad_only():
    with tempfile.TemporaryDirectory() as d:
        db_path = str(Path(d) / "mira.db")
        _make_db(db_path)
        learner = _make_learner(db_path, str(Path(d) / "state.json"))

        rows = learner.collect_negatives_since(None)

        assert len(rows) == 3, f"Expected 3 bad rows, got {len(rows)}"
        assert all(r["feedback"] == "bad" for r in rows)
        chat_ids = {r["chat_id"] for r in rows}
        assert "chat_good_99" not in chat_ids


def test_collect_negatives_respects_checkpoint():
    with tempfile.TemporaryDirectory() as d:
        db_path = str(Path(d) / "mira.db")
        _make_db(db_path)
        learner = _make_learner(db_path, str(Path(d) / "state.json"))

        rows = learner.collect_negatives_since("2026-04-14 10:30:00")

        assert len(rows) == 2  # only dist_02 and gs10_03 are after 10:30


def test_reconstruct_conversation():
    with tempfile.TemporaryDirectory() as d:
        db_path = str(Path(d) / "mira.db")
        _make_db(db_path)
        learner = _make_learner(db_path, str(Path(d) / "state.json"))

        turns = learner.reconstruct_conversation("chat_pilz_01", "2026-04-14 10:00:00")

        assert len(turns) == 4  # 2 user + 2 assistant
        assert turns[0] == {"role": "user", "content": "I need a manual for our Pilz PSENcode"}
        assert turns[1]["role"] == "assistant"
        assert "PSENcode" in turns[3]["content"]


async def test_anonymize_strips_pii_keeps_vendor():
    """anonymize() must strip PII and preserve vendor/model signal."""
    fake_response = {
        "turns": [
            {"role": "user", "content": "I need a manual for our Pilz PSENcode"},
            {"role": "assistant", "content": "Let me diagnose that PSENcode issue for FACILITY_A"},
        ],
        "anonymization_notes": "Replaced 'Acme Mfg' → FACILITY_A; 'John' → TECH_A",
    }

    with tempfile.TemporaryDirectory() as d:
        learner = _make_learner(str(Path(d) / "mira.db"), str(Path(d) / "state.json"))

        with patch.object(learner, "_claude_json", new=AsyncMock(return_value=fake_response)):
            result = await learner.anonymize([
                {"role": "user", "content": "I need a manual for our Pilz PSENcode, John at Acme Mfg"},
            ])

    assert result is not None
    assert "Pilz" in result["turns"][0]["content"]
    assert "PSENcode" in result["turns"][0]["content"]
    assert "FACILITY_A" in result["anonymization_notes"]
    # Original PII should not leak through
    assert "Acme Mfg" not in json.dumps(result)
    assert "John" not in result["anonymization_notes"].split("→")[0]


async def test_infer_pass_criteria_doc_request_misrouted():
    """infer_pass_criteria should flag expected_intent=documentation for manual requests."""
    fake_criteria = {
        "expected_final_state": "IDLE",
        "expected_intent": "documentation",
        "expected_keywords": ["manual", "documentation", "Pilz", "PSENcode"],
        "forbidden_keywords": ["diagnose", "fault", "parameter"],
        "expected_vendor": "Pilz",
        "description": "User asked for Pilz PSENcode manual — should return docs link, not diagnostic",
        "confidence": 0.92,
        "tldr": "Doc request misrouted to diagnostic FSM",
    }

    with tempfile.TemporaryDirectory() as d:
        learner = _make_learner(str(Path(d) / "mira.db"), str(Path(d) / "state.json"))

        with patch.object(learner, "_claude_json", new=AsyncMock(return_value=fake_criteria)):
            result = await learner.infer_pass_criteria(
                conversation=[{"role": "user", "content": "I need a manual for our Pilz PSENcode"}],
                reason="asked for manual, got diagnostic",
                comment="",
            )

    assert result is not None
    assert result["expected_intent"] == "documentation"
    assert "manual" in result["expected_keywords"]
    assert "Pilz" in result["expected_keywords"]
    assert result["confidence"] == 0.92


async def test_infer_pass_criteria_rejects_low_confidence():
    """infer_pass_criteria should return None when confidence < min_confidence."""
    low_confidence_response = {
        "expected_final_state": "DIAGNOSIS",
        "expected_intent": "industrial",
        "expected_keywords": [],
        "forbidden_keywords": [],
        "expected_vendor": None,
        "description": "Unclear what the user wanted",
        "confidence": 0.3,
        "tldr": "Unclear failure",
    }

    with tempfile.TemporaryDirectory() as d:
        learner = _make_learner(str(Path(d) / "mira.db"), str(Path(d) / "state.json"))

        with patch.object(
            learner, "_claude_json", new=AsyncMock(return_value=low_confidence_response)
        ):
            result = await learner.infer_pass_criteria(
                conversation=[{"role": "user", "content": "huh?"}],
                reason="",
                comment="",
            )

    assert result is None


def test_generate_fixture_schema():
    """generate_fixture should produce valid YAML matching the eval fixture schema."""
    with tempfile.TemporaryDirectory() as d:
        learner = _make_learner(str(Path(d) / "mira.db"), str(Path(d) / "state.json"))

        anon_result = {
            "turns": [
                {"role": "user", "content": "I need a manual for our Pilz PSENcode"},
                {"role": "assistant", "content": "Let me diagnose that..."},
                {"role": "user", "content": "No, I just need the manual"},
            ],
            "anonymization_notes": "Replaced 'Acme' → FACILITY_A",
        }
        pass_criteria = {
            "expected_final_state": "IDLE",
            "expected_keywords": ["manual", "documentation", "Pilz"],
            "forbidden_keywords": ["diagnose"],
            "expected_vendor": "Pilz",
            "description": "User asked for manual, should return docs link",
            "confidence": 0.9,
            "tldr": "Doc request misrouted",
        }
        feedback_entry = {"chat_id": "chat_pilz_01", "created_at": "2026-04-14 10:00:00"}

        fname, content = learner.generate_fixture(anon_result, pass_criteria, feedback_entry)

    # Filename pattern
    assert fname.startswith("auto_")
    assert fname.endswith(".yaml")

    # Parse and validate schema
    fixture = yaml.safe_load(content)
    assert fixture["auto_generated"] is True
    assert fixture["review_required"] is True
    assert fixture["expected_final_state"] == "IDLE"
    assert "manual" in fixture["expected_keywords"]
    assert "Pilz" in fixture["expected_vendor"]
    assert fixture["forbidden_keywords"] == ["diagnose"]

    # Only user turns in the fixture
    assert all(t["role"] == "user" for t in fixture["turns"])
    assert len(fixture["turns"]) == 2  # 2 user turns from the 3-turn conversation

    # Required schema fields
    for field in ("id", "description", "max_turns", "tags", "turns"):
        assert field in fixture, f"Missing required field: {field}"


async def test_open_draft_pr_calls_expected_git_commands():
    """open_draft_pr should call git worktree, commit, push, and gh pr create."""
    with tempfile.TemporaryDirectory() as d:
        learner = _make_learner(str(Path(d) / "mira.db"), str(Path(d) / "state.json"))

        call_log: list[list[str]] = []

        def _fake_run(cmd, **kwargs):
            call_log.append(cmd)
            result = MagicMock()
            result.returncode = 0
            result.stdout = "https://github.com/Mikecranesync/MIRA/pull/999"
            result.stderr = ""
            return result

        with (
            patch("mira_bots.tools.active_learner.subprocess.run", side_effect=_fake_run),
            patch("mira_bots.tools.active_learner.subprocess.CompletedProcess"),
        ):
            pr_url = await learner.open_draft_pr(
                new_fixtures=[("auto_20260414_abc123.yaml", "id: auto_abc123\n")],
                summary={
                    "start_ts": "2026-04-13T00:00:00",
                    "end_ts": "2026-04-14T04:00:00",
                    "fixture_infos": [{"reason": "bad", "anon_notes": "none", "tldr": "test"}],
                    "source_hashes": ["abc123def456"],
                },
                mira_dir=d,
            )

    # Verify key subprocess calls happened
    all_cmds = [" ".join(c) for c in call_log]
    assert any("git worktree add" in cmd for cmd in all_cmds), "missing git worktree add"
    assert any("git add" in cmd for cmd in all_cmds), "missing git add"
    assert any("git commit" in cmd for cmd in all_cmds), "missing git commit"
    assert any("git push" in cmd for cmd in all_cmds), "missing git push"
    assert any("gh pr create" in cmd and "--draft" in cmd for cmd in all_cmds), "missing gh pr create --draft"
    assert pr_url == "https://github.com/Mikecranesync/MIRA/pull/999"

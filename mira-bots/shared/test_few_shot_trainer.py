"""Tests for FewShotTrainer (issue #314)."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

# Hyphenated parent dir (mira-bots) — inject so `from shared import ...` works.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from shared.few_shot_trainer import FewShotTrainer, _boost_from_count  # noqa: E402


def _init_schema(db_path: Path) -> None:
    with sqlite3.connect(db_path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS feedback_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id         TEXT NOT NULL,
                feedback        TEXT NOT NULL,
                reason          TEXT,
                last_reply      TEXT,
                exchange_count  INTEGER,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS interactions (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id          TEXT NOT NULL,
                platform         TEXT NOT NULL DEFAULT 'telegram',
                user_message     TEXT NOT NULL,
                bot_response     TEXT NOT NULL,
                fsm_state        TEXT,
                intent           TEXT
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS conversation_state (
                chat_id          TEXT PRIMARY KEY,
                state            TEXT NOT NULL DEFAULT 'IDLE',
                asset_identified TEXT
            )
            """
        )


def _seed_chat(
    db_path: Path,
    chat_id: str,
    *,
    vendor: str,
    intent: str,
    good_count: int,
    bad_count: int = 0,
) -> None:
    with sqlite3.connect(db_path) as db:
        db.execute(
            "INSERT OR REPLACE INTO conversation_state (chat_id, state, asset_identified) VALUES (?, 'IDLE', ?)",
            (chat_id, f"{vendor}, Model-X"),
        )
        db.execute(
            "INSERT INTO interactions (chat_id, platform, user_message, bot_response, fsm_state, intent) "
            "VALUES (?, 'telegram', 'q', 'r', 'IDLE', ?)",
            (chat_id, intent),
        )
        for _ in range(good_count):
            db.execute(
                "INSERT INTO feedback_log (chat_id, feedback) VALUES (?, 'good')",
                (chat_id,),
            )
        for _ in range(bad_count):
            db.execute(
                "INSERT INTO feedback_log (chat_id, feedback) VALUES (?, 'bad')",
                (chat_id,),
            )


# ---------------------------------------------------------------------------
# boost formula
# ---------------------------------------------------------------------------


def test_boost_zero_returns_1():
    assert _boost_from_count(0) == 1.0


def test_boost_one_between_1_3_and_1_4():
    v = _boost_from_count(1)
    assert 1.3 <= v <= 1.4


def test_boost_twenty_between_2_4_and_2_6():
    v = _boost_from_count(20)
    assert 2.4 <= v <= 2.6


def test_boost_caps_at_3():
    assert _boost_from_count(1_000) == 3.0
    assert _boost_from_count(10_000) == 3.0


# ---------------------------------------------------------------------------
# confidence_boost
# ---------------------------------------------------------------------------


def test_missing_db_path_returns_1_0(tmp_path):
    trainer = FewShotTrainer(db_path=str(tmp_path / "does-not-exist.db"))
    assert trainer.confidence_boost("Pilz", "industrial") == 1.0


def test_empty_db_returns_1_0(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    trainer = FewShotTrainer(db_path=str(db))
    assert trainer.confidence_boost("Pilz", "industrial") == 1.0


def test_one_confirmation_boosts_modestly(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    _seed_chat(db, "c1", vendor="Pilz", intent="industrial", good_count=1)
    trainer = FewShotTrainer(db_path=str(db))
    boost = trainer.confidence_boost("Pilz", "industrial")
    assert 1.3 <= boost <= 1.4


def test_twenty_confirmations_boost_strong(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    for i in range(20):
        _seed_chat(
            db,
            f"c{i}",
            vendor="Pilz",
            intent="industrial",
            good_count=1,
        )
    trainer = FewShotTrainer(db_path=str(db))
    boost = trainer.confidence_boost("Pilz", "industrial")
    assert 2.4 <= boost <= 2.6


def test_bad_ratings_are_not_counted(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    _seed_chat(db, "c1", vendor="Pilz", intent="industrial", good_count=0, bad_count=10)
    trainer = FewShotTrainer(db_path=str(db))
    assert trainer.confidence_boost("Pilz", "industrial") == 1.0


def test_vendor_normalization_case_insensitive(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    _seed_chat(db, "c1", vendor="PILZ", intent="INDUSTRIAL", good_count=1)
    trainer = FewShotTrainer(db_path=str(db))
    # Query with a different case — still finds it.
    assert trainer.confidence_boost("pilz", "industrial") > 1.0


def test_different_vendor_intent_buckets_independent(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    for i in range(5):
        _seed_chat(db, f"p{i}", vendor="Pilz", intent="industrial", good_count=1)
    trainer = FewShotTrainer(db_path=str(db))
    pilz_ind = trainer.confidence_boost("Pilz", "industrial")
    yaskawa_doc = trainer.confidence_boost("Yaskawa", "documentation")
    assert pilz_ind > 1.0
    assert yaskawa_doc == 1.0


def test_cache_ttl_returns_same_value(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    _seed_chat(db, "c1", vendor="Pilz", intent="industrial", good_count=1)
    trainer = FewShotTrainer(db_path=str(db), cache_ttl_s=3600)
    first = trainer.confidence_boost("Pilz", "industrial")
    # Delete the backing row — cache should still return first value.
    with sqlite3.connect(db) as dbc:
        dbc.execute("DELETE FROM feedback_log")
    second = trainer.confidence_boost("Pilz", "industrial")
    assert first == second


def test_refresh_clears_cache(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    trainer = FewShotTrainer(db_path=str(db), cache_ttl_s=3600)
    assert trainer.confidence_boost("Pilz", "industrial") == 1.0  # cold
    _seed_chat(db, "c1", vendor="Pilz", intent="industrial", good_count=1)
    # Still cached at 1.0
    assert trainer.confidence_boost("Pilz", "industrial") == 1.0
    trainer.refresh()
    # Now reflects new row
    assert trainer.confidence_boost("Pilz", "industrial") > 1.0


def test_stats_returns_expected_keys(tmp_path):
    db = tmp_path / "mira.db"
    _init_schema(db)
    _seed_chat(db, "c1", vendor="Pilz", intent="industrial", good_count=2, bad_count=1)
    trainer = FewShotTrainer(db_path=str(db))
    s = trainer.stats()
    for key in ("db_path", "good_count", "bad_count", "cache_size", "cache_ttl_s"):
        assert key in s
    assert s["good_count"] == 2
    assert s["bad_count"] == 1


def test_stats_on_missing_db_is_safe(tmp_path):
    trainer = FewShotTrainer(db_path=str(tmp_path / "nope.db"))
    s = trainer.stats()
    assert s["good_count"] == 0
    assert s["bad_count"] == 0


@pytest.mark.parametrize("malformed_asset", ["", "NoCommaVendor"])
def test_asset_without_comma_still_matches(tmp_path, malformed_asset):
    """asset_identified may be just a vendor without a model comma."""
    db = tmp_path / "mira.db"
    _init_schema(db)
    with sqlite3.connect(db) as dbc:
        dbc.execute(
            "INSERT INTO conversation_state (chat_id, asset_identified) VALUES (?, ?)",
            ("c1", malformed_asset),
        )
        dbc.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, intent) "
            "VALUES ('c1', 'q', 'r', 'industrial')"
        )
        dbc.execute(
            "INSERT INTO feedback_log (chat_id, feedback) VALUES ('c1', 'good')"
        )
    trainer = FewShotTrainer(db_path=str(db))
    if malformed_asset == "":
        # empty asset → vendor substring is empty, only matches empty vendor query
        assert trainer.confidence_boost("", "industrial") > 1.0
    else:
        assert trainer.confidence_boost("NoCommaVendor", "industrial") > 1.0

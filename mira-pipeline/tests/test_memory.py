"""Unit tests for mira-pipeline/memory.py — pure functions and DB layer."""

from __future__ import annotations

import json
import sqlite3
from unittest.mock import patch

import pytest

import memory as mem


# ---------------------------------------------------------------------------
# Pure math
# ---------------------------------------------------------------------------

class TestCosineSim:
    def test_identical_vectors(self):
        v = [1.0, 0.0, 0.0]
        assert mem._cosine_sim(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors(self):
        assert mem._cosine_sim([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)

    def test_opposite_vectors(self):
        assert mem._cosine_sim([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)

    def test_empty_vectors_return_zero(self):
        assert mem._cosine_sim([], []) == 0.0
        assert mem._cosine_sim([1.0], []) == 0.0

    def test_mismatched_lengths_return_zero(self):
        assert mem._cosine_sim([1.0, 0.0], [1.0]) == 0.0

    def test_zero_magnitude_returns_zero(self):
        assert mem._cosine_sim([0.0, 0.0], [0.0, 0.0]) == 0.0


# ---------------------------------------------------------------------------
# ConversationMemory — DB layer (no network; _embed mocked to return [])
# ---------------------------------------------------------------------------

@pytest.fixture
def cm(tmp_path):
    db_path = str(tmp_path / "test_memory.db")
    return mem.ConversationMemory(db_path=db_path)


class TestExtractAndStore:
    def test_no_facts_returns_zero(self, cm):
        count = cm.extract_and_store("chat1", "hello world", "hi there")
        assert count == 0

    def test_equipment_stored(self, cm):
        count = cm.extract_and_store("chat1", "VFD tripped", "ok", asset_identified="Allen Bradley PowerFlex 525")
        assert count == 1

    def test_fault_code_extracted(self, cm):
        count = cm.extract_and_store("chat1", "VFD showing F003 fault", "Check DC bus")
        assert count >= 1

    def test_dedup_same_fact(self, cm):
        cm.extract_and_store("chat1", "VFD fault", "reply", asset_identified="PowerFlex 525")
        count = cm.extract_and_store("chat1", "VFD fault again", "reply", asset_identified="PowerFlex 525")
        assert count == 0

    def test_different_chats_same_fact(self, cm):
        count1 = cm.extract_and_store("chat1", "", "", asset_identified="PowerFlex 525")
        count2 = cm.extract_and_store("chat2", "", "", asset_identified="PowerFlex 525")
        assert count1 == 1
        assert count2 == 1


class TestGetStats:
    def test_empty_db(self, cm):
        stats = cm.get_stats()
        assert stats["total_memories"] == 0
        assert stats["unique_chats"] == 0

    def test_after_store(self, cm):
        cm.extract_and_store("chat1", "F003 fault code", "Check wiring", asset_identified="VFD-001")
        stats = cm.get_stats()
        assert stats["total_memories"] >= 1
        assert stats["unique_chats"] == 1


class TestFormatMemoryBlock:
    def test_empty_returns_empty_string(self, cm):
        assert cm.format_memory_block([]) == ""

    def test_single_memory(self, cm):
        memories = [{"fact_type": "equipment", "content": "PowerFlex 525", "similarity": 1.0}]
        block = cm.format_memory_block(memories)
        assert "EQUIPMENT" in block
        assert "PowerFlex 525" in block

    def test_multiple_memories_ordered(self, cm):
        memories = [
            {"fact_type": "equipment", "content": "VFD-001", "similarity": 0.9},
            {"fact_type": "fault_code", "content": "F003", "similarity": 0.8},
        ]
        block = cm.format_memory_block(memories)
        assert "EQUIPMENT" in block
        assert "FAULT_CODE" in block


class TestPruneOld:
    def test_prune_empty_db_returns_zero(self, cm):
        assert cm.prune_old(days=30) == 0

    def test_prune_zero_days_deletes_all(self, cm):
        cm.extract_and_store("chat1", "F003", "Check wiring")
        cm.extract_and_store("chat1", "F004", "Check motor", asset_identified="VFD-001")
        deleted = cm.prune_old(days=0)
        assert deleted >= 1
        assert cm.get_stats()["total_memories"] == 0

"""Shared test fixtures for mira-bots test suite."""

from __future__ import annotations

import sqlite3
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def tmp_db(tmp_path):
    """Create a temporary SQLite database with WAL mode and required tables."""
    db_path = str(tmp_path / "mira_test.db")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS conversation_state (
            chat_id TEXT PRIMARY KEY,
            state TEXT DEFAULT 'IDLE',
            asset_identified TEXT DEFAULT '',
            history TEXT DEFAULT '[]',
            last_options TEXT DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS feedback_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT,
            feedback TEXT,
            reason TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS api_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            provider TEXT,
            model TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            latency_ms REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture
def mock_router():
    """Pre-wired InferenceRouter mock with cascade stubs.

    Usage:
        router = mock_router
        router.complete.return_value = ("diagnosis text", {"provider": "claude"})
    """
    router = MagicMock()
    router.enabled = True
    router.backend = "cloud"
    router.complete = AsyncMock(
        return_value=(
            "Test diagnostic response",
            {"provider": "claude", "input_tokens": 10, "output_tokens": 20},
        )
    )
    # Keep the real sanitize_context — it's a static method with no side effects
    from shared.inference.router import InferenceRouter

    router.sanitize_context = InferenceRouter.sanitize_context
    return router


@pytest.fixture
def mock_router_disabled():
    """InferenceRouter mock that simulates all providers failing."""
    router = MagicMock()
    router.enabled = False
    router.backend = "local"
    router.complete = AsyncMock(return_value=("", {}))
    return router

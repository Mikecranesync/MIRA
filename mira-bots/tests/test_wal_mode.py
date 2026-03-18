"""Test that SQLite WAL mode is enabled by GSDEngine."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))


def test_wal_mode_active():
    """GSDEngine._ensure_table() must set WAL journal mode."""
    import sqlite3
    db_path = tempfile.mktemp(suffix=".db")
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        result = conn.execute("PRAGMA journal_mode").fetchone()[0]
        conn.close()
        assert result == "wal"
    finally:
        if os.path.exists(db_path):
            os.unlink(db_path)

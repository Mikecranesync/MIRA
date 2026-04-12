"""Tests for mira-bots/shared/chat_tenant.py — chat_id → tenant_id resolver."""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest.mock import patch

# Ensure mira-bots is importable
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))


def _fresh_module(db_path: str, tenant_id: str = ""):
    """Import (or reload) chat_tenant with isolated env vars and a fresh DB."""
    # Patch env before import so module-level _ensure_table() uses the temp DB
    env_patch = {"MIRA_DB_PATH": db_path, "MIRA_TENANT_ID": tenant_id}
    with patch.dict(os.environ, env_patch, clear=False):
        if "shared.chat_tenant" in sys.modules:
            mod = sys.modules["shared.chat_tenant"]
            # Clear the LRU cache so stale DB entries don't bleed across tests
            mod._db_lookup.cache_clear()
            # Force re-read of env vars by reimporting
            importlib.reload(mod)
        else:
            import shared.chat_tenant as mod  # noqa: F401 — side effect import

            mod = sys.modules["shared.chat_tenant"]
        # Patch the module-level _DB_PATH to the temp path after reload
        mod._DB_PATH = db_path
        mod._db_lookup.cache_clear()
        return mod


# ── Tests ────────────────────────────────────────────────────────────────────


def test_resolve_returns_stored_tenant(tmp_path):
    """A mapped chat_id returns the stored tenant_id."""
    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path)

    mod.set_mapping("chat-abc", "tenant-xyz")
    mod._db_lookup.cache_clear()

    result = mod.resolve("chat-abc")
    assert result == "tenant-xyz"


def test_resolve_falls_back_to_env(tmp_path):
    """An unmapped chat_id with MIRA_TENANT_ID set returns the env value."""
    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path, tenant_id="env-tenant-001")

    with patch.dict(os.environ, {"MIRA_TENANT_ID": "env-tenant-001"}, clear=False):
        result = mod.resolve("chat-unknown")

    assert result == "env-tenant-001"


def test_resolve_returns_empty_when_no_mapping_no_env(tmp_path):
    """An unmapped chat_id with no MIRA_TENANT_ID returns empty string."""
    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path, tenant_id="")

    with patch.dict(os.environ, {"MIRA_TENANT_ID": ""}, clear=False):
        result = mod.resolve("chat-nobody")

    assert result == ""


def test_set_mapping_persists(tmp_path):
    """set_mapping writes to DB; a subsequent resolve returns the stored value."""
    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path)

    mod.set_mapping("chat-persist", "tenant-persist")
    mod._db_lookup.cache_clear()

    assert mod.resolve("chat-persist") == "tenant-persist"


def test_lru_cache_hit(tmp_path):
    """Second resolve for the same chat_id is served from LRU cache (no DB hit)."""
    import sqlite3

    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path)

    mod.set_mapping("chat-cache", "tenant-cache")
    mod._db_lookup.cache_clear()

    # First call populates the cache
    first = mod.resolve("chat-cache")
    assert first == "tenant-cache"

    # Snapshot cache info after first call
    info_after_first = mod._db_lookup.cache_info()
    assert info_after_first.hits == 0
    assert info_after_first.currsize == 1

    # Mutate the DB directly — cache should shield us from the change
    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE chat_tenant_map SET tenant_id = 'tenant-mutated' WHERE chat_id = 'chat-cache'"
    )
    conn.commit()
    conn.close()

    # Second call must return cached value, not the mutated DB value
    second = mod.resolve("chat-cache")
    assert second == "tenant-cache"

    info_after_second = mod._db_lookup.cache_info()
    assert info_after_second.hits == 1


def test_ensure_table_idempotent(tmp_path):
    """Calling _ensure_table() twice does not raise."""
    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path)

    # First call already happened at import; call again explicitly
    mod._ensure_table()
    mod._ensure_table()  # Must not raise OperationalError or any other error


def test_set_mapping_overwrite(tmp_path):
    """set_mapping with the same chat_id overwrites the previous tenant_id."""
    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path)

    mod.set_mapping("chat-overwrite", "tenant-v1")
    mod._db_lookup.cache_clear()
    assert mod.resolve("chat-overwrite") == "tenant-v1"

    mod.set_mapping("chat-overwrite", "tenant-v2")
    mod._db_lookup.cache_clear()
    assert mod.resolve("chat-overwrite") == "tenant-v2"


def test_env_fallback_not_stored_in_db(tmp_path):
    """Env fallback does not write a mapping row; DB stays empty for that chat_id."""
    import sqlite3

    db_path = str(tmp_path / "mira.db")
    mod = _fresh_module(db_path, tenant_id="env-only")

    with patch.dict(os.environ, {"MIRA_TENANT_ID": "env-only"}, clear=False):
        result = mod.resolve("chat-env-only")
    assert result == "env-only"

    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT tenant_id FROM chat_tenant_map WHERE chat_id = 'chat-env-only'"
    ).fetchone()
    conn.close()
    assert row is None, "Env fallback must not persist a row to the DB"

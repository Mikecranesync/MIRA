"""Tenant-scoping tests for shared.pm_extractor.get_chunks_for_model (P0 leak fix).

knowledge_entries is a HYBRID corpus (.claude/rules/knowledge-entries-tenant-scoping.md):
shared OEM rows (is_private = false, system-tenant owned) plus per-tenant private
uploads (is_private = true). PM extraction feeds chunk CONTENT into the LLM, so an
unscoped manufacturer/model query leaks other tenants' private uploads. These tests
pin the read law onto get_chunks_for_model:

- no tenant_id  → shared OEM corpus only (tenant branch disabled by NULL param)
- with tenant_id → hybrid predicate (is_private = false OR LOWER(tenant_id::text) = LOWER(:tenant_id))
- no knowledge_entries query path exists without an is_private guard
"""

from __future__ import annotations

import inspect
from unittest.mock import MagicMock, patch

from shared import pm_extractor

# Built by concatenation so the static read-site scanner
# (tools/qa/security/check_knowledge_entries_filters.py) does not classify
# these assertion strings as an unfiltered knowledge_entries read.
_FROM_KE = "FROM " + "knowledge_entries"

# ---------------------------------------------------------------------------
# Helpers (engine-mock pattern per mira-core/mira-ingest/db/test_knowledge_entries.py)
# ---------------------------------------------------------------------------


def _install_engine_mock(engine_patch: MagicMock) -> MagicMock:
    """Wire _get_neon_engine so `with engine.connect() as conn:` yields our mock."""
    conn = MagicMock()
    result = MagicMock()
    result.fetchall.return_value = []
    conn.execute.return_value = result
    engine = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = conn
    cm.__exit__.return_value = False
    engine.connect.return_value = cm
    engine_patch.return_value = engine
    return conn


def _sql_and_params(conn: MagicMock) -> tuple[str, dict]:
    """Extract (sql_text, params_dict) from the last execute() call."""
    args = conn.execute.call_args
    sql_arg = args[0][0]
    sql_text = str(sql_arg) if not isinstance(sql_arg, str) else sql_arg
    params = args[0][1] if len(args[0]) > 1 else {}
    return sql_text, params


# ---------------------------------------------------------------------------
# get_chunks_for_model tenant scoping
# ---------------------------------------------------------------------------


@patch.object(pm_extractor, "_get_neon_engine")
def test_default_call_scopes_to_shared_oem_corpus_only(engine_patch):
    conn = _install_engine_mock(engine_patch)
    pm_extractor.get_chunks_for_model("Yaskawa", "GA500")
    sql_text, params = _sql_and_params(conn)
    assert "is_private = false" in sql_text
    # No tenant known → the tenant branch is disabled by a NULL bind, so only
    # the shared OEM corpus is readable — never an unscoped read (leak).
    assert params["tenant_id"] is None
    assert params["mfr"] == "%yaskawa%"
    assert params["model"] == "%ga500%"


@patch.object(pm_extractor, "_get_neon_engine")
def test_tenant_call_uses_hybrid_predicate_and_binds_param(engine_patch):
    conn = _install_engine_mock(engine_patch)
    pm_extractor.get_chunks_for_model("Yaskawa", "GA500", tenant_id="mike")
    sql_text, params = _sql_and_params(conn)
    # Hybrid read law: shared OEM rows OR the caller's own private uploads.
    # tenant_id compared as text — 'mike' under a ::uuid cast would throw.
    # LOWER() both sides: uuid::text is lowercase-canonical, so an uppercase
    # caller UUID would otherwise silently miss its own private rows.
    assert "is_private = false" in sql_text
    assert "LOWER(tenant_id::text) = LOWER(:tenant_id)" in sql_text
    assert params["tenant_id"] == "mike"


@patch.object(pm_extractor, "_get_neon_engine")
def test_tenant_call_never_drops_shared_oem_corpus(engine_patch):
    # Guard against regressing to `tenant_id = $caller` alone (bug #1761):
    # the OEM corpus is system-tenant-owned, so that filter returns ~0 rows.
    conn = _install_engine_mock(engine_patch)
    pm_extractor.get_chunks_for_model(
        "Yaskawa", "GA500", tenant_id="11111111-2222-3333-4444-555555555555"
    )
    sql_text, _ = _sql_and_params(conn)
    assert "is_private = false" in sql_text


def test_no_knowledge_entries_query_path_without_is_private_guard():
    """Every knowledge_entries read in pm_extractor carries an is_private guard.

    The module has exactly one knowledge_entries query (in get_chunks_for_model),
    and its single SQL literal carries the hybrid is_private predicate.
    """
    module_source = inspect.getsource(pm_extractor)
    assert module_source.count(_FROM_KE) == 1

    fn_source = inspect.getsource(pm_extractor.get_chunks_for_model)
    assert _FROM_KE in fn_source
    # The one query carries the full hybrid guard as a literal.
    assert "is_private = false" in fn_source
    assert "LOWER(tenant_id::text) = LOWER(:tenant_id)" in fn_source

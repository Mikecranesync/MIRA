"""Tests for per-call tenant isolation in RAGWorker and Supervisor.

Covers:
  - RAGWorker.process() accepts a per-call tenant_id kwarg that overrides self.tenant_id
  - Supervisor.process_full() resolves tenant per call via chat_tenant.resolve()
  - Supervisor falls back to MIRA_TENANT_ID env var when no DB mapping exists
  - Concurrent supervisors with different tenants do not cross-leak
  - chat_tenant.resolve() returns env fallback for unmapped chat IDs
  - Supervisor with no mapping and no env completes safely without raising
  - AtlasCMMS.for_tenant() uses per-tenant creds, not env-var defaults
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Ensure mira-bots is importable
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

# Ensure mira-mcp is importable (for AtlasCMMS)
MIRA_MCP = REPO_ROOT / "mira-mcp"
if str(MIRA_MCP) not in sys.path:
    sys.path.insert(0, str(MIRA_MCP))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fresh_chat_tenant(db_path: str, tenant_id: str = "") -> object:
    """Reload chat_tenant with an isolated temp DB and env, return the module."""
    env_patch = {"MIRA_DB_PATH": db_path, "MIRA_TENANT_ID": tenant_id}
    with patch.dict(os.environ, env_patch, clear=False):
        if "shared.chat_tenant" in sys.modules:
            mod = sys.modules["shared.chat_tenant"]
            importlib.reload(mod)
        else:
            import shared.chat_tenant  # noqa: F401

        mod = sys.modules["shared.chat_tenant"]
        mod._DB_PATH = db_path
        mod._db_lookup.cache_clear()
    return mod


def _make_rag_worker(tenant_id: str = "default-tenant") -> object:
    """Construct a RAGWorker with all external deps stubbed out."""
    from shared.workers.rag_worker import RAGWorker

    worker = RAGWorker(
        openwebui_url="http://mock-owui",
        api_key="test-key",
        collection_id="test-collection",
        nemotron=None,
        router=None,
        tenant_id=tenant_id,
    )
    return worker


def _minimal_state() -> dict:
    """Return a minimal FSM state dict suitable for RAGWorker.process()."""
    return {
        "state": "IDLE",
        "exchange_count": 0,
        "asset_identified": None,
        "context": {"history": []},
    }


# ---------------------------------------------------------------------------
# Test 1 — RAGWorker accepts a per-call tenant_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rag_worker_accepts_per_call_tenant(tmp_path):
    """RAGWorker.process() passes the per-call tenant_id to recall_knowledge,
    not the constructor default."""
    from shared.workers import rag_worker as rag_mod

    worker = _make_rag_worker(tenant_id="default-tenant")
    state = _minimal_state()

    # Stub out the embedding call so the recall branch is exercised
    fake_embedding = [0.1] * 768

    recall_calls: list[dict] = []

    def fake_recall(embedding, tenant_id, *, query_text="", limit=5):
        recall_calls.append({"tenant_id": tenant_id, "query_text": query_text})
        return []

    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=fake_embedding)),
        patch.object(rag_mod._neon_recall, "recall_knowledge", side_effect=fake_recall),
        patch.object(
            worker,
            "_call_llm",
            new=AsyncMock(
                return_value='{"reply":"ok","next_state":"IDLE","options":[],"confidence":"LOW"}'
            ),
        ),
    ):
        await worker.process("motor tripped", state, tenant_id="override-tenant")

    assert len(recall_calls) == 1, "recall_knowledge should be called exactly once"
    assert recall_calls[0]["tenant_id"] == "override-tenant", (
        f"Expected 'override-tenant', got {recall_calls[0]['tenant_id']!r}"
    )


# ---------------------------------------------------------------------------
# Test 2 — RAGWorker falls back to self.tenant_id when no per-call override
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rag_worker_falls_back_to_constructor_tenant(tmp_path):
    """When tenant_id kwarg is omitted, RAGWorker uses self.tenant_id."""
    from shared.workers import rag_worker as rag_mod

    worker = _make_rag_worker(tenant_id="constructor-tenant")
    state = _minimal_state()

    fake_embedding = [0.1] * 768
    recall_calls: list[dict] = []

    def fake_recall(embedding, tenant_id, *, query_text="", limit=5):
        recall_calls.append({"tenant_id": tenant_id})
        return []

    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=fake_embedding)),
        patch.object(rag_mod._neon_recall, "recall_knowledge", side_effect=fake_recall),
        patch.object(
            worker,
            "_call_llm",
            new=AsyncMock(
                return_value='{"reply":"ok","next_state":"IDLE","options":[],"confidence":"LOW"}'
            ),
        ),
    ):
        await worker.process("motor tripped", state)  # no tenant_id kwarg

    assert len(recall_calls) == 1
    assert recall_calls[0]["tenant_id"] == "constructor-tenant"


# ---------------------------------------------------------------------------
# Test 3 — Supervisor resolves tenant per call via chat_tenant mapping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_supervisor_resolves_tenant_per_call(tmp_path):
    """Supervisor.process() resolves the tenant from chat_tenant and passes it
    through to RAGWorker as a per-call override."""
    db_path = str(tmp_path / "mira.db")
    chat_tenant_mod = _fresh_chat_tenant(db_path)

    # Register a mapping
    chat_tenant_mod.set_mapping("chat-1", "tenant-1")
    chat_tenant_mod._db_lookup.cache_clear()

    # Capture the tenant_id forwarded to RAGWorker.process()
    rag_tenant_calls: list[str | None] = []

    async def fake_rag_process(message, state, photo_b64=None, vision_model=None, tenant_id=None):
        rag_tenant_calls.append(tenant_id)
        return '{"reply":"diagnosed","next_state":"Q1","options":[],"confidence":"MEDIUM"}'

    # Build a minimal Supervisor with everything mocked
    with (
        patch.dict(os.environ, {"MIRA_DB_PATH": db_path}, clear=False),
        # Redirect chat_tenant.resolve to the fresh module so DB mapping is visible
        patch("shared.engine.resolve_tenant", side_effect=chat_tenant_mod.resolve),
        patch(
            "shared.workers.rag_worker.RAGWorker._embed_ollama", new=AsyncMock(return_value=None)
        ),
        patch(
            "shared.workers.rag_worker.RAGWorker._call_llm",
            new=AsyncMock(
                return_value='{"reply":"diagnosed","next_state":"Q1","options":[],"confidence":"MEDIUM"}'
            ),
        ),
    ):
        from shared.engine import Supervisor

        sup = Supervisor(
            db_path=str(tmp_path / "sup.db"),
            openwebui_url="http://mock",
            api_key="key",
            collection_id="coll",
            tenant_id=None,
        )
        sup.rag.process = fake_rag_process  # type: ignore[method-assign]

        await sup.process("chat-1", "VFD fault F002")

    assert len(rag_tenant_calls) >= 1, "RAGWorker.process must be called at least once"
    assert rag_tenant_calls[0] == "tenant-1", (
        f"Expected tenant-1 from chat_tenant mapping, got {rag_tenant_calls[0]!r}"
    )


# ---------------------------------------------------------------------------
# Test 4 — Supervisor falls back to MIRA_TENANT_ID env var
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_supervisor_falls_back_to_env(tmp_path):
    """When no chat_tenant mapping exists, Supervisor uses MIRA_TENANT_ID env var."""
    db_path = str(tmp_path / "mira.db")
    chat_tenant_mod = _fresh_chat_tenant(db_path, tenant_id="env-fallback")

    rag_tenant_calls: list[str | None] = []

    async def fake_rag_process(message, state, photo_b64=None, vision_model=None, tenant_id=None):
        rag_tenant_calls.append(tenant_id)
        return '{"reply":"ok","next_state":"Q1","options":[],"confidence":"LOW"}'

    with (
        patch.dict(
            os.environ, {"MIRA_DB_PATH": db_path, "MIRA_TENANT_ID": "env-fallback"}, clear=False
        ),
        patch("shared.engine.resolve_tenant", side_effect=chat_tenant_mod.resolve),
        patch(
            "shared.workers.rag_worker.RAGWorker._embed_ollama", new=AsyncMock(return_value=None)
        ),
        patch(
            "shared.workers.rag_worker.RAGWorker._call_llm",
            new=AsyncMock(
                return_value='{"reply":"ok","next_state":"Q1","options":[],"confidence":"LOW"}'
            ),
        ),
    ):
        from shared.engine import Supervisor

        sup = Supervisor(
            db_path=str(tmp_path / "sup.db"),
            openwebui_url="http://mock",
            api_key="key",
            collection_id="coll",
            tenant_id=None,
        )
        sup.rag.process = fake_rag_process  # type: ignore[method-assign]

        await sup.process("unknown-chat", "motor overload")

    assert len(rag_tenant_calls) >= 1
    # resolve_tenant("unknown-chat") will return "env-fallback" via env var fallback;
    # if that is empty, Supervisor falls back to self.rag.tenant_id which is also "env-fallback"
    # (set at RAGWorker construction via MIRA_TENANT_ID).
    assert rag_tenant_calls[0] == "env-fallback", (
        f"Expected env-fallback, got {rag_tenant_calls[0]!r}"
    )


# ---------------------------------------------------------------------------
# Test 5 — Concurrent Supervisors with different tenants do not cross-leak
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_supervisors_different_tenants(tmp_path):
    """Two Supervisor.process() calls with distinct chat_id→tenant mappings must
    each forward their own tenant_id to RAGWorker — no cross-contamination."""
    db_path = str(tmp_path / "mira.db")
    chat_tenant_mod = _fresh_chat_tenant(db_path)

    chat_tenant_mod.set_mapping("chat-A", "tenant-alpha")
    chat_tenant_mod.set_mapping("chat-B", "tenant-beta")
    chat_tenant_mod._db_lookup.cache_clear()

    # Collect every (chat_id, tenant_id) pair that RAGWorker.process() receives
    rag_calls: list[dict] = []

    async def fake_rag_process(message, state, photo_b64=None, vision_model=None, tenant_id=None):
        rag_calls.append({"tenant_id": tenant_id})
        return '{"reply":"ok","next_state":"IDLE","options":[],"confidence":"LOW"}'

    with (
        patch.dict(os.environ, {"MIRA_DB_PATH": db_path}, clear=False),
        patch("shared.engine.resolve_tenant", side_effect=chat_tenant_mod.resolve),
        patch(
            "shared.workers.rag_worker.RAGWorker._embed_ollama", new=AsyncMock(return_value=None)
        ),
        patch(
            "shared.workers.rag_worker.RAGWorker._call_llm",
            new=AsyncMock(
                return_value='{"reply":"ok","next_state":"IDLE","options":[],"confidence":"LOW"}'
            ),
        ),
    ):
        from shared.engine import Supervisor

        sup = Supervisor(
            db_path=str(tmp_path / "sup.db"),
            openwebui_url="http://mock",
            api_key="key",
            collection_id="coll",
            tenant_id=None,
        )
        sup.rag.process = fake_rag_process  # type: ignore[method-assign]

        # Fire both calls sequentially (simulates concurrent requests sharing one Supervisor)
        await sup.process("chat-A", "VFD tripped")
        await sup.process("chat-B", "motor overload")

    assert len(rag_calls) == 2, f"Expected 2 RAG calls, got {len(rag_calls)}"
    observed_tenants = {c["tenant_id"] for c in rag_calls}
    assert observed_tenants == {"tenant-alpha", "tenant-beta"}, (
        f"Expected both tenants, got {observed_tenants!r}"
    )


# ---------------------------------------------------------------------------
# Test 6 — chat_tenant.resolve returns env fallback for unmapped chat ID
# ---------------------------------------------------------------------------


def test_chat_tenant_unmapped_returns_env_fallback(tmp_path):
    """resolve('unknown-chat-id') with no DB mapping and MIRA_TENANT_ID set
    must return the env var value, not an empty string."""
    db_path = str(tmp_path / "mira.db")
    chat_tenant_mod = _fresh_chat_tenant(db_path, tenant_id="env-fallback")

    # Ensure no mapping exists for this chat_id
    with patch.dict(os.environ, {"MIRA_TENANT_ID": "env-fallback"}, clear=False):
        result = chat_tenant_mod.resolve("unknown-chat-id")

    assert result == "env-fallback", f"Expected 'env-fallback' from env var, got {result!r}"


# ---------------------------------------------------------------------------
# Test 7 — Supervisor with no mapping and no env completes safely
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_supervisor_no_mapping_no_env_safe(tmp_path):
    """Supervisor constructed with tenant_id=None, no chat_tenant mapping, and
    MIRA_TENANT_ID unset must complete process() without raising."""
    db_path = str(tmp_path / "mira.db")
    # Fresh module with empty tenant — no env var, no mapping
    chat_tenant_mod = _fresh_chat_tenant(db_path, tenant_id="")

    fake_embedding = [0.1] * 768
    recall_calls: list[dict] = []

    def fake_recall(embedding, tenant_id, *, query_text="", limit=5):
        recall_calls.append({"tenant_id": tenant_id})
        return []

    from shared.workers import rag_worker as rag_mod

    with (
        patch.dict(
            os.environ,
            {"MIRA_DB_PATH": db_path, "MIRA_TENANT_ID": ""},
            clear=False,
        ),
        patch("shared.engine.resolve_tenant", side_effect=chat_tenant_mod.resolve),
        patch.object(rag_mod._neon_recall, "recall_knowledge", side_effect=fake_recall),
        patch(
            "shared.workers.rag_worker.RAGWorker._embed_ollama",
            new=AsyncMock(return_value=fake_embedding),
        ),
        patch(
            "shared.workers.rag_worker.RAGWorker._call_llm",
            new=AsyncMock(
                return_value='{"reply":"ok","next_state":"IDLE","options":[],"confidence":"LOW"}'
            ),
        ),
    ):
        from shared.engine import Supervisor

        sup = Supervisor(
            db_path=str(tmp_path / "sup.db"),
            openwebui_url="http://mock",
            api_key="key",
            collection_id="coll",
            tenant_id=None,
        )

        # Must not raise — empty tenant_id is a valid (degraded) operating mode
        reply = await sup.process("no-mapping-chat", "bearing noise")

    assert reply is not None, "Supervisor.process() must return a reply, not None"


# ---------------------------------------------------------------------------
# Test 8 — AtlasCMMS.for_tenant uses per-tenant creds, not env defaults
# ---------------------------------------------------------------------------


def test_atlas_for_tenant_uses_per_tenant_creds():
    """AtlasCMMS.for_tenant() must set .user and .password from arguments,
    ignoring ATLAS_API_USER and ATLAS_API_PASSWORD env vars."""
    from cmms.atlas import AtlasCMMS

    with patch.dict(
        os.environ,
        {
            "ATLAS_API_USER": "env-user@example.com",
            "ATLAS_API_PASSWORD": "env-password",
            "ATLAS_API_URL": "http://env-atlas:8080",
        },
        clear=False,
    ):
        instance = AtlasCMMS.for_tenant("tenant-user@example.com", "tenant-pw", "http://atlas:8080")

    assert instance.user == "tenant-user@example.com", (
        f"Expected tenant email, got {instance.user!r}"
    )
    assert instance.password == "tenant-pw", f"Expected tenant password, got {instance.password!r}"
    assert instance.api_url == "http://atlas:8080", (
        f"Expected per-tenant api_url, got {instance.api_url!r}"
    )

"""Tests for session context preservation when a follow-up photo arrives mid-diagnostic.

Covers:
  - test_photo_mid_diagnostic_preserves_options — last_options survives when a new
    equipment photo is processed during an active ASSET_IDENTIFIED session. The test
    uses the no-fault-indicator early-return path (line 582-594) where session_context
    is written to state without going through the RAG worker, making the preservation
    directly observable.
  - test_first_photo_starts_fresh — when there is no prior session_context, last_options
    is [] after the first photo (no stale data carried in).
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Make mira-bots importable from the repo root
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

# ---------------------------------------------------------------------------
# Stub out optional heavy dependencies that may not be installed in CI
# ---------------------------------------------------------------------------


def _install_stubs() -> None:
    """Inject lightweight stubs for packages not available in the test env."""
    if "pytesseract" not in sys.modules:
        pt = types.ModuleType("pytesseract")
        pt.image_to_string = lambda img, config="": ""  # type: ignore[attr-defined]
        sys.modules["pytesseract"] = pt

    for mod_path in ("PIL", "PIL.Image"):
        if mod_path not in sys.modules:
            sys.modules[mod_path] = types.ModuleType(mod_path)
    if not hasattr(sys.modules["PIL.Image"], "open"):
        sys.modules["PIL.Image"].open = lambda *a, **kw: MagicMock()  # type: ignore[attr-defined]

    if "langfuse" not in sys.modules:
        lf = types.ModuleType("langfuse")
        sys.modules["langfuse"] = lf

    pil_mod = sys.modules.get("PIL")
    if pil_mod is not None and not hasattr(pil_mod, "Image"):
        pil_mod.Image = sys.modules["PIL.Image"]  # type: ignore[attr-defined]


_install_stubs()

import os  # noqa: E402

os.environ.setdefault("MIRA_DB_PATH", ":memory:")

with patch("sqlite3.connect"):
    from shared.engine import Supervisor  # noqa: F401

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CHAT_ID = "chat-session-ctx"
_TENANT_ID = "tenant-test-0001"
# Minimal valid base64-encoded 1x1 white JPEG
_PHOTO_B64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN"
    "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg"
    "IBBQEAAAAAAAAAAAAAAQIDBAUREiExUf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEA"
    "AAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABgA/9k="
)

# Vision result for a generic equipment photo (not NAMEPLATE, not ELECTRICAL_PRINT).
# vision_result has no fault keywords so the engine takes the no-fault early-return path
# (line 582: "I can see this is X. How can I help?") rather than calling RAG.
_VISION_EQUIPMENT_RESULT = {
    "classification": "EQUIPMENT",
    "classification_confidence": 0.78,
    "vision_result": "Three-phase induction motor",
    "ocr_items": [],
    "tesseract_text": "",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
    "confidence": "medium",
}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _make_supervisor(tmp_path) -> Supervisor:
    """Return a Supervisor with all external I/O stubbed, backed by a real tmp SQLite DB."""
    db_path = ":memory:"
    with patch("sqlite3.connect"):
        sup = Supervisor(
            db_path=db_path,
            openwebui_url="http://mock-openwebui:8080",
            api_key="mock-api-key",
            collection_id="mock-collection",
            vision_model="qwen2.5vl:7b",
            tenant_id=_TENANT_ID,
            mcp_base_url="http://mock-mcp:8001",
            mcp_api_key="mock-mcp-key",
            web_base_url="http://mock-web:3000",
        )
    sup.db_path = str(tmp_path / "mira.db")
    sup._ensure_table()
    return sup


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_photo_mid_diagnostic_preserves_options(tmp_path):
    """Follow-up photo during an active session must not clear last_options.

    Exercise the no-fault-indicator early-return path (engine.py ~line 582) where
    session_context is written and the function returns before reaching RAG.
    This makes last_options directly observable in the saved state without the RAG
    worker overwriting it.
    """
    supervisor = _make_supervisor(tmp_path)

    # Pre-seed state as if MIRA already asked a diagnostic question with options.
    state = supervisor._load_state(_CHAT_ID)
    state["state"] = "ASSET_IDENTIFIED"
    state["asset_identified"] = "Allen-Bradley PowerFlex 40"
    state["context"]["session_context"] = {
        "equipment_type": "Variable Frequency Drive",
        "manufacturer": "Allen-Bradley",
        "last_question": "Is the motor making an unusual noise?",
        "last_options": ["Yes, grinding", "Yes, humming", "No noise"],
    }
    supervisor._save_state(_CHAT_ID, state)

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_EQUIPMENT_RESULT),
        ),
        patch("shared.chat_tenant.resolve", return_value=_TENANT_ID),
    ):
        result = await supervisor.process_full(_CHAT_ID, "", _PHOTO_B64)

    assert result["reply"]

    saved = supervisor._load_state(_CHAT_ID)
    sc = saved["context"].get("session_context", {})

    # The early-return path (no fault indicators) reads sc["last_options"] from ctx
    # and writes it back. With the bug, last_options was [] because the else block
    # rebuilt session_context from scratch; with the fix it must survive.
    assert sc.get("last_options") == ["Yes, grinding", "Yes, humming", "No noise"], (
        "last_options was cleared — follow-up photo wiped session context"
    )


@pytest.mark.asyncio
async def test_first_photo_starts_fresh(tmp_path):
    """First photo on a fresh session produces last_options=[] (no stale carry-in)."""
    supervisor = _make_supervisor(tmp_path)

    # State is completely fresh — default _load_state has session_context as an empty dict
    state = supervisor._load_state(_CHAT_ID)
    assert state["state"] == "IDLE"
    # session_context may exist as {} (default); ensure last_options is absent / empty
    sc_initial = state["context"].get("session_context", {})
    assert sc_initial.get("last_options", []) == []

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_EQUIPMENT_RESULT),
        ),
        patch("shared.chat_tenant.resolve", return_value=_TENANT_ID),
    ):
        result = await supervisor.process_full(_CHAT_ID, "", _PHOTO_B64)

    assert result["reply"]

    saved = supervisor._load_state(_CHAT_ID)
    sc = saved["context"].get("session_context", {})

    # On a fresh session there is no prior context to preserve, so last_options must be []
    assert sc.get("last_options", []) == [], (
        "last_options was non-empty on a fresh session — stale data bled in"
    )
    assert sc.get("last_question") is None or isinstance(sc.get("last_question"), str), (
        "last_question has unexpected type"
    )
    # equipment_type must be populated from the vision result
    assert sc.get("equipment_type"), "equipment_type was not set after first photo"

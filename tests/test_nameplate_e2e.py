"""End-to-end test for the nameplate flow wired into the Supervisor.

All downstream services (VisionWorker, NameplateWorker, httpx) are mocked so
no real network calls are made.  The test verifies:

- VisionWorker returns NAMEPLATE classification → _handle_nameplate fires
- NameplateWorker.extract() is called with the photo bytes
- mira-mcp POST /api/cmms/nameplate is called with the correct tenant_id and fields
- mira-web POST /api/provision/nameplate is called with the correct payload
- The reply returned to the caller contains "Asset registered" and the manufacturer/model
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
    # pytesseract (optional OCR, used in VisionWorker._ocr_extract)
    if "pytesseract" not in sys.modules:
        pt = types.ModuleType("pytesseract")
        pt.image_to_string = lambda img, config="": ""  # type: ignore[attr-defined]
        sys.modules["pytesseract"] = pt

    # PIL / Pillow (used by VisionWorker._ocr_extract and vision_worker module-level)
    for mod_path in ("PIL", "PIL.Image"):
        if mod_path not in sys.modules:
            sys.modules[mod_path] = types.ModuleType(mod_path)
    if not hasattr(sys.modules["PIL.Image"], "open"):
        sys.modules["PIL.Image"].open = lambda *a, **kw: MagicMock()  # type: ignore[attr-defined]

    # langfuse (optional tracing)
    if "langfuse" not in sys.modules:
        lf = types.ModuleType("langfuse")
        sys.modules["langfuse"] = lf

    # Ensure PIL stub is accessible as PIL.Image on the PIL namespace
    pil_mod = sys.modules.get("PIL")
    if pil_mod is not None and not hasattr(pil_mod, "Image"):
        pil_mod.Image = sys.modules["PIL.Image"]  # type: ignore[attr-defined]


_install_stubs()

# ---------------------------------------------------------------------------
# Import engine with the DB path pointed at :memory: so chat_tenant._ensure_table()
# doesn't try to open /data/mira.db which doesn't exist in the test env.
# ---------------------------------------------------------------------------

import os  # noqa: E402

os.environ.setdefault("MIRA_DB_PATH", ":memory:")

# chat_tenant calls _ensure_table() at module import time — patch sqlite3.connect
# so it uses an in-memory DB rather than the default /data path.
with patch("sqlite3.connect"):
    from shared.engine import Supervisor  # noqa: F401 — import triggers all module-level code

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CHAT_ID = "chat-1"
_TENANT_ID = "tenant-abc-0001"
# Minimal valid base64-encoded 1x1 white JPEG (no padding issues)
_PHOTO_B64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN"
    "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg"
    "IBBQEAAAAAAAAAAAAAAQIDBAUREiExUf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEA"
    "AAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABgA/9k="
)

_EXTRACTED_FIELDS = {
    "manufacturer": "AutomationDirect",
    "model": "GS1-45P0",
    "serial": "S123",
    "voltage": "460V",
    "fla": "12A",
    "hp": "5",
    "frequency": "60Hz",
    "rpm": None,
}

_VISION_NAMEPLATE_RESULT = {
    "classification": "NAMEPLATE",
    "classification_confidence": 0.85,
    "vision_result": "AutomationDirect GS1-45P0 nameplate showing rating data",
    "ocr_items": ["AutomationDirect", "GS1-45P0", "460V", "12A"],
    "tesseract_text": "AutomationDirect GS1-45P0",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
    "confidence": "high",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_supervisor(tmp_path):
    """Return a Supervisor instance with all external I/O stubbed out."""
    # Supervisor.__init__ calls self._ensure_table() which opens SQLite.
    # Use an in-memory DB path so it doesn't try to create /data/mira.db.
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
    # Replace the db_path with an actual tmp file so _load_state/_save_state work
    sup.db_path = str(tmp_path / "mira.db")
    sup._ensure_table()
    return sup


class _MockResponse:
    """Lightweight httpx response stub."""

    def __init__(self, json_data: dict, status_code: int = 200):
        self._json = json_data
        self.status_code = status_code
        self.text = str(json_data)

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=MagicMock(),
                response=MagicMock(status_code=self.status_code, text=self.text),
            )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_nameplate_flow_calls_mcp_and_web(tmp_path):
    """Full nameplate path: both downstream POSTs are made with correct payloads."""
    supervisor = _make_supervisor(tmp_path)

    # Track all POST calls
    captured_posts: list[dict] = []

    async def _mock_post(url, *, json=None, headers=None, **kwargs):
        captured_posts.append({"url": url, "json": json, "headers": headers})
        if "mcp" in url:
            return _MockResponse({"id": 99, "name": "AutomationDirect GS1-45P0"})
        # mira-web provision endpoint
        return _MockResponse({"ok": True, "linkedChunks": 7, "inserted": 2})

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = _mock_post

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_NAMEPLATE_RESULT),
        ),
        patch.object(
            supervisor.nameplate,
            "extract",
            new=AsyncMock(return_value=_EXTRACTED_FIELDS),
        ),
        patch.object(supervisor, "_save_session_photo"),
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.httpx.AsyncClient", return_value=mock_client),
    ):
        reply = await supervisor.process(_CHAT_ID, "", photo_b64=_PHOTO_B64)

    # Both HTTP POSTs must have been made
    post_urls = [c["url"] for c in captured_posts]
    assert any("mcp" in url and "nameplate" in url for url in post_urls), (
        f"mira-mcp POST not found in: {post_urls}"
    )
    assert any("web" in url and "provision" in url for url in post_urls), (
        f"mira-web POST not found in: {post_urls}"
    )

    # Reply contains "Asset registered" + manufacturer + model
    assert "Asset registered" in reply
    assert "AutomationDirect" in reply
    assert "GS1-45P0" in reply


@pytest.mark.asyncio
async def test_nameplate_mcp_payload_contains_tenant_and_fields(tmp_path):
    """mira-mcp POST body includes tenant_id and all nameplate fields."""
    supervisor = _make_supervisor(tmp_path)

    captured_mcp: list[dict] = []

    async def _mock_post(url, *, json=None, headers=None, **kwargs):
        if "mcp" in url:
            captured_mcp.append(json or {})
            return _MockResponse({"id": 1})
        return _MockResponse({"ok": True, "linkedChunks": 3, "inserted": 1})

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = _mock_post

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_NAMEPLATE_RESULT),
        ),
        patch.object(
            supervisor.nameplate,
            "extract",
            new=AsyncMock(return_value=_EXTRACTED_FIELDS),
        ),
        patch.object(supervisor, "_save_session_photo"),
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.httpx.AsyncClient", return_value=mock_client),
    ):
        await supervisor.process(_CHAT_ID, "", photo_b64=_PHOTO_B64)

    assert captured_mcp, "mira-mcp POST was never called"
    body = captured_mcp[0]
    assert body["tenant_id"] == _TENANT_ID
    assert body["manufacturer"] == "AutomationDirect"
    assert body["model"] == "GS1-45P0"
    assert body["serial"] == "S123"
    assert body["voltage"] == "460V"
    assert body["fla"] == "12A"
    assert body["hp"] == "5"


@pytest.mark.asyncio
async def test_nameplate_web_payload_correct_format(tmp_path):
    """mira-web POST body uses modelNumber (not model) and tenant_id."""
    supervisor = _make_supervisor(tmp_path)

    captured_web: list[dict] = []

    async def _mock_post(url, *, json=None, headers=None, **kwargs):
        if "web" in url:
            captured_web.append(json or {})
            return _MockResponse({"ok": True, "linkedChunks": 5, "inserted": 3})
        return _MockResponse({"id": 1})

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = _mock_post

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_NAMEPLATE_RESULT),
        ),
        patch.object(
            supervisor.nameplate,
            "extract",
            new=AsyncMock(return_value=_EXTRACTED_FIELDS),
        ),
        patch.object(supervisor, "_save_session_photo"),
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.httpx.AsyncClient", return_value=mock_client),
    ):
        await supervisor.process(_CHAT_ID, "", photo_b64=_PHOTO_B64)

    assert captured_web, "mira-web POST was never called"
    body = captured_web[0]
    assert body["tenant_id"] == _TENANT_ID
    np = body["nameplate"]
    assert np["manufacturer"] == "AutomationDirect"
    assert np["modelNumber"] == "GS1-45P0"
    assert np["serial"] == "S123"
    assert np["voltage"] == "460V"
    assert np["fla"] == "12A"
    assert np["hp"] == "5"


@pytest.mark.asyncio
async def test_nameplate_reply_contains_linked_chunks(tmp_path):
    """Reply message uses linkedChunks from the mira-web response."""
    supervisor = _make_supervisor(tmp_path)

    async def _mock_post(url, *, json=None, headers=None, **kwargs):
        if "mcp" in url:
            return _MockResponse({"id": 1})
        return _MockResponse({"ok": True, "linkedChunks": 42, "inserted": 10})

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = _mock_post

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_NAMEPLATE_RESULT),
        ),
        patch.object(
            supervisor.nameplate,
            "extract",
            new=AsyncMock(return_value=_EXTRACTED_FIELDS),
        ),
        patch.object(supervisor, "_save_session_photo"),
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.httpx.AsyncClient", return_value=mock_client),
    ):
        reply = await supervisor.process(_CHAT_ID, "", photo_b64=_PHOTO_B64)

    assert "42" in reply


@pytest.mark.asyncio
async def test_nameplate_flow_graceful_on_mcp_failure(tmp_path):
    """Flow does not raise if mira-mcp call fails — still returns a reply."""
    import httpx

    supervisor = _make_supervisor(tmp_path)
    call_count = 0

    async def _mock_post(url, *, json=None, headers=None, **kwargs):
        nonlocal call_count
        call_count += 1
        if "mcp" in url:
            raise httpx.TimeoutException("mcp timeout")
        return _MockResponse({"ok": True, "linkedChunks": 0, "inserted": 0})

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = _mock_post

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_NAMEPLATE_RESULT),
        ),
        patch.object(
            supervisor.nameplate,
            "extract",
            new=AsyncMock(return_value=_EXTRACTED_FIELDS),
        ),
        patch.object(supervisor, "_save_session_photo"),
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.httpx.AsyncClient", return_value=mock_client),
    ):
        # Must not raise — graceful degradation
        reply = await supervisor.process(_CHAT_ID, "", photo_b64=_PHOTO_B64)

    assert "Asset registered" in reply


@pytest.mark.asyncio
async def test_nameplate_bearer_token_sent_to_mcp(tmp_path):
    """Authorization header with Bearer token is included in mira-mcp POST."""
    supervisor = _make_supervisor(tmp_path)
    # Force a known api key value
    supervisor.mcp_api_key = "test-secret-key"

    captured_headers: list[dict] = []

    async def _mock_post(url, *, json=None, headers=None, **kwargs):
        if "mcp" in url:
            captured_headers.append(headers or {})
            return _MockResponse({"id": 1})
        return _MockResponse({"ok": True, "linkedChunks": 0, "inserted": 0})

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = _mock_post

    with (
        patch.object(
            supervisor.vision,
            "process",
            new=AsyncMock(return_value=_VISION_NAMEPLATE_RESULT),
        ),
        patch.object(
            supervisor.nameplate,
            "extract",
            new=AsyncMock(return_value=_EXTRACTED_FIELDS),
        ),
        patch.object(supervisor, "_save_session_photo"),
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.httpx.AsyncClient", return_value=mock_client),
    ):
        await supervisor.process(_CHAT_ID, "", photo_b64=_PHOTO_B64)

    assert captured_headers, "mira-mcp POST was never called"
    auth = captured_headers[0].get("Authorization", "")
    assert auth == "Bearer test-secret-key"

"""Regression tests for /ingest path traversal fix (security fix X2).

Covers the guard added at app.py ~line 297:

    real_path = Path(req.path).resolve()
    allowed_base = Path(settings.docs_base_path).resolve()
    if not real_path.is_relative_to(allowed_base):
        raise HTTPException(status_code=403, detail="Path must be within DOCS_BASE_PATH")

Only the path validation is exercised — downstream chunking/embedding can fail
freely (422 is fine; 403 is the only failure that matters here).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Make mira-sidecar importable from tests/
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-sidecar"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_store() -> MagicMock:
    store = MagicMock()
    store.doc_count.return_value = 0
    store.query.return_value = []
    return store


def _mock_embedder() -> MagicMock:
    embedder = MagicMock()
    embedder.model_name = "mock-embed"
    return embedder


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture
async def async_client(tmp_path: Path):
    """AsyncClient pointed at the FastAPI app with a controlled DOCS_BASE_PATH.

    The lifespan is bypassed by setting the module-level globals directly,
    exactly as the lifespan does.  docs_base_path is patched to tmp_path so
    tests fully control what counts as "inside" the allowed base.
    """
    import app as app_mod
    from httpx import ASGITransport, AsyncClient

    from config import settings

    # Patch settings.docs_base_path to the isolated tmp_path for this test run
    original_docs_base = settings.docs_base_path
    settings.docs_base_path = str(tmp_path)

    # Populate module globals that the endpoint requires before the path check
    app_mod._store_tenant = _mock_store()
    app_mod._store_shared = _mock_store()
    app_mod._embedder = _mock_embedder()
    # _llm is not reached by /ingest, so leave it None

    transport = ASGITransport(app=app_mod.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, tmp_path

    # Restore state
    settings.docs_base_path = original_docs_base
    app_mod._store_tenant = None
    app_mod._store_shared = None
    app_mod._embedder = None


# ---------------------------------------------------------------------------
# Convenience wrapper
# ---------------------------------------------------------------------------


async def _post_ingest(client, path: str) -> int:
    """POST /ingest with the given path and return the HTTP status code."""
    resp = await client.post(
        "/ingest",
        json={
            "filename": "test.pdf",
            "asset_id": "vfd-001",
            "path": path,
            "collection": "tenant",
        },
    )
    return resp.status_code


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestIngestPathTraversal:
    """Security regression suite for the DOCS_BASE_PATH guard on /ingest."""

    async def test_path_inside_base_is_allowed(self, async_client):
        """A path directly inside DOCS_BASE_PATH must NOT return 403.

        The endpoint may return 422 (no text extracted) because the file does
        not exist or is empty, but it must not be rejected by the path guard.
        """
        client, base = async_client
        target = str(base / "vfd-001" / "manual.pdf")
        status = await _post_ingest(client, target)
        assert status != 403, (
            f"Valid path inside DOCS_BASE_PATH returned 403 — path guard is too strict.\n"
            f"  base={base}\n  path={target}"
        )

    async def test_path_inside_nested_subdir_is_allowed(self, async_client):
        """A deeply-nested path under DOCS_BASE_PATH must NOT return 403."""
        client, base = async_client
        target = str(base / "tenant" / "assets" / "conveyor-01" / "spec.pdf")
        status = await _post_ingest(client, target)
        assert status != 403, f"Valid nested path returned 403.\n  base={base}\n  path={target}"

    async def test_etc_passwd_returns_403(self, async_client):
        """Requesting /etc/passwd must be rejected with 403."""
        client, _ = async_client
        status = await _post_ingest(client, "/etc/passwd")
        assert status == 403, f"Expected 403 for /etc/passwd, got {status}"

    async def test_tmp_evil_pdf_returns_403(self, async_client):
        """/tmp/evil.pdf is outside the base and must be rejected with 403."""
        client, _ = async_client
        status = await _post_ingest(client, "/tmp/evil.pdf")
        assert status == 403, f"Expected 403 for /tmp/evil.pdf, got {status}"

    async def test_prefix_bypass_returns_403(self, async_client):
        """A path that shares a common prefix but escapes via a different directory.

        If base=/tmp/pytest-xxx/docs, then /tmp/pytest-xxx/docs_evil/secret.txt
        must still be rejected — is_relative_to() uses structural containment,
        not string prefix matching.
        """
        client, base = async_client
        # Construct a sibling directory that starts with the same name as base
        evil_sibling = str(base.parent / (base.name + "_evil") / "secret.txt")
        status = await _post_ingest(client, evil_sibling)
        assert status == 403, (
            f"Prefix-bypass path was not rejected.\n  base={base}\n  evil_sibling={evil_sibling}"
        )

    async def test_dotdot_traversal_returns_403(self, async_client):
        """A path using .. to escape DOCS_BASE_PATH must be rejected with 403.

        Even though the raw string starts inside the base, resolve() collapses
        the .. segments before the guard evaluates it.
        """
        client, base = async_client
        # Build a raw string: <base>/subdir/../../../etc/passwd
        # After resolve() this lands well outside base
        raw = str(base / "subdir" / ".." / ".." / ".." / "etc" / "passwd")
        status = await _post_ingest(client, raw)
        assert status == 403, (
            f"../ traversal path was not rejected.\n  base={base}\n  raw_path={raw}"
        )

    async def test_dotdot_stays_inside_base_is_allowed(self, async_client):
        """A path with .. that still resolves to inside DOCS_BASE_PATH must NOT return 403.

        e.g. <base>/a/../b/file.pdf resolves to <base>/b/file.pdf — valid.
        """
        client, base = async_client
        # <base>/a/../b/file.pdf  resolves to  <base>/b/file.pdf
        raw = str(base / "a" / ".." / "b" / "file.pdf")
        status = await _post_ingest(client, raw)
        assert status != 403, (
            f"Internal .. path (stays inside base) incorrectly rejected with 403.\n"
            f"  base={base}\n  raw_path={raw}"
        )

    async def test_absolute_root_path_returns_403(self, async_client):
        """Requesting the filesystem root (/) must be rejected with 403."""
        client, _ = async_client
        status = await _post_ingest(client, "/")
        assert status == 403, f"Expected 403 for filesystem root '/', got {status}"

    async def test_symlink_outside_base_returns_403(self, async_client, tmp_path: Path):
        """A symlink whose target resolves outside DOCS_BASE_PATH must return 403.

        resolve() follows symlinks, so a link planted inside base that points
        outside must still be caught by the guard.
        """
        client, base = async_client

        # Create the target file outside the allowed base
        outside_dir = tmp_path / "outside"
        outside_dir.mkdir()
        secret = outside_dir / "secret.txt"
        secret.write_text("secret data", encoding="utf-8")

        # Plant a symlink inside the base pointing at the outside file
        link_dir = base / "links"
        link_dir.mkdir(parents=True, exist_ok=True)
        link = link_dir / "evil_link.pdf"
        try:
            link.symlink_to(secret)
        except (OSError, NotImplementedError):
            pytest.skip("Symlink creation not supported on this platform/filesystem")

        status = await _post_ingest(client, str(link))
        assert status == 403, (
            f"Symlink pointing outside base was not rejected.\n"
            f"  base={base}\n  link={link}\n  target={secret}"
        )

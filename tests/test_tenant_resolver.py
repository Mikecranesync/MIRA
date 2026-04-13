"""Tests for mira-mcp tenant_resolver module.

Covers:
- resolve_atlas_creds returns correct (email, password, api_url) tuple
- resolve_atlas_creds returns None when tenant not found
- resolve_atlas_creds returns None when NEON_DATABASE_URL is unset
- derive_atlas_password is deterministic for the same input
- derive_atlas_password produces correct output (verified against TS algorithm)
- derive_atlas_password raises RuntimeError when key is missing
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Make mira-mcp importable without installing it
REPO_ROOT = Path(__file__).parent.parent
MIRA_MCP = REPO_ROOT / "mira-mcp"
if str(MIRA_MCP) not in sys.path:
    sys.path.insert(0, str(MIRA_MCP))

from tenant_resolver import derive_atlas_password, resolve_atlas_creds  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TEST_TENANT_ID = "78917b56-aaaa-bbbb-cccc-000000000001"
_TEST_EMAIL = "acme@factorylm.com"
_TEST_KEY = "test-derivation-key-for-unit-tests"
_TEST_API_URL = "http://atlas-api:8080"


# ---------------------------------------------------------------------------
# derive_atlas_password
# ---------------------------------------------------------------------------


def test_derive_password_deterministic(monkeypatch):
    """Same tenant_id must always produce the same password."""
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)
    pw1 = derive_atlas_password(_TEST_TENANT_ID)
    pw2 = derive_atlas_password(_TEST_TENANT_ID)
    assert pw1 == pw2


def test_derive_password_correct_algorithm(monkeypatch):
    """Output must match HMAC-SHA256(key, tenant_id) → base64url[:32]."""
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)
    expected_digest = hmac.new(
        _TEST_KEY.encode(), _TEST_TENANT_ID.encode(), hashlib.sha256
    ).digest()
    expected = base64.urlsafe_b64encode(expected_digest).rstrip(b"=").decode()[:32]
    assert derive_atlas_password(_TEST_TENANT_ID) == expected


def test_derive_password_different_tenants_differ(monkeypatch):
    """Different tenant IDs must produce different passwords."""
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)
    pw_a = derive_atlas_password("tenant-a")
    pw_b = derive_atlas_password("tenant-b")
    assert pw_a != pw_b


def test_derive_password_length_32(monkeypatch):
    """Derived password must be exactly 32 characters."""
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)
    pw = derive_atlas_password(_TEST_TENANT_ID)
    assert len(pw) == 32


def test_derive_password_raises_when_key_missing(monkeypatch):
    """RuntimeError when ATLAS_PASSWORD_DERIVATION_KEY is not set."""
    monkeypatch.delenv("ATLAS_PASSWORD_DERIVATION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ATLAS_PASSWORD_DERIVATION_KEY"):
        derive_atlas_password(_TEST_TENANT_ID)


# ---------------------------------------------------------------------------
# resolve_atlas_creds
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_returns_none_when_neon_url_missing(monkeypatch):
    """Returns None when NEON_DATABASE_URL is not configured."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    result = await resolve_atlas_creds(_TEST_TENANT_ID)
    assert result is None


@pytest.mark.asyncio
async def test_resolve_returns_atlas_creds(monkeypatch):
    """Returns (email, derived_password, api_url) when tenant is found."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://fake/testdb")
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)
    monkeypatch.setenv("ATLAS_API_URL", _TEST_API_URL)

    # Build expected password using the same algorithm
    expected_digest = hmac.new(
        _TEST_KEY.encode(), _TEST_TENANT_ID.encode(), hashlib.sha256
    ).digest()
    expected_pw = base64.urlsafe_b64encode(expected_digest).rstrip(b"=").decode()[:32]

    # Mock psycopg AsyncConnection to return the test email
    mock_cur = AsyncMock()
    mock_cur.fetchone = AsyncMock(return_value={"email": _TEST_EMAIL})
    mock_cur.__aenter__ = AsyncMock(return_value=mock_cur)
    mock_cur.__aexit__ = AsyncMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.cursor = MagicMock(return_value=mock_cur)
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=False)

    mock_psycopg = MagicMock()
    mock_psycopg.AsyncConnection.connect = AsyncMock(return_value=mock_conn)
    mock_psycopg.rows = MagicMock()

    with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
        result = await resolve_atlas_creds(_TEST_TENANT_ID)

    assert result is not None
    email, password, api_url = result
    assert email == _TEST_EMAIL
    assert password == expected_pw
    assert api_url == _TEST_API_URL


@pytest.mark.asyncio
async def test_resolve_unknown_tenant_returns_none(monkeypatch):
    """Returns None when NeonDB returns no row for the tenant_id."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://fake/testdb")
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)

    mock_cur = AsyncMock()
    mock_cur.fetchone = AsyncMock(return_value=None)
    mock_cur.__aenter__ = AsyncMock(return_value=mock_cur)
    mock_cur.__aexit__ = AsyncMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.cursor = MagicMock(return_value=mock_cur)
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=False)

    mock_psycopg = MagicMock()
    mock_psycopg.AsyncConnection.connect = AsyncMock(return_value=mock_conn)
    mock_psycopg.rows = MagicMock()

    with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
        result = await resolve_atlas_creds("nonexistent-tenant-id")

    assert result is None


@pytest.mark.asyncio
async def test_resolve_returns_none_on_db_error(monkeypatch):
    """Returns None gracefully when NeonDB raises an exception."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://fake/testdb")
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)

    mock_psycopg = MagicMock()
    mock_psycopg.AsyncConnection.connect = AsyncMock(side_effect=OSError("connection refused"))
    mock_psycopg.rows = MagicMock()

    with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
        result = await resolve_atlas_creds(_TEST_TENANT_ID)

    assert result is None


@pytest.mark.asyncio
async def test_resolve_api_url_defaults_to_env(monkeypatch):
    """api_url in the returned tuple comes from ATLAS_API_URL env var."""
    custom_url = "http://custom-atlas:9999"
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://fake/testdb")
    monkeypatch.setenv("ATLAS_PASSWORD_DERIVATION_KEY", _TEST_KEY)
    monkeypatch.setenv("ATLAS_API_URL", custom_url)

    mock_cur = AsyncMock()
    mock_cur.fetchone = AsyncMock(return_value={"email": _TEST_EMAIL})
    mock_cur.__aenter__ = AsyncMock(return_value=mock_cur)
    mock_cur.__aexit__ = AsyncMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.cursor = MagicMock(return_value=mock_cur)
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=False)

    mock_psycopg = MagicMock()
    mock_psycopg.AsyncConnection.connect = AsyncMock(return_value=mock_conn)
    mock_psycopg.rows = MagicMock()

    with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
        result = await resolve_atlas_creds(_TEST_TENANT_ID)

    assert result is not None
    _, _, api_url = result
    assert api_url == custom_url

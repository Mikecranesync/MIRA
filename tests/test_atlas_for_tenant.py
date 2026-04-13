"""Tests for AtlasCMMS.for_tenant() classmethod (Task 0.4 — tenant isolation)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Make mira-mcp importable without installing it
REPO_ROOT = Path(__file__).parent.parent
MIRA_MCP = REPO_ROOT / "mira-mcp"
if str(MIRA_MCP) not in sys.path:
    sys.path.insert(0, str(MIRA_MCP))

from cmms.atlas import AtlasCMMS  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TEST_EMAIL = "tech@acme.com"
_TEST_PW = "s3cr3t"
_TEST_URL = "http://atlas-test:9090"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_for_tenant_uses_passed_credentials():
    """for_tenant() must wire email/password/api_url directly, ignoring env vars."""
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW, _TEST_URL)
    assert inst.user == _TEST_EMAIL
    assert inst.password == _TEST_PW
    assert inst.api_url == _TEST_URL


def test_for_tenant_configured_true():
    """Instance returned by for_tenant() reports .configured == True when both creds passed."""
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW, _TEST_URL)
    assert inst.configured is True


def test_for_tenant_configured_false_no_email():
    """configured is False when email is empty."""
    inst = AtlasCMMS.for_tenant("", _TEST_PW, _TEST_URL)
    assert inst.configured is False


def test_for_tenant_configured_false_no_password():
    """configured is False when password is empty."""
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, "", _TEST_URL)
    assert inst.configured is False


def test_for_tenant_api_url_defaults_to_env(monkeypatch):
    """When api_url is omitted, falls back to ATLAS_API_URL env var."""
    monkeypatch.setenv("ATLAS_API_URL", "http://from-env:8080")
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW)
    assert inst.api_url == "http://from-env:8080"


def test_for_tenant_api_url_defaults_to_hardcoded_default(monkeypatch):
    """When api_url is omitted and env var is unset, uses hardcoded default."""
    monkeypatch.delenv("ATLAS_API_URL", raising=False)
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW)
    assert inst.api_url == "http://atlas-api:8080"


def test_for_tenant_token_state_initialized():
    """Internal token state must be initialised to empty/zero — no stale token leakage."""
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW, _TEST_URL)
    assert inst._token == ""
    assert inst._token_expires == 0


def test_env_constructor_still_works(monkeypatch):
    """Standard AtlasCMMS() still reads credentials from env vars."""
    monkeypatch.setenv("ATLAS_API_URL", "http://atlas-env:8080")
    monkeypatch.setenv("ATLAS_API_USER", "admin@env.com")
    monkeypatch.setenv("ATLAS_API_PASSWORD", "env_pass")
    inst = AtlasCMMS()
    assert inst.api_url == "http://atlas-env:8080"
    assert inst.user == "admin@env.com"
    assert inst.password == "env_pass"


def test_env_constructor_not_polluted_by_for_tenant(monkeypatch):
    """Creating a for_tenant() instance must not affect a subsequent AtlasCMMS() instance."""
    monkeypatch.setenv("ATLAS_API_USER", "env_user@x.com")
    monkeypatch.setenv("ATLAS_API_PASSWORD", "env_pw")
    monkeypatch.setenv("ATLAS_API_URL", "http://atlas-api:8080")

    _ = AtlasCMMS.for_tenant("other@x.com", "other_pw", "http://other:9999")
    env_inst = AtlasCMMS()

    assert env_inst.user == "env_user@x.com"
    assert env_inst.api_url == "http://atlas-api:8080"


@pytest.mark.asyncio
async def test_for_tenant_get_token_uses_correct_user():
    """_get_token() must POST the credentials supplied to for_tenant(), not env vars."""
    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW, _TEST_URL)

    mock_response = MagicMock()
    mock_response.json.return_value = {"accessToken": "jwt-abc123"}
    mock_response.raise_for_status = MagicMock()

    mock_post = AsyncMock(return_value=mock_response)
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = mock_post

    with patch("httpx.AsyncClient", return_value=mock_client):
        token = await inst._get_token()

    assert token == "jwt-abc123"
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args
    # positional arg 0 = URL, keyword arg 'json' = body
    posted_url = call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs.get("url", "")
    posted_body = call_kwargs.kwargs.get("json", {})
    assert _TEST_URL in posted_url
    assert posted_body.get("email") == _TEST_EMAIL
    assert posted_body.get("password") == _TEST_PW


@pytest.mark.asyncio
async def test_for_tenant_get_token_caches_token():
    """Second call to _get_token() reuses cached JWT without a second HTTP request."""
    import time

    inst = AtlasCMMS.for_tenant(_TEST_EMAIL, _TEST_PW, _TEST_URL)
    # Pre-load a valid cached token
    inst._token = "cached-token"
    inst._token_expires = time.time() + 3600

    with patch("httpx.AsyncClient") as mock_cls:
        token = await inst._get_token()

    assert token == "cached-token"
    mock_cls.assert_not_called()

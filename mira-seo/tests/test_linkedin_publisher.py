"""Tests for LinkedIn publisher — Zernio → Buffer → clipboard fallback chain."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
import respx
from httpx import Response

from mira_seo.models.content import LinkedInPost
from mira_seo.tools import linkedin_publisher


def _post() -> LinkedInPost:
    return LinkedInPost(text="Hello LinkedIn", hashtags=["VFD", "Maintenance"])


@pytest.mark.asyncio
async def test_publish_uses_zernio_when_configured():
    with patch.dict(
        "os.environ",
        {"ZERNIO_API_KEY": "z-key", "ZERNIO_LINKEDIN_PROFILE_ID": "p1"},
        clear=True,
    ):
        with respx.mock:
            respx.post("https://app.zernio.com/api/v1/posts").mock(
                return_value=Response(200, json={"ok": True})
            )
            assert await linkedin_publisher.publish(_post()) is True


@pytest.mark.asyncio
async def test_publish_falls_through_to_buffer_when_zernio_fails():
    with patch.dict(
        "os.environ",
        {
            "ZERNIO_API_KEY": "z",
            "ZERNIO_LINKEDIN_PROFILE_ID": "p1",
            "BUFFER_ACCESS_TOKEN": "b-tok",
            "BUFFER_LINKEDIN_PROFILE_ID": "bp1",
        },
        clear=True,
    ):
        with respx.mock:
            respx.post("https://app.zernio.com/api/v1/posts").mock(
                return_value=Response(500, json={"err": "boom"})
            )
            respx.post("https://api.bufferapp.com/1/updates/create.json").mock(
                return_value=Response(200, json={"success": True})
            )
            assert await linkedin_publisher.publish(_post()) is True


@pytest.mark.asyncio
async def test_publish_falls_through_to_clipboard_when_unconfigured(tmp_path: Path, monkeypatch):
    clip = tmp_path / "post.txt"
    monkeypatch.setattr(linkedin_publisher, "CLIPBOARD_FILE", clip)
    with patch.dict("os.environ", {}, clear=True):
        assert await linkedin_publisher.publish(_post()) is True
    contents = clip.read_text()
    assert "Hello LinkedIn" in contents
    assert "#VFD" in contents

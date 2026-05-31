"""Tests for yt-pipeline uploader module."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch


def _plan() -> dict:
    """Return a minimal plan dict for tests."""
    return {
        "title": "VFD Overcurrent Fix",
        "description": "How to fix VFD overcurrent faults.",
        "tags": ["vfd", "fault", "industrial"],
    }


def test_refresh_token_returns_access_token():
    """_refresh_token() exchanges refresh token for access token."""
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({"access_token": "ya29.test"}).encode()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", return_value=mock_resp):
        from tools.yt_pipeline.uploader import _refresh_token

        token = _refresh_token("client-id", "client-secret", "refresh-tok")

    assert token == "ya29.test"


def test_upload_returns_video_id(tmp_path):
    """upload() streams chunks and returns video ID from final 200 response."""
    video = tmp_path / "final.mp4"
    video.write_bytes(b"x" * 100)

    # Mock 1: token refresh
    token_resp = MagicMock()
    token_resp.read.return_value = json.dumps({"access_token": "ya29.test"}).encode()
    token_resp.__enter__ = lambda s: s
    token_resp.__exit__ = MagicMock(return_value=False)

    # Mock 2: initiate upload — returns Location header
    init_resp = MagicMock()
    init_resp.headers = {"Location": "https://upload.example.com/session/abc"}
    init_resp.__enter__ = lambda s: s
    init_resp.__exit__ = MagicMock(return_value=False)

    # Mock 3: chunk upload — returns 200 with video ID
    chunk_resp = MagicMock()
    chunk_resp.status = 200
    chunk_resp.read.return_value = json.dumps({"id": "vid-xyz"}).encode()
    chunk_resp.__enter__ = lambda s: s
    chunk_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", side_effect=[token_resp, init_resp, chunk_resp]):
        from tools.yt_pipeline.uploader import upload

        video_id = upload(_plan(), video, "cid", "csecret", "rtoken", auto_publish=True)

    assert video_id == "vid-xyz"

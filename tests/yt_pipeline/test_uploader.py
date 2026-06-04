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
    mock_resp.read.return_value = json.dumps({"access_token": "fake-access-token"}).encode()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", return_value=mock_resp):
        from tools.yt_pipeline.uploader import _refresh_token

        token = _refresh_token("client-id", "client-secret", "refresh-tok")

    assert token == "fake-access-token"


def test_upload_returns_video_id(tmp_path):
    """upload() streams chunks and returns video ID from final 200 response."""
    import tools.yt_pipeline.uploader as up

    video = tmp_path / "final.mp4"
    video.write_bytes(b"x" * 100)

    # Mock 1: token refresh
    token_resp = MagicMock()
    token_resp.read.return_value = json.dumps({"access_token": "fake-access-token"}).encode()
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

    with patch("urllib.request.urlopen", side_effect=[token_resp, init_resp]), \
         patch.object(up._OPENER, "open", return_value=chunk_resp):
        from tools.yt_pipeline.uploader import upload

        video_id = upload(_plan(), video, "cid", "csecret", "rtoken", auto_publish=True)

    assert video_id == "vid-xyz"


def test_upload_resumes_across_chunks(tmp_path, monkeypatch):
    """upload() handles multi-chunk 308 resume responses correctly on Python 3.12.

    This test verifies that intermediate chunks receiving 308 "Resume Incomplete"
    responses trigger the resume logic (offset advancement) and allow the loop
    to send the next chunk. Without a no-redirect opener, urllib's default handler
    on Python 3.12 auto-follows 308, breaking the explicit resume control.
    """
    import urllib.error

    import tools.yt_pipeline.uploader as up

    # Reduce chunk size so 25-byte file spans 3 chunks: 10, 10, 5
    monkeypatch.setattr(up, "_CHUNK_SIZE", 10)

    video = tmp_path / "final.mp4"
    video.write_bytes(b"x" * 25)

    # Mock 1: token refresh
    token_resp = MagicMock()
    token_resp.read.return_value = json.dumps({"access_token": "fake-access-token"}).encode()
    token_resp.__enter__ = lambda s: s
    token_resp.__exit__ = MagicMock(return_value=False)

    # Mock 2: initiate upload — returns Location header
    init_resp = MagicMock()
    init_resp.headers = {"Location": "https://upload.example.com/session/abc"}
    init_resp.__enter__ = lambda s: s
    init_resp.__exit__ = MagicMock(return_value=False)

    # Mock 3: final chunk upload — returns 200 with video ID
    final_resp = MagicMock()
    final_resp.status = 200
    final_resp.read.return_value = json.dumps({"id": "vid-xyz"}).encode()
    final_resp.__enter__ = lambda s: s
    final_resp.__exit__ = MagicMock(return_value=False)

    # Track all chunk PUT requests to the opener
    captured_requests = []

    def fake_opener_open(req):
        """Simulate resumable protocol: first two chunks return 308, final returns 200."""
        captured_requests.append(req)
        chunk_num = len(captured_requests)
        if chunk_num < 3:  # first two chunks -> 308 "Resume Incomplete"
            raise urllib.error.HTTPError(
                req.full_url, 308, "Resume Incomplete", {}, None
            )
        # third chunk -> 200 OK with video ID
        return final_resp

    # token refresh + init use urllib.request.urlopen, chunk PUTs use _OPENER.open
    with patch("urllib.request.urlopen", side_effect=[token_resp, init_resp]), \
         patch.object(up._OPENER, "open", side_effect=fake_opener_open):
        from tools.yt_pipeline.uploader import upload

        video_id = upload(_plan(), video, "cid", "csecret", "rtoken", auto_publish=True)

    # Assertions
    assert video_id == "vid-xyz", "upload() should return the video ID from final 200 response"
    assert len(captured_requests) == 3, f"Expected 3 chunk requests, got {len(captured_requests)}"

    # Verify Content-Range headers
    for i, req in enumerate(captured_requests):
        content_range = req.headers.get("Content-range") or req.get_header("Content-range")
        assert content_range is not None, f"Request {i+1} missing Content-range header"

    # Final request should cover bytes 20-24 of 25
    final_range = captured_requests[-1].headers.get("Content-range") or captured_requests[-1].get_header("Content-range")
    assert final_range == "bytes 20-24/25", f"Final range header should be 'bytes 20-24/25', got {final_range}"

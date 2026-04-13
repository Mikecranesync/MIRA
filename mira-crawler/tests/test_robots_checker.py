"""Tests for robots.txt compliance checker. Zero real HTTP calls."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from crawler.robots_checker import RobotsChecker

ROBOTS_ALLOW_ALL = ""
ROBOTS_BLOCK_MANUALS = "User-agent: *\nDisallow: /manuals/"
ROBOTS_BLOCK_MIRA = "User-agent: MiraCrawler\nDisallow: /"


def _make_checker(tmp_path: Path) -> RobotsChecker:
    return RobotsChecker(
        cache_dir=tmp_path, user_agent="MiraCrawler/1.0", ttl_hours=24
    )


class TestRobotsChecker:
    @patch("crawler.robots_checker.httpx.get")
    def test_allows_when_no_robots_txt(self, mock_get, tmp_path):
        """No robots.txt (404) → allow all URLs."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_get.return_value = mock_resp

        checker = _make_checker(tmp_path)
        assert checker.is_allowed("https://example.com/manuals/guide.pdf") is True

    @patch("crawler.robots_checker.httpx.get")
    def test_blocks_disallowed_path(self, mock_get, tmp_path):
        """robots.txt disallows /manuals/ → block."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = ROBOTS_BLOCK_MANUALS
        mock_get.return_value = mock_resp

        checker = _make_checker(tmp_path)
        assert checker.is_allowed("https://example.com/manuals/guide.pdf") is False
        assert checker.is_allowed("https://example.com/public/page.html") is True

    @patch("crawler.robots_checker.httpx.get")
    def test_blocks_by_user_agent(self, mock_get, tmp_path):
        """robots.txt blocks our specific user agent."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = ROBOTS_BLOCK_MIRA
        mock_get.return_value = mock_resp

        checker = _make_checker(tmp_path)
        assert checker.is_allowed("https://example.com/anything") is False

    @patch("crawler.robots_checker.httpx.get")
    def test_caches_result(self, mock_get, tmp_path):
        """Second call uses cache, doesn't re-fetch."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = ROBOTS_ALLOW_ALL
        mock_get.return_value = mock_resp

        checker = _make_checker(tmp_path)
        checker.is_allowed("https://example.com/a")
        checker.is_allowed("https://example.com/b")
        # Only one HTTP call — same domain, cached
        mock_get.assert_called_once()

    @patch("crawler.robots_checker.httpx.get")
    def test_cache_file_written(self, mock_get, tmp_path):
        """Cache file is persisted to disk."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = ROBOTS_ALLOW_ALL
        mock_get.return_value = mock_resp

        checker = _make_checker(tmp_path)
        checker.is_allowed("https://example.com/test")

        cache_files = list((tmp_path / "robots").glob("*.json"))
        assert len(cache_files) == 1
        data = json.loads(cache_files[0].read_text())
        assert "fetched_at" in data

    @patch("crawler.robots_checker.httpx.get")
    def test_network_error_allows(self, mock_get, tmp_path):
        """Network error fetching robots.txt → fail-open (allow)."""
        mock_get.side_effect = Exception("Connection refused")

        checker = _make_checker(tmp_path)
        assert checker.is_allowed("https://example.com/test") is True

    def test_clear_cache(self, tmp_path):
        """clear_cache removes all cached files."""
        checker = _make_checker(tmp_path)
        robots_dir = tmp_path / "robots"
        robots_dir.mkdir(exist_ok=True)
        (robots_dir / "test.json").write_text("{}")

        count = checker.clear_cache()
        assert count == 1
        assert list(robots_dir.glob("*.json")) == []

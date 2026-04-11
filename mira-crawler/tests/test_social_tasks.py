"""Tests for Social Fleet Celery tasks.

All tests are offline — Buffer API and NeonDB calls are mocked.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestScheduleBufferPosts:
    """Tests for schedule_buffer_posts task."""

    @patch("tasks.social._get_buffer_token", return_value="")
    def test_skips_without_token(self, mock_token):
        from tasks.social import schedule_buffer_posts

        result = schedule_buffer_posts()

        assert result["scheduled"] == 0
        assert result["skipped_no_token"] is True

    @patch("tasks.social._get_approved_social_items", return_value=[])
    @patch("tasks.social._get_buffer_token", return_value="test-token")
    def test_no_items_to_schedule(self, mock_token, mock_items):
        from tasks.social import schedule_buffer_posts

        result = schedule_buffer_posts()

        assert result["scheduled"] == 0
        assert result["failed"] == 0

    @patch("tasks.social._update_social_item_status")
    @patch("tasks.social._get_approved_social_items", return_value=[
        {"id": 1, "platform": "linkedin", "body_text": "Test post", "char_count": 50},
    ])
    @patch("tasks.social._get_buffer_token", return_value="test-token")
    @patch("httpx.Client")
    def test_schedules_approved_items(self, mock_client_cls, mock_token, mock_items, mock_update):
        from tasks.social import schedule_buffer_posts

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"updates": [{"id": "buf_123"}]}
        mock_resp.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        result = schedule_buffer_posts()

        assert result["scheduled"] == 1
        mock_update.assert_called_once_with(1, "scheduled", "buf_123")


class TestCrossPostContent:
    """Tests for cross_post_content task."""

    @patch("mira_copy.client.complete")
    def test_adapts_to_target_platforms(self, mock_complete):
        from tasks.social import cross_post_content

        mock_complete.return_value = (
            '{"adaptations": [{"platform": "x", "text": "Short version", "char_count": 85}]}',
            {"input_tokens": 200, "output_tokens": 100},
        )

        result = cross_post_content("linkedin", "Long LinkedIn post about VFD faults", ["x"])

        assert result["source_platform"] == "linkedin"
        assert len(result["adaptations"]) == 1
        assert result["adaptations"][0]["platform"] == "x"


class TestSocialEngagementReport:
    """Tests for social_engagement_report task."""

    @patch.dict("os.environ", {"NEON_DATABASE_URL": ""})
    def test_returns_error_without_db(self):
        from tasks.social import social_engagement_report

        result = social_engagement_report()

        assert "error" in result


class TestPlatformCharLimits:
    """Tests for social configuration."""

    def test_all_platforms_have_limits(self):
        from tasks.social import PLATFORM_CHAR_LIMITS

        expected = {"linkedin", "x", "reddit", "facebook", "tiktok", "instagram"}
        assert set(PLATFORM_CHAR_LIMITS.keys()) == expected

    def test_x_limit_is_280(self):
        from tasks.social import PLATFORM_CHAR_LIMITS

        assert PLATFORM_CHAR_LIMITS["x"] == 280

    def test_linkedin_limit_is_3000(self):
        from tasks.social import PLATFORM_CHAR_LIMITS

        assert PLATFORM_CHAR_LIMITS["linkedin"] == 3000

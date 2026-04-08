"""Tests for Content Fleet Celery tasks.

All tests are offline — Claude API and NeonDB calls are mocked.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure imports work from repo root
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestGenerateBlogPost:
    """Tests for generate_blog_post task."""

    @patch("mira_copy.generate.generate")
    @patch("tasks.content._insert_content_item", return_value=42)
    def test_generates_with_explicit_topic(self, mock_insert, mock_gen):
        from tasks.content import generate_blog_post

        mock_result = MagicMock()
        mock_result.raw_json = {
            "title": "PowerFlex 525 F004 Troubleshooting",
            "slug": "powerflex-525-f004",
            "word_count": 950,
        }
        mock_result.rendered_md = "# Test blog post content"
        mock_result.usage = {"input_tokens": 500, "output_tokens": 800}
        mock_gen.return_value = mock_result

        result = generate_blog_post("maintenance_tech", "powerflex-525-f004")

        assert result["topic"] == "powerflex-525-f004"
        assert result["audience"] == "maintenance_tech"
        assert result["content_id"] == 42
        assert result["title"] == "PowerFlex 525 F004 Troubleshooting"
        mock_gen.assert_called_once_with("blog-post", "maintenance_tech", "powerflex-525-f004")

    @patch("mira_copy.generate.generate")
    @patch("tasks.content._insert_content_item", return_value=43)
    def test_picks_random_topic_when_none(self, mock_insert, mock_gen):
        from tasks.content import TOPIC_BANK, generate_blog_post

        mock_result = MagicMock()
        mock_result.raw_json = {"title": "Test", "slug": "test", "word_count": 100}
        mock_result.rendered_md = "content"
        mock_result.usage = {}
        mock_gen.return_value = mock_result

        result = generate_blog_post("maintenance_manager")

        assert result["topic"] in TOPIC_BANK
        assert result["audience"] == "maintenance_manager"

    @patch("mira_copy.generate.generate", side_effect=RuntimeError("API key not set"))
    def test_retries_on_failure(self, mock_gen):
        from tasks.content import generate_blog_post

        with pytest.raises(RuntimeError):
            generate_blog_post("maintenance_tech", "test-topic")


class TestGenerateSocialBatch:
    """Tests for generate_social_batch task."""

    @patch("mira_copy.generate.generate")
    @patch("tasks.content._insert_content_item", return_value=44)
    @patch("tasks.content._insert_social_items")
    def test_generates_all_platforms(self, mock_social_insert, mock_insert, mock_gen):
        from tasks.content import generate_social_batch

        mock_result = MagicMock()
        mock_result.raw_json = {
            "posts": [
                {"platform": "linkedin", "text": "LI post", "char_count": 200},
                {"platform": "x", "text": "X post", "char_count": 100},
                {"platform": "reddit", "text": "Reddit post", "char_count": 300},
                {"platform": "facebook", "text": "FB post", "char_count": 250},
                {"platform": "tiktok", "text": "TT caption", "char_count": 150},
                {"platform": "instagram", "text": "IG caption", "char_count": 180},
            ]
        }
        mock_result.rendered_md = "social content"
        mock_result.usage = {"input_tokens": 600, "output_tokens": 900}
        mock_gen.return_value = mock_result

        result = generate_social_batch("maintenance_tech", "fault-code-tip")

        assert result["post_count"] == 6
        assert "linkedin" in result["platforms"]
        assert "reddit" in result["platforms"]
        mock_social_insert.assert_called_once()

    @patch("mira_copy.generate.generate")
    @patch("tasks.content._insert_content_item", return_value=45)
    @patch("tasks.content._insert_social_items")
    def test_picks_random_theme_when_none(self, mock_social, mock_insert, mock_gen):
        from tasks.content import SOCIAL_THEMES, generate_social_batch

        mock_result = MagicMock()
        mock_result.raw_json = {"posts": []}
        mock_result.rendered_md = ""
        mock_result.usage = {}
        mock_gen.return_value = mock_result

        result = generate_social_batch("maintenance_tech")

        assert result["theme"] in SOCIAL_THEMES


class TestGenerateEmailVariant:
    """Tests for generate_email_variant task."""

    @patch("mira_copy.generate.generate")
    @patch("tasks.content._insert_content_item", return_value=46)
    def test_generates_variant(self, mock_insert, mock_gen):
        from tasks.content import generate_email_variant

        mock_result = MagicMock()
        mock_result.raw_json = {
            "subject": "Test subject line",
            "preview_text": "Preview text here",
        }
        mock_result.rendered_md = "email content"
        mock_result.rendered_html = "<h1>Email</h1>"
        mock_result.usage = {"input_tokens": 400, "output_tokens": 600}
        mock_gen.return_value = mock_result

        result = generate_email_variant("maintenance_tech", "activation", "B")

        assert result["subject"] == "Test subject line"
        assert result["variant"] == "B"
        mock_gen.assert_called_once_with("drip-email", "maintenance_tech", "activation")


class TestGenerateVideoScript:
    """Tests for generate_weekly_video_script task."""

    @patch("mira_copy.generate.generate")
    @patch("tasks.content._insert_content_item", return_value=47)
    def test_generates_script_package(self, mock_insert, mock_gen):
        from tasks.content import generate_weekly_video_script

        mock_result = MagicMock()
        mock_result.raw_json = {
            "title_options": [
                "GS20 Overcurrent - Can AI Fix It?",
                "VFD Fault: AI vs The Manual",
                "10 Seconds vs 40 Minutes",
            ],
            "total_duration_estimate": "11:30",
        }
        mock_result.rendered_md = "script content"
        mock_result.usage = {"input_tokens": 700, "output_tokens": 1200}
        mock_gen.return_value = mock_result

        result = generate_weekly_video_script("maintenance_tech", "gs20-overcurrent-fault")

        assert len(result["title_options"]) == 3
        assert result["duration_estimate"] == "11:30"
        assert result["topic"] == "gs20-overcurrent-fault"


class TestTopicBank:
    """Tests for content configuration."""

    def test_topic_bank_not_empty(self):
        from tasks.content import TOPIC_BANK
        assert len(TOPIC_BANK) >= 10

    def test_topic_bank_no_duplicates(self):
        from tasks.content import TOPIC_BANK
        assert len(TOPIC_BANK) == len(set(TOPIC_BANK))

    def test_social_themes_valid(self):
        from tasks.content import SOCIAL_THEMES
        assert len(SOCIAL_THEMES) >= 4
        assert "fault-code-tip" in SOCIAL_THEMES
        assert "ai-vs-manual" in SOCIAL_THEMES

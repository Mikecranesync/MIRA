"""Tests for YouTube analyzer provider."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

from mira_seo.providers.youtube_analyzer import (
    analyze_transcript,
    find_similar_videos,
    get_transcript,
    youtube_autocomplete,
)


class TestGetTranscript:
    """Test get_transcript function."""

    def test_extract_video_id_youtu_be_format(self):
        """Extract video ID from youtu.be short URL."""
        with patch("mira_seo.providers.youtube_analyzer.YouTubeTranscriptApi") as mock_api:
            mock_api.get_transcript.return_value = [
                {"text": "Hello", "start": 0.0, "duration": 1.0},
                {"text": "World", "start": 1.0, "duration": 1.0},
            ]

            result = get_transcript("https://youtu.be/dQw4w9WgXcQ")

            # YouTubeTranscriptApi should be called with correct video ID
            mock_api.get_transcript.assert_called_once_with("dQw4w9WgXcQ")
            assert "Hello" in result
            assert "World" in result

    def test_extract_video_id_youtube_com_format(self):
        """Extract video ID from youtube.com watch URL."""
        with patch("mira_seo.providers.youtube_analyzer.YouTubeTranscriptApi") as mock_api:
            mock_api.get_transcript.return_value = [
                {"text": "Test", "start": 0.0, "duration": 1.0},
            ]

            result = get_transcript("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

            mock_api.get_transcript.assert_called_once_with("dQw4w9WgXcQ")
            assert "Test" in result

    def test_extract_video_id_with_timestamp(self):
        """Extract video ID from URL with timestamp parameter."""
        with patch("mira_seo.providers.youtube_analyzer.YouTubeTranscriptApi") as mock_api:
            mock_api.get_transcript.return_value = [
                {"text": "Content", "start": 0.0, "duration": 1.0},
            ]

            result = get_transcript("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30")

            mock_api.get_transcript.assert_called_once_with("dQw4w9WgXcQ")
            assert "Content" in result

    def test_invalid_url_returns_empty_string(self):
        """Return empty string for invalid URL."""
        result = get_transcript("https://example.com/not-a-video")
        assert result == ""

    def test_transcript_disabled_returns_empty_string(self):
        """Return empty string when transcript is disabled."""
        with patch("mira_seo.providers.youtube_analyzer.YouTubeTranscriptApi") as mock_api:
            mock_api.get_transcript.side_effect = TranscriptsDisabled("dQw4w9WgXcQ")

            result = get_transcript("https://youtu.be/dQw4w9WgXcQ")

            assert result == ""

    def test_no_transcript_found_returns_empty_string(self):
        """Return empty string when no transcript is available."""
        with patch("mira_seo.providers.youtube_analyzer.YouTubeTranscriptApi") as mock_api:
            # NoTranscriptFound requires video_id, requested_language_codes, transcript_data
            mock_api.get_transcript.side_effect = NoTranscriptFound(
                video_id="dQw4w9WgXcQ",
                requested_language_codes=["en"],
                transcript_data=[]
            )

            result = get_transcript("https://youtu.be/dQw4w9WgXcQ")

            assert result == ""

    def test_generic_error_returns_empty_string(self):
        """Return empty string on any other error."""
        with patch("mira_seo.providers.youtube_analyzer.YouTubeTranscriptApi") as mock_api:
            mock_api.get_transcript.side_effect = Exception("Network error")

            result = get_transcript("https://youtu.be/dQw4w9WgXcQ")

            assert result == ""


class TestFindSimilarVideos:
    """Test find_similar_videos function."""

    @pytest.mark.asyncio
    async def test_no_api_key_returns_empty_list(self):
        """Return empty list when YOUTUBE_API_KEY is not set."""
        with patch.dict("os.environ", {"YOUTUBE_API_KEY": ""}):
            # Re-import to pick up the new env var
            from importlib import reload

            import mira_seo.providers.youtube_analyzer as yt_module

            reload(yt_module)
            result = await yt_module.find_similar_videos("test query")

            assert result == []

    @pytest.mark.asyncio
    async def test_successful_search_returns_video_list(self):
        """Successfully search and return video list with view counts."""
        with patch("mira_seo.providers.youtube_analyzer.YOUTUBE_API_KEY", "fake-key"):
            with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
                # Mock search response
                search_response = MagicMock()
                search_response.json.return_value = {
                    "items": [
                        {
                            "id": {"videoId": "vid1"},
                            "snippet": {
                                "title": "Video 1",
                                "description": "Description 1",
                                "channelTitle": "Channel 1",
                            },
                        },
                        {
                            "id": {"videoId": "vid2"},
                            "snippet": {
                                "title": "Video 2",
                                "description": "Description 2",
                                "channelTitle": "Channel 2",
                            },
                        },
                    ]
                }

                # Mock statistics response
                stats_response = MagicMock()
                stats_response.json.return_value = {
                    "items": [
                        {"id": "vid1", "statistics": {"viewCount": "1000"}},
                        {"id": "vid2", "statistics": {"viewCount": "2000"}},
                    ]
                }

                mock_ctx = AsyncMock()
                mock_ctx.__aenter__.return_value.get = AsyncMock(
                    side_effect=[search_response, stats_response]
                )
                mock_ctx.__aexit__.return_value = None
                mock_client.return_value = mock_ctx

                result = await find_similar_videos("test query", max_results=2)

                assert len(result) == 2
                assert result[0]["title"] == "Video 1"
                assert result[0]["url"] == "https://www.youtube.com/watch?v=vid1"
                assert result[0]["view_count"] == 1000
                assert result[1]["view_count"] == 2000


class TestAnalyzeTranscript:
    """Test analyze_transcript function."""

    @pytest.mark.asyncio
    async def test_empty_transcript_returns_empty_dict(self):
        """Return empty placeholder dict for empty transcript."""
        result = await analyze_transcript("")

        assert result == {
            "main_topics": [],
            "keywords": [],
            "content_format": "unknown",
            "key_questions": [],
        }

    @pytest.mark.asyncio
    async def test_successful_analysis_returns_parsed_json(self):
        """Successfully analyze transcript and parse response."""
        with patch("mira_seo.providers.youtube_analyzer.MIRA_PIPELINE_URL", "http://test:9099"):
            with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
                response_data = {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps({
                                    "main_topics": ["Topic 1", "Topic 2"],
                                    "keywords": ["keyword1", "keyword2"],
                                    "content_format": "tutorial",
                                    "key_questions": ["Q1?", "Q2?"],
                                })
                            }
                        }
                    ]
                }

                mock_response = MagicMock()
                mock_response.json.return_value = response_data

                mock_ctx = AsyncMock()
                mock_ctx.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__.return_value = None
                mock_client.return_value = mock_ctx

                result = await analyze_transcript("Sample transcript")

                assert result["main_topics"] == ["Topic 1", "Topic 2"]
                assert result["keywords"] == ["keyword1", "keyword2"]
                assert result["content_format"] == "tutorial"
                assert result["key_questions"] == ["Q1?", "Q2?"]

    @pytest.mark.asyncio
    async def test_json_in_markdown_code_blocks(self):
        """Parse JSON when wrapped in markdown code blocks."""
        with patch("mira_seo.providers.youtube_analyzer.MIRA_PIPELINE_URL", "http://test:9099"):
            with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
                response_data = {
                    "choices": [
                        {
                            "message": {
                                "content": "```json\n" + json.dumps({
                                    "main_topics": ["Topic"],
                                    "keywords": ["kw"],
                                    "content_format": "review",
                                    "key_questions": [],
                                }) + "\n```"
                            }
                        }
                    ]
                }

                mock_response = MagicMock()
                mock_response.json.return_value = response_data

                mock_ctx = AsyncMock()
                mock_ctx.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__.return_value = None
                mock_client.return_value = mock_ctx

                result = await analyze_transcript("Sample transcript")

                assert result["content_format"] == "review"
                assert result["main_topics"] == ["Topic"]

    @pytest.mark.asyncio
    async def test_invalid_json_returns_empty_dict(self):
        """Return empty dict when response contains invalid JSON."""
        with patch("mira_seo.providers.youtube_analyzer.MIRA_PIPELINE_URL", "http://test:9099"):
            with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
                response_data = {
                    "choices": [
                        {
                            "message": {
                                "content": "This is not valid JSON"
                            }
                        }
                    ]
                }

                mock_response = MagicMock()
                mock_response.json.return_value = response_data

                mock_ctx = AsyncMock()
                mock_ctx.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__.return_value = None
                mock_client.return_value = mock_ctx

                result = await analyze_transcript("Sample transcript")

                assert result == {
                    "main_topics": [],
                    "keywords": [],
                    "content_format": "unknown",
                    "key_questions": [],
                }


class TestYoutubeAutocomplete:
    """Test youtube_autocomplete function."""

    @pytest.mark.asyncio
    async def test_empty_keyword_returns_empty_list(self):
        """Return empty list for empty keyword."""
        result = await youtube_autocomplete("")
        assert result == []

    @pytest.mark.asyncio
    async def test_successful_autocomplete_returns_suggestions(self):
        """Successfully fetch and parse autocomplete suggestions."""
        with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
            jsonp_response = 'window.google.ac.h(["test",["test video","test audio","testing","test drive"]])'

            mock_response = MagicMock()
            mock_response.text = jsonp_response

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
            mock_ctx.__aexit__.return_value = None
            mock_client.return_value = mock_ctx

            result = await youtube_autocomplete("test")

            assert len(result) == 4
            assert "test video" in result
            assert "test audio" in result

    @pytest.mark.asyncio
    async def test_limits_to_10_suggestions(self):
        """Limit results to 10 suggestions."""
        with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
            suggestions = [f"suggestion {i}" for i in range(15)]
            jsonp_response = f'window.google.ac.h(["test",{json.dumps(suggestions)}])'

            mock_response = MagicMock()
            mock_response.text = jsonp_response

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
            mock_ctx.__aexit__.return_value = None
            mock_client.return_value = mock_ctx

            result = await youtube_autocomplete("test")

            assert len(result) == 10

    @pytest.mark.asyncio
    async def test_http_error_returns_empty_list(self):
        """Return empty list on HTTP error."""
        with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
            mock_ctx = AsyncMock()
            mock_ctx.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("Connection error")
            )
            mock_ctx.__aexit__.return_value = None
            mock_client.return_value = mock_ctx

            result = await youtube_autocomplete("test")

            assert result == []

    @pytest.mark.asyncio
    async def test_invalid_jsonp_format_returns_empty_list(self):
        """Return empty list when JSONP format is invalid."""
        with patch("mira_seo.providers.youtube_analyzer.httpx.AsyncClient") as mock_client:
            mock_response = MagicMock()
            mock_response.text = "invalid response"

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
            mock_ctx.__aexit__.return_value = None
            mock_client.return_value = mock_ctx

            result = await youtube_autocomplete("test")

            assert result == []

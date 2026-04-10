"""Tests for tasks/reddit.py — Reddit forum scraper.

All tests run offline — no network calls, no Redis, no Celery broker required.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Sample fixtures
# ---------------------------------------------------------------------------

_SAMPLE_LISTING = {
    "data": {
        "children": [
            {
                "data": {
                    "id": "abc123",
                    "title": "VFD tripping on overcurrent fault",
                    "selftext": "My GS20 drive keeps faulting with E01. I checked the motor...",
                    "subreddit": "PLC",
                    "permalink": "/r/PLC/comments/abc123/vfd_tripping_on_overcurrent/",
                }
            },
            {
                "data": {
                    "id": "def456",
                    "title": "Best practices for PLC programming",
                    "selftext": "Looking for resources on structured text best practices.",
                    "subreddit": "PLC",
                    "permalink": "/r/PLC/comments/def456/best_practices_plc/",
                }
            },
            {
                "data": {
                    "id": "ghi789",
                    "title": "Post with no selftext",
                    "selftext": "",
                    "subreddit": "IndustrialMaintenance",
                    "permalink": "/r/IndustrialMaintenance/comments/ghi789/post_no_selftext/",
                }
            },
            {
                "data": {
                    "id": "del001",
                    "title": "Deleted post",
                    "selftext": "[deleted]",
                    "subreddit": "electricians",
                    "permalink": "/r/electricians/comments/del001/deleted/",
                }
            },
            {
                # Malformed — missing required fields
                "data": {}
            },
        ]
    }
}

_EMPTY_LISTING = {"data": {"children": []}}

_MALFORMED_RESPONSE = {"unexpected": "structure"}


# ---------------------------------------------------------------------------
# 1. Parse Reddit JSON response
# ---------------------------------------------------------------------------


class TestParseRedditJson:

    def test_parse_basic_listing(self):
        """Extracts title, post_id, subreddit, and permalink from a listing."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_SAMPLE_LISTING)

        # Malformed child (empty data) is skipped; deleted selftext is normalised
        assert len(posts) == 4

    def test_post_fields_present(self):
        """Each post record has required fields."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_SAMPLE_LISTING)

        for post in posts:
            assert "post_id" in post
            assert "title" in post
            assert "selftext" in post
            assert "subreddit" in post
            assert "permalink" in post

    def test_first_post_values(self):
        """First post has correct title, ID, and permalink."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_SAMPLE_LISTING)
        first = posts[0]

        assert first["post_id"] == "abc123"
        assert first["title"] == "VFD tripping on overcurrent fault"
        assert "GS20" in first["selftext"]
        assert first["permalink"] == "https://www.reddit.com/r/PLC/comments/abc123/vfd_tripping_on_overcurrent/"

    def test_deleted_selftext_normalised(self):
        """[deleted] selftext is converted to empty string."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_SAMPLE_LISTING)
        deleted = next(p for p in posts if p["post_id"] == "del001")

        assert deleted["selftext"] == ""

    def test_empty_listing_returns_empty(self):
        """Empty children list returns empty list of posts."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_EMPTY_LISTING)
        assert posts == []

    def test_malformed_response_returns_empty(self):
        """Unexpected JSON structure returns empty list without raising."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_MALFORMED_RESPONSE)
        assert isinstance(posts, list)

    def test_missing_title_post_skipped(self):
        """Posts with no title are silently skipped."""
        from tasks.reddit import _parse_reddit_response

        data = {
            "data": {
                "children": [
                    {"data": {"id": "notitle", "selftext": "some text", "subreddit": "PLC",
                               "permalink": "/r/PLC/comments/notitle/"}},
                ]
            }
        }
        posts = _parse_reddit_response(data)
        assert len(posts) == 0

    def test_permalink_is_absolute(self):
        """Permalink is always an absolute https://www.reddit.com URL."""
        from tasks.reddit import _parse_reddit_response

        posts = _parse_reddit_response(_SAMPLE_LISTING)
        for post in posts:
            assert post["permalink"].startswith("https://www.reddit.com")


# ---------------------------------------------------------------------------
# 2. Build post text
# ---------------------------------------------------------------------------


class TestBuildPostText:

    def test_combines_title_selftext_comments(self):
        """Combined text includes title, selftext, and numbered comments."""
        from tasks.reddit import _build_post_text

        post = {
            "title": "VFD overcurrent",
            "selftext": "Motor keeps tripping.",
        }
        comments = ["Check the motor load.", "Verify acceleration ramp."]

        text = _build_post_text(post, comments)

        assert "VFD overcurrent" in text
        assert "Motor keeps tripping." in text
        assert "1. Check the motor load." in text
        assert "2. Verify acceleration ramp." in text

    def test_no_selftext_no_comments(self):
        """When selftext and comments are both empty, only title is in output."""
        from tasks.reddit import _build_post_text

        post = {"title": "Just a title", "selftext": ""}
        text = _build_post_text(post, [])

        assert "Just a title" in text
        assert "Top Comments" not in text

    def test_no_comments_section_omitted(self):
        """'Top Comments:' header is omitted when comments list is empty."""
        from tasks.reddit import _build_post_text

        post = {"title": "Test", "selftext": "Some content."}
        text = _build_post_text(post, [])

        assert "Top Comments" not in text


# ---------------------------------------------------------------------------
# 3. Subreddits configuration
# ---------------------------------------------------------------------------


class TestSubredditsConfigured:

    def test_at_least_three_subreddits(self):
        """At least 3 subreddits must be configured."""
        from tasks.reddit import SUBREDDITS

        assert len(SUBREDDITS) >= 3

    def test_expected_subreddits_present(self):
        """PLC, IndustrialMaintenance, and electricians must be in the list."""
        from tasks.reddit import SUBREDDITS

        assert "PLC" in SUBREDDITS
        assert "IndustrialMaintenance" in SUBREDDITS
        assert "electricians" in SUBREDDITS

    def test_no_duplicate_subreddits(self):
        """Subreddit names must be unique."""
        from tasks.reddit import SUBREDDITS

        assert len(SUBREDDITS) == len(set(SUBREDDITS))

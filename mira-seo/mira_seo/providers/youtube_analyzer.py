"""YouTube content analyzer — transcripts, search, SEO analysis."""

from __future__ import annotations

import json
import logging
import os
import re

import httpx
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

logger = logging.getLogger("mira-seo.youtube")

MIRA_PIPELINE_URL = os.getenv("MIRA_PIPELINE_URL", "http://mira-pipeline:9099")
MIRA_DEFAULT_MODEL = os.getenv("MIRA_DEFAULT_MODEL", "llama-3.1-8b-instant")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")


def get_transcript(video_url: str) -> str:
    """Extract video ID from URL and fetch transcript.

    Supports:
    - https://youtu.be/VIDEO_ID
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://www.youtube.com/watch?v=VIDEO_ID&t=123 (timestamps)

    Returns:
        Full transcript as a single string (space-separated segments).
        On error (TranscriptsDisabled, NoTranscriptFound, etc): returns "" and logs warning.
    """
    # Extract video ID
    video_id = None

    # Try youtu.be format
    match = re.search(r"youtu\.be/([a-zA-Z0-9_-]{11})", video_url)
    if match:
        video_id = match.group(1)

    # Try youtube.com format
    if not video_id:
        match = re.search(r"v=([a-zA-Z0-9_-]{11})", video_url)
        if match:
            video_id = match.group(1)

    if not video_id:
        logger.warning(f"Could not extract video ID from URL: {video_url}")
        return ""

    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        # Join all text segments with spaces
        transcript_text = " ".join(item["text"] for item in transcript_list)
        return transcript_text
    except (NoTranscriptFound, TranscriptsDisabled, VideoUnavailable) as e:
        logger.warning(f"Transcript unavailable for {video_id}: {e}")
        return ""
    except Exception as e:
        logger.warning(f"Error fetching transcript for {video_id}: {e}")
        return ""


async def find_similar_videos(query: str, max_results: int = 4) -> list[dict]:
    """Search YouTube for similar videos using YouTube Data API v3.

    Returns:
        List of dicts with keys: title, url, description, view_count, channel_title
        Returns [] if YOUTUBE_API_KEY is not set or API call fails.
    """
    if not YOUTUBE_API_KEY:
        logger.warning("YOUTUBE_API_KEY not set — YouTube search unavailable")
        return []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Search for videos
            search_url = "https://www.googleapis.com/youtube/v3/search"
            search_params = {
                "part": "snippet",
                "q": query,
                "maxResults": max_results,
                "type": "video",
                "key": YOUTUBE_API_KEY,
            }

            search_resp = await client.get(search_url, params=search_params)
            search_resp.raise_for_status()
            search_data = search_resp.json()

            results = []
            video_ids = []

            # Extract video IDs from search results
            for item in search_data.get("items", []):
                video_id = item.get("id", {}).get("videoId")
                if video_id:
                    video_ids.append(video_id)
                    # Temporarily store snippet for later merge
                    results.append(
                        {
                            "videoId": video_id,
                            "title": item.get("snippet", {}).get("title", ""),
                            "description": item.get("snippet", {}).get("description", ""),
                            "channel_title": item.get("snippet", {}).get("channelTitle", ""),
                        }
                    )

            # Fetch statistics (view count) for each video
            if video_ids:
                stats_url = "https://www.googleapis.com/youtube/v3/videos"
                stats_params = {
                    "part": "statistics",
                    "id": ",".join(video_ids),
                    "key": YOUTUBE_API_KEY,
                }

                stats_resp = await client.get(stats_url, params=stats_params)
                stats_resp.raise_for_status()
                stats_data = stats_resp.json()

                # Create a map of video ID -> statistics
                stats_map = {}
                for item in stats_data.get("items", []):
                    vid_id = item.get("id")
                    view_count = item.get("statistics", {}).get("viewCount", "0")
                    stats_map[vid_id] = int(view_count)

                # Merge statistics into results
                for result in results:
                    vid_id = result["videoId"]
                    result["view_count"] = stats_map.get(vid_id, 0)
                    result["url"] = f"https://www.youtube.com/watch?v={vid_id}"
                    # Remove temporary videoId field
                    del result["videoId"]

            return results

    except httpx.HTTPStatusError as e:
        logger.warning(f"YouTube API error: {e.response.status_code} {e}")
        return []
    except Exception as e:
        logger.warning(f"Error searching YouTube: {e}")
        return []


async def analyze_transcript(transcript: str) -> dict:
    """Send transcript to mira-pipeline cascade for SEO analysis.

    Uses the OpenAI-compatible endpoint at MIRA_PIPELINE_URL/v1/chat/completions.

    Returns:
        Dict with keys: main_topics, keywords, content_format, key_questions
        If parse fails or API call fails, returns empty dict with placeholder values.
    """
    if not transcript:
        logger.warning("Empty transcript provided to analyze_transcript")
        return {
            "main_topics": [],
            "keywords": [],
            "content_format": "unknown",
            "key_questions": [],
        }

    system_prompt = (
        "You are an SEO analyst. Extract structured data from this YouTube video transcript."
    )
    user_prompt = (
        f"Transcript:\n{transcript[:8000]}\n\n"
        "Extract:\n"
        "1. main_topics (list of 5-10 topics)\n"
        "2. keywords (list of 15-20 SEO keywords mentioned)\n"
        "3. content_format (e.g. 'tutorial', 'review', 'explainer')\n"
        "4. key_questions (list of questions the video answers)\n\n"
        "Return as JSON only, no markdown."
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            payload = {
                "model": MIRA_DEFAULT_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            }

            resp = await client.post(
                f"{MIRA_PIPELINE_URL}/v1/chat/completions",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            # Extract content from OpenAI-compatible response
            message_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not message_content:
                logger.warning("Empty response from mira-pipeline")
                return {
                    "main_topics": [],
                    "keywords": [],
                    "content_format": "unknown",
                    "key_questions": [],
                }

            # Parse JSON from response
            # Try to extract JSON if it's wrapped in markdown code blocks
            json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", message_content)
            if json_match:
                message_content = json_match.group(1)

            parsed = json.loads(message_content)

            # Ensure required keys exist
            return {
                "main_topics": parsed.get("main_topics", []),
                "keywords": parsed.get("keywords", []),
                "content_format": parsed.get("content_format", "unknown"),
                "key_questions": parsed.get("key_questions", []),
            }

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse JSON from mira-pipeline response: {e}")
        return {
            "main_topics": [],
            "keywords": [],
            "content_format": "unknown",
            "key_questions": [],
        }
    except httpx.HTTPError as e:
        logger.warning(f"HTTP error calling mira-pipeline: {e}")
        return {
            "main_topics": [],
            "keywords": [],
            "content_format": "unknown",
            "key_questions": [],
        }
    except Exception as e:
        logger.warning(f"Error analyzing transcript: {e}")
        return {
            "main_topics": [],
            "keywords": [],
            "content_format": "unknown",
            "key_questions": [],
        }


async def youtube_autocomplete(seed_keyword: str) -> list[str]:
    """Scrape YouTube search suggestions using Google's autocomplete API.

    The API returns JSONP format:
    window.google.ac.h(["keyword", [...suggestions...]])

    Returns:
        List of up to 10 suggestion strings.
        Returns [] on error.
    """
    if not seed_keyword:
        return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = "https://suggestqueries.google.com/complete/search"
            params = {
                "client": "youtube",
                "ds": "yt",
                "q": seed_keyword,
            }

            resp = await client.get(url, params=params)
            resp.raise_for_status()

            # Response is JSONP: window.google.ac.h([...])
            text = resp.text

            # Extract JSON array from JSONP wrapper
            # Pattern: window.google.ac.h([...])
            match = re.search(r"window\.google\.ac\.h\((.*)\)", text)
            if not match:
                logger.warning(f"Could not parse autocomplete response for '{seed_keyword}'")
                return []

            json_str = match.group(1)
            data = json.loads(json_str)

            # data is [keyword, [suggestions...], ...]
            # We want the second element (list of suggestions)
            if isinstance(data, list) and len(data) >= 2:
                suggestions = data[1]
                if isinstance(suggestions, list):
                    return suggestions[:10]

            return []

    except httpx.HTTPError as e:
        logger.warning(f"HTTP error fetching YouTube autocomplete: {e}")
        return []
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse error in YouTube autocomplete: {e}")
        return []
    except Exception as e:
        logger.warning(f"Error fetching YouTube autocomplete: {e}")
        return []

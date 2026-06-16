"""Fetch the full transcript from any YouTube video URL or ID.

Usage:
    uv run --with youtube-transcript-api python tools/youtube_transcript.py <url_or_id> [lang]

Examples:
    uv run --with youtube-transcript-api python tools/youtube_transcript.py https://youtu.be/ddFgXoNa9_0
    uv run --with youtube-transcript-api python tools/youtube_transcript.py dQw4w9WgXcQ
    uv run --with youtube-transcript-api python tools/youtube_transcript.py https://www.youtube.com/watch?v=dQw4w9WgXcQ es
"""

from __future__ import annotations

import re
import sys


def extract_video_id(url_or_id: str) -> str:
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)([A-Za-z0-9_-]{11})",
        r"^([A-Za-z0-9_-]{11})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    raise ValueError(f"Cannot extract video ID from: {url_or_id}")


def fetch_transcript(video_id: str, lang: str = "en") -> None:
    from youtube_transcript_api import NoTranscriptFound, TranscriptsDisabled, YouTubeTranscriptApi

    api = YouTubeTranscriptApi()

    try:
        result = api.fetch(video_id, languages=[lang])
    except TranscriptsDisabled:
        print(f"Error: Transcripts are disabled for video {video_id}", file=sys.stderr)
        sys.exit(1)
    except NoTranscriptFound:
        # Fall back to any available language
        try:
            transcript_list = api.list(video_id)
            available = list(transcript_list)
            if not available:
                print(f"Error: No transcripts available for video {video_id}", file=sys.stderr)
                sys.exit(1)
            first = available[0]
            result = api.fetch(video_id, languages=[first.language_code])
        except Exception as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)
    except Exception as exc:
        print(f"Error fetching transcript: {exc}", file=sys.stderr)
        sys.exit(1)

    full_text = " ".join(s.text.replace("\n", " ") for s in result.snippets)
    source = "auto-generated" if result.is_generated else "manual"

    print(f"Video ID : {video_id}")
    print(f"Language : {result.language_code} ({source})")
    print(f"Segments : {len(result.snippets)}")
    print()
    print("--- TRANSCRIPT ---")
    print()
    print(full_text)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    url_or_id = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "en"

    try:
        video_id = extract_video_id(url_or_id)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    fetch_transcript(video_id, lang)


if __name__ == "__main__":
    main()

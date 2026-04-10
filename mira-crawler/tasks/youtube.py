"""YouTube task — fetch transcripts and metadata from YouTube videos for KB ingest.

Downloads subtitles (VTT) via yt-dlp, parses timestamps, detects visual diagnostic
cues, extracts frames at those moments, chunks transcript text, and stores in the KB.

Visual cue frames are saved to ~/ingest_staging/youtube_frames/ for use as synthetic
test cases (equipment displays, fault codes captured on-camera).

Scheduled weekly via Trigger.dev Cloud. Safe to re-run — dedup via Redis set
mira:youtube:seen_videos prevents duplicate ingest.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse, urlunparse

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.youtube")

# ---------------------------------------------------------------------------
# Channel list
# ---------------------------------------------------------------------------

YOUTUBE_CHANNELS = [
    "https://youtube.com/@FlukeTestTools",
    "https://youtube.com/@ABBgroupnews",
    "https://youtube.com/@RSAutomation",
    "https://youtube.com/@KleinTools",
    "https://youtube.com/@realPars",
    "https://youtube.com/@TheEngineeringMindset",
    "https://youtube.com/@SkillcatApp",
    "https://youtube.com/@electricianU",
]

# Keywords that indicate the presenter is pointing to something visible on screen
VISUAL_CUE_KEYWORDS = [
    "look at",
    "you can see",
    "notice",
    "as shown",
    "right here",
    "this is what",
    "see how",
    "pointing to",
    "the display shows",
    "the meter reads",
    "fault code",
    "error on screen",
    "nameplate",
    "let me show",
    "zoom in",
    "close up",
]

# Number of subtitle segments to merge into one text block
_SEGMENTS_PER_BLOCK = 5

# Frame output directory
_FRAMES_DIR = Path.home() / "ingest_staging" / "youtube_frames"

# Redis dedup key
_SEEN_KEY = "mira:youtube:seen_videos"

# Timestamp pattern: HH:MM:SS.mmm or MM:SS.mmm
_TS_RE = re.compile(
    r"^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})\s*-->\s*"
    r"(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})"
)

# VTT cue identifier line (sequence numbers like "1", "2", etc.)
_CUE_ID_RE = re.compile(r"^\d+\s*$")

# Tags inside VTT cue text (e.g. <00:00:05.000><c>text</c>)
_VTT_TAG_RE = re.compile(r"<[^>]+>")


# ---------------------------------------------------------------------------
# Pure functions (no network, fully testable)
# ---------------------------------------------------------------------------


def _ts_to_seconds(h: str | None, m: str, s: str, ms: str) -> float:
    """Convert parsed timestamp components to fractional seconds."""
    hours = int(h) if h else 0
    return hours * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def _parse_vtt(content: str) -> list[dict]:
    """Parse a WebVTT subtitle file into a list of timed segments.

    Each returned dict has:
        start_seconds (float): cue start time
        end_seconds   (float): cue end time
        text          (str):   plain cue text with VTT tags stripped

    Handles:
    - WEBVTT header line
    - Optional cue identifiers (bare integers)
    - Timestamp lines (HH:MM:SS.mmm --> HH:MM:SS.mmm)
    - Multi-line cue text
    - NOTE/STYLE/REGION blocks (skipped)
    - Empty lines (block separators)
    """
    if not content:
        return []

    segments: list[dict] = []
    lines = content.splitlines()

    i = 0
    # Skip WEBVTT header
    while i < len(lines) and not lines[i].startswith("WEBVTT"):
        i += 1
    i += 1  # consume WEBVTT line

    while i < len(lines):
        line = lines[i].strip()

        # Empty separator — skip
        if not line:
            i += 1
            continue

        # NOTE / STYLE / REGION blocks — skip until blank line
        if line.startswith(("NOTE", "STYLE", "REGION")):
            i += 1
            while i < len(lines) and lines[i].strip():
                i += 1
            continue

        # Numeric cue identifier — skip
        if _CUE_ID_RE.match(line):
            i += 1
            continue

        # Timestamp line
        ts_match = _TS_RE.match(line)
        if ts_match:
            (h1, m1, s1, ms1, h2, m2, s2, ms2) = ts_match.groups()
            start = _ts_to_seconds(h1, m1, s1, ms1)
            end = _ts_to_seconds(h2, m2, s2, ms2)
            i += 1

            # Collect cue text lines until blank line or next cue
            text_lines: list[str] = []
            while i < len(lines):
                text_line = lines[i].strip()
                if not text_line:
                    break
                # Stop if next line looks like a timestamp (new cue)
                if _TS_RE.match(text_line):
                    break
                # Stop on cue identifiers that precede a timestamp
                if _CUE_ID_RE.match(text_line) and i + 1 < len(lines) and _TS_RE.match(
                    lines[i + 1].strip()
                ):
                    break
                text_lines.append(text_line)
                i += 1

            raw_text = " ".join(text_lines)
            # Strip VTT inline tags
            clean_text = _VTT_TAG_RE.sub("", raw_text).strip()
            if clean_text:
                segments.append(
                    {"start_seconds": start, "end_seconds": end, "text": clean_text}
                )
            continue

        i += 1

    return segments


def _detect_visual_cues(segments: list[dict]) -> list[dict]:
    """Return segments that contain visual diagnostic cue keywords.

    Matched segments are returned with an added `cue_keyword` field containing
    the first keyword matched. Case-insensitive scan.
    """
    results: list[dict] = []
    for seg in segments:
        text_lower = seg["text"].lower()
        for kw in VISUAL_CUE_KEYWORDS:
            if kw in text_lower:
                results.append({**seg, "cue_keyword": kw})
                break  # only tag first match per segment
    return results


def _segments_to_text_blocks(segments: list[dict], video_url: str) -> list[dict]:
    """Merge every _SEGMENTS_PER_BLOCK segments into one text block.

    Output keys match what chunk_blocks() expects:
        text       (str): merged transcript text
        page_num   (int | None): None for transcript blocks
        section    (str): timestamp range for the merged block
        source_url (str): video URL
    """
    blocks: list[dict] = []
    for i in range(0, len(segments), _SEGMENTS_PER_BLOCK):
        group = segments[i : i + _SEGMENTS_PER_BLOCK]
        merged_text = " ".join(s["text"] for s in group)
        start_ts = group[0]["start_seconds"]
        end_ts = group[-1]["end_seconds"]
        section = f"{start_ts:.1f}s–{end_ts:.1f}s"
        blocks.append(
            {
                "text": merged_text,
                "page_num": None,
                "section": section,
                "source_url": video_url,
            }
        )
    return blocks


# ---------------------------------------------------------------------------
# Frame extraction (best-effort, failures are logged and skipped)
# ---------------------------------------------------------------------------


def _extract_frame(video_url: str, timestamp: float, output_path: Path) -> bool:
    """Extract a single frame from a YouTube video using yt-dlp + ffmpeg.

    Downloads the direct stream URL via yt-dlp then seeks to timestamp with
    ffmpeg. Best-effort — returns False on any failure.

    Args:
        video_url: Full YouTube watch URL.
        timestamp: Seconds from start.
        output_path: Where to write the JPEG frame.

    Returns:
        True if frame was written, False otherwise.
    """
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Get direct stream URL (video only, best quality ≤720p)
        yt_result = subprocess.run(
            [
                "yt-dlp",
                "--format", "bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]/best[height<=720]",
                "--get-url",
                "--no-playlist",
                video_url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if yt_result.returncode != 0:
            logger.warning(
                "yt-dlp get-url failed for %s: %s", video_url, yt_result.stderr[:200]
            )
            return False

        stream_url = yt_result.stdout.strip().splitlines()[0]
        if not stream_url:
            logger.warning("Empty stream URL for %s", video_url)
            return False

        # Extract frame with ffmpeg
        ffmpeg_result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss", str(timestamp),
                "-i", stream_url,
                "-frames:v", "1",
                "-q:v", "2",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if ffmpeg_result.returncode != 0:
            logger.warning(
                "ffmpeg frame extract failed for %s@%ss: %s",
                video_url,
                timestamp,
                ffmpeg_result.stderr[-200:],
            )
            return False

        if output_path.exists() and output_path.stat().st_size > 0:
            logger.info("Frame saved: %s", output_path)
            return True

        logger.warning("Frame file missing or empty after ffmpeg: %s", output_path)
        return False

    except FileNotFoundError as e:
        logger.warning("Tool not found (yt-dlp or ffmpeg): %s", e)
        return False
    except subprocess.TimeoutExpired:
        logger.warning("Frame extraction timed out for %s@%ss", video_url, timestamp)
        return False
    except Exception as e:
        logger.error("Unexpected frame extraction error for %s: %s", video_url, e)
        return False


# ---------------------------------------------------------------------------
# yt-dlp helpers
# ---------------------------------------------------------------------------


def _list_channel_videos(channel_url: str, max_videos: int = 50) -> list[dict]:
    """Return recent video metadata dicts from a YouTube channel via yt-dlp.

    Each dict has: id, title, url, upload_date.
    Returns empty list on failure.
    """
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--flat-playlist",
                "--playlist-end", str(max_videos),
                "--print", '{"id":"%(id)s","title":"%(title)s","url":"%(webpage_url)s",'
                           '"upload_date":"%(upload_date)s"}',
                "--no-warnings",
                channel_url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning("yt-dlp list failed for %s: %s", channel_url, result.stderr[:200])
            return []

        videos: list[dict] = []
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                videos.append(json.loads(line))
            except json.JSONDecodeError:
                logger.debug("Non-JSON line from yt-dlp: %s", line[:100])
        return videos

    except FileNotFoundError:
        logger.warning("yt-dlp not found — skipping channel listing for %s", channel_url)
        return []
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timed out listing channel: %s", channel_url)
        return []
    except Exception as e:
        logger.error("Error listing channel %s: %s", channel_url, e)
        return []


def _download_vtt(video_url: str, outdir: Path) -> Path | None:
    """Download auto-generated English subtitles as VTT to outdir.

    Returns path to the .vtt file, or None if download failed or no subtitles.
    """
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--write-auto-sub",
                "--sub-lang", "en",
                "--sub-format", "vtt",
                "--skip-download",
                "--no-playlist",
                "--output", str(outdir / "%(id)s.%(ext)s"),
                video_url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning(
                "VTT download failed for %s: %s", video_url, result.stderr[:200]
            )
            return None

        # Find the .vtt file yt-dlp wrote
        vtt_files = list(outdir.glob("*.vtt"))
        if not vtt_files:
            logger.debug("No VTT file produced for %s (no auto-captions?)", video_url)
            return None
        return vtt_files[0]

    except FileNotFoundError:
        logger.warning("yt-dlp not found — subtitle download skipped")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("VTT download timed out for %s", video_url)
        return None
    except Exception as e:
        logger.error("Error downloading VTT for %s: %s", video_url, e)
        return None


# ---------------------------------------------------------------------------
# Redis URL helpers
# ---------------------------------------------------------------------------


def _redis_url_from_broker(broker_url: str) -> str:
    """Extract a Redis connection URL from a Celery broker URL.

    Normalises the database path to '/0' using urlparse so that hostnames
    like 'redis-db0' or high-numbered paths like '/10' are handled correctly
    (the naive str.replace('/0', '') approach breaks on both — M6 fix).
    """
    parsed = urlparse(broker_url)
    return urlunparse(parsed._replace(path="/0"))


# ---------------------------------------------------------------------------
# Dedup helpers
# ---------------------------------------------------------------------------


def _seen_add(redis_client, video_id: str) -> None:
    """Mark video as processed in Redis set."""
    try:
        redis_client.sadd(_SEEN_KEY, video_id)
        redis_client.expire(_SEEN_KEY, 90 * 24 * 3600)  # 90-day TTL
    except Exception as e:
        logger.warning("Redis sadd failed: %s", e)


def _is_seen(redis_client, video_id: str) -> bool:
    """Return True if video has already been processed."""
    try:
        return bool(redis_client.sismember(_SEEN_KEY, video_id))
    except Exception as e:
        logger.warning("Redis sismember failed: %s — treating as unseen", e)
        return False


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task
def ingest_youtube_channels() -> dict:
    """Ingest transcripts from configured YouTube channels into the MIRA KB.

    For each channel:
      1. Lists recent videos via yt-dlp
      2. Skips already-seen video IDs (Redis dedup)
      3. Downloads VTT auto-captions
      4. Parses segments, detects visual cues
      5. Extracts frames at visual cue timestamps (best-effort)
      6. Merges segments into text blocks → chunks → embed → store

    Returns summary dict with counts.
    """
    try:
        import redis
    except ImportError:
        logger.error("redis-py not installed — cannot run ingest_youtube_channels")
        return {"error": "redis_not_installed"}

    broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    redis_url = _redis_url_from_broker(broker_url)
    try:
        r = redis.from_url(redis_url)
        r.ping()
    except Exception as e:
        logger.error("Redis connection failed: %s — dedup disabled", e)
        r = None

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot store KB entries")
        return {"error": "no_tenant_id"}

    try:
        from ingest.chunker import chunk_blocks
        from ingest.embedder import embed_batch
        from ingest.store import store_chunks
    except ImportError:
        from mira_crawler.ingest.chunker import chunk_blocks
        from mira_crawler.ingest.embedder import embed_batch
        from mira_crawler.ingest.store import store_chunks

    total_videos = 0
    skipped_seen = 0
    skipped_no_captions = 0
    total_chunks = 0
    total_stored = 0
    total_frames = 0

    for channel_url in YOUTUBE_CHANNELS:
        logger.info("Processing channel: %s", channel_url)
        videos = _list_channel_videos(channel_url)
        if not videos:
            logger.info("No videos returned for %s", channel_url)
            continue

        for video in videos:
            video_id = video.get("id", "")
            video_url = video.get("url", "")
            title = video.get("title", "")

            if not video_id or not video_url:
                continue

            # Dedup check
            if r and _is_seen(r, video_id):
                skipped_seen += 1
                continue

            total_videos += 1
            logger.info("Processing video: %s — %s", video_id, title)

            with tempfile.TemporaryDirectory() as tmpdir:
                vtt_path = _download_vtt(video_url, Path(tmpdir))
                if vtt_path is None:
                    skipped_no_captions += 1
                    if r:
                        _seen_add(r, video_id)  # don't retry captionless videos
                    continue

                try:
                    vtt_content = vtt_path.read_text(encoding="utf-8", errors="replace")
                except Exception as e:
                    logger.error("Failed to read VTT file %s: %s", vtt_path, e)
                    continue

            # Parse subtitles
            segments = _parse_vtt(vtt_content)
            if not segments:
                logger.info("Empty transcript for %s — skipping", video_id)
                skipped_no_captions += 1
                if r:
                    _seen_add(r, video_id)
                continue

            # Detect visual cues and extract frames (best-effort)
            cue_segments = _detect_visual_cues(segments)
            for cue_seg in cue_segments:
                ts = cue_seg["start_seconds"]
                frame_path = _FRAMES_DIR / f"{video_id}_{ts:.0f}s.jpg"
                if not frame_path.exists():
                    success = _extract_frame(video_url, ts, frame_path)
                    if success:
                        total_frames += 1

            # Build text blocks and chunk
            blocks = _segments_to_text_blocks(segments, video_url)
            chunks = chunk_blocks(
                blocks,
                source_url=video_url,
                source_type="video_transcript",
            )
            total_chunks += len(chunks)

            # Embed and store
            embedded_pairs = embed_batch(chunks, ollama_url=ollama_url)
            valid_pairs = [(c, e) for c, e in embedded_pairs if e is not None]

            stored = store_chunks(
                valid_pairs,
                tenant_id=tenant_id,
                manufacturer="",
                model_number="",
            )
            total_stored += stored

            if r:
                _seen_add(r, video_id)

            logger.info(
                "Video %s: %d segments, %d cues, %d chunks, %d stored",
                video_id,
                len(segments),
                len(cue_segments),
                len(chunks),
                stored,
            )

    summary = {
        "channels": len(YOUTUBE_CHANNELS),
        "videos_processed": total_videos,
        "skipped_seen": skipped_seen,
        "skipped_no_captions": skipped_no_captions,
        "chunks_produced": total_chunks,
        "chunks_stored": total_stored,
        "frames_extracted": total_frames,
    }
    logger.info("YouTube ingest complete: %s", summary)
    return summary

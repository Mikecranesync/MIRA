#!/usr/bin/env python3
"""
Upload the most recent v2 build to YouTube.

ONE-TIME SETUP:

1. Create a Google Cloud project, enable the YouTube Data API v3.
2. Create OAuth 2.0 credentials of type "Desktop app".
3. Download the JSON file as `~/.config/mira/youtube_oauth_client.json`.
   (Do NOT commit it to git. Path is gitignored at repo root.)
4. First run will open a browser for you to authorize the upload scope and
   write a refresh token to `~/.config/mira/youtube_token.json`.
   Subsequent runs are non-interactive.

USAGE:

    doppler run --project factorylm --config prd -- \\
        .venv/bin/python upload_youtube.py \\
            --video-path output/v2/comic-v2/mira_explainer_v2.mp4 \\
            --metadata-dir output/v2/metadata \\
            [--privacy unlisted|public|private] \\
            [--playlist-id <ID>] \\
            [--dry-run]

DEFAULTS:
    --privacy unlisted        # safe default — never auto-publishes public
    --video-path = ~/mira/marketing/videos/comic-v2/mira_explainer_v2.mp4
    --metadata-dir = output/v2/metadata

The title comes from the storyboard, the description from
`metadata/youtube_description.md`, captions from `metadata/transcript.srt`,
and the thumbnail from the first letterboxed canvas (or `--thumbnail PATH`).

After upload, prints the YouTube URL and appends to spend.json with the
upload details.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

OAUTH_CLIENT_PATH = Path.home() / ".config" / "mira" / "youtube_oauth_client.json"
OAUTH_TOKEN_PATH = Path.home() / ".config" / "mira" / "youtube_token.json"
OAUTH_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

DEFAULT_VIDEO = (PROJECT_ROOT / ".." / "videos" / "comic-v2" / "mira_explainer_v2.mp4").resolve()
DEFAULT_METADATA = PROJECT_ROOT / "output" / "v2" / "metadata"
SPEND_LOG = (PROJECT_ROOT / ".." / "videos" / "spend.json").resolve()
STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_v2.yaml"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("upload-youtube")


def _abort_with_setup_help() -> None:
    print(
        "\n[upload_youtube] OAuth client not found.\n\n"
        f"Place the OAuth client JSON at:\n  {OAUTH_CLIENT_PATH}\n\n"
        "How to get it:\n"
        "  1. https://console.cloud.google.com/ → create project (or select existing).\n"
        "  2. APIs & Services → Library → enable 'YouTube Data API v3'.\n"
        "  3. APIs & Services → Credentials → Create credentials →\n"
        "     OAuth client ID → Application type: Desktop app.\n"
        "  4. Download the JSON, then:\n"
        f"     mkdir -p {OAUTH_CLIENT_PATH.parent}\n"
        f"     mv ~/Downloads/client_secret_*.json {OAUTH_CLIENT_PATH}\n"
        "  5. Re-run this script. A browser will open for one-time authorization.\n",
        file=sys.stderr,
    )
    raise SystemExit(2)


def _build_youtube_client() -> Any:
    """Return an authenticated `googleapiclient` resource for YouTube Data API."""
    if not OAUTH_CLIENT_PATH.exists():
        _abort_with_setup_help()

    # Imported lazily so `--dry-run` works without google libs installed.
    from google.auth.transport.requests import Request  # type: ignore
    from google.oauth2.credentials import Credentials  # type: ignore
    from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore
    from googleapiclient.discovery import build  # type: ignore

    creds: Credentials | None = None
    if OAUTH_TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(OAUTH_TOKEN_PATH), OAUTH_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(OAUTH_CLIENT_PATH), OAUTH_SCOPES,
            )
            creds = flow.run_local_server(port=0)
        OAUTH_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        OAUTH_TOKEN_PATH.write_text(creds.to_json())
        logger.info("Stored fresh OAuth token at %s", OAUTH_TOKEN_PATH)

    return build("youtube", "v3", credentials=creds)


def _resumable_upload(yt: Any, video_path: Path, body: dict[str, Any]) -> str:
    """Upload using a resumable transfer; return the new videoId."""
    from googleapiclient.http import MediaFileUpload  # type: ignore

    media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True, mimetype="video/mp4")
    req = yt.videos().insert(part=",".join(body.keys()), body=body, media_body=media)
    response = None
    while response is None:
        status, response = req.next_chunk()
        if status:
            logger.info("upload %.0f%%", status.progress() * 100)
    return response["id"]


def _upload_caption(yt: Any, video_id: str, srt_path: Path) -> None:
    from googleapiclient.http import MediaFileUpload  # type: ignore

    media = MediaFileUpload(str(srt_path), mimetype="application/octet-stream", resumable=False)
    yt.captions().insert(
        part="snippet",
        body={"snippet": {
            "videoId": video_id,
            "language": "en",
            "name": "English (auto from manifest)",
            "isDraft": False,
        }},
        media_body=media,
    ).execute()


def main() -> int:
    p = argparse.ArgumentParser(description="Upload v2 comic build to YouTube")
    p.add_argument("--video-path", default=str(DEFAULT_VIDEO))
    p.add_argument("--metadata-dir", default=str(DEFAULT_METADATA))
    p.add_argument("--privacy", default="unlisted",
                   choices=["unlisted", "public", "private"])
    p.add_argument("--playlist-id")
    p.add_argument("--thumbnail", help="optional path to a custom thumbnail image")
    p.add_argument("--dry-run", action="store_true",
                   help="show what would be uploaded; no API calls")
    args = p.parse_args()

    video_path = Path(args.video_path).expanduser().resolve()
    metadata_dir = Path(args.metadata_dir).expanduser().resolve()

    if not video_path.exists():
        raise SystemExit(f"video file not found: {video_path}")
    desc_path = metadata_dir / "youtube_description.md"
    srt_path = metadata_dir / "transcript.srt"
    if not desc_path.exists():
        raise SystemExit(
            f"metadata description not found: {desc_path}\n"
            "  Run build_video_v2.py first to emit the metadata bundle."
        )

    storyboard = yaml.safe_load(STORYBOARD_PATH.read_text())
    title = str(storyboard.get("title", "MIRA Explainer"))
    description = desc_path.read_text()

    # Derive YouTube tags from the hashtag tail of the description (one
    # source of truth).
    tags = [t.lstrip("#") for t in description.split() if t.startswith("#")]

    body = {
        "snippet": {
            "title": title[:100],          # YouTube hard cap
            "description": description[:5000],  # YouTube hard cap
            "tags": tags[:30],             # YouTube allows up to ~500 chars total
            "categoryId": "28",            # Science & Technology
        },
        "status": {
            "privacyStatus": args.privacy,
            "selfDeclaredMadeForKids": False,
        },
    }

    if args.dry_run:
        print("[dry-run] would upload:")
        print(f"  video:       {video_path}")
        print(f"  size:        {video_path.stat().st_size / (1024*1024):.2f} MB")
        print(f"  privacy:     {args.privacy}")
        print(f"  title:       {body['snippet']['title']}")
        print(f"  tags:        {body['snippet']['tags']}")
        print(f"  caption:     {srt_path if srt_path.exists() else '(none)'}")
        if args.playlist_id:
            print(f"  playlist:    {args.playlist_id}")
        if args.thumbnail:
            print(f"  thumbnail:   {args.thumbnail}")
        return 0

    yt = _build_youtube_client()
    logger.info("Uploading %s (%.2f MB) ...", video_path.name,
                video_path.stat().st_size / (1024 * 1024))
    video_id = _resumable_upload(yt, video_path, body)
    url = f"https://www.youtube.com/watch?v={video_id}"
    logger.info("Uploaded: %s", url)

    if srt_path.exists():
        try:
            _upload_caption(yt, video_id, srt_path)
            logger.info("Caption uploaded.")
        except Exception as e:
            logger.warning("Caption upload failed (video still uploaded): %s", e)

    if args.playlist_id:
        try:
            yt.playlistItems().insert(
                part="snippet",
                body={"snippet": {
                    "playlistId": args.playlist_id,
                    "resourceId": {"kind": "youtube#video", "videoId": video_id},
                }},
            ).execute()
            logger.info("Added to playlist %s.", args.playlist_id)
        except Exception as e:
            logger.warning("Playlist add failed: %s", e)

    if args.thumbnail and Path(args.thumbnail).exists():
        from googleapiclient.http import MediaFileUpload  # type: ignore
        try:
            yt.thumbnails().set(
                videoId=video_id,
                media_body=MediaFileUpload(args.thumbnail, mimetype="image/jpeg"),
            ).execute()
            logger.info("Thumbnail set.")
        except Exception as e:
            logger.warning("Thumbnail set failed: %s", e)

    # Append to spend log
    log_entry = {
        "pipeline": "comic",
        "version": "v2",
        "action": "youtube_upload",
        "video_id": video_id,
        "url": url,
        "privacy": args.privacy,
        "size_bytes": video_path.stat().st_size,
    }
    if SPEND_LOG.exists():
        existing = json.loads(SPEND_LOG.read_text())
    else:
        existing = []
    existing.append(log_entry)
    SPEND_LOG.write_text(json.dumps(existing, indent=2))

    print(f"\n✅ Uploaded: {url}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

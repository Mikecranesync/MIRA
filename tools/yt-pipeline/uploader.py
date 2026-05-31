"""Uploads final.mp4 to YouTube via Data API v3 resumable upload."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("yt-pipeline.uploader")

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_UPLOAD_URL = (
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
)
_CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB


def _refresh_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    """Exchange refresh token for access token via OAuth2."""
    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(_TOKEN_URL, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def upload(
    plan: dict,
    video_path: Path,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    auto_publish: bool = False,
) -> str:
    """Upload video_path to YouTube. Returns video ID."""
    access_token = _refresh_token(client_id, client_secret, refresh_token)
    video_size = video_path.stat().st_size

    metadata = json.dumps(
        {
            "snippet": {
                "title": plan["title"],
                "description": plan["description"],
                "tags": plan["tags"],
                "categoryId": "28",
            },
            "status": {"privacyStatus": "public" if auto_publish else "private"},
        }
    ).encode()

    init_req = urllib.request.Request(_UPLOAD_URL, data=metadata, method="POST")
    init_req.add_header("Authorization", f"Bearer {access_token}")
    init_req.add_header("Content-Type", "application/json")
    init_req.add_header("X-Upload-Content-Type", "video/mp4")
    init_req.add_header("X-Upload-Content-Length", str(video_size))
    with urllib.request.urlopen(init_req) as resp:
        upload_uri = resp.headers["Location"]

    log.info(
        "Uploading %s (%.1f MB) to YouTube...",
        video_path.name,
        video_size / 1e6,
    )
    with open(video_path, "rb") as f:
        offset = 0
        while offset < video_size:
            chunk = f.read(_CHUNK_SIZE)
            end = offset + len(chunk) - 1
            chunk_req = urllib.request.Request(upload_uri, data=chunk, method="PUT")
            chunk_req.add_header("Content-Range", f"bytes {offset}-{end}/{video_size}")
            chunk_req.add_header("Content-Type", "video/mp4")
            try:
                with urllib.request.urlopen(chunk_req) as resp:
                    if resp.status in (200, 201):
                        video_id = json.loads(resp.read())["id"]
                        log.info(
                            "Upload complete: https://youtube.com/watch?v=%s",
                            video_id,
                        )
                        return video_id
                    offset += len(chunk)
            except urllib.error.HTTPError as exc:
                if exc.code == 308:  # Resume Incomplete — expected for non-final chunks
                    offset += len(chunk)
                else:
                    raise

    raise RuntimeError("Upload completed all chunks without receiving video ID")

#!/usr/bin/env python3
"""Minimal YouTube uploader for MIRA promo/demo renders.

Auth: refresh-token OAuth from Doppler `factorylm/prd`
(`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`).

Usage:
  doppler run -p factorylm -c prd -- python tools/youtube_uploader.py --jobs jobs.json
  doppler run -p factorylm -c prd -- python tools/youtube_uploader.py \
      --file path.mp4 --title "T" --description "D" --privacy private

`jobs.json` is a list of {file, title, description}. Privacy defaults to
`private` (override per-job with a "privacy" key or globally with --privacy).
Prints a JSON summary of {file, video_id, url, privacy} per upload.

Quota: each insert costs ~1600 units of the 10K/day default → ~6 uploads/day.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

TOKEN_URI = "https://oauth2.googleapis.com/token"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def build_client():
    cid = os.environ.get("YOUTUBE_CLIENT_ID")
    csec = os.environ.get("YOUTUBE_CLIENT_SECRET")
    rtok = os.environ.get("YOUTUBE_REFRESH_TOKEN")
    missing = [k for k, v in
               {"YOUTUBE_CLIENT_ID": cid, "YOUTUBE_CLIENT_SECRET": csec,
                "YOUTUBE_REFRESH_TOKEN": rtok}.items() if not v]
    if missing:
        sys.exit(f"Missing env (run via Doppler factorylm/prd): {', '.join(missing)}")
    creds = Credentials(
        token=None, refresh_token=rtok, token_uri=TOKEN_URI,
        client_id=cid, client_secret=csec, scopes=SCOPES,
    )
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def upload_one(youtube, path: str, title: str, description: str, privacy: str) -> dict:
    if not os.path.isfile(path):
        return {"file": path, "error": "file not found"}
    body = {
        "snippet": {
            "title": title[:100],
            "description": description,
            "categoryId": "28",  # Science & Technology
        },
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": False,
            "embeddable": True,
        },
    }
    media = MediaFileUpload(path, mimetype="video/mp4", chunksize=-1, resumable=True)
    req = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    vid = resp["id"]
    return {
        "file": os.path.basename(path),
        "video_id": vid,
        "url": f"https://youtu.be/{vid}",
        "studio": f"https://studio.youtube.com/video/{vid}/edit",
        "privacy": resp["status"]["privacyStatus"],
        "title": resp["snippet"]["title"],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", help="JSON list of {file,title,description[,privacy]}")
    ap.add_argument("--file")
    ap.add_argument("--title")
    ap.add_argument("--description", default="")
    ap.add_argument("--privacy", default="private",
                    choices=["private", "unlisted", "public"])
    args = ap.parse_args()

    if args.jobs:
        with open(args.jobs) as f:
            jobs = json.load(f)
    elif args.file and args.title:
        jobs = [{"file": args.file, "title": args.title,
                 "description": args.description}]
    else:
        sys.exit("Provide --jobs FILE or --file + --title")

    youtube = build_client()
    results = []
    for j in jobs:
        try:
            r = upload_one(youtube, j["file"], j["title"],
                           j.get("description", ""),
                           j.get("privacy", args.privacy))
        except HttpError as e:
            r = {"file": j.get("file"), "error": f"HttpError {e.resp.status}: {e}"}
        results.append(r)
        print(json.dumps(r, indent=2), flush=True)

    print("\n=== SUMMARY ===")
    for r in results:
        if "error" in r:
            print(f"  FAIL  {r.get('file')}: {r['error']}")
        else:
            print(f"  OK    [{r['privacy']}] {r['url']}  {r['title']}")
    return 0 if all("error" not in r for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())

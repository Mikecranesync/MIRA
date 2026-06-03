#!/usr/bin/env python3
"""
Offline fallback TTS for the promo pipeline using macOS `say`.

Why this exists: the renderer (build_screenshot_demo.py) generates voiceover via
OpenAI gpt-4o-mini-tts. When the OpenAI key is out of quota AND the Groq Orpheus
TTS model is pending org-admin terms acceptance, there is no cloud voice path.
This sidecar produces a ROUGH-CUT voiceover.mp3 from the same manifest narration
so the full video can still be assembled and reviewed. It does NOT modify the
renderer — run this, then call build_screenshot_demo.py with --skip-tts.

When a cloud voice is available again, delete voiceover.mp3 (or re-run the
renderer without --skip-tts) to get the production onyx/Orpheus voice.

Usage:
    .venv/bin/python marketing/comic-pipeline/local_tts_say.py \
        --manifest marketing/comic-pipeline/scripts/<manifest>.yaml \
        [--voice "Reed (English (US))"] [--rate 145]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import yaml

THIS_FILE = Path(__file__).resolve()
REPO_ROOT = THIS_FILE.parent.parent.parent


def resolve(p: str) -> Path:
    c = Path(p)
    return c if c.is_absolute() else REPO_ROOT / c


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--voice", default="Reed (English (US))")
    ap.add_argument("--rate", type=int, default=145)  # playbook wants 130-140 wpm
    args = ap.parse_args()

    manifest = yaml.safe_load(Path(args.manifest).read_text(encoding="utf-8"))
    slug = manifest["slug"]
    output_dir = resolve(manifest.get("output_dir", f"marketing/videos/{slug}"))
    output_dir.mkdir(parents=True, exist_ok=True)

    # Same concatenation the renderer uses, but with sentence spacing `say` reads
    # as natural pauses between frames.
    lines = [f["narration"].strip() for f in manifest["frames"]]
    text = "\n\n".join(lines)

    aiff = output_dir / "voiceover.aiff"
    mp3 = output_dir / "voiceover.mp3"

    print(f"[say] voice={args.voice!r} rate={args.rate} chars={len(text)} -> {aiff}")
    subprocess.run(
        ["say", "-v", args.voice, "-r", str(args.rate), "-o", str(aiff), text],
        check=True,
    )
    # AIFF -> MP3 so the assembler's ffprobe/ffmpeg path matches the cloud flow.
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff),
         "-codec:a", "libmp3lame", "-qscale:a", "2", str(mp3)],
        check=True,
    )
    aiff.unlink(missing_ok=True)
    dur = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(mp3)],
        capture_output=True, text=True,
    ).stdout.strip()
    print(f"[say] wrote {mp3} ({dur}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

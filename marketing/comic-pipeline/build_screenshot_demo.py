#!/usr/bin/env python3
"""
Stitch existing screenshots into a product demo MP4.

Sibling of build_video_v2.py / run_pipeline.py — but bypasses OpenAI panel
generation. Reads a YAML manifest with literal screenshot paths + per-frame
narration, generates a single concatenated voiceover via OpenAI tts-1-hd,
and stitches a 16:9 MP4 via the existing multi_image_assembler.

Usage:
    doppler run --project factorylm --config prd -- \
        .venv/Scripts/python.exe marketing/comic-pipeline/build_screenshot_demo.py \
        --manifest marketing/comic-pipeline/scripts/ux_demo_pilot.yaml \
        [--skip-tts]   # reuse existing voiceover.mp3 if already rendered
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import yaml
from openai import OpenAI

THIS_FILE = Path(__file__).resolve()
PIPELINE_DIR = THIS_FILE.parent
REPO_ROOT = PIPELINE_DIR.parent.parent

sys.path.insert(0, str(PIPELINE_DIR))
from pipeline.multi_image_assembler import assemble_multi_image_video  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("screenshot-demo")


def load_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def resolve(p: str) -> Path:
    candidate = Path(p)
    if not candidate.is_absolute():
        candidate = REPO_ROOT / candidate
    return candidate


def render_voiceover(manifest: dict, audio_path: Path) -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY not set — run under `doppler run`.")

    style = (manifest.get("voiceover_style") or "").strip()
    lines = [f["narration"].strip() for f in manifest["frames"]]
    text = "\n\n".join(lines)

    model = manifest.get("tts_model", "gpt-4o-mini-tts")
    voice = manifest.get("tts_voice", "onyx")
    logger.info("Generating TTS (model=%s, voice=%s, %d chars) → %s",
                model, voice, len(text), audio_path)

    client = OpenAI(api_key=api_key)
    audio_path.parent.mkdir(parents=True, exist_ok=True)

    # gpt-4o-mini-tts supports a real `instructions` param for voice direction.
    # tts-1-hd ignores instructions; never concatenate style into `input`
    # because it gets read aloud.
    kwargs: dict = {"model": model, "voice": voice, "input": text}
    if style and "gpt-4o" in model:
        kwargs["instructions"] = style

    with client.audio.speech.with_streaming_response.create(**kwargs) as response:
        response.stream_to_file(audio_path)


def main() -> int:
    ap = argparse.ArgumentParser(description="Stitch screenshots into a demo MP4")
    ap.add_argument("--manifest", required=True,
                    help="Path to YAML manifest (slug, frames, etc.)")
    ap.add_argument("--skip-tts", action="store_true",
                    help="Reuse existing voiceover.mp3 if present")
    args = ap.parse_args()

    manifest_path = Path(args.manifest).resolve()
    manifest = load_manifest(manifest_path)

    slug = manifest["slug"]
    output_dir = resolve(manifest.get("output_dir", f"marketing/videos/{slug}"))
    output_dir.mkdir(parents=True, exist_ok=True)

    audio_path = output_dir / "voiceover.mp3"
    video_path = output_dir / f"{slug}.mp4"

    if args.skip_tts and audio_path.exists():
        logger.info("Reusing existing voiceover: %s", audio_path)
    else:
        render_voiceover(manifest, audio_path)

    images = []
    for f in manifest["frames"]:
        img = resolve(f["image"])
        if not img.exists():
            raise SystemExit(f"Missing screenshot: {img}")
        images.append(str(img))

    logger.info("Stitching %d images → %s", len(images), video_path)
    result = assemble_multi_image_video(
        images=images,
        audio_path=str(audio_path),
        output_path=str(video_path),
        width=int(manifest.get("width", 1920)),
        height=int(manifest.get("height", 1080)),
        transition_duration=float(manifest.get("transition_duration", 0.5)),
        zoom_amount=float(manifest.get("zoom_amount", 0.02)),
        fit_mode=manifest.get("fit_mode", "letterbox"),
    )

    if not result["success"]:
        logger.error("Assembly failed: %s", result["error"])
        return 1

    summary = {
        "slug": slug,
        "output": str(video_path),
        "audio": str(audio_path),
        "frames": len(images),
        "duration_seconds": result["metadata"].get("audio_duration"),
        "size_mb": round(result["metadata"].get("file_size_mb", 0), 2),
        "resolution": result["metadata"].get("output_resolution"),
    }
    print("\n" + json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Stitch existing screenshots into a product demo MP4.

Sibling of build_video_v2.py / run_pipeline.py — but bypasses OpenAI panel
generation. Reads a YAML manifest with literal screenshot paths + per-frame
narration, generates a single concatenated voiceover, and stitches a 16:9 MP4
via the existing multi_image_assembler.

TTS provider is manifest-driven (`tts_provider`, default "openai"):
  - "openai": gpt-4o-mini-tts / onyx (default), supports `instructions`.
  - "groq":   canopylabs/orpheus-v1-english / leo (default), OpenAI-compatible
              /audio/speech at https://api.groq.com/openai/v1. Requires a
              one-time org-admin terms acceptance at
              console.groq.com/playground?model=canopylabs/orpheus-v1-english
              (returns model_terms_required until accepted — UNTESTED here).
              Orpheus emits wav, not mp3 — groq manifests should set
              `tts_format: wav`.

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


def _make_tts_client(manifest: dict) -> tuple[OpenAI, str]:
    """Build the TTS client for the manifest's provider (openai|groq)."""
    provider = (manifest.get("tts_provider") or "openai").lower()
    if provider == "groq":
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise SystemExit("GROQ_API_KEY not set — run under `doppler run`.")
        return OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1"), provider
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY not set — run under `doppler run`.")
    return OpenAI(api_key=api_key), provider


def render_voiceover(manifest: dict, audio_path: Path) -> None:
    client, provider = _make_tts_client(manifest)

    style = (manifest.get("voiceover_style") or "").strip()
    lines = [f["narration"].strip() for f in manifest["frames"]]
    text = "\n\n".join(lines)

    if provider == "groq":
        model = manifest.get("tts_model", "canopylabs/orpheus-v1-english")
        voice = manifest.get("tts_voice", "leo")
    else:
        model = manifest.get("tts_model", "gpt-4o-mini-tts")
        voice = manifest.get("tts_voice", "onyx")
    logger.info("Generating TTS (provider=%s, model=%s, voice=%s, %d chars) → %s",
                provider, model, voice, len(text), audio_path)

    audio_path.parent.mkdir(parents=True, exist_ok=True)

    # gpt-4o-mini-tts supports a real `instructions` param for voice direction.
    # tts-1-hd / Orpheus ignore it; never concatenate style into `input`
    # because it gets read aloud.
    kwargs: dict = {"model": model, "voice": voice, "input": text}
    if style and "gpt-4o" in model:
        kwargs["instructions"] = style

    # response_format must match the output extension. The OpenAI default is
    # mp3; Orpheus emits wav, so for groq (or any non-mp3 output) request the
    # format explicitly. Leaving the openai/mp3 path untouched keeps existing
    # manifests byte-for-byte identical.
    fmt = audio_path.suffix.lstrip(".") or "mp3"
    if provider == "groq" or fmt != "mp3":
        kwargs["response_format"] = fmt

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

    # Orpheus emits wav; manifests can set `tts_format: wav` to match.
    audio_ext = (manifest.get("tts_format") or "mp3").lstrip(".")
    audio_path = output_dir / f"voiceover.{audio_ext}"
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

#!/usr/bin/env python3
"""
v1 routine — MIRA comic explainer builder (one TTS call, static framing).

Single-shot builder — uses the 7 finished ChatGPT comic pages in reference/
as the visual track, generates one continuous TTS narration, stitches with
static letterbox framing + xfade transitions. No camera motion, no music.

For the paced / camera-tracked / scored build, see build_video_v2.py.

Usage:
  doppler run --project factorylm --config prd -- \\
      .venv/bin/python build_video_v1.py

Output: ~/mira/marketing/videos/comic-v1/mira_explainer_v1.mp4
"""
from __future__ import annotations

VERSION = "v1"

import argparse
import logging
import os
import sys
from pathlib import Path

import yaml
from openai import OpenAI
from rich.console import Console

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline.multi_image_assembler import assemble_multi_image_video

ROOT = Path(__file__).resolve().parent
STORYBOARD_PATH = ROOT / "scripts" / "storyboard_v1.yaml"
REF_DIR = ROOT / "reference"
AUDIO_DIR = ROOT / "output" / "audio"
# Finals land in the shared marketing/videos tree to match the sibling
# seedance-video-gen convention (one spend.json, one place to browse outputs).
FINAL_DIR = (ROOT / ".." / "videos" / "comic-v1").resolve()

console = Console()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def build_narration(storyboard: dict) -> tuple[str, str]:
    """Return (joined_text, style_instruction)."""
    style = storyboard["audio"]["style_instruction"].strip()
    beats = [shot["narration_beat"].strip() for shot in storyboard["shots"]]
    joined = "  ".join(b.replace("\n", " ") for b in beats)
    return joined, style


_INSTRUCTION_MODELS = {"gpt-4o-mini-tts", "gpt-4o-audio-preview"}


def synth_narration(
    client: OpenAI,
    *,
    model: str,
    voice: str,
    text: str,
    out_path: Path,
    instructions: str = "",
) -> None:
    """Synthesize full narration track.

    gpt-4o-mini-tts passes style via instructions= (actually shapes delivery).
    Legacy tts-1-hd ignores instructions — style text was prepended to input,
    which caused the model to read it aloud. With gpt-4o-mini-tts the style
    goes in instructions= and the input is narration text only.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    kwargs: dict = dict(model=model, voice=voice, input=text)
    if instructions and model in _INSTRUCTION_MODELS:
        kwargs["instructions"] = instructions
    with client.audio.speech.with_streaming_response.create(**kwargs) as response:
        response.stream_to_file(out_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-tts", action="store_true",
                        help="reuse existing narration mp3 if present")
    args = parser.parse_args()

    storyboard = yaml.safe_load(STORYBOARD_PATH.read_text())

    # Resolve image paths in storyboard order.
    shot_files = []
    for shot in storyboard["shots"]:
        p = REF_DIR / shot["file"]
        if not p.exists():
            raise SystemExit(f"missing reference image: {p}")
        shot_files.append(p)
    console.print(f"[bold]Shots:[/bold] {len(shot_files)} images")

    # Narration.
    narration_path = AUDIO_DIR / "narration_v1.mp3"
    if args.skip_tts and narration_path.exists():
        console.print(f"[yellow]skip TTS — reusing[/yellow] {narration_path}")
    else:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise SystemExit("OPENAI_API_KEY not in env — run under `doppler run`.")
        text, style = build_narration(storyboard)
        model = storyboard["audio"]["tts_model"]
        console.print(f"[bold]Narration:[/bold] {len(text)} chars, model={model}")
        client = OpenAI(api_key=api_key)
        synth_narration(
            client,
            model=model,
            voice=storyboard["audio"]["tts_voice"],
            text=text,
            instructions=style,
            out_path=narration_path,
        )
        console.print(f"[green]ok[/green] narration → {narration_path}")

    # Stitch.
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    final_path = FINAL_DIR / storyboard["video"]["output_name"]
    console.print(f"[bold]Stitching[/bold] → {final_path}")
    result = assemble_multi_image_video(
        images=[str(p) for p in shot_files],
        audio_path=str(narration_path),
        output_path=str(final_path),
        width=int(storyboard["video"]["width"]),
        height=int(storyboard["video"]["height"]),
        transition_duration=float(storyboard["video"]["transition_duration"]),
        zoom_amount=float(storyboard["video"]["zoom_amount"]),
        fit_mode=storyboard["video"]["fit_mode"],
    )
    if not result["success"]:
        console.print(f"[red]ERROR[/red] {result['error']}")
        return 2

    meta = result["metadata"]
    console.print(
        f"[bold green]DONE[/bold green] {final_path}\n"
        f"  size:     {meta.get('file_size_mb', 0):.2f} MB\n"
        f"  duration: {meta.get('audio_duration', 0):.1f}s\n"
        f"  shots:    {meta.get('image_count', 0)}\n"
        f"  res:      {meta.get('output_resolution', '?')}\n"
        f"  per-shot: {meta.get('per_image_duration', 0):.2f}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

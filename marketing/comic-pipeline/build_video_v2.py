#!/usr/bin/env python3
"""
v2 routine — paced, camera-tracked, scored MIRA comic explainer.

Differences from v1 (build_video_v1.py):
  - Per-beat TTS at 0.9× speed (one OpenAI call per narration sentence)
  - Per-beat focal points; camera animates beat-to-beat via piecewise zoompan
  - Synthesized 2-mood ambient music bed (problem → resolution)
  - Sidechain-ducked final mix

Usage:
  doppler run --project factorylm --config prd -- \\
      .venv/bin/python build_video_v2.py

Output: ~/mira/marketing/videos/comic-v2/mira_explainer_v2.mp4
"""
from __future__ import annotations

VERSION = "v2"

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import yaml
from rich.console import Console
from rich.table import Table

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from pipeline.v2 import audio as v2_audio
from pipeline.v2 import render as v2_render
from pipeline.v2 import tts as v2_tts
from pipeline.v2 import verify as v2_verify

STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_v2.yaml"
REF_DIR = PROJECT_ROOT / "reference"
WORK_ROOT = PROJECT_ROOT / "output" / "v2"
FINAL_DIR = (PROJECT_ROOT / ".." / "videos" / "comic-v2").resolve()

console = Console()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _build_pause_schedule(storyboard: dict) -> list[float]:
    """Per-beat trailing pauses, in storyboard order. Length = total_beats."""
    p_within = float(storyboard["audio"]["pause_within_shot"])
    p_between = float(storyboard["audio"]["pause_between_shots"])
    pauses: list[float] = []
    shots = storyboard["shots"]
    last_shot_id = shots[-1]["id"]
    for shot in shots:
        beats = shot["beats"]
        for j, _ in enumerate(beats):
            if j < len(beats) - 1:
                pauses.append(p_within)
            elif shot["id"] != last_shot_id:
                pauses.append(p_between)
            else:
                pauses.append(1.5)  # trailing breath at end
    return pauses


def _focals_in_storyboard_order(storyboard: dict) -> list[dict]:
    """Flatten all beats' focals in order."""
    out: list[dict] = []
    for shot in storyboard["shots"]:
        for beat in shot["beats"]:
            out.append(beat["focal"])
    return out


def _focal_outs(storyboard: dict) -> list[dict | None]:
    """For each beat, the focal of the NEXT beat in the SAME shot, else None."""
    out: list[dict | None] = []
    for shot in storyboard["shots"]:
        beats = shot["beats"]
        for j, _ in enumerate(beats):
            if j < len(beats) - 1:
                out.append(beats[j + 1]["focal"])
            else:
                out.append(None)  # no pan-out at shot boundaries (hard cut)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="MIRA comic v2 builder")
    parser.add_argument("--skip-tts", action="store_true",
                        help="reuse cached TTS even if storyboard text changed (debug)")
    parser.add_argument("--skip-render", action="store_true",
                        help="reuse cached beat clips (visual debug)")
    parser.add_argument("--skip-verify", action="store_true",
                        help="skip the post-build Playwright verification pass")
    args = parser.parse_args()

    storyboard = yaml.safe_load(STORYBOARD_PATH.read_text())
    pauses = _build_pause_schedule(storyboard)
    focals_in = _focals_in_storyboard_order(storyboard)
    focals_out = _focal_outs(storyboard)

    n_beats = len(focals_in)
    console.print(f"[bold]v2 build[/bold]: {len(storyboard['shots'])} shots, {n_beats} beats")

    # ── Stage 1: per-beat TTS ────────────────────────────────────────────
    console.rule("[bold]1/6 Per-beat TTS")
    t0 = time.time()
    cache_dir = WORK_ROOT / "audio" / "beats"
    beats = v2_tts.synth_all_beats(storyboard, cache_dir=cache_dir)
    narration_total = sum(b.duration for b in beats)
    console.print(
        f"  [green]ok[/green] {len(beats)} beats, {narration_total:.1f}s narration "
        f"(elapsed {time.time()-t0:.1f}s)"
    )

    # ── Stage 2: pre-render canvas PNGs (letterbox to 1920x1080) ─────────
    console.rule("[bold]2/6 Letterbox canvas")
    source_images = {shot["id"]: REF_DIR / shot["file"] for shot in storyboard["shots"]}
    canvas_dir = WORK_ROOT / "canvas"
    canvases = v2_render.canvas_pre_render(source_images=source_images, out_dir=canvas_dir)
    console.print(f"  [green]ok[/green] {len(canvases)} canvases")

    # ── Stage 3: render per-beat clips with zoompan animation ────────────
    console.rule("[bold]3/6 Render beat clips")
    beat_dir = WORK_ROOT / "beats"
    beat_clip_paths: list[Path] = []
    fps = int(storyboard["video"]["fps"])
    width = int(storyboard["video"]["width"])
    height = int(storyboard["video"]["height"])
    bi = 0
    for shot in storyboard["shots"]:
        canvas = canvases[shot["id"]]
        for j, beat in enumerate(shot["beats"]):
            beat_path = beat_dir / f"shot{shot['id']}_beat{j}.mp4"
            v2_render.render_beat_clip(
                canvas_png=canvas,
                out_path=beat_path,
                focal_in=focals_in[bi],
                focal_out=focals_out[bi],
                narration_seconds=beats[bi].duration,
                pause_seconds=pauses[bi],
                width=width, height=height, fps=fps,
            )
            beat_clip_paths.append(beat_path)
            bi += 1

    # ── Stage 4: concat all beats into the silent video master ───────────
    console.rule("[bold]4/6 Concat video master")
    silent_video = WORK_ROOT / "silent_video.mp4"
    if silent_video.exists() and not args.skip_render:
        silent_video.unlink()  # always rebuild after beats
    video_total = v2_render.concat_all_beats(beat_paths=beat_clip_paths, out_path=silent_video)
    console.print(f"  [green]ok[/green] silent video {video_total:.1f}s -> {silent_video.name}")

    # ── Stage 5: build narration mp3, synth music bed, mix with ducking ──
    console.rule("[bold]5/6 Audio assembly")
    narration_path = WORK_ROOT / "narration_v2.mp3"
    if narration_path.exists():
        narration_path.unlink()
    narration_dur = v2_audio.build_narration(beats, pauses, narration_path)
    console.print(f"  [green]ok[/green] narration {narration_dur:.1f}s")

    # Compute pivot timing: end of shot 3 in the video timeline.
    pivot_idx = None
    bi = 0
    for shot in storyboard["shots"]:
        for _ in shot["beats"]:
            if shot["id"] == 3:
                pivot_idx = bi  # last beat of shot 3 (we'll add up to and incl. this)
            bi += 1
    pivot_seconds = 0.0
    bi = 0
    for shot in storyboard["shots"]:
        for _ in shot["beats"]:
            pivot_seconds += beats[bi].duration + pauses[bi]
            bi += 1
            if pivot_idx is not None and bi > pivot_idx:
                break
        else:
            continue
        break
    console.print(f"  [dim]pivot at {pivot_seconds:.1f}s (end of shot 3)[/dim]")

    bed_path = WORK_ROOT / "music_bed.wav"
    if bed_path.exists():
        bed_path.unlink()
    v2_audio.synth_music_bed(
        storyboard, pivot_seconds=pivot_seconds, total_seconds=video_total,
        work_dir=WORK_ROOT / "music", out_path=bed_path,
    )
    console.print(f"  [green]ok[/green] music bed {video_total:.1f}s")

    mixed_path = WORK_ROOT / "mixed_audio.m4a"
    if mixed_path.exists():
        mixed_path.unlink()
    v2_audio.mix_with_ducking(
        narration_path=narration_path, bed_path=bed_path,
        music_cfg=storyboard["music"], out_path=mixed_path,
    )
    console.print(f"  [green]ok[/green] mixed audio (ducked)")

    # ── Stage 6: mux silent video + mixed audio into final ───────────────
    console.rule("[bold]6/6 Final mux")
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    final_path = FINAL_DIR / storyboard["video"]["output_name"]
    if final_path.exists():
        final_path.unlink()
    v2_audio.mux_video_audio(
        video_path=silent_video, audio_path=mixed_path, out_path=final_path,
    )

    # Persist build manifest so verify (and future tooling) can read back the
    # actual beat durations + pauses used in this build.
    manifest = {
        "video_path": str(final_path),
        "video_duration": video_total,
        "pivot_seconds": pivot_seconds,
        "beats": [
            {
                "shot_id": b.shot_id, "beat_index": b.beat_index,
                "text": b.text, "path": str(b.path), "duration": b.duration,
            }
            for b in beats
        ],
        "pauses": pauses,
    }
    (WORK_ROOT / "build_manifest.json").write_text(json.dumps(manifest, indent=2))

    size_mb = final_path.stat().st_size / (1024 * 1024)
    table = Table(title="v2 done", show_lines=False)
    table.add_column("metric", justify="left")
    table.add_column("value", justify="right")
    table.add_row("output", str(final_path))
    table.add_row("duration", f"{video_total:.1f}s")
    table.add_row("size", f"{size_mb:.2f} MB")
    table.add_row("beats", str(len(beats)))
    table.add_row("pivot at", f"{pivot_seconds:.1f}s")
    table.add_row("elapsed", f"{time.time()-t0:.1f}s")
    console.print(table)

    # ── Stage 7 (optional): Playwright-driven verification ───────────────
    if args.skip_verify:
        console.print("[dim]Skipping verify (--skip-verify).[/dim]")
        return 0

    console.rule("[bold]7/7 Verify (Playwright)")
    expectations = v2_verify.build_expectations(manifest=manifest, storyboard=storyboard)
    verify_dir = WORK_ROOT / "verify"
    results = v2_verify.run_verification(
        video_path=final_path, expectations=expectations, out_dir=verify_dir,
    )
    console.print(
        f"  [green]ok[/green] {len(results['screenshots'])}/{results['expectations_total']} "
        f"frames captured -> {verify_dir / 'report.html'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

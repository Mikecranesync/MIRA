#!/usr/bin/env python3
"""
v2 routine — paced, camera-tracked, scored MIRA comic explainer.

Differences from v1 (build_video_v1.py):
  - Per-beat TTS at 0.9× speed (one OpenAI call per narration sentence)
  - Per-beat focal points; camera animates beat-to-beat via piecewise zoompan
  - Synthesized 2-mood ambient music bed (problem → resolution)
  - Sidechain-ducked final mix

Usage (original comic v2):
  doppler run --project factorylm --config prd -- \\
      .venv/bin/python build_video_v2.py

Usage (demo story scripts with TTS):
  doppler run --project factorylm --config prd -- \\
      .venv/bin/python build_video_v2.py \\
      --storyboard ../demo-videos/story-scripts.yaml \\
      --story 60-second-setup

Usage (demo story scripts with user-recorded voice):
  .venv/bin/python build_video_v2.py \\
      --storyboard ../demo-videos/story-scripts.yaml \\
      --story fault-code-30-seconds \\
      --recordings ../demo-videos/recordings/fault-code-30-seconds/

Output: ~/mira/marketing/videos/comic-v2/mira_explainer_v2.mp4
  (or story output path defined in story-scripts.yaml)
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
# Absolute path to the mira repo root (two levels up from comic-pipeline)
MIRA_ROOT = (PROJECT_ROOT / ".." / "..").resolve()

sys.path.insert(0, str(PROJECT_ROOT))

from pipeline.v2 import audio as v2_audio
from pipeline.v2 import render as v2_render
from pipeline.v2 import tts as v2_tts
from pipeline.v2 import verify as v2_verify

STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_v2.yaml"
REF_DIR = PROJECT_ROOT / "reference"
WORK_ROOT = PROJECT_ROOT / "output" / "v2"
FINAL_DIR = (PROJECT_ROOT / ".." / "videos" / "comic-v2").resolve()

# Defaults injected when a story entry omits audio/video/music blocks
_DEFAULT_AUDIO = {
    "tts_model": "gpt-4o-mini-tts",
    "tts_voice": "onyx",
    "tts_speed": 1.05,
    "pause_within_shot": 0.5,
    "pause_between_shots": 1.0,
    "style_instruction": (
        "Speak like a confident, experienced maintenance engineer talking to a peer. "
        "Conversational and direct — not pitching, just telling it straight. "
        "Natural rhythm. Let short sentences land with weight. "
        "Longer sentences flow without over-emphasizing every word."
    ),
}
_DEFAULT_VIDEO = {
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "shot_xfade_duration": 0.5,
    "intra_beat_pan_duration": 0.5,
}
_DEFAULT_MUSIC = {
    "bed_volume_db": -18,
    "duck_threshold": 0.05,
    "duck_ratio": 6,
    "duck_attack_ms": 80,
    "duck_release_ms": 400,
    "crossfade_seconds": 3.0,
    "moods": {
        "problem": {
            "sines": [
                {"freq": 55.0, "weight": 0.45},
                {"freq": 82.4, "weight": 0.30},
                {"freq": 87.3, "weight": 0.15},
            ],
            "noise": {"color": "brown", "weight": 0.10},
        },
        "resolution": {
            "sines": [
                {"freq": 65.4, "weight": 0.30},
                {"freq": 98.0, "weight": 0.25},
                {"freq": 130.8, "weight": 0.25},
                {"freq": 164.8, "weight": 0.20},
            ],
            "noise": {"color": "pink", "weight": 0.05},
        },
    },
    "cues": [
        {"shot_id": 1, "mood": "problem"},
        {"shot_id": 4, "mood": "resolution"},
    ],
}

console = Console()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("build_v2")


# ──────────────────────────────────────────────────────────────────────────────
# Story loading helpers
# ──────────────────────────────────────────────────────────────────────────────

def _is_multi_story_format(data: dict) -> bool:
    return "stories" in data


def _normalize_beat(beat: dict) -> dict:
    """Accept both 'text' and 'narration' keys; always return with 'text'."""
    b = dict(beat)
    if "narration" in b and "text" not in b:
        b["text"] = b.pop("narration")
    return b


def _load_story(storyboard_path: Path, story_id: str | None) -> dict:
    """Load and normalize a storyboard dict ready for the pipeline.

    Supports two formats:
    - storyboard_v2.yaml: single storyboard dict with 'shots', 'audio', 'video', 'music'
    - story-scripts.yaml: multi-story format with 'stories' list; story_id selects one entry
    """
    data = yaml.safe_load(storyboard_path.read_text())

    if not _is_multi_story_format(data):
        # Legacy single-storyboard format — pass through unchanged
        return data

    if not story_id:
        ids = [s["id"] for s in data["stories"]]
        raise SystemExit(
            f"--storyboard points to a multi-story file. "
            f"Specify --story <id>. Available: {ids}"
        )

    story = next((s for s in data["stories"] if s["id"] == story_id), None)
    if story is None:
        ids = [s["id"] for s in data["stories"]]
        raise SystemExit(f"Story '{story_id}' not found. Available: {ids}")

    # Normalize beats: rename narration→text, warn on screenshot_needed
    shots = []
    for shot in story["shots"]:
        s = dict(shot)
        if s.pop("screenshot_needed", False):
            logger.warning(
                "Shot %s uses a placeholder screenshot (%s). "
                "Capture the real screenshot and update story-scripts.yaml.",
                s.get("id"), s.get("file", "?"),
            )
        s["beats"] = [_normalize_beat(b) for b in s.get("beats", [])]
        shots.append(s)

    # Build a storyboard dict compatible with the existing pipeline
    storyboard: dict = {
        "title": story.get("title", story_id),
        "version": 2,
        "shots": shots,
        "audio": story.get("audio", _DEFAULT_AUDIO),
        "video": story.get("video", _DEFAULT_VIDEO),
        "music": story.get("music", _DEFAULT_MUSIC),
        "_story_output": story.get("output"),  # private: used to override FINAL_DIR
    }

    # Fill in any missing audio keys from defaults
    for k, v in _DEFAULT_AUDIO.items():
        storyboard["audio"].setdefault(k, v)

    # Ensure video has output_name for the final mux step
    if "output_name" not in storyboard["video"]:
        storyboard["video"]["output_name"] = f"demo_{story_id}.mp4"

    return storyboard


def _resolve_image(file_str: str, storyboard_path: Path) -> Path:
    """Resolve a screenshot path from a story shot's 'file' field.

    Priority:
    1. Absolute path → use as-is
    2. Relative to MIRA_ROOT (handles 'docs/promo-screenshots/...')
    3. Relative to REF_DIR (legacy comic panel paths)
    4. Relative to storyboard_path's parent directory
    """
    p = Path(file_str)
    if p.is_absolute():
        return p
    # Try MIRA_ROOT first (catches docs/promo-screenshots/* paths)
    candidate = MIRA_ROOT / p
    if candidate.exists():
        return candidate
    # Legacy: relative to comic-pipeline/reference/
    candidate = REF_DIR / p
    if candidate.exists():
        return candidate
    # Relative to the storyboard file itself
    candidate = storyboard_path.parent / p
    if candidate.exists():
        return candidate
    # Return MIRA_ROOT-relative path even if missing (error surfaces at render time)
    return MIRA_ROOT / p


# ──────────────────────────────────────────────────────────────────────────────
# Recordings loader (user-recorded voice → BeatAudio objects)
# ──────────────────────────────────────────────────────────────────────────────

def _load_recordings(recordings_dir: Path, storyboard: dict) -> list[v2_tts.BeatAudio]:
    """Build BeatAudio list from pre-recorded MP3 files.

    Files must be named beat-01.mp3, beat-02.mp3, ... in storyboard order.
    Duration is measured via ffprobe.
    """
    import subprocess

    beats: list[v2_tts.BeatAudio] = []
    bi = 1
    for shot in storyboard["shots"]:
        for j, beat in enumerate(shot["beats"]):
            filename = recordings_dir / f"beat-{bi:02d}.mp3"
            if not filename.exists():
                raise SystemExit(
                    f"Missing recording: {filename}\n"
                    f"Expected beat-01.mp3 … beat-{_total_beats(storyboard):02d}.mp3 "
                    f"in {recordings_dir}"
                )
            proc = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "json", str(filename)],
                capture_output=True, text=True, timeout=30, check=True,
            )
            duration = float(json.loads(proc.stdout)["format"]["duration"])
            beats.append(v2_tts.BeatAudio(
                shot_id=shot["id"], beat_index=j,
                text=beat.get("text", ""),
                path=filename, duration=duration,
            ))
            bi += 1
    return beats


def _total_beats(storyboard: dict) -> int:
    return sum(len(shot["beats"]) for shot in storyboard["shots"])


# ──────────────────────────────────────────────────────────────────────────────
# Storyboard traversal helpers (unchanged from original)
# ──────────────────────────────────────────────────────────────────────────────

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


def _compute_pivot(storyboard: dict, beats: list, pauses: list[float]) -> float:
    """Compute music mood pivot: end of the 3rd shot (or last shot if <3)."""
    shots = storyboard["shots"]
    pivot_shot_id = shots[min(2, len(shots) - 1)]["id"]  # 0-indexed: index 2 = 3rd shot

    pivot_idx = None
    bi = 0
    for shot in shots:
        for _ in shot["beats"]:
            if shot["id"] == pivot_shot_id:
                pivot_idx = bi
            bi += 1

    pivot_seconds = 0.0
    bi = 0
    for shot in shots:
        for _ in shot["beats"]:
            pivot_seconds += beats[bi].duration + pauses[bi]
            bi += 1
            if pivot_idx is not None and bi > pivot_idx:
                return pivot_seconds
    return pivot_seconds


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="MIRA comic / demo video v2 builder")
    parser.add_argument(
        "--storyboard", type=Path, default=None,
        help=(
            "Path to a storyboard YAML (default: scripts/storyboard_v2.yaml). "
            "Accepts both single-storyboard and multi-story formats."
        ),
    )
    parser.add_argument(
        "--story", type=str, default=None,
        help=(
            "Story ID to build when --storyboard points to a multi-story file "
            "(e.g. 60-second-setup, fault-code-30-seconds)."
        ),
    )
    parser.add_argument(
        "--recordings", type=Path, default=None,
        help=(
            "Folder containing user-recorded beat-01.mp3 … beat-NN.mp3 files. "
            "When supplied, TTS is skipped and your recordings are used instead."
        ),
    )
    parser.add_argument("--skip-tts", action="store_true",
                        help="reuse cached TTS even if storyboard text changed (debug)")
    parser.add_argument("--skip-render", action="store_true",
                        help="reuse cached beat clips (visual debug)")
    parser.add_argument("--skip-verify", action="store_true",
                        help="skip the post-build Playwright verification pass")
    parser.add_argument("--dry-run", action="store_true",
                        help="print shot/beat table and estimated duration, then exit")
    args = parser.parse_args()

    # Resolve storyboard and work paths
    sb_path = args.storyboard or STORYBOARD_PATH
    storyboard = _load_story(sb_path, args.story)

    # Per-story isolated work directory so multiple stories don't clobber caches
    story_slug = args.story or "v2"
    work_root = PROJECT_ROOT / "output" / story_slug
    work_root.mkdir(parents=True, exist_ok=True)

    # Output path: story's own 'output' field → FINAL_DIR fallback
    story_output = storyboard.pop("_story_output", None)
    if story_output:
        final_dir = (MIRA_ROOT / story_output).parent
        output_name = Path(story_output).name
        final_dir.mkdir(parents=True, exist_ok=True)
        storyboard["video"]["output_name"] = output_name
    else:
        final_dir = FINAL_DIR
        final_dir.mkdir(parents=True, exist_ok=True)

    # Resolve image paths (handles docs/promo-screenshots/ and REF_DIR)
    source_images = {
        shot["id"]: _resolve_image(shot["file"], sb_path)
        for shot in storyboard["shots"]
    }

    pauses = _build_pause_schedule(storyboard)
    focals_in = _focals_in_storyboard_order(storyboard)
    focals_out = _focal_outs(storyboard)
    n_beats = len(focals_in)

    console.print(
        f"[bold]v2 build[/bold] story=[cyan]{story_slug}[/cyan] "
        f"{len(storyboard['shots'])} shots, {n_beats} beats"
    )

    # ── Dry run ───────────────────────────────────────────────────────────────
    if args.dry_run:
        table = Table(title=f"Dry run — {storyboard.get('title', story_slug)}", show_lines=True)
        table.add_column("shot", justify="right")
        table.add_column("beat", justify="right")
        table.add_column("duration", justify="right")
        table.add_column("screenshot", justify="left")
        table.add_column("narration", justify="left")
        for shot in storyboard["shots"]:
            img = source_images[shot["id"]]
            exists = "✓" if img.exists() else "✗ MISSING"
            for j, beat in enumerate(shot["beats"]):
                table.add_row(
                    str(shot["id"]),
                    str(j + 1),
                    f"{beat.get('duration', '?')}s",
                    f"{img.name} [{exists}]",
                    beat.get("text", "")[:60],
                )
        console.print(table)
        est = sum(
            beat.get("duration", 5.0)
            for shot in storyboard["shots"]
            for beat in shot["beats"]
        )
        console.print(f"Estimated duration: [bold]{est:.0f}s[/bold]")
        return 0

    t0 = time.time()

    # ── Stage 1: Audio (TTS or user recordings) ───────────────────────────────
    console.rule("[bold]1/6 Audio")
    cache_dir = work_root / "audio" / "beats"

    if args.recordings:
        recordings_dir = args.recordings.resolve()
        if not recordings_dir.is_dir():
            raise SystemExit(f"--recordings folder not found: {recordings_dir}")
        beats = _load_recordings(recordings_dir, storyboard)
        console.print(f"  [green]ok[/green] loaded {len(beats)} user recordings from {recordings_dir.name}/")
    else:
        if args.skip_tts:
            console.print("  [dim]--skip-tts: reusing cached beat audio[/dim]")
        beats = v2_tts.synth_all_beats(storyboard, cache_dir=cache_dir)
        console.print(f"  [green]ok[/green] {len(beats)} TTS beats")

    narration_total = sum(b.duration for b in beats)
    console.print(f"  [dim]narration total: {narration_total:.1f}s (elapsed {time.time()-t0:.1f}s)[/dim]")

    # ── Stage 2: Letterbox canvas PNGs ───────────────────────────────────────
    console.rule("[bold]2/6 Letterbox canvas")
    canvas_dir = work_root / "canvas"
    canvases = v2_render.canvas_pre_render(source_images=source_images, out_dir=canvas_dir)
    console.print(f"  [green]ok[/green] {len(canvases)} canvases")

    # ── Stage 3: Render per-beat clips with zoompan animation ─────────────────
    console.rule("[bold]3/6 Render beat clips")
    beat_dir = work_root / "beats"
    beat_clip_paths: list[Path] = []
    fps = int(storyboard["video"]["fps"])
    width = int(storyboard["video"]["width"])
    height = int(storyboard["video"]["height"])
    bi = 0
    for shot in storyboard["shots"]:
        canvas = canvases[shot["id"]]
        for j, beat in enumerate(shot["beats"]):
            beat_path = beat_dir / f"shot{shot['id']}_beat{j}.mp4"
            if beat_path.exists() and args.skip_render:
                beat_clip_paths.append(beat_path)
                bi += 1
                continue
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
    console.print(f"  [green]ok[/green] {len(beat_clip_paths)} beat clips")

    # ── Stage 4: Concat beat clips → silent video master ─────────────────────
    console.rule("[bold]4/6 Concat video master")
    silent_video = work_root / "silent_video.mp4"
    if silent_video.exists() and not args.skip_render:
        silent_video.unlink()
    video_total = v2_render.concat_all_beats(beat_paths=beat_clip_paths, out_path=silent_video)
    console.print(f"  [green]ok[/green] silent video {video_total:.1f}s -> {silent_video.name}")

    # ── Stage 5: Narration + music bed + ducked mix ───────────────────────────
    console.rule("[bold]5/6 Audio assembly")
    narration_path = work_root / "narration_v2.mp3"
    if narration_path.exists():
        narration_path.unlink()
    narration_dur = v2_audio.build_narration(beats, pauses, narration_path)
    console.print(f"  [green]ok[/green] narration {narration_dur:.1f}s")

    pivot_seconds = _compute_pivot(storyboard, beats, pauses)
    console.print(f"  [dim]pivot at {pivot_seconds:.1f}s (mood: problem → resolution)[/dim]")

    bed_path = work_root / "music_bed.wav"
    if bed_path.exists():
        bed_path.unlink()
    v2_audio.synth_music_bed(
        storyboard, pivot_seconds=pivot_seconds, total_seconds=video_total,
        work_dir=work_root / "music", out_path=bed_path,
    )
    console.print(f"  [green]ok[/green] music bed {video_total:.1f}s")

    mixed_path = work_root / "mixed_audio.m4a"
    if mixed_path.exists():
        mixed_path.unlink()
    v2_audio.mix_with_ducking(
        narration_path=narration_path, bed_path=bed_path,
        music_cfg=storyboard["music"], out_path=mixed_path,
    )
    console.print(f"  [green]ok[/green] mixed audio (ducked)")

    # ── Stage 6: Mux video + audio → final MP4 ────────────────────────────────
    console.rule("[bold]6/6 Final mux")
    final_path = final_dir / storyboard["video"]["output_name"]
    if final_path.exists():
        final_path.unlink()
    v2_audio.mux_video_audio(
        video_path=silent_video, audio_path=mixed_path, out_path=final_path,
    )

    manifest = {
        "story": story_slug,
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
    (work_root / "build_manifest.json").write_text(json.dumps(manifest, indent=2))

    size_mb = final_path.stat().st_size / (1024 * 1024)
    table = Table(title="v2 done", show_lines=False)
    table.add_column("metric", justify="left")
    table.add_column("value", justify="right")
    table.add_row("story", story_slug)
    table.add_row("output", str(final_path))
    table.add_row("duration", f"{video_total:.1f}s")
    table.add_row("size", f"{size_mb:.2f} MB")
    table.add_row("beats", str(len(beats)))
    table.add_row("pivot at", f"{pivot_seconds:.1f}s")
    table.add_row("elapsed", f"{time.time()-t0:.1f}s")
    console.print(table)

    # ── Stage 7 (optional): Playwright verification ───────────────────────────
    if args.skip_verify:
        console.print("[dim]Skipping verify (--skip-verify).[/dim]")
        return 0

    console.rule("[bold]7/7 Verify (Playwright)")
    expectations = v2_verify.build_expectations(manifest=manifest, storyboard=storyboard)
    verify_dir = work_root / "verify"
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

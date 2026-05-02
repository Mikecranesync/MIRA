"""
Smooth-transitions remix.

Takes the existing 27 cached beat clips + mixed_audio.m4a from comic-pipeline/output/v2
and produces a final mp4 with:
  - cross-dissolve (xfade) between every shot transition (no hard cuts)
  - frozen-frame extension on the CTA to keep total length matched to audio
  - audio re-encoded with loudnorm (-16 LUFS) so it's actually audible

Outputs to ~/mira/marketing/videos/comic-vfd-f004/mira_explainer_vfd_f004.mp4
(overwrites the previous version after backing it up to .pre_smooth.mp4).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORK = PROJECT_ROOT / "output" / "v2"
BEATS = WORK / "beats"
SHOTS_DIR = WORK / "shots_concat"
SHOTS_DIR.mkdir(parents=True, exist_ok=True)
FINAL_DIR = (PROJECT_ROOT / ".." / "videos" / "comic-vfd-f004").resolve()
FINAL_DIR.mkdir(parents=True, exist_ok=True)

XFADE_DURATION = 0.6  # seconds of cross-dissolve at each shot boundary
FINAL_NAME = "mira_explainer_vfd_f004.mp4"


def run(cmd: list[str], *, timeout: int = 600) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        sys.stderr.write((proc.stderr or "")[-2000:])
        raise SystemExit(f"ffmpeg failed (exit {proc.returncode})")


def probe_duration(p: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(p)],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return float(proc.stdout.strip())


def beats_by_shot() -> dict[int, list[Path]]:
    groups: dict[int, list[Path]] = {}
    for f in sorted(BEATS.glob("shot*_beat*.mp4")):
        shot_id = int(f.stem.split("_")[0].removeprefix("shot"))
        groups.setdefault(shot_id, []).append(f)
    for shot_id in groups:
        groups[shot_id].sort(key=lambda p: int(p.stem.split("_")[1].removeprefix("beat")))
    return dict(sorted(groups.items()))


def concat_shot(shot_id: int, beat_paths: list[Path]) -> Path:
    """Concat one shot's beats into a single mp4 (stream-copy: zero re-encode cost)."""
    out = SHOTS_DIR / f"shot{shot_id}.mp4"
    if out.exists():
        out.unlink()
    list_file = SHOTS_DIR / f"shot{shot_id}.txt"
    list_file.write_text("\n".join(f"file '{p.resolve()}'" for p in beat_paths))
    run(["ffmpeg", "-y", "-v", "error",
         "-f", "concat", "-safe", "0",
         "-i", str(list_file),
         "-c", "copy",
         str(out)])
    return out


def xfade_chain(shot_videos: list[Path], shot_durations: list[float], xfade_dur: float) -> Path:
    """Chain shot mp4s with xfade between each pair. Returns silent mp4 path."""
    out = WORK / "silent_video_smooth.mp4"
    if out.exists():
        out.unlink()

    inputs: list[str] = []
    for v in shot_videos:
        inputs += ["-i", str(v)]

    # Build the filter_complex chain.
    # Each xfade takes [prev_chain][next_input], outputs [chain_N].
    # Offset for xfade #k = (cumulative chain duration up to and including shot k) - xfade_dur.
    # Cumulative chain duration after pairwise xfade k = prev_total - xfade_dur + shot_durations[k+1]
    parts: list[str] = []
    label_in = "0:v"
    chain_dur = shot_durations[0]
    for k in range(1, len(shot_videos)):
        offset = chain_dur - xfade_dur
        label_out = f"v{k}"
        parts.append(
            f"[{label_in}][{k}:v]xfade=transition=fade:duration={xfade_dur}:offset={offset:.4f}[{label_out}]"
        )
        label_in = label_out
        chain_dur = chain_dur - xfade_dur + shot_durations[k]

    filter_complex = ";".join(parts)
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{label_in}]",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-r", "24",
        str(out),
    ]
    run(cmd, timeout=900)
    return out


def freeze_extend(silent_path: Path, target_duration: float) -> Path:
    """Append freeze-frame to reach target_duration. Returns silent mp4 path."""
    cur = probe_duration(silent_path)
    extra = target_duration - cur
    out = WORK / "silent_video_smooth_padded.mp4"
    if out.exists():
        out.unlink()
    if extra <= 0.05:
        # Close enough; just copy.
        shutil.copy(silent_path, out)
        return out
    # tpad clones the last frame for `extra` seconds.
    run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(silent_path),
        "-vf", f"tpad=stop_mode=clone:stop_duration={extra:.4f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", "24",
        str(out),
    ])
    return out


def mux_loudnormed(silent_path: Path, audio_path: Path, out_path: Path) -> None:
    if out_path.exists():
        out_path.unlink()
    run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(silent_path),
        "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-af", "aresample=async=1:first_pts=0,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        str(out_path),
    ], timeout=600)


def main() -> int:
    audio = WORK / "mixed_audio.m4a"
    if not audio.exists():
        sys.exit(f"missing {audio}")
    audio_dur = probe_duration(audio)

    groups = beats_by_shot()
    print(f"shots discovered: {list(groups.keys())}")

    shot_videos: list[Path] = []
    shot_durations: list[float] = []
    for shot_id, beat_paths in groups.items():
        sv = concat_shot(shot_id, beat_paths)
        d = probe_duration(sv)
        shot_videos.append(sv)
        shot_durations.append(d)
        print(f"  shot{shot_id}: {len(beat_paths)} beats -> {sv.name} ({d:.3f}s)")

    raw_total = sum(shot_durations)
    expected_after_xfade = raw_total - XFADE_DURATION * (len(shot_videos) - 1)
    print(f"raw concat total: {raw_total:.3f}s")
    print(f"after {XFADE_DURATION}s xfades: {expected_after_xfade:.3f}s")
    print(f"audio target:      {audio_dur:.3f}s")

    silent = xfade_chain(shot_videos, shot_durations, XFADE_DURATION)
    silent_dur = probe_duration(silent)
    print(f"xfade-chained silent video: {silent.name} ({silent_dur:.3f}s)")

    padded = freeze_extend(silent, audio_dur)
    padded_dur = probe_duration(padded)
    print(f"freeze-padded silent video: {padded.name} ({padded_dur:.3f}s)")

    final_path = FINAL_DIR / FINAL_NAME
    if final_path.exists():
        backup = final_path.with_suffix(".pre_smooth.mp4")
        if backup.exists():
            backup.unlink()
        final_path.rename(backup)
        print(f"backed up previous final -> {backup.name}")

    mux_loudnormed(padded, audio, final_path)

    final_dur = probe_duration(final_path)
    final_size_mb = final_path.stat().st_size / (1024 * 1024)
    print(f"\n=== DONE ===")
    print(f"output: {final_path}")
    print(f"duration: {final_dur:.3f}s")
    print(f"size: {final_size_mb:.2f} MB")
    print(f"shot transitions: {len(shot_videos) - 1} cross-dissolves @ {XFADE_DURATION}s each")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

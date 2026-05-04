"""
Audio for comic-pipeline v2: narration assembly, synthesized music bed,
sidechain-ducked final mix, and video/audio mux.
"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from .tts import BeatAudio

logger = logging.getLogger("comic.v2.audio")


def _run(cmd: list[str], *, timeout: int = 600) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-1500:]
        raise RuntimeError(f"{cmd[0]} failed (exit {proc.returncode}):\n{tail}")


def _probe_duration(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return float(json.loads(proc.stdout)["format"]["duration"])


def build_narration(
    beats: list[BeatAudio],
    pauses: list[float],
    out_path: Path,
) -> float:
    """Concat beat MP3s with `pauses[i]` of silence appended after each.

    Returns total narration duration. Output is a single mp3 at 48 kHz mono.
    """
    assert len(beats) == len(pauses), "pauses must align with beats"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    inputs: list[str] = []
    filter_parts: list[str] = []
    for i, beat in enumerate(beats):
        inputs.extend(["-i", str(beat.path)])
        # apad pad_dur=0 is a no-op; otherwise pads end with silence.
        pad = max(0.0, pauses[i])
        filter_parts.append(
            f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,"
            f"apad=pad_dur={pad:.4f}[s{i}]"
        )

    concat_inputs = "".join(f"[s{i}]" for i in range(len(beats)))
    filter_complex = (
        ";".join(filter_parts)
        + f";{concat_inputs}concat=n={len(beats)}:v=0:a=1[out]"
    )

    logger.info(
        "[narration] concat %d beats, total pauses %.2fs -> %s",
        len(beats), sum(pauses), out_path.name,
    )
    _run([
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-ar", "48000", "-ac", "1",
        str(out_path),
    ])
    return _probe_duration(out_path)


def synth_mood(
    mood_cfg: dict,
    *,
    duration: float,
    out_path: Path,
    bed_volume_db: float,
) -> None:
    """Synthesize one mood (sine-stack + noise) at exact duration. Output WAV stereo."""
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Build filter graph: each sine wave gets weighted, noise gets weighted,
    # everything amix'd, then volume-trimmed to bed_volume_db.
    sines = mood_cfg.get("sines", [])
    noise = mood_cfg.get("noise", {})

    parts: list[str] = []
    inputs: list[str] = []  # source labels for amix

    for i, s in enumerate(sines):
        parts.append(
            f"sine=frequency={s['freq']}:duration={duration:.4f}:"
            f"sample_rate=48000[s{i}_raw];"
            f"[s{i}_raw]volume={s['weight']}[s{i}]"
        )
        inputs.append(f"[s{i}]")

    if noise:
        color = noise.get("color", "brown")
        weight = noise.get("weight", 0.05)
        parts.append(
            f"anoisesrc=color={color}:duration={duration:.4f}:"
            f"sample_rate=48000:amplitude=0.5[n_raw];"
            f"[n_raw]volume={weight}[n]"
        )
        inputs.append("[n]")

    n_in = len(inputs)
    parts.append(
        f"{''.join(inputs)}amix=inputs={n_in}:duration=longest[mix]"
    )
    parts.append(f"[mix]volume={bed_volume_db}dB,aformat=channel_layouts=stereo[out]")

    filter_complex = ";".join(parts)
    logger.info("[music] synth mood (%d sines, noise=%s) %.2fs -> %s",
                len(sines), bool(noise), duration, out_path.name)
    _run([
        "ffmpeg", "-y",
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-ac", "2", "-ar", "48000",
        "-t", f"{duration:.4f}",
        str(out_path),
    ])


def synth_music_bed(
    storyboard: dict,
    *,
    pivot_seconds: float,
    total_seconds: float,
    work_dir: Path,
    out_path: Path,
) -> None:
    """Synth the two moods and acrossfade them at the pivot.

    pivot_seconds = midpoint of the crossfade in the OUTPUT timeline. Should
    correspond to "shot 4 starts" in the video (the MIRA pivot).
    """
    music = storyboard["music"]
    crossfade = float(music["crossfade_seconds"])
    bed_db = float(music["bed_volume_db"])

    # Per the acrossfade math:
    #   problem_len + resolution_len - crossfade = total_seconds
    #   midpoint = problem_len - crossfade/2 = pivot_seconds
    # =>
    #   problem_len = pivot_seconds + crossfade/2
    #   resolution_len = total_seconds - pivot_seconds + crossfade/2
    problem_len = pivot_seconds + crossfade / 2
    resolution_len = total_seconds - pivot_seconds + crossfade / 2

    moods = {m["mood"]: m for m in music["cues"]}
    if "problem" not in moods or "resolution" not in moods:
        raise RuntimeError("music.cues must reference both 'problem' and 'resolution' moods")

    problem_def = music["moods"]["problem"]
    resolution_def = music["moods"]["resolution"]

    work_dir.mkdir(parents=True, exist_ok=True)
    p_path = work_dir / "mood_problem.wav"
    r_path = work_dir / "mood_resolution.wav"
    synth_mood(problem_def, duration=problem_len, out_path=p_path, bed_volume_db=bed_db)
    synth_mood(resolution_def, duration=resolution_len, out_path=r_path, bed_volume_db=bed_db)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info(
        "[music] crossfade %.2fs problem + %.2fs resolution -> %.2fs bed",
        problem_len, resolution_len, total_seconds,
    )
    _run([
        "ffmpeg", "-y",
        "-i", str(p_path), "-i", str(r_path),
        "-filter_complex",
        f"[0][1]acrossfade=d={crossfade}:c1=tri:c2=tri[out]",
        "-map", "[out]",
        "-ac", "2", "-ar", "48000",
        str(out_path),
    ])


def mix_with_ducking(
    *,
    narration_path: Path,
    bed_path: Path,
    music_cfg: dict,
    out_path: Path,
) -> None:
    """Sidechain-compress the bed against the narration. Output AAC m4a."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    threshold = float(music_cfg["duck_threshold"])
    ratio = float(music_cfg["duck_ratio"])
    attack = float(music_cfg["duck_attack_ms"])
    release = float(music_cfg["duck_release_ms"])

    logger.info(
        "[mix] sidechain duck (thr=%.3f ratio=%.1f atk=%.0fms rel=%.0fms) -> %s",
        threshold, ratio, attack, release, out_path.name,
    )
    _run([
        "ffmpeg", "-y",
        "-i", str(narration_path),
        "-i", str(bed_path),
        "-filter_complex",
        # Split narration into "main mix line" and "sidechain key signal"
        "[0]asplit=2[narr_main][narr_sc];"
        # Compress bed using narration as sidechain key
        f"[1][narr_sc]sidechaincompress=threshold={threshold}:ratio={ratio}:"
        f"attack={attack}:release={release}[bed_ducked];"
        # Final mix — narration full level, ducked bed underneath
        "[narr_main]aformat=channel_layouts=stereo[narr_st];"
        "[narr_st][bed_ducked]amix=inputs=2:duration=first:weights=1.0|0.85,"
        "alimiter=limit=0.95[mixed]",
        "-map", "[mixed]",
        "-ac", "2", "-ar", "48000",
        "-c:a", "aac", "-b:a", "192k",
        str(out_path),
    ])


def mux_video_audio(
    *,
    video_path: Path,
    audio_path: Path,
    out_path: Path,
) -> None:
    """Mux silent video + mixed audio into final YouTube-ready MP4."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("[mux] %s + %s -> %s", video_path.name, audio_path.name, out_path.name)
    _run([
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "copy",
        "-shortest",
        "-movflags", "+faststart",
        str(out_path),
    ])

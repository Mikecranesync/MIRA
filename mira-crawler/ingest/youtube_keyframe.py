"""YouTube keyframe extraction + Claude vision classification.

Pipeline per video:
  1. yt-dlp downloads video at 360p to a temp file
  2. ffmpeg extracts scene-change frames (threshold 0.4)
  3. Claude vision classifies each frame into one of 9 categories
  4. Valuable frames stored in PHOTOS_DIR + nomic-embed-vision → NeonDB
  5. Temp video and discarded frames deleted immediately

Frame categories (keep):
  fault_code_display  — VFD/PLC/HMI screen showing fault or error code
  wiring_condition    — exposed terminals, connections, burn marks, damage
  component_state     — motor, contactor, capacitor, drive hardware
  multimeter_reading  — measurement device on equipment
  schematic_diagram   — wiring diagram, one-line diagram
  ladder_logic_screen — Studio 5000 / RSLogix rungs (especially faults)
  hmi_display         — operator panel showing alarms, setpoints, values
  teaching_diagram    — labeled diagram explaining a concept

Frame categories (discard):
  presenter           — person talking to camera
  discard             — unrelated or low-information content
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import httpx
from ingest.embedder import embed_image

logger = logging.getLogger("mira-crawler.youtube.keyframe")

PHOTOS_DIR = Path(os.getenv("PHOTOS_DIR", "/data/youtube_frames"))
MAX_FRAMES_PER_VIDEO = int(os.getenv("YOUTUBE_MAX_FRAMES", "60"))
SCENE_THRESHOLD = float(os.getenv("YOUTUBE_SCENE_THRESHOLD", "0.4"))

# Frame categories worth keeping in the KB
KEEP_CATEGORIES = {
    "fault_code_display",
    "wiring_condition",
    "component_state",
    "multimeter_reading",
    "schematic_diagram",
    "ladder_logic_screen",
    "hmi_display",
    "teaching_diagram",
}

_CLASSIFY_PROMPT = """You are analyzing a frame from an industrial maintenance or PLC programming tutorial video.

Classify this frame into exactly ONE category:

KEEP categories:
- fault_code_display: VFD, PLC, or HMI screen showing a fault or error code
- wiring_condition: exposed terminals, wire connections, burn marks, or wiring damage
- component_state: motor, contactor, capacitor, relay, or drive hardware (normal or damaged)
- multimeter_reading: measurement device being used on equipment
- schematic_diagram: wiring diagram, one-line diagram, or electrical schematic
- ladder_logic_screen: PLC programming software (Studio 5000, RSLogix) showing ladder rungs
- hmi_display: operator touch panel or HMI showing alarms, setpoints, or process values
- teaching_diagram: labeled diagram or graphic explaining an electrical/industrial concept

DISCARD categories:
- presenter: person talking to camera, interview setup
- discard: slide text, desktop screen unrelated to equipment, low-information content

Respond ONLY with valid JSON matching this schema:
{
  "category": "<one of the categories above>",
  "fault_codes": ["<any visible fault/error codes, empty list if none>"],
  "equipment_visible": "<what equipment or component is shown, or empty string>",
  "condition": "<normal|damaged|burned|loose|failed|unknown>",
  "teaching_context": "<one sentence: what is being demonstrated, or empty string>"
}"""


def _neon_engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ["NEON_DATABASE_URL"]
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _update_keyframe_status(video_id: str, status: str, error_msg: str = "") -> None:
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            conn.execute(
                text("""
                    UPDATE youtube_videos
                    SET keyframe_status = :status,
                        error_msg = CASE WHEN :err != '' THEN :err ELSE error_msg END,
                        updated_at = now()
                    WHERE video_id = :vid
                """),
                {"status": status, "err": error_msg, "vid": video_id},
            )
            conn.commit()
    except Exception as e:
        logger.error("Keyframe status update failed for %s: %s", video_id, e)


def _get_video_meta(video_id: str) -> dict:
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            row = conn.execute(
                text("SELECT title, channel_name, view_count FROM youtube_videos WHERE video_id = :vid"),
                {"vid": video_id},
            ).fetchone()
        if row:
            return {"title": row[0] or "", "channel_name": row[1] or "", "view_count": row[2] or 0}
    except Exception as e:
        logger.warning("Meta fetch failed for %s: %s", video_id, e)
    return {"title": "", "channel_name": "", "view_count": 0}


def _download_video(video_id: str, out_dir: Path) -> Path | None:
    """Download video at 360p using yt-dlp. Returns path to downloaded file."""
    out_template = str(out_dir / "video.%(ext)s")
    cmd = [
        "yt-dlp",
        "--format", "bestvideo[height<=360][ext=mp4]+bestaudio/best[height<=360]/best",
        "--output", out_template,
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    try:
        subprocess.run(cmd, check=True, timeout=600, capture_output=True)
        # Find the downloaded file
        for f in out_dir.iterdir():
            if f.stem == "video":
                logger.info("Downloaded %s → %s (%d MB)", video_id, f.name, f.stat().st_size // 1024 // 1024)
                return f
        logger.warning("yt-dlp succeeded but no file found in %s", out_dir)
        return None
    except subprocess.TimeoutExpired:
        logger.error("yt-dlp timeout for %s", video_id)
        return None
    except subprocess.CalledProcessError as e:
        logger.error("yt-dlp failed for %s: %s", video_id, e.stderr.decode()[:300])
        return None


def _extract_scene_frames(video_path: Path, frames_dir: Path) -> list[Path]:
    """Use ffmpeg scene-change detection to extract key frames.

    Returns list of JPEG paths, capped at MAX_FRAMES_PER_VIDEO.
    """
    out_pattern = str(frames_dir / "frame_%04d.jpg")
    cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vf", f"select='gt(scene,{SCENE_THRESHOLD})',scale=640:-1",
        "-vsync", "vfr",
        "-q:v", "3",
        "-frames:v", str(MAX_FRAMES_PER_VIDEO),
        out_pattern,
        "-y",
        "-loglevel", "error",
    ]
    try:
        subprocess.run(cmd, check=True, timeout=300, capture_output=True)
        frames = sorted(frames_dir.glob("frame_*.jpg"))
        logger.info("Extracted %d scene-change frames from %s", len(frames), video_path.name)
        return frames
    except subprocess.CalledProcessError as e:
        logger.error("ffmpeg failed: %s", e.stderr.decode()[:200])
        return []
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timeout on %s", video_path)
        return []


def _classify_frame(frame_path: Path) -> dict | None:
    """Send frame to Claude vision for classification. Returns parsed JSON or None."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set — cannot classify frames")
        return None

    try:
        image_data = frame_path.read_bytes()
        image_b64 = base64.b64encode(image_data).decode()

        with httpx.Client(timeout=60) as client:
            resp = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 300,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "image/jpeg",
                                        "data": image_b64,
                                    },
                                },
                                {"type": "text", "text": _CLASSIFY_PROMPT},
                            ],
                        }
                    ],
                },
            )
            resp.raise_for_status()
            content = resp.json()["content"][0]["text"].strip()
            # Strip any markdown code fences
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)
    except json.JSONDecodeError as e:
        logger.warning("JSON parse error classifying %s: %s", frame_path.name, e)
        return None
    except Exception as e:
        logger.warning("Frame classification failed for %s: %s", frame_path.name, e)
        return None


def _store_frame(
    frame_path: Path,
    video_id: str,
    frame_index: int,
    classification: dict,
    video_meta: dict,
    tenant_id: str,
    ollama_url: str,
    vision_model: str,
) -> bool:
    """Copy frame to PHOTOS_DIR, embed, and insert into knowledge_entries."""
    from sqlalchemy import text

    # Save to permanent location
    dest_dir = PHOTOS_DIR / video_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"frame_{frame_index:04d}.jpg"
    shutil.copy2(frame_path, dest)

    # Build content description for text retrieval
    cat = classification.get("category", "")
    equipment = classification.get("equipment_visible", "")
    context = classification.get("teaching_context", "")
    fault_codes = classification.get("fault_codes", [])
    condition = classification.get("condition", "unknown")

    content_parts = [f"[{cat}]"]
    if fault_codes:
        content_parts.append(f"Fault codes: {', '.join(fault_codes)}")
    if equipment:
        content_parts.append(f"Equipment: {equipment}")
    if condition not in ("unknown", "normal"):
        content_parts.append(f"Condition: {condition}")
    if context:
        content_parts.append(context)
    content_parts.append(f"Source: {video_meta.get('channel_name', '')} — {video_meta.get('title', '')[:60]}")
    content = " | ".join(content_parts)

    # Image embedding
    image_b64 = base64.b64encode(dest.read_bytes()).decode()
    image_embedding = embed_image(image_b64, ollama_url=ollama_url, model=vision_model)

    metadata = {
        "chunk_index": frame_index,
        "chunk_type": "youtube_frame",
        "source": "youtube_keyframe",
        "category": cat,
        "fault_codes": fault_codes,
        "equipment_visible": equipment,
        "condition": condition,
        "teaching_context": context,
        "channel_name": video_meta.get("channel_name", ""),
        "video_title": video_meta.get("title", ""),
        "view_count": video_meta.get("view_count", 0),
        "video_id": video_id,
        "frame_path": str(dest),
    }

    source_url = f"https://www.youtube.com/watch?v={video_id}#frame{frame_index}"
    entry_id = str(uuid.uuid4())

    try:
        engine = _neon_engine()
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, manufacturer, model_number,
                         content, embedding, source_url, source_page,
                         metadata, is_private, verified, chunk_type, image_embedding)
                    VALUES
                        (:id, :tid, 'youtube_frame', '', '',
                         :content, cast(:emb AS vector), :src_url, :src_page,
                         cast(:meta AS jsonb), false, false, 'youtube_frame',
                         cast(:img_emb AS vector))
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": entry_id,
                    "tid": tenant_id,
                    "content": content,
                    "emb": str([0.0] * 768),  # placeholder — image-only entries use image_embedding
                    "src_url": source_url,
                    "src_page": frame_index,
                    "meta": json.dumps(metadata),
                    "img_emb": str(image_embedding) if image_embedding else str([0.0] * 768),
                },
            )
            conn.commit()
        logger.info("Stored frame %d (%s) for %s", frame_index, cat, video_id)
        return True
    except Exception as e:
        logger.error("Frame store failed (frame %d, %s): %s", frame_index, video_id, e)
        return False


def extract_keyframes(video_id: str, dry_run: bool = False) -> dict:
    """Full keyframe extraction pipeline for one video.

    Returns {video_id, frames_extracted, frames_kept, frames_discarded, status}.
    """
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    vision_model = os.getenv("EMBED_VISION_MODEL", "nomic-embed-vision:v1.5")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set")
        return {"video_id": video_id, "frames_extracted": 0, "frames_kept": 0, "frames_discarded": 0, "status": "error"}

    video_meta = _get_video_meta(video_id)
    logger.info("Extracting keyframes: %s | %s", video_id, video_meta["title"][:60])

    stats = {"video_id": video_id, "frames_extracted": 0, "frames_kept": 0, "frames_discarded": 0, "status": "pending"}

    with tempfile.TemporaryDirectory(prefix=f"mira_yt_{video_id}_") as tmp:
        tmp_path = Path(tmp)
        frames_dir = tmp_path / "frames"
        frames_dir.mkdir()

        # Step 1: Download
        video_file = _download_video(video_id, tmp_path)
        if not video_file:
            if not dry_run:
                _update_keyframe_status(video_id, "failed", "download failed")
            return {**stats, "status": "failed"}

        # Step 2: Extract frames
        frames = _extract_scene_frames(video_file, frames_dir)
        stats["frames_extracted"] = len(frames)

        # Delete video immediately — we only need frames
        video_file.unlink(missing_ok=True)
        logger.info("Temp video deleted: %s", video_file.name)

        if not frames:
            if not dry_run:
                _update_keyframe_status(video_id, "failed", "no frames extracted")
            return {**stats, "status": "failed"}

        # Step 3: Classify + store each frame
        for i, frame_path in enumerate(frames):
            classification = _classify_frame(frame_path)
            if not classification:
                frame_path.unlink(missing_ok=True)
                continue

            category = classification.get("category", "discard")

            if dry_run:
                logger.info(
                    "[DRY RUN] frame %d → %s | faults=%s | equipment=%s",
                    i,
                    category,
                    classification.get("fault_codes", []),
                    classification.get("equipment_visible", "")[:40],
                )
                if category in KEEP_CATEGORIES:
                    stats["frames_kept"] += 1
                else:
                    stats["frames_discarded"] += 1
                frame_path.unlink(missing_ok=True)
                continue

            if category not in KEEP_CATEGORIES:
                stats["frames_discarded"] += 1
                frame_path.unlink(missing_ok=True)
                continue

            stored = _store_frame(
                frame_path=frame_path,
                video_id=video_id,
                frame_index=i,
                classification=classification,
                video_meta=video_meta,
                tenant_id=tenant_id,
                ollama_url=ollama_url,
                vision_model=vision_model,
            )
            if stored:
                stats["frames_kept"] += 1
            else:
                stats["frames_discarded"] += 1

            frame_path.unlink(missing_ok=True)

    # tmp directory cleaned up automatically by context manager

    final_status = "dry_run" if dry_run else ("done" if stats["frames_kept"] >= 0 else "failed")
    stats["status"] = final_status

    if not dry_run:
        _update_keyframe_status(video_id, "done" if stats["frames_kept"] >= 0 else "failed")

    logger.info(
        "Keyframes done: %s | extracted=%d kept=%d discarded=%d",
        video_id, stats["frames_extracted"], stats["frames_kept"], stats["frames_discarded"],
    )
    return stats

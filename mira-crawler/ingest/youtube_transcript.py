"""YouTube transcript extraction and ingestion.

Pulls timestamped captions via youtube-transcript-api, chunks into
60-second windows, embeds with nomic-embed-text, and stores in
knowledge_entries with source_type="youtube_transcript".

Metadata stored per chunk:
  channel_name, video_title, timestamp_start, view_count
  (enables future retrieval weighting by engagement signal)
"""

from __future__ import annotations

import json
import logging
import os
import uuid

from ingest.embedder import embed_text
from ingest.store import chunk_exists

logger = logging.getLogger("mira-crawler.youtube.transcript")

# 60-second windows — preserves one teaching moment per chunk
WINDOW_SECONDS = int(os.getenv("YOUTUBE_TRANSCRIPT_WINDOW_S", "60"))
# Minimum text length to bother embedding
MIN_CHUNK_CHARS = 80


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


def _update_video_status(video_id: str, status: str, error_msg: str = "") -> None:
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            conn.execute(
                text("""
                    UPDATE youtube_videos
                    SET transcript_status = :status,
                        error_msg = CASE WHEN :err != '' THEN :err ELSE error_msg END,
                        updated_at = now()
                    WHERE video_id = :vid
                """),
                {"status": status, "err": error_msg, "vid": video_id},
            )
            conn.commit()
    except Exception as e:
        logger.error("Status update failed for %s: %s", video_id, e)


def _get_video_meta(video_id: str) -> dict:
    """Fetch title, channel_name, view_count from youtube_videos."""
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            row = conn.execute(
                text("""
                    SELECT title, channel_name, view_count
                    FROM youtube_videos WHERE video_id = :vid
                """),
                {"vid": video_id},
            ).fetchone()
        if row:
            return {"title": row[0] or "", "channel_name": row[1] or "", "view_count": row[2] or 0}
    except Exception as e:
        logger.warning("Meta fetch failed for %s: %s", video_id, e)
    return {"title": "", "channel_name": "", "view_count": 0}


def _fetch_transcript(video_id: str) -> list[dict] | None:
    """Fetch transcript via youtube-transcript-api. Returns list of {text, start, duration}."""
    try:
        from youtube_transcript_api import (
            YouTubeTranscriptApi,
        )

        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US"])
        return transcript
    except Exception as e:
        err = str(e)
        if "disabled" in err.lower() or "no transcript" in err.lower():
            logger.info("No captions for %s: %s", video_id, err)
            return None
        logger.warning("Transcript fetch error for %s: %s", video_id, err)
        return None


def _window_chunks(
    transcript: list[dict],
    video_id: str,
    title: str,
    channel_name: str,
    view_count: int,
    window_s: int = WINDOW_SECONDS,
) -> list[dict]:
    """Group transcript segments into fixed time windows.

    Each chunk covers `window_s` seconds of video and carries full
    metadata so retrieval can surface the source video + timestamp.
    """
    if not transcript:
        return []

    chunks: list[dict] = []
    window_text: list[str] = []
    window_start = transcript[0]["start"]
    chunk_index = 0

    for seg in transcript:
        seg_start = seg["start"]
        seg_text = seg["text"].strip().replace("\n", " ")

        # Flush window when we've crossed the time boundary
        if seg_start - window_start >= window_s and window_text:
            text = " ".join(window_text).strip()
            if len(text) >= MIN_CHUNK_CHARS:
                chunks.append({
                    "text": text,
                    "source_url": f"https://www.youtube.com/watch?v={video_id}&t={int(window_start)}",
                    "source_type": "youtube_transcript",
                    "chunk_index": chunk_index,
                    "chunk_type": "text",
                    "metadata_extra": {
                        "channel_name": channel_name,
                        "video_title": title,
                        "timestamp_start": int(window_start),
                        "view_count": view_count,
                        "video_id": video_id,
                    },
                })
                chunk_index += 1
            window_text = [seg_text]
            window_start = seg_start
        else:
            window_text.append(seg_text)

    # Flush final window
    if window_text:
        text = " ".join(window_text).strip()
        if len(text) >= MIN_CHUNK_CHARS:
            chunks.append({
                "text": text,
                "source_url": f"https://www.youtube.com/watch?v={video_id}&t={int(window_start)}",
                "source_type": "youtube_transcript",
                "chunk_index": chunk_index,
                "chunk_type": "text",
                "metadata_extra": {
                    "channel_name": channel_name,
                    "video_title": title,
                    "timestamp_start": int(window_start),
                    "view_count": view_count,
                    "video_id": video_id,
                },
            })

    return chunks


def _insert_chunk_with_meta(
    tenant_id: str,
    chunk: dict,
    embedding: list[float],
    ollama_url: str,
    vision_model: str,
) -> str:
    """Insert a transcript chunk with extended YouTube metadata into NeonDB."""
    from sqlalchemy import text

    entry_id = str(uuid.uuid4())
    source_url = chunk["source_url"]
    extra = chunk.get("metadata_extra", {})

    metadata = {
        "chunk_index": chunk["chunk_index"],
        "chunk_type": "text",
        "source": "youtube_transcript",
        "channel_name": extra.get("channel_name", ""),
        "video_title": extra.get("video_title", ""),
        "timestamp_start": extra.get("timestamp_start", 0),
        "view_count": extra.get("view_count", 0),
        "video_id": extra.get("video_id", ""),
    }

    try:
        engine = _neon_engine()
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, manufacturer, model_number,
                         content, embedding, source_url, source_page,
                         metadata, is_private, verified, chunk_type)
                    VALUES
                        (:id, :tid, :stype, '', '',
                         :content, cast(:emb AS vector), :src_url, :src_page,
                         cast(:meta AS jsonb), false, false, 'text')
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": entry_id,
                    "tid": tenant_id,
                    "stype": "youtube_transcript",
                    "content": chunk["text"],
                    "emb": str(embedding),
                    "src_url": source_url,
                    "src_page": chunk["chunk_index"],
                    "meta": json.dumps(metadata),
                },
            )
            conn.commit()
        return entry_id
    except Exception as e:
        logger.error("Insert failed for chunk %d: %s", chunk["chunk_index"], e)
        return ""


def ingest_transcript(video_id: str, dry_run: bool = False) -> dict:
    """Full transcript ingestion pipeline for one video.

    Returns {video_id, chunks_total, inserted, skipped, status}.
    """
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
    vision_model = os.getenv("EMBED_VISION_MODEL", "nomic-embed-vision:v1.5")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set")
        return {"video_id": video_id, "chunks_total": 0, "inserted": 0, "skipped": 0, "status": "error"}

    meta = _get_video_meta(video_id)
    logger.info("Ingesting transcript: %s | %s", video_id, meta["title"][:60])

    transcript = _fetch_transcript(video_id)
    if transcript is None:
        if not dry_run:
            _update_video_status(video_id, "no_captions")
        return {"video_id": video_id, "chunks_total": 0, "inserted": 0, "skipped": 0, "status": "no_captions"}

    chunks = _window_chunks(
        transcript,
        video_id=video_id,
        title=meta["title"],
        channel_name=meta["channel_name"],
        view_count=meta["view_count"],
    )

    if not chunks:
        if not dry_run:
            _update_video_status(video_id, "failed", "no chunks after windowing")
        return {"video_id": video_id, "chunks_total": 0, "inserted": 0, "skipped": 0, "status": "failed"}

    if dry_run:
        for chunk in chunks[:3]:
            extra = chunk.get("metadata_extra", {})
            logger.info(
                "[DRY RUN] chunk %d | t=%ds | view_count=%d | %s...",
                chunk["chunk_index"],
                extra.get("timestamp_start", 0),
                extra.get("view_count", 0),
                chunk["text"][:80],
            )
        logger.info("[DRY RUN] Total chunks: %d (showing first 3)", len(chunks))
        return {
            "video_id": video_id,
            "chunks_total": len(chunks),
            "inserted": 0,
            "skipped": 0,
            "status": "dry_run",
        }

    inserted = 0
    skipped = 0
    for chunk in chunks:
        source_url = chunk["source_url"]
        chunk_idx = chunk["chunk_index"]

        if chunk_exists(tenant_id, source_url, chunk_idx):
            skipped += 1
            continue

        embedding = embed_text(chunk["text"], ollama_url=ollama_url, model=embed_model)
        if embedding is None:
            continue

        entry_id = _insert_chunk_with_meta(
            tenant_id=tenant_id,
            chunk=chunk,
            embedding=embedding,
            ollama_url=ollama_url,
            vision_model=vision_model,
        )
        if entry_id:
            inserted += 1

    status = "done" if inserted > 0 or skipped == len(chunks) else "failed"
    _update_video_status(video_id, status)

    logger.info(
        "Transcript done: %s | inserted=%d skipped=%d total=%d",
        video_id, inserted, skipped, len(chunks),
    )
    return {
        "video_id": video_id,
        "chunks_total": len(chunks),
        "inserted": inserted,
        "skipped": skipped,
        "status": status,
    }

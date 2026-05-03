"""YouTube knowledge harvester — search-driven transcript extraction.

Uses the knowledge base (NeonDB knowledge_entries) and the Reddit corpus as
search-term sources to find YouTube videos, download their transcripts, and
extract structured equipment knowledge — then writes a corpus/youtube/ tree.

This is knowledge-first, not channel-first: we know what equipment is in the
KB, so we go find expert videos about exactly those topics.

Dependencies:
    youtube-transcript-api  (pip install youtube-transcript-api)
    yt-dlp                  (pip install yt-dlp — also needs to be CLI-available)

Usage:
    python corpus/youtube_harvester.py --source both --limit 10 --dry-run
    python corpus/youtube_harvester.py --source kb_chunks --limit 5
    python corpus/youtube_harvester.py --source reddit --limit 20
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

from extractors.classifier import classify
from extractors.equipment import extract_equipment, has_equipment_mention
from extractors.fault_codes import extract_fault_codes, has_fault_code

logger = logging.getLogger("youtube-harvester")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

_CORPUS_DIR = Path(__file__).parent
_OUT_DIR = _CORPUS_DIR / "youtube"

# Duration filter: 5 – 30 minutes (tutorial-length)
_MIN_DURATION = 300
_MAX_DURATION = 1800

# Transcript chunk size
_CHUNK_WORDS = 500
_OVERLAP_WORDS = 50

# Rate limiting between yt-dlp search calls
_SEARCH_SLEEP = 2.0

# ---------------------------------------------------------------------------
# Hardcoded gap-filler queries (important topics often missing from KB)
# ---------------------------------------------------------------------------

_GAP_QUERIES: list[tuple[str, str]] = [
    ("how to megger test a motor tutorial", "mechanical"),
    ("VFD variable frequency drive troubleshooting basics", "electrical"),
    ("PLC ladder logic programming tutorial beginners", "controls"),
    ("4-20mA loop troubleshooting explained", "instrumentation"),
    ("motor starter wiring diagram tutorial", "electrical"),
    ("thermal overload relay setting and troubleshooting", "electrical"),
    ("hydraulic system troubleshooting basics", "hydraulic"),
    ("pneumatic valve solenoid troubleshooting", "pneumatic"),
    ("bearing vibration analysis predictive maintenance", "mechanical"),
    ("HVAC refrigerant leak diagnosis and repair", "HVAC"),
    ("PID controller tuning explained industrial", "instrumentation"),
    ("electrical panel infrared thermography inspection", "electrical"),
    ("gearbox oil analysis and condition monitoring", "mechanical"),
    ("three phase motor winding test resistance", "mechanical"),
    ("servo drive alarm fault code troubleshooting", "controls"),
]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class SearchTerm:
    query: str
    category: str
    manufacturer: str = ""
    model: str = ""
    equipment_type: str = ""
    source: str = "manual"


@dataclass
class VideoMeta:
    video_id: str
    title: str
    channel: str
    channel_url: str
    video_url: str
    duration_seconds: int
    view_count: int
    like_count: int
    description: str


@dataclass
class KnowledgeChunk:
    video_id: str
    video_title: str
    channel: str
    channel_url: str
    video_url: str
    duration_seconds: int
    view_count: int
    like_count: int
    chunk_index: int
    chunk_text: str
    word_count: int
    topic: str
    category: str
    manufacturer: str
    equipment_type: str
    model_number: str
    fault_codes: list[dict] = field(default_factory=list)
    search_query: str = ""
    knowledge_entry: str = ""


# ---------------------------------------------------------------------------
# Search term extraction
# ---------------------------------------------------------------------------


def _build_from_neondb(db_url: str, limit: int = 300) -> list[SearchTerm]:
    """Query knowledge_entries for unique manufacturer/model/equipment combos."""
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except ImportError:
        logger.warning("sqlalchemy not available — skipping kb_chunks source")
        return []

    try:
        engine = create_engine(
            db_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
        )
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT DISTINCT
                    COALESCE(manufacturer, '') AS manufacturer,
                    COALESCE(model_number, '')  AS model_number,
                    COALESCE(equipment_type, '') AS equipment_type
                FROM knowledge_entries
                WHERE (manufacturer    IS NOT NULL AND manufacturer    != '')
                   OR (model_number    IS NOT NULL AND model_number    != '')
                   OR (equipment_type  IS NOT NULL AND equipment_type  != '')
                LIMIT :lim
            """), {"lim": limit}).fetchall()
    except Exception as exc:
        logger.warning("NeonDB query failed: %s — skipping kb_chunks source", exc)
        return []

    topics = ["troubleshooting", "fault codes", "maintenance"]
    terms: list[SearchTerm] = []
    seen: set[str] = set()

    for row in rows:
        mfr, model, etype = row[0].strip(), row[1].strip(), row[2].strip()
        for topic in topics:
            if mfr and model:
                q = f"{mfr} {model} {topic}"
            elif mfr and etype:
                q = f"{mfr} {etype} {topic}"
            elif model:
                q = f"{model} {topic}"
            elif etype:
                q = f"{etype} {topic}"
            else:
                continue
            if q not in seen:
                seen.add(q)
                terms.append(SearchTerm(
                    query=q,
                    category="electrical",
                    manufacturer=mfr,
                    model=model,
                    equipment_type=etype,
                    source="kb_chunks",
                ))

    logger.info("Built %d search terms from NeonDB", len(terms))
    return terms


def _build_from_reddit(corpus_dir: Path) -> list[SearchTerm]:
    """Extract search terms from quality-pass Reddit posts."""
    qfile = corpus_dir / "processed" / "questions.json"
    if not qfile.exists():
        logger.warning("Reddit corpus not found at %s — skipping", qfile)
        return []

    posts = json.loads(qfile.read_text())
    quality_posts = [p for p in posts if p.get("quality_pass")]

    terms: list[SearchTerm] = []
    seen: set[str] = set()

    for post in quality_posts:
        mfr = post.get("manufacturer", "") or ""
        etype = post.get("equipment_type", "") or ""
        cat = post.get("category", "general")

        if not mfr and not etype:
            continue

        for topic in ["troubleshooting", "repair", "fault diagnosis"]:
            if mfr and etype:
                q = f"{mfr} {etype} {topic}"
            elif mfr:
                q = f"{mfr} {topic}"
            else:
                q = f"{etype} {topic}"
            if q not in seen:
                seen.add(q)
                terms.append(SearchTerm(
                    query=q,
                    category=cat,
                    manufacturer=mfr,
                    equipment_type=etype,
                    source="reddit",
                ))

    logger.info("Built %d search terms from Reddit corpus", len(terms))
    return terms


def build_search_queue(
    source: str,
    db_url: str | None,
    corpus_dir: Path,
) -> list[SearchTerm]:
    """Combine search terms from all requested sources, deduped."""
    all_terms: list[SearchTerm] = []
    seen_queries: set[str] = set()

    if source in ("kb_chunks", "both") and db_url:
        all_terms.extend(_build_from_neondb(db_url))

    if source in ("reddit", "both"):
        all_terms.extend(_build_from_reddit(corpus_dir))

    # Always append gap-fillers
    for q, cat in _GAP_QUERIES:
        if q not in seen_queries:
            all_terms.append(SearchTerm(query=q, category=cat, source="manual"))

    # Deduplicate
    deduped: list[SearchTerm] = []
    for t in all_terms:
        if t.query not in seen_queries:
            seen_queries.add(t.query)
            deduped.append(t)

    logger.info("Total search queue: %d queries", len(deduped))
    return deduped


# ---------------------------------------------------------------------------
# YouTube search via yt-dlp
# ---------------------------------------------------------------------------


def search_youtube(query: str, max_results: int = 10) -> list[VideoMeta]:
    """Search YouTube via yt-dlp Python API (falls back to CLI subprocess)."""
    # Prefer Python API (no PATH dependency)
    try:
        import yt_dlp  # type: ignore[import]
        return _search_youtube_api(query, max_results, yt_dlp)
    except ImportError:
        pass

    # CLI fallback
    return _search_youtube_cli(query, max_results)


def _search_youtube_api(query: str, max_results: int, yt_dlp) -> list[VideoMeta]:  # type: ignore[no-untyped-def]
    """Search using yt_dlp Python package."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    videos: list[VideoMeta] = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)
            if not info or "entries" not in info:
                return []
            for entry in info["entries"] or []:
                if not entry:
                    continue
                vid_id = entry.get("id", "")
                if not vid_id:
                    continue
                videos.append(VideoMeta(
                    video_id=vid_id,
                    title=entry.get("title", ""),
                    channel=entry.get("uploader") or entry.get("channel") or "",
                    channel_url=entry.get("uploader_url") or entry.get("channel_url") or "",
                    video_url=entry.get("webpage_url") or f"https://www.youtube.com/watch?v={vid_id}",
                    duration_seconds=int(entry.get("duration") or 0),
                    view_count=int(entry.get("view_count") or 0),
                    like_count=int(entry.get("like_count") or 0),
                    description=(entry.get("description") or "")[:500],
                ))
    except Exception as exc:
        logger.warning("yt-dlp API search failed for '%s': %s", query, exc)
    return videos


def _search_youtube_cli(query: str, max_results: int) -> list[VideoMeta]:
    """Search using yt-dlp CLI subprocess fallback."""
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                f"ytsearch{max_results}:{query}",
                "--dump-json",
                "--no-playlist",
                "--no-warnings",
                "--quiet",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        logger.error("yt-dlp not found — install with: pip install yt-dlp")
        return []
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp search timed out for: %s", query)
        return []

    videos: list[VideoMeta] = []
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        vid_id = data.get("id", "")
        if not vid_id:
            continue
        videos.append(VideoMeta(
            video_id=vid_id,
            title=data.get("title", ""),
            channel=data.get("uploader") or data.get("channel") or "",
            channel_url=data.get("uploader_url") or data.get("channel_url") or "",
            video_url=data.get("webpage_url") or f"https://www.youtube.com/watch?v={vid_id}",
            duration_seconds=int(data.get("duration") or 0),
            view_count=int(data.get("view_count") or 0),
            like_count=int(data.get("like_count") or 0),
            description=(data.get("description") or "")[:500],
        ))
    return videos


def filter_by_duration(
    videos: list[VideoMeta],
    min_sec: int = _MIN_DURATION,
    max_sec: int = _MAX_DURATION,
) -> list[VideoMeta]:
    return [v for v in videos if min_sec <= v.duration_seconds <= max_sec]


# ---------------------------------------------------------------------------
# VTT parser (mirrors mira-crawler/tasks/youtube.py — kept in sync manually)
# ---------------------------------------------------------------------------

_TS_RE = re.compile(
    r"^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})\s*-->\s*"
    r"(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})"
)
_CUE_ID_RE = re.compile(r"^\d+\s*$")
_VTT_TAG_RE = re.compile(r"<[^>]+>")


def _ts_to_seconds(h: str | None, m: str, s: str, ms: str) -> float:
    hours = int(h) if h else 0
    return hours * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def _parse_vtt(content: str) -> list[dict]:
    if not content:
        return []
    segments: list[dict] = []
    lines = content.splitlines()
    i = 0
    while i < len(lines) and not lines[i].startswith("WEBVTT"):
        i += 1
    i += 1
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith(("NOTE", "STYLE", "REGION")):
            i += 1
            while i < len(lines) and lines[i].strip():
                i += 1
            continue
        if _CUE_ID_RE.match(line):
            i += 1
            continue
        ts_match = _TS_RE.match(line)
        if ts_match:
            (h1, m1, s1, ms1, h2, m2, s2, ms2) = ts_match.groups()
            start = _ts_to_seconds(h1, m1, s1, ms1)
            end = _ts_to_seconds(h2, m2, s2, ms2)
            i += 1
            text_lines: list[str] = []
            while i < len(lines):
                tl = lines[i].strip()
                if not tl:
                    break
                if _TS_RE.match(tl):
                    break
                if _CUE_ID_RE.match(tl) and i + 1 < len(lines) and _TS_RE.match(lines[i + 1].strip()):
                    break
                text_lines.append(tl)
                i += 1
            raw_text = " ".join(text_lines)
            clean = _VTT_TAG_RE.sub("", raw_text).strip()
            if clean:
                segments.append({"text": clean, "start": start, "duration": end - start})
            continue
        i += 1
    return segments


# ---------------------------------------------------------------------------
# Transcript download — yt-dlp VTT primary, youtube_transcript_api fallback
# ---------------------------------------------------------------------------


def get_transcript(video_id: str) -> list[dict] | None:
    """Download transcript for video_id. Returns list[{text, start, duration}] or None."""
    video_url = f"https://www.youtube.com/watch?v={video_id}"

    # Primary: yt-dlp Python API (better anti-bot handling than youtube_transcript_api)
    try:
        import yt_dlp  # type: ignore[import]
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                "writeautomaticsub": True,
                "subtitleslangs": ["en"],
                "subtitlesformat": "vtt",
                "skip_download": True,
                "outtmpl": f"{tmpdir}/%(id)s.%(ext)s",
                "quiet": True,
                "no_warnings": True,
            }
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([video_url])
            except Exception:
                pass

            vtt_files = list(Path(tmpdir).glob("*.vtt"))
            if vtt_files:
                content = vtt_files[0].read_text(encoding="utf-8", errors="replace")
                segs = _parse_vtt(content)
                if segs:
                    return segs
    except ImportError:
        pass

    # Fallback: youtube_transcript_api (v1.0+)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt = YouTubeTranscriptApi()  # type: ignore[call-arg]
        transcript = ytt.fetch(video_id)  # type: ignore[attr-defined]
        return [{"text": s.text, "start": s.start, "duration": s.duration} for s in transcript]
    except Exception as exc:
        logger.debug("No transcript for %s: %s", video_id, exc)

    return None


# ---------------------------------------------------------------------------
# Transcript chunking + topic classification
# ---------------------------------------------------------------------------


_TOPIC_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(
        r"\b(troubleshoot|fault|error|alarm|fix|repair|diagnos|problem|issue|trip)\b", re.I
    ), "troubleshooting"),
    (re.compile(
        r"\b(install|wiring|wire|setup|commission|mount|connect)\b", re.I
    ), "installation"),
    (re.compile(
        r"\b(maintenance|PM|preventive|preventative|inspect|lubrication|calibrat|service)\b", re.I
    ), "maintenance"),
    (re.compile(
        r"\b(how\s+does|what\s+is|explain|understand|basics|introduc|overview|principle|theory)\b", re.I
    ), "theory"),
]


def classify_topic(text: str) -> str:
    for pattern, topic in _TOPIC_PATTERNS:
        if pattern.search(text):
            return topic
    return "general"


def chunk_transcript(
    segments: list[dict],
    chunk_words: int = _CHUNK_WORDS,
    overlap_words: int = _OVERLAP_WORDS,
) -> list[str]:
    """Merge transcript segments into word-count-bounded chunks with overlap."""
    full_text = " ".join(s.get("text", "") for s in segments)
    words = full_text.split()
    if not words:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_words, len(words))
        chunks.append(" ".join(words[start:end]))
        start += chunk_words - overlap_words
        if start >= len(words):
            break

    return chunks


# ---------------------------------------------------------------------------
# Per-video processing
# ---------------------------------------------------------------------------


def process_video(
    meta: VideoMeta,
    segments: list[dict],
    search_term: SearchTerm,
) -> list[KnowledgeChunk]:
    """Run extractors + topic classification on each transcript chunk."""
    raw_chunks = chunk_transcript(segments)
    result: list[KnowledgeChunk] = []

    for idx, chunk_text in enumerate(raw_chunks):
        equip = extract_equipment(chunk_text)
        codes = extract_fault_codes(chunk_text)
        has_eq = has_equipment_mention(chunk_text)
        has_fc = has_fault_code(chunk_text)

        cl = classify(
            title=meta.title,
            body=chunk_text,
            score=max(meta.like_count // 10, 1),
            has_equipment=has_eq,
            has_fault_code=has_fc,
        )

        topic = classify_topic(chunk_text)
        mfr = equip.manufacturer or search_term.manufacturer
        etype = equip.equipment_type or search_term.equipment_type

        knowledge_entry = (
            f"Expert {meta.channel} says about {mfr or etype or 'industrial equipment'}: "
            f"{chunk_text[:300]}"
        )

        result.append(KnowledgeChunk(
            video_id=meta.video_id,
            video_title=meta.title,
            channel=meta.channel,
            channel_url=meta.channel_url,
            video_url=meta.video_url,
            duration_seconds=meta.duration_seconds,
            view_count=meta.view_count,
            like_count=meta.like_count,
            chunk_index=idx,
            chunk_text=chunk_text,
            word_count=len(chunk_text.split()),
            topic=topic,
            category=cl.category,
            manufacturer=mfr,
            equipment_type=etype,
            model_number=equip.model or search_term.model,
            fault_codes=[
                {"code": fc.code, "manufacturer": fc.manufacturer, "description": fc.description}
                for fc in codes
            ],
            search_query=search_term.query,
            knowledge_entry=knowledge_entry,
        ))

    return result


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def _write_outputs(all_chunks: list[KnowledgeChunk], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "raw").mkdir(exist_ok=True)
    (out_dir / "processed").mkdir(exist_ok=True)
    (out_dir / "by_equipment").mkdir(exist_ok=True)
    (out_dir / "by_topic").mkdir(exist_ok=True)

    # All processed chunks
    chunk_dicts = [asdict(c) for c in all_chunks]
    (out_dir / "processed" / "chunks.json").write_text(json.dumps(chunk_dicts, indent=2))

    # By equipment type
    by_equip: dict[str, list[dict]] = defaultdict(list)
    for c in chunk_dicts:
        key = c.get("equipment_type") or "unknown"
        by_equip[key].append(c)
    for etype, items in by_equip.items():
        safe = re.sub(r"[^a-z0-9_]", "_", etype.lower())
        (out_dir / "by_equipment" / f"{safe}.json").write_text(json.dumps(items, indent=2))

    # By topic
    by_topic: dict[str, list[dict]] = defaultdict(list)
    for c in chunk_dicts:
        by_topic[c.get("topic", "general")].append(c)
    for topic, items in by_topic.items():
        (out_dir / "by_topic" / f"{topic}.json").write_text(json.dumps(items, indent=2))


def _build_expert_index(all_chunks: list[KnowledgeChunk]) -> dict:
    index: dict[str, dict] = {}
    for c in all_chunks:
        ch = c.channel
        if ch not in index:
            index[ch] = {
                "channel_url": c.channel_url,
                "video_ids": [],
                "video_count": 0,
                "chunk_count": 0,
                "topics": set(),
                "manufacturers": set(),
                "equipment_types": set(),
            }
        e = index[ch]
        if c.video_id not in e["video_ids"]:
            e["video_ids"].append(c.video_id)
            e["video_count"] += 1
        e["chunk_count"] += 1
        if c.topic:
            e["topics"].add(c.topic)
        if c.manufacturer:
            e["manufacturers"].add(c.manufacturer)
        if c.equipment_type:
            e["equipment_types"].add(c.equipment_type)

    # Convert sets to sorted lists for JSON serialization
    for e in index.values():
        e["topics"] = sorted(e["topics"])
        e["manufacturers"] = sorted(e["manufacturers"])
        e["equipment_types"] = sorted(e["equipment_types"])
        del e["video_ids"]

    return index


# ---------------------------------------------------------------------------
# Main harvest
# ---------------------------------------------------------------------------


def harvest(
    source: str,
    limit: int,
    dry_run: bool,
    db_url: str | None,
    corpus_dir: Path,
    out_dir: Path,
) -> None:
    queue = build_search_queue(source, db_url, corpus_dir)

    # Cap queue to --limit
    queue = queue[:limit]

    if dry_run:
        print(f"\nDry run — would process {len(queue)} search queries:\n")
        for i, t in enumerate(queue, 1):
            print(f"  {i:3d}. [{t.source:10s}] {t.query}")
        return

    all_chunks: list[KnowledgeChunk] = []
    seen_video_ids: set[str] = set()
    videos_found = 0
    videos_processed = 0
    transcripts_downloaded = 0

    for term in queue:
        logger.info("Searching: %s", term.query)
        candidates = search_youtube(term.query, max_results=10)
        time.sleep(_SEARCH_SLEEP)

        filtered = filter_by_duration(candidates)
        logger.info("  → %d results, %d in duration range", len(candidates), len(filtered))
        videos_found += len(filtered)

        for meta in filtered:
            if meta.video_id in seen_video_ids:
                continue
            seen_video_ids.add(meta.video_id)
            videos_processed += 1

            # Save raw metadata
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "raw").mkdir(exist_ok=True)
            raw_file = out_dir / "raw" / f"{meta.video_id}.json"
            if not raw_file.exists():
                raw_file.write_text(json.dumps(asdict(meta) | {"search_query": term.query}, indent=2))

            # Download transcript
            segments = get_transcript(meta.video_id)
            if segments is None:
                logger.info("  No English transcript: %s — %s", meta.video_id, meta.title[:60])
                continue
            transcripts_downloaded += 1

            # Process
            chunks = process_video(meta, segments, term)
            all_chunks.extend(chunks)
            logger.info(
                "  Processed: %s (%ds, %d chunks) — %s",
                meta.video_id,
                meta.duration_seconds,
                len(chunks),
                meta.title[:60],
            )

    # Write outputs
    _write_outputs(all_chunks, out_dir)

    expert_index = _build_expert_index(all_chunks)
    (out_dir / "expert_index.json").write_text(json.dumps(expert_index, indent=2))

    # Stats
    by_equip: dict[str, int] = defaultdict(int)
    by_topic: dict[str, int] = defaultdict(int)
    for c in all_chunks:
        by_equip[c.equipment_type or "unknown"] += 1
        by_topic[c.topic] += 1

    print(f"\n{'='*60}")
    print(f"YouTube harvest complete")
    print(f"{'='*60}")
    print(f"  Search queries processed: {len(queue)}")
    print(f"  Videos found (in range):  {videos_found}")
    print(f"  Videos processed:         {videos_processed}")
    print(f"  Transcripts downloaded:   {transcripts_downloaded}")
    print(f"  Knowledge chunks:         {len(all_chunks)}")
    print(f"  Unique channels:          {len(expert_index)}")

    print("\nBy topic:")
    for topic, n in sorted(by_topic.items(), key=lambda x: -x[1]):
        print(f"  {topic:<20} {n:>4} chunks")

    print("\nBy equipment type (top 10):")
    for etype, n in sorted(by_equip.items(), key=lambda x: -x[1])[:10]:
        print(f"  {etype:<25} {n:>4} chunks")

    print(f"\nOutput: {out_dir}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="YouTube knowledge harvester — search-driven transcript extraction"
    )
    parser.add_argument(
        "--source",
        default="both",
        choices=["kb_chunks", "reddit", "both", "manual"],
        help="Search term source (default: both)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Max number of search queries to process (default: 10)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the search queue without downloading anything",
    )
    parser.add_argument(
        "--out-dir",
        default=str(_OUT_DIR),
        help="Output directory (default: corpus/youtube/)",
    )
    parser.add_argument(
        "--corpus-dir",
        default=str(_CORPUS_DIR),
        help="Corpus root directory (default: corpus/)",
    )
    args = parser.parse_args()

    db_url = os.environ.get("NEON_DATABASE_URL")
    if args.source in ("kb_chunks", "both") and not db_url:
        logger.warning(
            "NEON_DATABASE_URL not set — kb_chunks source unavailable; "
            "falling back to reddit + manual"
        )

    harvest(
        source=args.source,
        limit=args.limit,
        dry_run=args.dry_run,
        db_url=db_url,
        corpus_dir=Path(args.corpus_dir),
        out_dir=Path(args.out_dir),
    )

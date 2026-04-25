"""YouTube teaching pattern extraction via Claude.

Analyzes full video transcripts to extract the structured teaching
approach used by top industrial maintenance educators. Patterns are
stored in the teaching_patterns NeonDB table.

Weekly, the top 5 patterns by engagement_score are collapsed into a
style addendum injected into every bot's system prompt — so MIRA
responds like winning educators, not just like a manual.

engagement_score = view_count / channel_median_views
  (computed after insertion — high-view videos relative to their
   channel are promoted as "winning" patterns)
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path

import httpx

logger = logging.getLogger("mira-crawler.youtube.pattern")

_EXTRACT_PROMPT = """You are analyzing the transcript of an industrial maintenance or PLC programming tutorial video.

Extract the teaching structure used in this video. Respond ONLY with valid JSON matching this exact schema:

{
  "opening_hook": "<how the video opens: real fault scenario | theory intro | equipment demo | other>",
  "problem_statement": "<the specific problem or fault being taught, one sentence>",
  "diagnostic_steps": [
    "<step 1: concrete action the tech takes>",
    "<step 2>",
    "<step 3>",
    "... (include all distinct diagnostic/fix steps, minimum 3 if present)"
  ],
  "resolution_format": "<how the solution is presented: root_cause→fix→verify | demo_only | theory_only | other>",
  "analogies_used": ["<any analogies or comparisons used to explain concepts>"],
  "teaches_to_camera": <true if instructor demonstrates on real equipment, false if slides/whiteboard only>,
  "domain": "<vfd | plc | electrical | motor | general>"
}

If the transcript does not contain a clear instructional structure, return:
{"domain": "general", "diagnostic_steps": [], "opening_hook": "unclear", "problem_statement": "", "resolution_format": "unknown", "analogies_used": [], "teaches_to_camera": false}

TRANSCRIPT:
"""

_STYLE_TEMPLATE = """TEACHING STYLE (learned from top industrial educators):
{rules}"""

_STYLE_RULES_DEFAULT = [
    "Lead with the symptom and fault code, not theory",
    "Follow: observe → measure → isolate → fix → verify",
    "Name the specific parameter when recommending a setting change",
    "Use one analogy maximum per explanation",
    "End with a verification step the tech can perform immediately",
    "For PLC faults: map HMI alarm → ladder logic rung → fix → test in program",
]


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


def _update_pattern_status(video_id: str, status: str, error_msg: str = "") -> None:
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            conn.execute(
                text("""
                    UPDATE youtube_videos
                    SET pattern_status = :status,
                        error_msg = CASE WHEN :err != '' THEN :err ELSE error_msg END,
                        updated_at = now()
                    WHERE video_id = :vid
                """),
                {"status": status, "err": error_msg, "vid": video_id},
            )
            conn.commit()
    except Exception as e:
        logger.error("Pattern status update failed for %s: %s", video_id, e)


def _get_full_transcript(video_id: str) -> str | None:
    """Reconstruct full transcript text from knowledge_entries chunks."""
    from sqlalchemy import text

    try:
        with _neon_engine().connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT content
                    FROM knowledge_entries
                    WHERE source_type = 'youtube_transcript'
                      AND metadata->>'video_id' = :vid
                    ORDER BY (metadata->>'chunk_index')::int ASC
                """),
                {"vid": video_id},
            ).fetchall()
        if not rows:
            return None
        return " ".join(r[0] for r in rows)
    except Exception as e:
        logger.error("Transcript fetch failed for %s: %s", video_id, e)
        return None


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


def _claude_extract_pattern(transcript: str) -> dict | None:
    """Extract teaching pattern via Ollama qwen2.5vl:7b (local, no API key required)."""
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.getenv("YOUTUBE_VISION_MODEL", "qwen2.5vl:7b")

    truncated = transcript[:12000].encode("utf-8", errors="ignore").decode("utf-8")
    if len(transcript) > 12000:
        truncated += "\n[transcript truncated]"

    prompt = _EXTRACT_PROMPT + truncated

    try:
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                f"{ollama_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 600},
                },
            )
            resp.raise_for_status()
            content = resp.json()["response"].strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)
    except json.JSONDecodeError as e:
        logger.warning("JSON parse error in pattern extraction: %s", e)
        return None
    except Exception as e:
        logger.error("Pattern extraction failed: %s", e)
        return None


def _store_pattern(video_id: str, pattern: dict, view_count: int) -> bool:
    """Insert pattern into teaching_patterns table."""
    from sqlalchemy import text

    entry_id = str(uuid.uuid4())
    # engagement_score computed later via regen task — store None initially
    try:
        with _neon_engine().connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO teaching_patterns (id, source_video_id, pattern_json, engagement_score)
                    VALUES (:id, :vid, cast(:pattern AS jsonb), NULL)
                    ON CONFLICT DO NOTHING
                """),
                {"id": entry_id, "vid": video_id, "pattern": json.dumps(pattern)},
            )
            conn.commit()
        return True
    except Exception as e:
        logger.error("Pattern store failed for %s: %s", video_id, e)
        return False


def analyze_pattern(video_id: str, dry_run: bool = False) -> dict:
    """Extract and store teaching pattern for one video.

    Returns {video_id, pattern, status}.
    """
    meta = _get_video_meta(video_id)
    logger.info("Analyzing pattern: %s | %s", video_id, meta["title"][:60])

    transcript = _get_full_transcript(video_id)
    if not transcript:
        logger.warning("No transcript found in NeonDB for %s — skipping pattern", video_id)
        if not dry_run:
            _update_pattern_status(video_id, "failed", "no transcript in KB")
        return {"video_id": video_id, "pattern": None, "status": "failed"}

    pattern = _claude_extract_pattern(transcript)
    if not pattern:
        if not dry_run:
            _update_pattern_status(video_id, "failed", "claude extraction failed")
        return {"video_id": video_id, "pattern": None, "status": "failed"}

    steps = pattern.get("diagnostic_steps", [])
    domain = pattern.get("domain", "general")

    if dry_run:
        logger.info("[DRY RUN] Pattern for %s:", video_id)
        logger.info("  domain=%s steps=%d hook=%s", domain, len(steps), pattern.get("opening_hook", ""))
        for i, step in enumerate(steps[:5]):
            logger.info("  step %d: %s", i + 1, step[:80])
        return {"video_id": video_id, "pattern": pattern, "status": "dry_run"}

    stored = _store_pattern(video_id, pattern, meta["view_count"])
    status = "done" if stored else "failed"
    _update_pattern_status(video_id, status)

    logger.info(
        "Pattern done: %s | domain=%s steps=%d stored=%s",
        video_id, domain, len(steps), stored,
    )
    return {"video_id": video_id, "pattern": pattern, "status": status}


def regenerate_style_prompt(output_path: str | None = None) -> str:
    """Load top 5 patterns by engagement_score and write the style addendum file.

    Called by weekly Celery beat task. Returns the generated prompt string.
    """
    from sqlalchemy import text

    if not output_path:
        output_path = os.getenv("YOUTUBE_STYLE_PROMPT_PATH", "/data/youtube_style_prompt.txt")

    try:
        with _neon_engine().connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT pattern_json, engagement_score
                    FROM teaching_patterns
                    WHERE engagement_score IS NOT NULL
                    ORDER BY engagement_score DESC NULLS LAST
                    LIMIT 5
                """),
            ).fetchall()
    except Exception as e:
        logger.error("Failed to load teaching patterns: %s", e)
        return ""

    if not rows:
        logger.info("No scored patterns yet — using default style rules")
        rules = _STYLE_RULES_DEFAULT
    else:
        # Synthesize rules from top patterns
        rules = _synthesize_rules(rows)

    style = _STYLE_TEMPLATE.format(rules="\n".join(f"- {r}" for r in rules))

    try:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(style)
        logger.info("Style prompt written to %s (%d rules)", output_path, len(rules))
    except Exception as e:
        logger.error("Failed to write style prompt: %s", e)

    return style


def _synthesize_rules(rows: list) -> list[str]:
    """Collapse top patterns into concrete style rules."""
    rules = []

    def _parse(val):
        if isinstance(val, dict):
            return val
        try:
            return json.loads(val) if val else {}
        except (TypeError, ValueError):
            return {}

    # Tally opening hooks
    hooks = [_parse(r[0]).get("opening_hook", "") for r in rows if r[0]]
    if hooks.count("real fault scenario") >= 2:
        rules.append("Open with the actual fault scenario — show the error on the equipment first")

    # Tally resolution formats
    formats = [_parse(r[0]).get("resolution_format", "") for r in rows if r[0]]
    if any("verify" in f for f in formats):
        rules.append("Always end with a verification step the tech can perform immediately")

    # Check if most teach on real equipment
    camera = [_parse(r[0]).get("teaches_to_camera", False) for r in rows if r[0]]
    if sum(camera) >= 3:
        rules.append("Refer to what the tech can physically observe — not just theory")

    # Diagnostic steps are present in winning videos
    rules.append("Follow: observe → measure → isolate → fix → verify")
    rules.append("Lead with the symptom and fault code, not background theory")
    rules.append("Name the specific parameter or register when recommending a change")
    rules.append("Use one analogy maximum per explanation")
    rules.append("For PLC faults: map HMI alarm → ladder logic rung → fix → test in program")

    return rules


# ---------------------------------------------------------------------------
# Celery task: weekly style prompt regeneration
# ---------------------------------------------------------------------------

try:
    from mira_crawler.celery_app import app as _app
except ImportError:
    try:
        from celery_app import app as _app
    except ImportError:
        _app = None

if _app is not None:
    from celery.schedules import crontab  # noqa: E402

    @_app.task(name="mira_crawler.tasks.youtube_tasks.regenerate_youtube_style_prompt")
    def regenerate_youtube_style_prompt_task() -> dict:
        """Regenerate teaching style prompt from top-scored patterns. Runs weekly."""
        style = regenerate_style_prompt()
        return {"rules_generated": style.count("\n- "), "status": "done" if style else "empty"}

    # Register in beat schedule — imported by celeryconfig via celery_app
    _WEEKLY_TASK = {
        "youtube-regen-style-weekly": {
            "task": "mira_crawler.tasks.youtube_tasks.regenerate_youtube_style_prompt",
            "schedule": crontab(day_of_week="sun", hour=4, minute=0),
        }
    }

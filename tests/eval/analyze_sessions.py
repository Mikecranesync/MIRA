#!/usr/bin/env python3
"""Standalone cron script: find sessions idle >10 min, grade them, generate fixtures.

Runs every 5 minutes via cron. Safe to call concurrently (file lock prevents overlap).

Usage (via Doppler on VPS):
    doppler run --project factorylm --config prd -- python3 tests/eval/analyze_sessions.py

Environment:
    SESSION_RECORDING_PATH    Directory of *.ndjson session files (default: /data/sessions)
    GROQ_API_KEY              Required for LLM judge grading
    ANTHROPIC_API_KEY         Optional second judge provider
    GITHUB_TOKEN              Optional — enables automatic GitHub issue creation
    EVAL_DISABLE_JUDGE        Set to "1" to skip LLM grading (deterministic grades only)
    NEON_DATABASE_URL         Optional — enables NeonDB analysis result storage
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Insert repo root so `tests.eval.*` imports work regardless of cwd.
# Must use .resolve() so we get an absolute path — when called as
# `python3 tests/eval/analyze_sessions.py`, __file__ is relative.
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
# Append mira-bots AFTER repo root — stdlib email must take precedence over
# mira-bots/email/__init__.py.
if str(_REPO_ROOT / "mira-bots") not in sys.path:
    sys.path.append(str(_REPO_ROOT / "mira-bots"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("analyze-sessions")

INACTIVITY_MINUTES = 10
MIN_TURNS = 2
LOCK_FILE = "/tmp/mira-session-analyzer.lock"


def _session_dir() -> Path:
    return Path(os.getenv("SESSION_RECORDING_PATH", "/data/sessions"))


def _load_turns(ndjson_path: Path) -> list[dict]:
    turns: list[dict] = []
    try:
        for line in ndjson_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    turns.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception as exc:
        logger.warning("Failed to load %s: %s", ndjson_path, exc)
    return turns


def _last_session_turns(turns: list[dict]) -> list[dict]:
    """Return turns belonging to the most recent session.

    A new session begins after a time gap > INACTIVITY_MINUTES minutes.
    """
    if not turns:
        return []

    def _ts(t: dict) -> float:
        try:
            v = t.get("timestamp", "")
            dt = datetime.fromisoformat(v)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except Exception:
            return 0.0

    sorted_turns = sorted(turns, key=_ts)

    # Find where the most recent session starts (biggest time gap from the end)
    session_start = 0
    for i in range(1, len(sorted_turns)):
        gap_seconds = _ts(sorted_turns[i]) - _ts(sorted_turns[i - 1])
        if gap_seconds > INACTIVITY_MINUTES * 60:
            session_start = i

    return sorted_turns[session_start:]


def _is_session_complete(session_turns: list[dict]) -> bool:
    """True if last turn timestamp is older than INACTIVITY_MINUTES."""
    if not session_turns:
        return False
    last = session_turns[-1]
    try:
        v = last.get("timestamp", "")
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        elapsed_min = (datetime.now(timezone.utc) - dt).total_seconds() / 60
        return elapsed_min > INACTIVITY_MINUTES
    except Exception:
        return False


def _sidecar_path(ndjson_path: Path) -> Path:
    return ndjson_path.with_suffix(".analyzed")


def _is_already_analyzed(ndjson_path: Path, session_turns: list[dict]) -> bool:
    """Check the .analyzed sidecar file to avoid re-analyzing the same session."""
    if not session_turns:
        return False
    last_ts = session_turns[-1].get("timestamp", "")
    sp = _sidecar_path(ndjson_path)
    if not sp.exists():
        return False
    try:
        data = json.loads(sp.read_text(encoding="utf-8"))
        return last_ts in data.get("analyzed_sessions", [])
    except Exception:
        return False


def _mark_analyzed(ndjson_path: Path, session_turns: list[dict]) -> None:
    if not session_turns:
        return
    last_ts = session_turns[-1].get("timestamp", "")
    sp = _sidecar_path(ndjson_path)
    try:
        existing = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {}
    except Exception:
        existing = {}
    sessions: list[str] = existing.get("analyzed_sessions", [])
    if last_ts not in sessions:
        sessions.append(last_ts)
    sp.write_text(json.dumps({"analyzed_sessions": sessions[-200:]}), encoding="utf-8")


def _ensure_neon_table() -> None:
    """Create the session_analyses table if it doesn't exist."""
    try:
        # append, not insert — mira-ingest/tests/ shadows repo tests/ if at index 0
        ingest_path = str(_REPO_ROOT / "mira-core" / "mira-ingest")
        if ingest_path not in sys.path:
            sys.path.append(ingest_path)
        from db.neon import ensure_session_analyses_table  # type: ignore[import]

        ensure_session_analyses_table()
    except Exception as exc:
        logger.debug("NeonDB table setup skipped: %s", exc)


def main() -> int:
    # File lock — prevent overlapping cron runs
    try:
        lock_fd = open(LOCK_FILE, "w")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        logger.info("Another instance running — skipping")
        return 0

    try:
        _ensure_neon_table()

        session_dir = _session_dir()
        if not session_dir.exists():
            logger.info("Session dir %s does not exist — nothing to analyze", session_dir)
            return 0

        ndjson_files = list(session_dir.glob("*.ndjson"))
        logger.info("Scanning %d session file(s) in %s", len(ndjson_files), session_dir)

        try:
            from shared.analysis.session_analyzer import SessionAnalyzer

            analyzer = SessionAnalyzer()
        except Exception as exc:
            logger.error("Failed to import SessionAnalyzer: %s", exc)
            return 1

        analyzed = 0
        skipped = 0
        for ndjson_path in sorted(ndjson_files):
            try:
                all_turns = _load_turns(ndjson_path)
                session_turns = _last_session_turns(all_turns)

                diagnostic_turns = [t for t in session_turns if t.get("type") != "feedback"]
                if len(diagnostic_turns) < MIN_TURNS:
                    skipped += 1
                    continue
                if not _is_session_complete(session_turns):
                    continue
                if _is_already_analyzed(ndjson_path, session_turns):
                    continue

                chat_id = diagnostic_turns[0].get("chat_id", ndjson_path.stem)
                logger.info("Analyzing %s — %d turns", chat_id, len(diagnostic_turns))

                result = analyzer.analyze(chat_id, session_turns)

                if result.get("skip"):
                    logger.info("Skipped %s: %s", chat_id, result.get("reason"))
                    skipped += 1
                    continue

                _mark_analyzed(ndjson_path, session_turns)
                analyzed += 1

                logger.info(
                    "Done: %s overall=%.2f category=%s fixture=%s",
                    chat_id,
                    result.get("overall", 0.0),
                    result.get("category", "?"),
                    Path(result.get("fixture_path", "?")).name,
                )

            except Exception as exc:
                logger.error("Error analyzing %s: %s", ndjson_path.name, exc, exc_info=True)

        logger.info("Complete — analyzed=%d skipped=%d", analyzed, skipped)
        return 0

    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


if __name__ == "__main__":
    sys.exit(main())

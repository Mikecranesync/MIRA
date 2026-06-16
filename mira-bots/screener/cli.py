"""MIRA Interaction Screener — CLI entry point.

Usage:
    python -m screener --mode live
    python -m screener --mode report [--hours 24]
    python -m screener --mode batch [--output /data/screener]

Modes:
    live   Tail all four sources in real time, print flags as they occur
    report Grade sessions from the last N hours, print proposals interactively
    batch  Grade all unanalyzed NDJSON sessions, write FixProposal JSON to disk
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_MIRA_BOTS = Path(__file__).resolve().parent.parent
if str(_MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(_MIRA_BOTS))

from screener.proposer import propose_fixes
from screener.report import (
    print_live_alert,
    print_session_report,
    print_summary,
)
from screener.schema import SessionQuality
from screener.scorer import Scorer, score_ndjson_session
from screener.watcher import _DB_PATH, _SESSION_DIR, run_all_watchers

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("mira-screener")


# ── Live mode ─────────────────────────────────────────────────────────────────


async def _live(db_path: str, session_dir: Path, container: str) -> None:
    """Tail all sources; print compact alert on each flagged session."""
    print(f"[screener] live mode — db={db_path} sessions={session_dir} container={container}")
    print("[screener] Ctrl+C to stop\n")

    queue: asyncio.Queue = asyncio.Queue()
    scorer = Scorer()

    async def _consume() -> None:
        while True:
            # Flush timed-out sessions every 30s
            flush_task = asyncio.create_task(asyncio.sleep(30))
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                await flush_task
                for session in scorer.flush_timedout_sessions():
                    _handle_session(session)
                continue

            source = event.get("source")
            session: SessionQuality | None = None

            if source == "sqlite":
                session = scorer.ingest_sqlite_row(event["row"])
            elif source == "ndjson":
                session = scorer.ingest_ndjson_event(event)
            elif source == "feedback":
                session = scorer.ingest_feedback(event["row"])
            elif source == "docker":
                # Docker lines are context-only; print raw if they look like errors
                line: str = event.get("line", "")
                if any(kw in line for kw in ("ERROR", "WARNING", "CRITICAL", "Traceback")):
                    logger.info("[docker] %s", line)

            if session:
                _handle_session(session)

    async def _watcher() -> None:
        await run_all_watchers(queue, db_path=db_path, session_dir=session_dir, container=container)

    await asyncio.gather(_watcher(), _consume())


def _handle_session(session: SessionQuality) -> None:
    if not session.quality_flags:
        return
    print_live_alert(session)
    proposals = propose_fixes(session, session.quality_flags)
    for p in proposals:
        print(f"  → [{p.fix_category}] {p.title}")


# ── Report mode ───────────────────────────────────────────────────────────────


def _report(db_path: str, session_dir: Path, hours: int, interactive: bool) -> None:
    """Grade sessions from last N hours; optionally walk through fixes interactively."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    print(f"[screener] report mode — last {hours}h  db={db_path}  sessions={session_dir}\n")

    # Collect sessions from NDJSON files (most complete source)
    graded: list[SessionQuality] = []
    total_proposals = 0

    if session_dir.exists():
        for ndjson_path in sorted(session_dir.glob("*.ndjson")):
            try:
                turns_raw: list[dict] = []
                for line in ndjson_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        turns_raw.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

                # Filter to last N hours
                recent_turns = []
                for t in turns_raw:
                    try:
                        ts = datetime.fromisoformat(t.get("timestamp", ""))
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        if ts >= cutoff:
                            recent_turns.append(t)
                    except Exception:
                        continue

                if len(recent_turns) < 2:
                    continue

                feedback_rating = None
                for t in recent_turns:
                    if t.get("type") == "feedback":
                        feedback_rating = t.get("feedback_rating")

                diag_turns = [t for t in recent_turns if t.get("type") != "feedback"]
                if len(diag_turns) < 2:
                    continue

                session = score_ndjson_session(diag_turns, feedback_rating)
                if session and session.quality_flags:
                    proposals = propose_fixes(session, session.quality_flags)
                    total_proposals += len(proposals)
                    graded.append(session)
                    print_session_report(session, proposals, interactive=interactive)

            except Exception as exc:
                logger.warning("Error processing %s: %s", ndjson_path.name, exc)

    # Fallback: grade from SQLite if no NDJSON
    if not graded and Path(db_path).exists():
        graded = _grade_from_sqlite(db_path, cutoff)
        for session in graded:
            if session.quality_flags:
                proposals = propose_fixes(session, session.quality_flags)
                total_proposals += len(proposals)
                print_session_report(session, proposals, interactive=interactive)

    print_summary(graded, total_proposals)


def _grade_from_sqlite(db_path: str, cutoff: datetime) -> list[SessionQuality]:
    """Grade sessions using only the SQLite interactions table."""
    import sqlite3  # noqa: PLC0415 — deferred to avoid startup cost

    sessions: list[SessionQuality] = []
    try:
        db = sqlite3.connect(db_path, timeout=5)
        db.execute("PRAGMA journal_mode=WAL")
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT * FROM interactions WHERE created_at >= ? ORDER BY chat_id, id",
            (cutoff.isoformat(),),
        ).fetchall()
        db.close()
    except Exception as exc:
        logger.warning("SQLite grade error: %s", exc)
        return []

    # Group by chat_id
    by_chat: dict[str, list[dict]] = {}
    for row in rows:
        cid = str(row["chat_id"])
        by_chat.setdefault(cid, []).append(dict(row))

    scorer = Scorer()
    for chat_id, chat_rows in by_chat.items():
        for row in chat_rows:
            scorer.ingest_sqlite_row(row)
        sessions.extend(scorer.flush_timedout_sessions())

    return sessions


# ── Batch mode ────────────────────────────────────────────────────────────────


def _batch(session_dir: Path, output_dir: Path) -> None:
    """Grade all unanalyzed NDJSON sessions, write FixProposal JSON to output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"[screener] batch mode — sessions={session_dir} output={output_dir}\n")

    if not session_dir.exists():
        print(f"[screener] session dir {session_dir} not found — nothing to process")
        return

    total_sessions = 0
    total_flags = 0

    for ndjson_path in sorted(session_dir.glob("*.ndjson")):
        analyzed_path = ndjson_path.with_suffix(".screened")
        if analyzed_path.exists():
            continue

        try:
            turns_raw = []
            for line in ndjson_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    turns_raw.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

            feedback_rating = next(
                (t.get("feedback_rating") for t in turns_raw if t.get("type") == "feedback"),
                None,
            )
            diag_turns = [t for t in turns_raw if t.get("type") != "feedback"]

            if len(diag_turns) < 2:
                continue

            session = score_ndjson_session(diag_turns, feedback_rating)
            if not session:
                continue

            proposals = propose_fixes(session, session.quality_flags)
            total_sessions += 1
            total_flags += len(session.quality_flags)

            out = {
                "session_id": session.session_id,
                "chat_id": session.chat_id,
                "outcome": session.outcome,
                "quality_flags": [
                    {
                        "code": f.code,
                        "severity": f.severity,
                        "description": f.description,
                        "turns_affected": f.turns_affected,
                    }
                    for f in session.quality_flags
                ],
                "fix_proposals": [
                    {
                        "flag_code": p.flag_code,
                        "fix_category": p.fix_category,
                        "severity": p.severity,
                        "title": p.title,
                        "affected_file": p.affected_file,
                        "proposed_change": p.proposed_change,
                        "confidence": p.confidence,
                    }
                    for p in proposals
                ],
            }

            out_path = output_dir / f"{ndjson_path.stem}.json"
            out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
            analyzed_path.touch()

            p0_count = sum(1 for f in session.quality_flags if f.severity == "P0")
            print(
                f"  {session.chat_id[:12]}  outcome={session.outcome}  "
                f"flags={len(session.quality_flags)} (p0={p0_count})  → {out_path.name}"
            )

        except Exception as exc:
            logger.warning("Batch error (%s): %s", ndjson_path.name, exc)

    print(f"\n[screener] Done — sessions={total_sessions} flags={total_flags}")


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="MIRA interaction screener",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--mode",
        choices=["live", "report", "batch"],
        default="report",
        help="live=tail in real time, report=last N hours, batch=all unanalyzed",
    )
    parser.add_argument("--hours", type=int, default=24, help="Hours of history for report mode")
    parser.add_argument("--db", default=_DB_PATH, help="Path to mira.db SQLite file")
    parser.add_argument(
        "--session-dir", default=str(_SESSION_DIR), help="Path to NDJSON session directory"
    )
    parser.add_argument(
        "--container", default="mira-bot-telegram", help="Docker container name to tail"
    )
    parser.add_argument(
        "--output", default="/data/screener", help="Output dir for batch mode JSON reports"
    )
    parser.add_argument(
        "--interactive", action="store_true", help="Prompt to approve each fix in report mode"
    )
    args = parser.parse_args()

    session_dir = Path(args.session_dir)

    if args.mode == "live":
        try:
            asyncio.run(_live(args.db, session_dir, args.container))
        except KeyboardInterrupt:
            print("\n[screener] Stopped.")

    elif args.mode == "report":
        _report(args.db, session_dir, args.hours, args.interactive)

    elif args.mode == "batch":
        _batch(session_dir, Path(args.output))

    return 0


if __name__ == "__main__":
    sys.exit(main())

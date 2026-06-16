#!/usr/bin/env python3
"""MIRA Session Replay — debug production failures offline.

Given a chat_id from mira.db interactions or a JSON dump of a session,
replays the original user turns through the local in-process pipeline and diffs
the new responses against the original.  This is how you debug a production
failure without VPS access.

Usage
-----
  # Replay from a JSON dump in fixtures/replay/ (works without VPS)
  python3 tests/eval/replay.py --file tests/eval/fixtures/replay/pilz_distribution_block.json

  # Replay from live mira.db using chat_id (VPS DB or local copy)
  python3 tests/eval/replay.py --chat-id 123456789 --db /path/to/mira.db

  # Export a session from mira.db to a JSON file (for later offline replay)
  python3 tests/eval/replay.py --export --chat-id 123456789 --db /path/to/mira.db

  # Replay and write a markdown diff report
  python3 tests/eval/replay.py --file fixtures/replay/pilz.json --report /tmp/replay.md

Environment
-----------
  MIRA_DB_PATH   Path to mira.db (defaults to /opt/mira/data/mira.db on VPS)
"""

from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    _HAS_RICH = True
except ImportError:
    _HAS_RICH = False

_console = Console() if _HAS_RICH else None

_REPLAY_DIR = Path(__file__).parent / "fixtures" / "replay"

# ── Session extraction ────────────────────────────────────────────────────────


def extract_session(chat_id: str, db_path: str) -> dict:
    """Extract all interactions for a chat_id from mira.db.

    Returns a dict with:
      - chat_id: str
      - turns: list of {user_message, assistant_reply, fsm_state, created_at}
      - exported_at: ISO timestamp
    """
    import sqlite3

    db = Path(db_path)
    if not db.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT user_message, assistant_reply, fsm_state, response_time_ms, created_at
        FROM interactions
        WHERE chat_id = ?
        ORDER BY created_at
        """,
        (chat_id,),
    ).fetchall()
    conn.close()

    if not rows:
        raise ValueError(f"No interactions found for chat_id={chat_id!r}")

    turns = [
        {
            "user_message": r["user_message"],
            "assistant_reply": r["assistant_reply"],
            "fsm_state": r["fsm_state"],
            "response_time_ms": r["response_time_ms"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]

    return {
        "chat_id": chat_id,
        "turns": turns,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_db": str(db_path),
    }


# ── Replay runner ─────────────────────────────────────────────────────────────


async def replay_session(
    session: dict,
    verbose: bool = True,
    db_path: str | None = None,
) -> dict:
    """Replay all user turns from a session through the local pipeline.

    Returns a dict with:
      - original_turns: list of original {user_message, assistant_reply}
      - replayed_turns: list of replayed {user_message, new_reply, original_reply, latency_ms}
      - diffs: list of unified diff strings (one per turn)
      - changed_turns: count of turns where response differed
      - final_fsm_state: str
    """
    from tests.eval.local_pipeline import LocalPipeline  # noqa: PLC0415

    pipeline = LocalPipeline(db_path=db_path, verbose=verbose)
    chat_id = f"replay-{uuid.uuid4().hex[:8]}"
    turns = session.get("turns", [])

    replayed_turns = []
    diffs = []

    for i, turn in enumerate(turns):
        user_msg = turn["user_message"]
        original_reply = turn.get("assistant_reply", "")
        original_state = turn.get("fsm_state", "?")

        if verbose:
            _print_turn_header(i + 1, len(turns), user_msg)

        new_reply, status, latency = await pipeline.call(chat_id, user_msg)
        new_state = pipeline.fsm_state(chat_id)

        # Compute unified diff
        diff = list(difflib.unified_diff(
            original_reply.splitlines(keepends=True),
            new_reply.splitlines(keepends=True),
            fromfile=f"turn_{i+1}_original",
            tofile=f"turn_{i+1}_replayed",
            lineterm="",
        ))
        diff_str = "".join(diff)
        changed = bool(diff_str.strip())

        replayed_turns.append({
            "turn": i + 1,
            "user_message": user_msg,
            "original_reply": original_reply,
            "new_reply": new_reply,
            "original_fsm_state": original_state,
            "new_fsm_state": new_state,
            "latency_ms": latency,
            "http_status": status,
            "changed": changed,
        })
        diffs.append(diff_str)

        if verbose:
            _print_turn_result(
                original_reply, new_reply, original_state, new_state, latency, changed
            )

    changed_count = sum(1 for t in replayed_turns if t["changed"])

    return {
        "original_session": session,
        "replayed_turns": replayed_turns,
        "diffs": diffs,
        "changed_turns": changed_count,
        "total_turns": len(turns),
        "final_fsm_state": pipeline.fsm_state(chat_id),
        "replayed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Report writer ─────────────────────────────────────────────────────────────


def write_replay_report(result: dict, output_path: Path) -> None:
    """Write a markdown diff report for a replay result."""
    session = result["original_session"]
    chat_id = session.get("chat_id", "unknown")
    exported_at = session.get("exported_at", "unknown")

    changed = result["changed_turns"]
    total = result["total_turns"]
    final_state = result["final_fsm_state"]

    lines = [
        f"# MIRA Replay Report",
        f"",
        f"**Chat ID:** {chat_id}  |  **Original exported:** {exported_at}",
        f"**Replayed at:** {result['replayed_at']}",
        f"**Changed turns:** {changed}/{total}  |  **Final FSM state:** {final_state}",
        "",
    ]

    for t in result["replayed_turns"]:
        n = t["turn"]
        changed_mark = "⚠️ CHANGED" if t["changed"] else "✓ same"
        lines += [
            f"## Turn {n} — {changed_mark}",
            "",
            f"**User:** {t['user_message']}",
            "",
            f"**FSM:** original={t['original_fsm_state']} → replayed={t['new_fsm_state']}",
            f"**Latency:** {t['latency_ms']}ms",
            "",
        ]

        if t["changed"]:
            diff_str = result["diffs"][n - 1]
            lines += [
                "<details>",
                "<summary>Diff (click to expand)</summary>",
                "",
                "```diff",
                diff_str,
                "```",
                "</details>",
                "",
                "**Original:**",
                f"> {t['original_reply'][:600]}",
                "",
                "**Replayed:**",
                f"> {t['new_reply'][:600]}",
                "",
            ]
        else:
            lines += [
                f"*Response unchanged.*",
                "",
            ]

    lines += [
        "---",
        f"*Generated by `tests/eval/replay.py` at {datetime.now(timezone.utc).isoformat()}*",
    ]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n")
    print(f"Report written: {output_path}")


# ── Display helpers ───────────────────────────────────────────────────────────


def _print_turn_header(n: int, total: int, user_msg: str) -> None:
    if _HAS_RICH:
        _console.rule(f"[dim]Turn {n}/{total}[/dim]")
        _console.print(f"[bold yellow]User:[/bold yellow] {user_msg}")
    else:
        print(f"\n--- Turn {n}/{total} ---")
        print(f"User: {user_msg}")


def _print_turn_result(
    original: str,
    new_reply: str,
    orig_state: str,
    new_state: str,
    latency: int,
    changed: bool,
) -> None:
    state_change = f"{orig_state} → {new_state}" if orig_state != new_state else orig_state
    if _HAS_RICH:
        if changed:
            _console.print(f"  [bold red]CHANGED[/bold red]  FSM: {state_change}  {latency}ms")
            _console.print(f"  [dim]Original:[/dim] {original[:200]}")
            _console.print(f"  [dim]Replayed:[/dim] {new_reply[:200]}")
        else:
            _console.print(f"  [green]unchanged[/green]  FSM: {state_change}  {latency}ms")
    else:
        mark = "CHANGED" if changed else "unchanged"
        print(f"  [{mark}]  FSM: {state_change}  {latency}ms")
        if changed:
            print(f"  Original: {original[:200]}")
            print(f"  Replayed: {new_reply[:200]}")


# ── main ──────────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Replay a MIRA session through the local pipeline and diff responses",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument(
        "--file",
        metavar="PATH",
        help="JSON session dump to replay (from fixtures/replay/ or --export output)",
    )
    grp.add_argument(
        "--chat-id",
        metavar="ID",
        help="chat_id to load from mira.db and replay",
    )
    grp.add_argument(
        "--list",
        action="store_true",
        help="List available session dumps in fixtures/replay/",
    )
    p.add_argument(
        "--export",
        action="store_true",
        help="Export the session to a JSON file (use with --chat-id)",
    )
    p.add_argument(
        "--db",
        metavar="PATH",
        default=os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db"),
        help="Path to mira.db SQLite (default: MIRA_DB_PATH env or /opt/mira/data/mira.db)",
    )
    p.add_argument(
        "--report",
        metavar="PATH",
        default=None,
        help="Write a markdown diff report to this path",
    )
    p.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print each turn as it replays",
    )
    return p


async def _async_main(args: argparse.Namespace) -> int:
    # List dumps
    if args.list:
        dumps = sorted(_REPLAY_DIR.glob("*.json"))
        if not dumps:
            print("No session dumps found in", _REPLAY_DIR)
            return 1
        print(f"Session dumps in {_REPLAY_DIR}/:")
        for d in dumps:
            size = d.stat().st_size
            data = json.loads(d.read_text())
            turns = len(data.get("turns", []))
            chat_id = data.get("chat_id", "?")
            exported = data.get("exported_at", "?")[:10]
            print(f"  {d.name:<40} {turns} turns  {chat_id}  {exported}")
        return 0

    # Load session
    if args.file:
        session_path = Path(args.file)
        if not session_path.is_absolute():
            # Try relative to replay dir first
            candidate = _REPLAY_DIR / session_path
            if candidate.exists():
                session_path = candidate
        session = json.loads(session_path.read_text())
        print(f"Loaded session: {session.get('chat_id')} ({len(session.get('turns', []))} turns)")
    else:
        # Load from live DB
        if not Path(args.db).exists():
            print(f"DB not found: {args.db}", file=sys.stderr)
            print("  → Use --file with a session dump from fixtures/replay/")
            return 1
        session = extract_session(args.chat_id, args.db)
        print(f"Extracted {len(session['turns'])} turns for chat_id={args.chat_id}")

        # Export if requested
        if args.export:
            out_path = _REPLAY_DIR / f"session_{args.chat_id}.json"
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(session, indent=2))
            print(f"Exported to: {out_path}")
            return 0

    # Replay
    result = await replay_session(session, verbose=args.verbose)

    # Summary
    changed = result["changed_turns"]
    total = result["total_turns"]
    if _HAS_RICH:
        color = "green" if changed == 0 else "yellow" if changed < total else "red"
        _console.rule("[bold]Replay Summary[/bold]")
        _console.print(
            f"  [{color}]{changed}/{total} turns changed[/{color}]  "
            f"FSM: {result['final_fsm_state']}"
        )
    else:
        print(f"\nReplay complete: {changed}/{total} turns changed | FSM: {result['final_fsm_state']}")

    # Report
    if args.report:
        write_replay_report(result, Path(args.report))
    elif changed > 0:
        # Auto-write to runs/ dir
        auto_path = Path(__file__).parent / "runs" / f"replay-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M')}.md"
        write_replay_report(result, auto_path)

    return 0


def main() -> int:
    args = _build_parser().parse_args()
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""harvest-interactions.py — Harvest production interactions and flag quality issues.

Reads from the SQLite `interactions` table (populated by Supervisor._log_interaction),
flags quality problems, outputs reports, and optionally posts to GitHub issue #18.

Usage:
    python harvest-interactions.py                       # harvest + flag
    python harvest-interactions.py --post-github         # also post summary to GH #18
    python harvest-interactions.py --since 24h           # only last 24 hours (default)
    python harvest-interactions.py --since 7d            # last 7 days
    python harvest-interactions.py --since all           # everything

Cron (BRAVO Mac Mini launchd):
    Create ~/Library/LaunchAgents/com.factorylm.harvest-interactions.plist:
    <plist>
      <dict>
        <key>Label</key><string>com.factorylm.harvest-interactions</string>
        <key>ProgramArguments</key>
        <array>
          <string>/usr/bin/python3</string>
          <string>/Users/bravonode/Mira/mira-bots/tools/harvest-interactions.py</string>
          <string>--post-github</string>
        </array>
        <key>StartCalendarInterval</key>
        <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
        <key>StandardOutPath</key><string>/tmp/harvest-interactions.log</string>
        <key>StandardErrorPath</key><string>/tmp/harvest-interactions.err</string>
      </dict>
    </plist>
    Then: launchctl load ~/Library/LaunchAgents/com.factorylm.harvest-interactions.plist
"""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"
DB_PATH = os.getenv("MIRA_DB_PATH", str(SCRIPT_DIR.parent.parent / "mira-bridge" / "data" / "mira.db"))

RESET_PHRASES = [
    "i help maintenance technicians",
    "what equipment do you need help with",
]

GITHUB_ISSUE = 18  # Bot response quality tuning (ongoing)


def parse_since(since_str: str) -> datetime | None:
    """Parse --since argument into a datetime cutoff."""
    if since_str == "all":
        return None
    match = re.match(r"^(\d+)([hdwm])$", since_str)
    if not match:
        print(f"Invalid --since format: {since_str} (use 24h, 7d, 4w, all)")
        sys.exit(1)
    val, unit = int(match.group(1)), match.group(2)
    deltas = {"h": timedelta(hours=val), "d": timedelta(days=val),
              "w": timedelta(weeks=val), "m": timedelta(days=val * 30)}
    return datetime.now() - deltas[unit]


def fetch_interactions(db_path: str, since: datetime | None) -> list[dict]:
    """Read interactions from SQLite."""
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    # Check if interactions table exists
    table_check = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='interactions'"
    ).fetchone()
    if not table_check:
        db.close()
        print("interactions table not found — bot has not logged any interactions yet")
        return []
    if since:
        rows = db.execute(
            "SELECT * FROM interactions WHERE created_at >= ? ORDER BY created_at",
            (since.isoformat(),),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM interactions ORDER BY created_at").fetchall()
    db.close()
    return [dict(r) for r in rows]


def group_sessions(interactions: list[dict], gap_minutes: int = 5) -> list[list[dict]]:
    """Group interactions into sessions by chat_id + time gap."""
    by_chat: dict[str, list[dict]] = {}
    for ix in interactions:
        by_chat.setdefault(ix["chat_id"], []).append(ix)

    sessions = []
    for chat_id, msgs in by_chat.items():
        msgs.sort(key=lambda m: m["created_at"])
        session: list[dict] = [msgs[0]]
        for i in range(1, len(msgs)):
            try:
                prev_t = datetime.fromisoformat(msgs[i - 1]["created_at"])
                curr_t = datetime.fromisoformat(msgs[i]["created_at"])
                gap = (curr_t - prev_t).total_seconds() / 60
            except (ValueError, TypeError):
                gap = 0
            if gap > gap_minutes:
                sessions.append(session)
                session = []
            session.append(msgs[i])
        if session:
            sessions.append(session)
    return sessions


def flag_session(session: list[dict]) -> list[dict]:
    """Flag quality issues in a single session. Returns list of flag dicts."""
    flags = []

    for ix in session:
        resp = ix["bot_response"].lower()

        # Session reset
        if any(phrase in resp for phrase in RESET_PHRASES):
            flags.append({
                "type": "session_reset",
                "severity": "high",
                "interaction_id": ix["id"],
                "detail": f"Bot reset: \"{ix['bot_response'][:80]}...\"",
                "user_message": ix["user_message"],
                "timestamp": ix["created_at"],
            })

        # Number reply reset
        if ix["user_message"].strip() in ("1", "2", "3", "4") and any(
            phrase in resp for phrase in RESET_PHRASES
        ):
            flags.append({
                "type": "number_reply_reset",
                "severity": "high",
                "interaction_id": ix["id"],
                "detail": f"User chose option '{ix['user_message']}' but bot reset",
                "user_message": ix["user_message"],
                "timestamp": ix["created_at"],
            })

        # Slow response
        if ix.get("response_time_ms") and ix["response_time_ms"] > 10000:
            flags.append({
                "type": "slow_response",
                "severity": "medium",
                "interaction_id": ix["id"],
                "detail": f"Response took {ix['response_time_ms']}ms (>{10000}ms threshold)",
                "user_message": ix["user_message"],
                "timestamp": ix["created_at"],
            })

        # Confusion signal
        if len(ix["user_message"].strip()) < 5 and ix["user_message"].strip() not in (
            "1", "2", "3", "4", "yes", "no", "ok",
        ):
            flags.append({
                "type": "confusion_signal",
                "severity": "low",
                "interaction_id": ix["id"],
                "detail": f"Very short reply: \"{ix['user_message']}\"",
                "user_message": ix["user_message"],
                "timestamp": ix["created_at"],
            })

    # Premature ending
    if len(session) < 3:
        flags.append({
            "type": "premature_ending",
            "severity": "medium",
            "interaction_id": session[-1]["id"],
            "detail": f"Session ended after {len(session)} turn(s)",
            "user_message": session[-1]["user_message"],
            "timestamp": session[-1]["created_at"],
        })

    # Repeated question
    user_msgs = [ix["user_message"].strip().lower() for ix in session]
    seen = set()
    for msg in user_msgs:
        if msg in seen and len(msg) > 5:
            flags.append({
                "type": "repeated_question",
                "severity": "medium",
                "interaction_id": session[-1]["id"],
                "detail": f"User repeated: \"{msg}\"",
                "user_message": msg,
                "timestamp": session[-1]["created_at"],
            })
            break
        seen.add(msg)

    return flags


def write_interaction_log(interactions: list[dict], output_dir: Path):
    """Write full interaction log as JSON."""
    path = output_dir / "interaction-log.json"
    with open(path, "w") as f:
        json.dump(interactions, f, indent=2, default=str)
    print(f"Wrote {len(interactions)} interactions to {path}")


def write_quality_flags(sessions: list[list[dict]], all_flags: list[dict], output_dir: Path):
    """Write human-readable quality flags report."""
    path = output_dir / "quality-flags.md"
    lines = [
        f"# MIRA Interaction Quality Flags",
        f"",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"**Sessions analyzed:** {len(sessions)}",
        f"**Total interactions:** {sum(len(s) for s in sessions)}",
        f"**Flags raised:** {len(all_flags)}",
        f"",
    ]

    if not all_flags:
        lines.append("No quality issues found.")
    else:
        # Summary by type
        type_counts = Counter(f["type"] for f in all_flags)
        lines.append("## Summary")
        lines.append("")
        lines.append("| Flag Type | Count |")
        lines.append("|-----------|-------|")
        for ftype, count in type_counts.most_common():
            lines.append(f"| {ftype} | {count} |")
        lines.append("")

        # Detail
        lines.append("## Flagged Interactions")
        lines.append("")
        for flag in sorted(all_flags, key=lambda f: f.get("timestamp", "")):
            severity_icon = {"high": "!!!", "medium": "!!", "low": "!"}.get(
                flag["severity"], "?"
            )
            lines.append(f"### [{severity_icon}] {flag['type']} — {flag['timestamp']}")
            lines.append(f"")
            lines.append(f"**User said:** {flag['user_message']}")
            lines.append(f"**Issue:** {flag['detail']}")
            lines.append(f"")

    with open(path, "w") as f:
        f.write("\n".join(lines))
    print(f"Wrote quality flags to {path}")


def build_github_comment(sessions, all_flags, interactions) -> str:
    """Build a markdown comment for GitHub issue #18."""
    type_counts = Counter(f["type"] for f in all_flags)
    most_common = type_counts.most_common(1)[0] if type_counts else ("none", 0)

    lines = [
        f"## Interaction Harvest — {datetime.now().strftime('%Y-%m-%d')}",
        f"",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Conversations | {len(sessions)} |",
        f"| Total interactions | {len(interactions)} |",
        f"| Flagged | {len(all_flags)} |",
        f"| Most common failure | {most_common[0]} ({most_common[1]}x) |",
        f"",
    ]

    # 3 worst examples (high severity first)
    worst = sorted(all_flags, key=lambda f: {"high": 0, "medium": 1, "low": 2}.get(
        f["severity"], 3
    ))[:3]
    if worst:
        lines.append("### Worst Examples")
        lines.append("")
        for i, flag in enumerate(worst, 1):
            lines.append(f"**{i}. {flag['type']}** ({flag['timestamp']})")
            lines.append(f"> User: {flag['user_message']}")
            lines.append(f"> Issue: {flag['detail']}")
            lines.append("")

    return "\n".join(lines)


def post_to_github(comment: str):
    """Post comment to GitHub issue #18 via gh CLI."""
    try:
        subprocess.run(
            ["gh", "issue", "comment", str(GITHUB_ISSUE), "--body", comment],
            check=True, capture_output=True, text=True,
        )
        print(f"Posted summary to GitHub issue #{GITHUB_ISSUE}")
    except subprocess.CalledProcessError as e:
        print(f"Failed to post to GitHub: {e.stderr}")
    except FileNotFoundError:
        print("gh CLI not found — skipping GitHub post")


def main():
    parser = argparse.ArgumentParser(description="Harvest MIRA interactions and flag quality issues")
    parser.add_argument("--since", default="24h", help="Time window: 24h, 7d, 4w, all (default: 24h)")
    parser.add_argument("--db", default=DB_PATH, help=f"SQLite DB path (default: {DB_PATH})")
    parser.add_argument("--post-github", action="store_true", help="Post summary to GitHub issue #18")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR), help="Output directory")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    since = parse_since(args.since)
    since_str = since.strftime("%Y-%m-%d %H:%M") if since else "all time"
    print(f"Harvesting interactions since {since_str} from {args.db}")

    if not Path(args.db).exists():
        print(f"Database not found: {args.db}")
        print("0 conversations, 0 flagged")
        return

    interactions = fetch_interactions(args.db, since)
    if not interactions:
        print("0 conversations, 0 flagged")
        write_interaction_log([], output_dir)
        write_quality_flags([], [], output_dir)
        return

    sessions = group_sessions(interactions)
    all_flags = []
    for session in sessions:
        all_flags.extend(flag_session(session))

    write_interaction_log(interactions, output_dir)
    write_quality_flags(sessions, all_flags, output_dir)

    print(f"\n{len(sessions)} conversations, {len(all_flags)} flagged")

    if args.post_github and all_flags:
        comment = build_github_comment(sessions, all_flags, interactions)
        post_to_github(comment)
    elif args.post_github:
        print("No flags to post — skipping GitHub comment")


if __name__ == "__main__":
    main()

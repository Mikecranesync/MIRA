#!/usr/bin/env python3
"""
telegram_verify.py — Scores the most recent manual photo test.
Run after sending a photo from your phone to the MIRA bot.

Logic:
1. getUpdates → find most recent message with photo attachment (sent to bot)
2. Extract chat_id from that update
3. Query ~/Mira/mira-bridge/data/mira.db conversation_state WHERE chat_id=?
4. Parse JSON state → extract last assistant message from history
5. Score against 6-part pass condition (includes IDENTIFICATION since photo was sent)
6. Write report to artifacts/latest_run/report_telegram_photo.md
7. Print PASS/FAIL with full evidence
"""
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

_HERE = Path(__file__).parent
_BOTS_ROOT = _HERE.parent
_CORE_ROOT  = _BOTS_ROOT.parent / "mira-core"
_ARTIFACTS_DIR = _BOTS_ROOT / "artifacts" / "latest_run"
_SMOKE_RESULTS = _ARTIFACTS_DIR / "smoke_results.json"
_DB_PATH = Path.home() / "Mira" / "mira-bridge" / "data" / "mira.db"


def _load_env() -> None:
    env_path = _BOTS_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


_load_env()

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BOT_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Scoring patterns
_DEVICE_TERMS = [
    "gs10", "micro820", "vfd", "drive", "plc", "inverter", "motor",
    "variable frequency", "programmable logic", "controller",
]
_FAULT_CAUSE_TERMS = [
    "caused by", "due to", "likely", "indicates", "suggest",
    "overloaded", "overheated", "overcurrent", "overload", "overheat",
    "tripped", "failed", "worn", "shorted", "open circuit", "low voltage",
    "high temp", "winding", "bearing", "insulation", "phase", "imbalance",
    "probable", "voltage", "most likely",
]
_ACTION_VERBS = [
    "check", "inspect", "verify", "measure", "reset", "test", "replace",
    "disconnect", "reconnect", "clean", "tighten", "remove", "install",
    "confirm", "ensure", "read",
]
_HALLUCINATION_TERMS = [
    "siemens", "allen-bradley", "rockwell", "ab plc",
    "mitsubishi melsec", "omron sysmac", "schneider modicon",
]


def _score_photo_response(reply: str) -> dict:
    """6-part scorer for photo test response."""
    if not reply:
        return {
            "passed": False,
            "conditions": {k: False for k in [
                "IDENTIFICATION", "FAULT_CAUSE", "NEXT_STEP",
                "READABILITY", "NO_HALLUCINATION", "ACTIONABILITY",
            ]},
            "word_count": 0,
            "failed": ["IDENTIFICATION", "FAULT_CAUSE", "NEXT_STEP",
                       "READABILITY", "NO_HALLUCINATION", "ACTIONABILITY"],
        }

    r = reply.lower()
    word_count = len(reply.split())

    identification   = any(t in r for t in _DEVICE_TERMS)
    fault_cause      = any(t in r for t in _FAULT_CAUSE_TERMS)
    next_step        = any(v in r for v in _ACTION_VERBS)
    readability      = 20 <= word_count <= 150
    no_hallucination = not any(t in r for t in _HALLUCINATION_TERMS)
    # Actionability: at least one physically doable next step
    actionability    = next_step

    conditions = {
        "IDENTIFICATION":   identification,
        "FAULT_CAUSE":      fault_cause,
        "NEXT_STEP":        next_step,
        "READABILITY":      readability,
        "NO_HALLUCINATION": no_hallucination,
        "ACTIONABILITY":    actionability,
    }
    passed = all(conditions.values())
    failed = [k for k, v in conditions.items() if not v]

    return {
        "passed":     passed,
        "conditions": conditions,
        "word_count": word_count,
        "failed":     failed,
    }


def _find_latest_photo_update() -> tuple[int | None, int | None]:
    """Return (chat_id, message_id) of most recent photo message sent to bot."""
    try:
        with httpx.Client(timeout=15) as client:
            r = client.get(f"{BOT_API}/getUpdates", params={"limit": 100})
            data = r.json()
    except Exception as e:
        print(f"  getUpdates error: {e}")
        return None, None

    updates = data.get("result", [])
    for u in reversed(updates):
        msg = u.get("message", {})
        if msg.get("photo") and not msg.get("from", {}).get("is_bot", False):
            return msg["chat"]["id"], msg["message_id"]

    return None, None


def _get_bot_reply_from_db(chat_id: int) -> str | None:
    """Read last assistant message from SQLite conversation_state."""
    if not _DB_PATH.exists():
        print(f"  DB not found: {_DB_PATH}")
        return None

    try:
        conn = sqlite3.connect(str(_DB_PATH))
        conn.row_factory = sqlite3.Row

        for cid in (str(chat_id), chat_id):
            cur = conn.execute(
                "SELECT state_json FROM conversation_state "
                "WHERE chat_id=? ORDER BY updated_at DESC LIMIT 1",
                (cid,),
            )
            row = cur.fetchone()
            if row:
                break

        conn.close()

        if not row:
            return None

        state   = json.loads(row["state_json"])
        history = state.get("history", [])
        for msg in reversed(history):
            if msg.get("role") == "assistant":
                return msg.get("content", "")

        return None

    except Exception as e:
        print(f"  DB read error: {e}")
        return None


def _git_tag_and_push(repo_path: Path, tag: str) -> bool:
    try:
        subprocess.run(
            ["git", "-C", str(repo_path), "tag", tag],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["git", "-C", str(repo_path), "push", "origin", tag],
            check=True, capture_output=True,
        )
        print(f"  Tagged + pushed: {tag} ({repo_path.name})")
        return True
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode().strip() if e.stderr else ""
        print(f"  Tag/push failed ({repo_path.name}): {stderr}")
        return False


def _release_gate(photo_passed: bool) -> None:
    """Tag v1.0.1 only after the real Telegram photo path passes."""
    print("\n=== RELEASE GATE ===")
    if not photo_passed:
        print("  STOP — photo test failed. Fix before tagging.")
        return

    # Read GSD smoke results if available (written by telegram_bot_test.py Phase 6)
    gsd_rate = None
    if _SMOKE_RESULTS.exists():
        try:
            data = json.loads(_SMOKE_RESULTS.read_text())
            gsd_rate = data.get("gsd_rate")
        except Exception:
            pass

    if gsd_rate is not None and gsd_rate < 0.80:
        print(f"  STOP — GSD smoke rate {gsd_rate:.0%} below 80%.")
        print("  Run telegram_bot_test.py and fix GSD failures first.")
        return

    tag = "v1.0.1"
    ok_bots = _git_tag_and_push(_BOTS_ROOT, tag)
    ok_core = _git_tag_and_push(_CORE_ROOT, tag)
    if ok_bots and ok_core:
        gsd_str = f", GSD {gsd_rate:.0%}" if gsd_rate is not None else ""
        print(f"\n  MIRA {tag} RELEASED — real Telegram photo path validated{gsd_str}")
    else:
        print("\n  Partial tag — check errors above")


def main() -> None:
    print("MIRA Telegram Photo Verify")
    print("=" * 40)

    if not BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set. Check ~/Mira/mira-bots/.env")
        sys.exit(1)

    # Step 1: Find latest photo update
    print("\nStep 1: Searching for latest photo message in getUpdates...")
    chat_id, msg_id = _find_latest_photo_update()
    if chat_id is None:
        print("  ERROR: No photo message found in recent updates.")
        print("  Did you send a photo to the bot from your phone?")
        print("  Note: getUpdates may not capture old messages — try resending the photo.")
        sys.exit(1)
    print(f"  Found photo from chat_id={chat_id}, message_id={msg_id}")

    # Step 2: Get bot reply from SQLite
    print("\nStep 2: Reading bot reply from SQLite conversation_state...")
    reply = _get_bot_reply_from_db(chat_id)
    if not reply:
        print(f"  No reply found in DB for chat_id={chat_id}")
        print("  Possible causes:")
        print("    - Bot hasn't finished processing the photo yet (wait 10–30 s and retry)")
        print(f"    - Wrong DB path: {_DB_PATH}")
        print("    - conversation_state table schema differs — check mira-bridge container logs")
        sys.exit(1)

    word_count = len(reply.split())
    print(f"  Reply ({word_count} words): {reply[:200]}{'...' if len(reply) > 200 else ''}")

    # Step 3: Score
    print("\nStep 3: Scoring (6-part photo pass condition)...")
    scored = _score_photo_response(reply)

    # Step 4: Write report
    _ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    status_str = "PASS" if scored["passed"] else "FAIL"

    lines = [
        f"# MIRA Telegram Photo Test — {now}",
        "",
        f"## Result: {status_str}",
        "",
        f"**chat_id:** {chat_id}",
        f"**message_id:** {msg_id}",
        f"**Word count:** {scored['word_count']}",
        "",
        "## Conditions",
        "",
        "| Condition | Result |",
        "|-----------|--------|",
    ]
    for cond, result in scored["conditions"].items():
        lines.append(f"| {cond} | {'PASS' if result else 'FAIL'} |")

    if scored.get("failed"):
        lines += ["", f"**Failed conditions:** {', '.join(scored['failed'])}"]

    lines += [
        "",
        "## Bot Reply",
        "",
        "```",
        reply,
        "```",
    ]

    report_path = _ARTIFACTS_DIR / "report_telegram_photo.md"
    report_path.write_text("\n".join(lines))

    # Step 5: Print result
    print("\n" + "=" * 40)
    overall = "PASS" if scored["passed"] else "FAIL"
    print(f"  {overall} — {scored['word_count']} words")
    for cond, result in scored["conditions"].items():
        mark = "PASS" if result else "FAIL"
        print(f"  {mark:4s}  {cond}")

    print(f"\n  Report: {report_path}")

    if not scored["passed"]:
        print(f"\n  Failed conditions: {', '.join(scored['failed'])}")

    _release_gate(scored["passed"])

    if not scored["passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()

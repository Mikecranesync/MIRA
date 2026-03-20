#!/usr/bin/env python3
"""MIRA Demo Conversation — automated Telegram interaction for screen recording.

Sends a pre-scripted diagnostic conversation to the MIRA bot and prints
timestamped send/receive logs. Use this to drive a repeatable demo recording.

Environment variables (same as telegram_test_runner):
    TELETHON_API_ID      — Telegram API ID (from my.telegram.org)
    TELETHON_API_HASH    — Telegram API hash
    TELETHON_SESSION     — Path to .session file (default: demo/mira_demo.session)

Usage:
    # See what will be sent without connecting
    python demo/demo_conversation.py --dry-run

    # Run live (start screen recording first!)
    python demo/demo_conversation.py --delay 10

    # Use a different bot or session
    python demo/demo_conversation.py --bot @SomeOtherBot --delay 8
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Demo message sequence
# ---------------------------------------------------------------------------

MESSAGES = [
    {
        "text": "/reset",
        "note": "Clear any previous conversation state",
        "post_delay": 3,         # short pause — reset is instant
    },
    {
        "text": "I'm having trouble with the main conveyor. The motor keeps tripping.",
        "note": "Describe the problem — triggers GSD opening question",
        "post_delay": None,      # wait for bot reply
    },
    {
        "text": "1",
        "note": "Select option 1 — symptom matches overcurrent / tripping fault",
        "post_delay": None,
    },
    {
        "text": "2",
        "note": "Select option 2 — fault occurs after running a few minutes (thermal)",
        "post_delay": None,
    },
    {
        "text": "1",
        "note": "Select option 1 — ambient temperature has been higher than normal",
        "post_delay": None,
    },
    {
        "text": "/equipment CONV-001",
        "note": "Pull live equipment status from MCP endpoint",
        "post_delay": None,
    },
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _print(tag: str, text: str, note: str = "") -> None:
    note_str = f"  # {note}" if note else ""
    print(f"[{_ts()}] {tag:>6}  {text!r}{note_str}")


async def _wait_for_reply(
    client,
    entity,
    after_id: int,
    timeout: int,
    poll_interval: float = 1.5,
) -> str | None:
    """Poll for new bot messages after `after_id`. Returns full text of last substantive reply."""
    collected = []
    last_seen_id = after_id
    silence_ticks = 0
    elapsed = 0.0

    while elapsed < timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        new = []
        async for msg in client.iter_messages(entity, limit=30, min_id=last_seen_id):
            if not msg.out and msg.text:
                new.append(msg)
        new.sort(key=lambda m: m.id)
        if new:
            collected.extend(new)
            last_seen_id = new[-1].id
            silence_ticks = 0
        else:
            silence_ticks += 1
            # Stop polling after 4 quiet ticks once we have something
            if collected and silence_ticks >= 4:
                break

    if not collected:
        return None
    # Prefer the last substantive message (>30 chars); fall back to last message
    substantive = [m for m in collected if len(m.text) > 30]
    return (substantive[-1] if substantive else collected[-1]).text


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


def run_dry(messages: list[dict], bot: str, delay: int) -> None:
    print(f"\nDRY RUN — would send to {bot} with {delay}s inter-message delay\n")
    print(f"{'#':<4} {'Wait':<12} {'Message'}")
    print("-" * 70)
    for i, msg in enumerate(messages, 1):
        wait = f"{msg['post_delay']}s fixed" if msg["post_delay"] is not None else f"bot reply (max {delay*3}s)"
        print(f"{i:<4} {wait:<12} {msg['text']!r}")
        if msg.get("note"):
            print(f"     {'':12} # {msg['note']}")
    print()


# ---------------------------------------------------------------------------
# Live run
# ---------------------------------------------------------------------------


async def run_live(messages: list[dict], bot: str, delay: int, session_path: str) -> None:
    try:
        from telethon import TelegramClient
    except ImportError:
        print("ERROR: telethon is not installed. Install with: pip install telethon>=1.36.0")
        sys.exit(1)

    api_id_str = os.environ.get("TELETHON_API_ID", "")
    api_hash = os.environ.get("TELETHON_API_HASH", "")

    if not api_id_str or not api_hash:
        print("ERROR: TELETHON_API_ID and TELETHON_API_HASH must be set.")
        print("Get them from https://my.telegram.org under 'API development tools'.")
        sys.exit(1)

    try:
        api_id = int(api_id_str)
    except ValueError:
        print(f"ERROR: TELETHON_API_ID must be an integer, got: {api_id_str!r}")
        sys.exit(1)

    # Strip .session suffix — TelegramClient adds it automatically
    session = session_path[:-8] if session_path.endswith(".session") else session_path

    if not Path(session_path).exists() and not Path(session + ".session").exists():
        print(f"ERROR: Telethon session not found at {session_path}")
        print("Create a session first:")
        print("  python mira-bots/telegram_test_runner/session_setup.py")
        print("Then set: TELETHON_SESSION=/path/to/session_file")
        sys.exit(1)

    print(f"\nConnecting to Telegram as demo user...")
    print(f"  Bot:     {bot}")
    print(f"  Session: {session_path}")
    print(f"  Delay:   {delay}s max wait per reply\n")

    async with TelegramClient(session, api_id, api_hash) as client:
        await client.start()
        entity = await client.get_entity(bot)
        _print("READY", f"Connected — sending to {bot}")

        # Anchor message ID so we only collect replies to our own messages
        last_sent_id = 0
        async for msg in client.iter_messages(entity, limit=1):
            last_sent_id = msg.id

        for i, msg in enumerate(messages, 1):
            _print("SEND", msg["text"], msg.get("note", ""))
            sent = await client.send_message(entity, msg["text"])
            last_sent_id = sent.id

            post_delay = msg.get("post_delay")
            if post_delay is not None:
                # Fixed pause (e.g., after /reset)
                await asyncio.sleep(post_delay)
                _print("SKIP", f"Fixed {post_delay}s pause (no reply expected)")
            else:
                # Wait for actual bot reply
                reply = await _wait_for_reply(
                    client, entity, last_sent_id, timeout=delay * 3, poll_interval=1.5
                )
                if reply:
                    preview = reply[:120].replace("\n", " ")
                    _print("RECV", preview)
                    # Advance anchor past the reply messages
                    async for latest in client.iter_messages(entity, limit=1):
                        last_sent_id = latest.id
                else:
                    _print("WARN", f"No reply received within {delay * 3}s — continuing")

                # Pause between turns to give screen recording breathing room
                if i < len(messages):
                    await asyncio.sleep(delay)

    print(f"\n[{_ts()}] Demo conversation complete.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MIRA demo conversation — automated Telegram interaction"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the message sequence without connecting to Telegram",
    )
    parser.add_argument(
        "--delay",
        type=int,
        default=8,
        help="Seconds to pause between messages after receiving a reply (default: 8)",
    )
    parser.add_argument(
        "--bot",
        default="@FactoryLMDiagnose_bot",
        help="Bot username to send messages to (default: @FactoryLMDiagnose_bot)",
    )
    parser.add_argument(
        "--session",
        default=os.environ.get("TELETHON_SESSION", str(HERE / "mira_demo.session")),
        help="Path to Telethon .session file (default: demo/mira_demo.session or $TELETHON_SESSION)",
    )
    args = parser.parse_args()

    if args.dry_run:
        run_dry(MESSAGES, args.bot, args.delay)
        return

    asyncio.run(run_live(MESSAGES, args.bot, args.delay, args.session))


if __name__ == "__main__":
    main()

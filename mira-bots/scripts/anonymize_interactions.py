"""anonymize_interactions.py — Extract and anonymize chat history + GSD diagnostics.

Two export functions:
  1. extract_messages() — reads webui.db, strips PII, writes anonymized_chats.jsonl
  2. export_diagnostics() — reads mira.db conversation_state, writes anonymized_diagnostics.jsonl

Run with:
    doppler run --project factorylm --config prd -- python anonymize_interactions.py
"""

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# Path to Open WebUI SQLite database (inside mira-core container, mapped to host)
WEBUI_DB_PATH = os.environ.get("WEBUI_DB_PATH", "/Users/bravonode/Mira/mira-core/data/webui.db")
OUTPUT_PATH = Path(__file__).parent / "data" / "anonymized_chats.jsonl"

# PII removal patterns
PII_PATTERNS = [
    # IP addresses
    (re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "[IP_REDACTED]"),
    # Phone numbers (US formats)
    (re.compile(r"\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"), "[PHONE_REDACTED]"),
    # Email addresses
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "[EMAIL_REDACTED]"),
    # Serial numbers (alphanumeric, 8-20 chars, common industrial pattern)
    (re.compile(r"\bSN[-:]?\s*[A-Z0-9]{6,20}\b", re.IGNORECASE), "[SERIAL_REDACTED]"),
    # Telegram usernames
    (re.compile(r"@[A-Za-z0-9_]{4,32}"), "[USERNAME_REDACTED]"),
]

# Simple name word-list (extend as needed)
KNOWN_NAMES = [
    "Mike",
    "Michael",
    "John",
    "Jane",
    "Bob",
    "Alice",
    "Dave",
    "Sarah",
]
NAME_PATTERN = re.compile(r"\b(" + "|".join(re.escape(n) for n in KNOWN_NAMES) + r")\b")


def strip_pii(text: str) -> str:
    if not text:
        return text
    for pattern, replacement in PII_PATTERNS:
        text = pattern.sub(replacement, text)
    text = NAME_PATTERN.sub("[NAME_REDACTED]", text)
    return text


def extract_messages(db_path: str) -> list[dict]:
    """Extract chat messages from webui.db."""
    if not Path(db_path).exists():
        print(f"WARNING: DB not found at {db_path}. Trying fallback paths.")
        fallbacks = [
            "/app/backend/data/webui.db",
            os.path.expanduser("~/Mira/mira-core/data/webui.db"),
        ]
        for fb in fallbacks:
            if Path(fb).exists():
                db_path = fb
                print(f"Using fallback: {db_path}")
                break
        else:
            print("ERROR: webui.db not found. Set WEBUI_DB_PATH env var.")
            return []

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Open WebUI stores chat history in the 'chat' table as JSON
    try:
        cur.execute("SELECT id, user_id, title, chat, updated_at FROM chat ORDER BY updated_at ASC")
        rows = cur.fetchall()
    except sqlite3.OperationalError as e:
        print(f"ERROR querying DB: {e}")
        conn.close()
        return []

    conn.close()

    messages = []
    for row in rows:
        chat_json = row["chat"]
        if not chat_json:
            continue
        try:
            chat_data = json.loads(chat_json)
        except json.JSONDecodeError:
            continue

        # Open WebUI chat format: {"history": {"messages": {...}}, "messages": [...]}
        raw_messages = chat_data.get("messages", [])
        if not raw_messages:
            # Try nested history format
            history = chat_data.get("history", {})
            msgs_dict = history.get("messages", {})
            raw_messages = list(msgs_dict.values()) if isinstance(msgs_dict, dict) else []

        for msg in raw_messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if not role or not content:
                continue
            if isinstance(content, list):
                # Multi-part content — extract text parts only
                content = " ".join(
                    part.get("text", "")
                    for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                )
            messages.append(
                {
                    "role": role,
                    "content": strip_pii(str(content)),
                    "timestamp": row["updated_at"],
                }
            )

    return messages


def anonymize_chat_id(chat_id: str) -> str:
    """SHA-256 hash of chat_id for anonymization."""
    return hashlib.sha256(chat_id.encode()).hexdigest()[:16]


def export_diagnostics():
    """Export completed GSD conversations as anonymized JSONL records."""
    mira_db = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    diag_output = Path(__file__).parent / "data" / "anonymized_diagnostics.jsonl"

    if not Path(mira_db).exists():
        print(f"WARNING: mira.db not found at {mira_db}. Skipping diagnostics export.")
        return

    db = sqlite3.connect(mira_db)
    db.row_factory = sqlite3.Row

    rows = db.execute(
        """SELECT chat_id, state, asset_identified, fault_category,
                  exchange_count, final_state, updated_at
           FROM conversation_state
           WHERE final_state IS NOT NULL
             AND updated_at > datetime('now', '-25 hours')"""
    ).fetchall()
    db.close()

    if not rows:
        print("No completed GSD conversations in the last 25 hours.")
        return

    diag_output.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with open(diag_output, "a") as f:
        for row in rows:
            record = {
                "session_id": anonymize_chat_id(row["chat_id"]),
                "asset": row["asset_identified"] or "unknown",
                "fault_category": row["fault_category"] or "unknown",
                "exchanges_to_resolution": row["exchange_count"],
                "resolved": row["final_state"] == "RESOLVED",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            f.write(json.dumps(record) + "\n")
            count += 1

    print(f"Exported {count} anonymized diagnostic records to {diag_output}")


def main():
    # Export 1: Open WebUI chat history (anonymized)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Extracting from: {WEBUI_DB_PATH}")
    messages = extract_messages(WEBUI_DB_PATH)
    print(f"Extracted {len(messages)} messages")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        for msg in messages:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")

    print(f"Written to: {OUTPUT_PATH}")

    # Export 2: GSD diagnostic conversations (anonymized)
    export_diagnostics()


if __name__ == "__main__":
    main()

"""Lightweight conversation memory — SQLite + Ollama embeddings.

Extracts facts from each conversation turn (equipment tags, fault codes,
procedures, symptoms) and stores them with vector embeddings. On the next
query, retrieves the top-N most relevant memories and formats them as a
text block for system prompt injection.

No external dependencies beyond httpx + sqlite3 (both already in the stack).
Uses the same nomic-embed-text model as NeonDB recall.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import time

import httpx

logger = logging.getLogger("mira.memory")

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
EMBED_MODEL = os.getenv("MEM_EMBED_MODEL", "nomic-embed-text:latest")
MEM_DB_PATH = os.getenv("MEM_DB_PATH", "/data/mem0/memory.db")
MAX_MEMORIES = int(os.getenv("MEM_MAX_RESULTS", "5"))
MAX_TOKENS = int(os.getenv("MEM_MAX_TOKENS", "500"))
PRUNE_DAYS = int(os.getenv("MEM_PRUNE_DAYS", "90"))

# Fault code pattern (reuse from neon_recall)
_FAULT_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")

# Action step pattern — sentences starting with a verb
_ACTION_RE = re.compile(
    r"(?:^|\. )((?:Check|Measure|Reset|Verify|Inspect|Disconnect|Replace|Test|Remove|Tighten|"
    r"Clean|Confirm|Record|Monitor|Adjust|Set|Toggle|Power|De-energize|Lock|Tag)\b[^.]{10,80})",
    re.IGNORECASE,
)


def _ensure_db(db_path: str) -> None:
    """Create memory tables if they don't exist."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id     TEXT NOT NULL,
            fact_type   TEXT NOT NULL,
            content     TEXT NOT NULL,
            embedding   TEXT,
            created_at  REAL NOT NULL DEFAULT (unixepoch())
        )
    """)
    db.execute("""
        CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id)
    """)
    db.commit()
    db.close()


def _embed(text: str) -> list[float]:
    """Get embedding vector from Ollama. Returns [] on failure."""
    try:
        r = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("embedding", [])
    except Exception as e:
        logger.warning("Memory embed failed: %s", e)
        return []


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


class ConversationMemory:
    """Lightweight memory store — extract facts, embed, search, inject."""

    def __init__(self, db_path: str = MEM_DB_PATH):
        self.db_path = db_path
        _ensure_db(db_path)
        logger.info("ConversationMemory initialized (db=%s)", db_path)

    def extract_and_store(
        self,
        chat_id: str,
        user_message: str,
        assistant_reply: str,
        asset_identified: str = "",
    ) -> int:
        """Extract facts from a conversation turn and store them.

        Returns the number of facts stored.
        """
        facts: list[tuple[str, str]] = []  # (fact_type, content)

        # Equipment identification
        if asset_identified and len(asset_identified) > 3:
            facts.append(("equipment", asset_identified))

        # Fault codes from user message
        for code in set(_FAULT_RE.findall(user_message)):
            if len(code) >= 2:
                facts.append(("fault_code", code))

        # Action steps from assistant reply
        for match in _ACTION_RE.finditer(assistant_reply):
            step = match.group(1).strip().rstrip(".")
            if len(step) > 15:
                facts.append(("procedure", step))

        # Key user observations (equipment-specific details)
        # Extract voltage, current, HP mentions with context
        spec_patterns = [
            (r"\b(\d{2,3})\s*[Vv](?:olt|AC|DC)\b", "voltage"),
            (r"\b(\d+)\s*(?:HP|hp|horsepower)\b", "power_rating"),
            (r"\b(\d+)\s*[Aa](?:mp)?\b", "current"),
            (r"\b(\d+)\s*(?:ft|feet|foot)\b", "cable_length"),
        ]
        for pattern, spec_type in spec_patterns:
            m = re.search(pattern, user_message)
            if m:
                # Store the whole sentence containing the spec
                start = max(0, user_message.rfind(".", 0, m.start()) + 1)
                end = user_message.find(".", m.end())
                if end == -1:
                    end = len(user_message)
                context = user_message[start:end].strip()
                if len(context) > 10:
                    facts.append(("observation", context))

        if not facts:
            return 0

        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        stored = 0
        for fact_type, content in facts:
            # Dedup — don't store the same fact twice for this chat
            existing = db.execute(
                "SELECT id FROM memories WHERE chat_id = ? AND content = ?",
                (chat_id, content),
            ).fetchone()
            if existing:
                continue

            emb = _embed(content)
            db.execute(
                "INSERT INTO memories (chat_id, fact_type, content, embedding) VALUES (?, ?, ?, ?)",
                (chat_id, fact_type, content, json.dumps(emb) if emb else None),
            )
            stored += 1

        db.commit()
        db.close()

        if stored:
            logger.info("MEMORY_STORE chat_id=%s stored=%d facts", chat_id, stored)
        return stored

    def search(self, chat_id: str, query: str, limit: int = MAX_MEMORIES) -> list[dict]:
        """Retrieve most relevant memories for a query.

        Returns list of {fact_type, content, similarity} sorted by relevance.
        """
        query_emb = _embed(query)
        if not query_emb:
            return []

        db = sqlite3.connect(self.db_path)
        rows = db.execute(
            "SELECT fact_type, content, embedding FROM memories WHERE chat_id = ? AND embedding IS NOT NULL",
            (chat_id,),
        ).fetchall()
        db.close()

        if not rows:
            return []

        scored = []
        for fact_type, content, emb_json in rows:
            emb = json.loads(emb_json)
            sim = _cosine_sim(query_emb, emb)
            scored.append({"fact_type": fact_type, "content": content, "similarity": sim})

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:limit]

    def format_memory_block(self, memories: list[dict]) -> str:
        """Format memories as a text block for system prompt injection.

        Caps at MAX_TOKENS chars (~tokens) to preserve context window.
        """
        if not memories:
            return ""

        lines = []
        char_count = 0
        for m in memories:
            line = f"- {m['fact_type'].upper()}: {m['content']}"
            if char_count + len(line) > MAX_TOKENS * 4:  # ~4 chars per token
                break
            lines.append(line)
            char_count += len(line)

        return "\n".join(lines)

    def prune_old(self, days: int = PRUNE_DAYS) -> int:
        """Delete memories older than N days. Returns count deleted."""
        cutoff = time.time() - (days * 86400)
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        cursor = db.execute("DELETE FROM memories WHERE created_at < ?", (cutoff,))
        deleted = cursor.rowcount
        db.commit()
        db.close()
        if deleted:
            logger.info("MEMORY_PRUNE deleted=%d (older than %d days)", deleted, days)
        return deleted

    def get_stats(self) -> dict:
        """Return memory statistics."""
        db = sqlite3.connect(self.db_path)
        total = db.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        by_type = db.execute(
            "SELECT fact_type, COUNT(*) FROM memories GROUP BY fact_type"
        ).fetchall()
        unique_chats = db.execute("SELECT COUNT(DISTINCT chat_id) FROM memories").fetchone()[0]
        db.close()
        return {
            "total_memories": total,
            "by_type": {row[0]: row[1] for row in by_type},
            "unique_chats": unique_chats,
        }

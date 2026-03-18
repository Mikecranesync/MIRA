"""OpenViking context store — filesystem-based vector retrieval.

Falls back to a sqlite-backed keyword-cosine store if openviking is
unavailable, requiring zero additional dependencies beyond stdlib.
"""

import json
import logging
import math
import os
import sqlite3

logger = logging.getLogger("mira-mcp")

VIKING_STORE_PATH = os.environ.get("VIKING_STORE_PATH", "/mira-db/viking")

try:
    import openviking
    _USE_OPENVIKING = True
    logger.info("OpenViking backend active (v%s)", getattr(openviking, "__version__", "?"))
except ImportError:
    _USE_OPENVIKING = False
    logger.warning("openviking not installed — using sqlite keyword-cosine fallback")


# ---------------------------------------------------------------------------
# Fallback: sqlite keyword-cosine store (stdlib only)
# ---------------------------------------------------------------------------

def _fallback_db_path() -> str:
    os.makedirs(VIKING_STORE_PATH, exist_ok=True)
    return os.path.join(VIKING_STORE_PATH, "fallback.db")


def _ensure_fallback_db(db_path: str) -> None:
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS viking_chunks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            store_key  TEXT NOT NULL,
            content    TEXT NOT NULL,
            metadata   TEXT NOT NULL DEFAULT '{}'
        )
    """)
    db.commit()
    db.close()


def _term_score(query: str, content: str) -> float:
    """Simple term-overlap score in [0, 1]."""
    q_words = set(query.lower().split())
    c_words = set(content.lower().split())
    if not q_words:
        return 0.0
    return len(q_words & c_words) / len(q_words)


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def ingest_text(text: str, store_key: str, metadata: dict = None) -> int:
    """Store a text chunk under store_key. Returns row id."""
    meta = metadata or {}
    if _USE_OPENVIKING:
        store = openviking.open(store_key, create=True)
        return store.add(text, metadata=meta)

    db_path = _fallback_db_path()
    _ensure_fallback_db(db_path)
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    cur = db.execute(
        "INSERT INTO viking_chunks (store_key, content, metadata) VALUES (?, ?, ?)",
        (store_key, text, json.dumps(meta)),
    )
    row_id = cur.lastrowid
    db.commit()
    db.close()
    return row_id


def ingest_pdf(path: str, tenant_id: str, equipment_type: str) -> int:
    """Ingest a PDF as page chunks into viking://{tenant_id}/equipment/{equipment_type}.

    Returns number of chunks stored.
    """
    store_key = f"viking://{tenant_id}/equipment/{equipment_type}"
    try:
        import pdfplumber
        pages = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text and text.strip():
                    pages.append(text.strip())
    except ImportError:
        with open(path, "r", errors="ignore") as f:
            pages = [f.read()]

    count = 0
    for i, chunk in enumerate(pages):
        ingest_text(chunk, store_key, metadata={
            "source": os.path.basename(path),
            "tenant_id": tenant_id,
            "equipment_type": equipment_type,
            "page": i,
        })
        count += 1
    logger.info("Ingested %d chunks from %s → %s", count, path, store_key)
    return count


def retrieve(query: str, tenant_id: str, top_k: int = 5) -> list[dict]:
    """Return top_k context chunks for query from tenant's store.

    Each result: {"content": str, "score": float, "metadata": dict}
    """
    store_key = f"viking://{tenant_id}/equipment"

    if _USE_OPENVIKING:
        try:
            store = openviking.open(store_key, create=False)
            results = store.search(query, top_k=top_k)
            return [{"content": r.text, "score": r.score, "metadata": r.metadata}
                    for r in results]
        except Exception as e:
            logger.warning("openviking.search failed: %s — falling back to sqlite", e)

    db_path = _fallback_db_path()
    if not os.path.exists(db_path):
        return []
    _ensure_fallback_db(db_path)
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        "SELECT content, metadata FROM viking_chunks WHERE store_key LIKE ?",
        (f"%{tenant_id}%",),
    ).fetchall()
    db.close()

    scored = []
    for row in rows:
        score = _term_score(query, row["content"])
        scored.append({
            "content": row["content"],
            "score": round(score, 4),
            "metadata": json.loads(row["metadata"]),
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]

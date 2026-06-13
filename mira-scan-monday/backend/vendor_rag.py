"""Manufacturer-scoped RAG for the scan chat path.

Bypasses mira-pipeline (which retrieves across all manufacturers) and
queries `knowledge_entries` directly with a manufacturer ILIKE filter so
a PowerFlex 525 chat never sees Yaskawa or AutomationDirect chunks.

Retrieval = Postgres BM25 via `content_tsv @@ plainto_tsquery(...)`
(no embeddings needed — the GIN index is already populated by the
crawler ingest pipeline). Chunks become the LLM's grounded context;
the LLM cascade (Groq → Cerebras → Gemini) is called directly.

Falls back to mira_rag.chat()'s existing mira-pipeline path when:
- the asset isn't in the curated allowlist (no manufacturer patterns),
- NeonDB is unavailable,
- or all LLM providers fail.

Returns a deterministic "no documentation indexed" message (instead of falling
back) when the asset IS in the allowlist but has no KB chunks — this prevents
the cross-vendor contamination that the mira-pipeline path would cause.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from . import db
from .known_equipment import get_equipment
from .models import ChatSource

logger = logging.getLogger("mira-scan.vendor_rag")

SHARED_TENANT_ID = os.getenv(
    "MIRA_SHARED_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
)
VENDOR_RAG_TOP_K = int(os.getenv("VENDOR_RAG_TOP_K", "5"))
VENDOR_RAG_LLM_TIMEOUT = float(os.getenv("VENDOR_RAG_LLM_TIMEOUT", "30"))


def manufacturer_patterns(asset_id: str | None) -> list[str]:
    """Return ILIKE patterns for the manufacturer column.

    Curated entries already enumerate the manufacturer aliases that
    appear in scanner output AND in `knowledge_entries.manufacturer`
    (Allen-Bradley vs Rockwell, ABB vs Baldor-Reliance, etc.). Reusing
    them here means the same source of truth governs both directions.
    """
    if not asset_id:
        return []
    entry = get_equipment(asset_id)
    if not entry:
        return []
    return [f"%{tok}%" for tok in entry.get("make", []) if tok]


async def retrieve_vendor_chunks(
    patterns: list[str], query: str, top_k: int = VENDOR_RAG_TOP_K
) -> list[dict[str, Any]]:
    """BM25-rank chunks restricted to the given manufacturer patterns.

    Returns [] on empty inputs or any DB error so the caller can fall
    back without raising.
    """
    if not patterns or not query.strip():
        return []

    # Build N OR'd ILIKE clauses with positional params to avoid string
    # interpolation. Order: $1 = query, $2..$N+1 = patterns, last = limit.
    mfr_clauses = " OR ".join("manufacturer ILIKE %s" for _ in patterns)
    sql = f"""
        SELECT content,
               manufacturer,
               model_number,
               source_url,
               source_page,
               metadata,
               ts_rank_cd(content_tsv, plainto_tsquery('english', %s)) AS rank
          FROM knowledge_entries
         WHERE ({mfr_clauses})
           AND content_tsv @@ plainto_tsquery('english', %s)
         ORDER BY rank DESC
         LIMIT %s
    """
    params: tuple[Any, ...] = (query, *patterns, query, top_k)
    try:
        rows = await db.fetch_all(sql, params)
    except db.DBUnavailable:
        return []
    except Exception:
        logger.exception("vendor RAG retrieval failed (patterns=%r)", patterns)
        return []

    chunks: list[dict[str, Any]] = []
    for row in rows:
        chunks.append(
            {
                "content": row[0] or "",
                "manufacturer": row[1] or "",
                "model_number": row[2] or "",
                "source_url": row[3] or "",
                "source_page": row[4],
                "metadata": row[5] or {},
                "rank": float(row[6] or 0.0),
            }
        )
    return chunks


def build_grounded_messages(
    chunks: list[dict[str, Any]],
    asset_label: str | None,
    history: list[dict],
    user_message: str,
) -> list[dict[str, str]]:
    """Assemble the system+history+user messages with [n] citation markers
    so the LLM can reference sources by index."""
    label = asset_label or "the equipment"
    blocks: list[str] = []
    for i, c in enumerate(chunks, start=1):
        head_bits = [b for b in (c.get("manufacturer"), c.get("model_number")) if b]
        head = " ".join(head_bits) or "OEM doc"
        page = c.get("source_page")
        page_str = f", p.{page}" if page else ""
        url = c.get("source_url") or ""
        url_str = f" — {url}" if url else ""
        blocks.append(f"[{i}] {head}{page_str}{url_str}\n{c.get('content', '')}")
    context = "\n\n---\n\n".join(blocks) if blocks else "(no documentation found)"

    system = (
        f"You are MIRA, an industrial maintenance diagnostic assistant answering "
        f"about {label}. Use ONLY the documentation below to answer. Cite sources "
        f"with [n] markers matching the numbered blocks. If the documentation does "
        f"not cover the question, say so plainly — never guess or invent values.\n\n"
        f"Documentation:\n{context}"
    )

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


_PROVIDERS: list[dict[str, str]] = []


def _providers() -> list[dict[str, str]]:
    """Lazy-build the cascade so tests can monkey-patch env vars."""
    global _PROVIDERS  # noqa: PLW0603
    if _PROVIDERS:
        return _PROVIDERS
    out: list[dict[str, str]] = []
    if (k := os.getenv("GROQ_API_KEY", "")):
        out.append(
            {
                "name": "groq",
                "url": "https://api.groq.com/openai/v1/chat/completions",
                "key": k,
                "model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            }
        )
    if (k := os.getenv("CEREBRAS_API_KEY", "")):
        out.append(
            {
                "name": "cerebras",
                "url": "https://api.cerebras.ai/v1/chat/completions",
                "key": k,
                "model": os.getenv("CEREBRAS_MODEL", "llama3.1-8b"),
            }
        )
    if (k := os.getenv("GEMINI_API_KEY", "")):
        out.append(
            {
                "name": "gemini",
                "url": (
                    "https://generativelanguage.googleapis.com/v1beta/openai/"
                    "chat/completions"
                ),
                "key": k,
                "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            }
        )
    _PROVIDERS = out
    return out


async def call_llm_cascade(messages: list[dict[str, str]]) -> str:
    """Try Groq → Cerebras → Gemini; return first non-empty completion."""
    for p in _providers():
        try:
            async with httpx.AsyncClient(timeout=VENDOR_RAG_LLM_TIMEOUT) as client:
                resp = await client.post(
                    p["url"],
                    json={
                        "model": p["model"],
                        "messages": messages,
                        "temperature": 0.2,
                    },
                    headers={
                        "Authorization": f"Bearer {p['key']}",
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            content = data["choices"][0]["message"]["content"] or ""
            if content.strip():
                logger.info("vendor RAG LLM=%s ok", p["name"])
                return content
        except Exception as exc:
            logger.warning("vendor RAG LLM=%s failed: %s", p["name"], exc)
            continue
    return ""


def chunks_to_sources(chunks: list[dict[str, Any]]) -> list[ChatSource]:
    sources: list[ChatSource] = []
    seen: set[tuple[str, int | None]] = set()
    for c in chunks:
        url = c.get("source_url") or ""
        page = c.get("source_page")
        key = (url, page)
        if key in seen:
            continue
        seen.add(key)
        title_bits = [
            b for b in (c.get("manufacturer"), c.get("model_number")) if b
        ]
        title = " ".join(title_bits) or (url or "OEM document")
        sources.append(
            ChatSource(title=title, url=url or None, page=page if page else None)
        )
    return sources


async def vendor_chat(
    message: str,
    asset_id: str | None,
    asset_label: str | None,
    history: list[dict],
) -> tuple[str, list[ChatSource]] | None:
    """Run the manufacturer-scoped chat path.

    Returns (reply, sources) on success, or None if this path can't
    serve the request (no patterns, no chunks, no LLM) — caller then
    falls back to mira-pipeline.
    """
    patterns = manufacturer_patterns(asset_id)
    if not patterns:
        return None

    chunks = await retrieve_vendor_chunks(patterns, message)
    if not chunks:
        logger.info(
            "vendor RAG: no chunks for asset=%s patterns=%r — no documentation indexed",
            asset_id,
            patterns,
        )
        label = asset_label or (asset_id or "").replace("-", " ").strip() or "this equipment"
        return (
            f"I don't have documentation for **{label}** in the knowledge base yet. "
            "Once the OEM manual is indexed, I'll be able to answer grounded questions "
            "about fault codes, parameters, and procedures.",
            [],
        )

    if not _providers():
        logger.warning(
            "vendor RAG: no LLM providers configured — falling back to mira-pipeline"
        )
        return None

    messages = build_grounded_messages(chunks, asset_label, history, message)
    reply = await call_llm_cascade(messages)
    if not reply.strip():
        return None
    return reply, chunks_to_sources(chunks)

"""Blog Fleet — KB-powered blog content generation, validation, and publishing.

Mines fault codes from the NeonDB knowledge base, generates blog articles
grounded in equipment manual content, validates claims against the KB using
Mira's RAG retrieval, and publishes approved drafts.

Pipeline: mine → generate → validate → publish
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.blog")

# Reuse fault code regex from neon_recall.py
_FAULT_CODE_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")

# Topic bank for KB-grounded articles (expanded from content.py)
KB_TOPIC_BANK = [
    "VFD overcurrent faults — causes and systematic diagnosis",
    "Motor insulation testing procedures for maintenance technicians",
    "Allen-Bradley CompactLogix common faults and recovery procedures",
    "PowerFlex 525 parameter setup for basic motor control",
    "Hydraulic system pressure troubleshooting guide",
    "GS20 VFD communication setup over Modbus RTU",
    "How to read and interpret motor nameplates",
    "Air compressor preventive maintenance schedule",
    "Conveyor belt tracking and tensioning procedures",
    "Understanding VFD deceleration faults and braking resistors",
    "PLC analog input scaling and troubleshooting",
    "Bearing lubrication best practices for industrial motors",
    "Siemens SINAMICS G120 commissioning quick start",
    "Yaskawa GA800 fault code reference and recovery",
    "ABB ACS880 first-time startup checklist",
]

MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID", "78917b56-2c58-4e32-b77c-545e30e3e2eb")


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════


def _run_async(coro_func, *args, **kwargs):
    """Run an async function from a sync Celery task."""
    return asyncio.run(coro_func(*args, **kwargs))


def _db_engine():
    """Create a NeonDB engine (NullPool — Neon PgBouncer handles pooling)."""
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def _ensure_blog_schema():
    """Create blog_drafts table if it doesn't exist."""
    from sqlalchemy import text

    engine = _db_engine()
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS blog_drafts (
                id              SERIAL PRIMARY KEY,
                draft_type      TEXT NOT NULL,
                slug            TEXT NOT NULL UNIQUE,
                title           TEXT NOT NULL,
                content_json    JSONB NOT NULL,
                status          TEXT NOT NULL DEFAULT 'draft',
                confidence      REAL,
                validation_notes TEXT,
                source_chunks   TEXT[],
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                published_at    TIMESTAMPTZ
            )
        """))
        conn.commit()


def _insert_draft(draft_type, slug, title, content_json, source_chunks=None):
    """Insert a blog draft row. Returns draft ID or None on conflict."""
    from sqlalchemy import text

    _ensure_blog_schema()
    engine = _db_engine()
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    INSERT INTO blog_drafts (draft_type, slug, title, content_json, source_chunks)
                    VALUES (:dt, :slug, :title, :cj, :sc)
                    ON CONFLICT (slug) DO NOTHING
                    RETURNING id
                """),
                {
                    "dt": draft_type,
                    "slug": slug,
                    "title": title,
                    "cj": json.dumps(content_json),
                    "sc": source_chunks or [],
                },
            )
            conn.commit()
            row = result.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.error("Failed to insert draft slug=%s: %s", slug, e)
        return None


def _update_draft(draft_id, **kwargs):
    """Update draft fields by ID."""
    from sqlalchemy import text

    engine = _db_engine()
    sets = ", ".join(f"{k} = :{k}" for k in kwargs)
    kwargs["did"] = draft_id
    with engine.connect() as conn:
        conn.execute(text(f"UPDATE blog_drafts SET {sets} WHERE id = :did"), kwargs)
        conn.commit()


def _get_existing_slugs():
    """Get all slugs already in blog_drafts."""
    from sqlalchemy import text

    _ensure_blog_schema()
    engine = _db_engine()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT slug FROM blog_drafts")).fetchall()
    return {r[0] for r in rows}


async def _embed_text(text_str: str) -> list[float] | None:
    """Embed text via Ollama nomic-embed-text (768-dim)."""
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{ollama_url}/api/embeddings",
                json={"model": embed_model, "prompt": text_str},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
    except Exception as e:
        logger.warning("Ollama embed failed: %s", e)
        return None


async def _recall_knowledge(query_text: str, limit: int = 10) -> list[dict]:
    """RAG retrieval from NeonDB — vector + keyword hybrid search.

    Simplified version of neon_recall.recall_knowledge() for use outside bot containers.
    """
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        return []

    embedding = await _embed_text(query_text)
    if not embedding:
        return []

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

    # Stage 1: Vector search
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT content, manufacturer, model_number, equipment_type,
                       source_type,
                       1 - (embedding <=> cast(:emb AS vector)) AS similarity
                FROM knowledge_entries
                WHERE tenant_id = :tid AND embedding IS NOT NULL
                ORDER BY embedding <=> cast(:emb AS vector)
                LIMIT :lim
            """),
            {"emb": str(embedding), "tid": MIRA_TENANT_ID, "lim": limit},
        ).mappings().fetchall()

    results = [dict(r) for r in rows if r["similarity"] >= 0.70]

    # Stage 2: Fault code keyword fallback
    codes = list({m.upper() for m in _FAULT_CODE_RE.findall(query_text)})
    if codes and len(results) < 3:
        with engine.connect() as conn:
            for code in codes[:3]:
                like_rows = conn.execute(
                    text("""
                        SELECT content, manufacturer, model_number, equipment_type,
                               source_type, 0.5 AS similarity
                        FROM knowledge_entries
                        WHERE tenant_id = :tid AND content ILIKE :pat
                        LIMIT 5
                    """),
                    {"tid": MIRA_TENANT_ID, "pat": f"%{code}%"},
                ).mappings().fetchall()
                seen = {r["content"][:100] for r in results}
                for r in like_rows:
                    if r["content"][:100] not in seen:
                        results.append(dict(r))
                        seen.add(r["content"][:100])

    return results


async def _claude_complete(system: str, user: str, max_tokens: int = 4096) -> str:
    """Call Claude API via mira_copy client. Returns content string."""
    from mira_copy.client import complete

    content, usage = await complete(system, user, max_tokens=max_tokens)
    logger.info(
        "CLAUDE_CALL input=%d output=%d",
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
    )
    return content


def _parse_json(text: str) -> dict:
    """Extract JSON from Claude response."""
    from mira_copy.client import extract_json

    return extract_json(text)


# ═══════════════════════════════════════════════════════════════════════════
# Task 1: Mine fault codes from KB
# ═══════════════════════════════════════════════════════════════════════════

MINE_SYSTEM_PROMPT = """You are a maintenance technical writer. Extract a structured fault code reference from these equipment manual excerpts.

Output ONLY valid JSON matching this exact schema:
{
  "slug": "manufacturer-code-short-description (URL-safe, lowercase, hyphens)",
  "title": "Manufacturer Fault Code XXX — Short Description",
  "equipment": "Equipment model name",
  "manufacturer": "Manufacturer name",
  "faultCode": "The fault code (e.g., F012, E.OC, Alarm 414)",
  "description": "2-3 sentence description of what this fault means",
  "commonCauses": ["cause 1", "cause 2", "cause 3", "cause 4"],
  "recommendedFix": "1. Step one.\\n2. Step two.\\n3. Step three.",
  "relatedCodes": [],
  "metaDescription": "Under 160 chars targeting maintenance technician search intent"
}

Rules:
- Every fact must come from the provided manual excerpts
- Do NOT invent causes or fixes not supported by the source material
- If the source doesn't have enough detail, say so in the description
- Slug format: manufacturer-code-description (e.g., powerflex-f012-overcurrent)"""


@app.task(bind=True, max_retries=2, default_retry_delay=60)
def mine_fault_codes(self):
    """Mine fault codes from NeonDB knowledge base and create draft pages.

    Queries knowledge_entries for chunks containing fault code patterns,
    groups by code + equipment, sends to Claude for structured extraction.
    """
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    logger.info("Starting fault code mining from KB")

    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        logger.error("NEON_DATABASE_URL not set — aborting")
        return {"mined": 0, "error": "no_db"}

    existing_slugs = _get_existing_slugs()

    # Query KB for chunks containing fault code patterns
    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT content, manufacturer, model_number, equipment_type
                FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND (
                    content ~* '\\m[A-Z]{1,3}[-]?\\d{1,4}\\M'
                    OR content ILIKE '%fault%code%'
                    OR content ILIKE '%alarm%'
                    OR content ILIKE '%error%code%'
                  )
                LIMIT 500
            """),
            {"tid": MIRA_TENANT_ID},
        ).mappings().fetchall()

    logger.info("Found %d KB chunks with potential fault codes", len(rows))

    # Group chunks by manufacturer + fault code
    code_chunks: dict[str, list[dict]] = {}
    for row in rows:
        content = row["content"]
        codes = _FAULT_CODE_RE.findall(content)
        mfr = row.get("manufacturer", "") or "Unknown"
        model = row.get("model_number", "") or ""
        for code in codes:
            key = f"{mfr}|{code.upper()}|{model}"
            if key not in code_chunks:
                code_chunks[key] = []
            code_chunks[key].append(dict(row))

    mined = 0
    for key, chunks in code_chunks.items():
        if mined >= 10:  # Cap per run to control API costs
            break

        mfr, code, model = key.split("|", 2)
        # Build a tentative slug to check for duplicates
        slug_prefix = f"{mfr.lower().replace(' ', '-')}-{code.lower()}"
        if any(s.startswith(slug_prefix) for s in existing_slugs):
            continue

        # Combine chunk content for Claude
        combined = "\n\n---\n\n".join(
            f"[Source: {c.get('manufacturer', '')} {c.get('model_number', '')}]\n{c['content']}"
            for c in chunks[:5]
        )

        try:
            raw = _run_async(
                _claude_complete,
                MINE_SYSTEM_PROMPT,
                f"Equipment manual excerpts for fault code {code} on {mfr} {model}:\n\n{combined}",
                max_tokens=2048,
            )
            fc_data = _parse_json(raw)
        except Exception as exc:
            logger.warning("Claude extraction failed for %s: %s", key, exc)
            continue

        slug = fc_data.get("slug", slug_prefix)
        title = fc_data.get("title", f"{mfr} {code}")

        draft_id = _insert_draft(
            "fault_code", slug, title, fc_data,
            source_chunks=[c["content"][:100] for c in chunks[:5]],
        )
        if draft_id:
            mined += 1
            existing_slugs.add(slug)
            logger.info("Mined fault code: id=%s slug=%s", draft_id, slug)
            # Chain validation
            validate_blog_draft.delay(draft_id)

    logger.info("Fault code mining complete: mined=%d", mined)
    return {"mined": mined}


# ═══════════════════════════════════════════════════════════════════════════
# Task 2: Generate KB-grounded blog articles
# ═══════════════════════════════════════════════════════════════════════════

ARTICLE_SYSTEM_PROMPT = """You are a maintenance technical writer at FactoryLM. Write a blog article grounded in the provided equipment manual excerpts.

CRITICAL RULES:
- Every technical claim MUST be supported by the provided reference material
- Do NOT invent specifications, procedures, or parameters not in the sources
- If the sources don't cover something, don't include it
- Write for field maintenance technicians — practical, direct, no academic tone
- Include specific parameter numbers, torque values, and thresholds from the sources

Output ONLY valid JSON matching this exact schema:
{
  "slug": "url-safe-title",
  "title": "Article Title — Subtitle",
  "description": "Meta description under 160 chars for SEO",
  "date": "YYYY-MM-DD",
  "author": "FactoryLM Engineering",
  "category": "Guides|Troubleshooting|Fundamentals|Industry",
  "readingTime": "X min read",
  "heroEmoji": "Single character",
  "sections": [
    {"type": "paragraph", "text": "..."},
    {"type": "heading", "text": "..."},
    {"type": "list", "items": ["...", "..."], "ordered": false},
    {"type": "callout", "text": "...", "variant": "tip|warning|info"},
    {"type": "quote", "text": "...", "attribution": "..."}
  ],
  "relatedPosts": [],
  "relatedFaultCodes": []
}

Target: 600-1000 words, 4-6 sections with h2 headings, at least 1 callout and 1 list."""


@app.task(bind=True, max_retries=2, default_retry_delay=60)
def generate_kb_blog_post(self, audience: str = "maintenance_tech", topic: str | None = None):
    """Generate a blog article grounded in KB equipment manual content.

    Uses RAG retrieval to get relevant chunks, then Claude to write an article.
    Chains to validate_blog_draft for fact-checking.
    """
    import random

    if not topic:
        topic = random.choice(KB_TOPIC_BANK)

    logger.info("Generating KB blog post: topic=%s", topic)

    # RAG retrieval — get relevant chunks from the knowledge base
    chunks = _run_async(_recall_knowledge, topic, 10)
    if len(chunks) < 2:
        logger.warning("Insufficient KB content for topic=%s (got %d chunks)", topic, len(chunks))
        return {"error": "insufficient_kb_content", "topic": topic, "chunks": len(chunks)}

    # Build reference material for Claude
    reference = "\n\n".join(
        f"[{i+1}] ({c.get('manufacturer', '')} {c.get('model_number', '')} — "
        f"{c.get('equipment_type', '')})\n{c['content']}"
        for i, c in enumerate(chunks)
    )

    try:
        raw = _run_async(
            _claude_complete,
            ARTICLE_SYSTEM_PROMPT,
            f'Topic: "{topic}"\n\nReference material from equipment manuals:\n\n{reference}\n\n'
            f"Write a 600-1000 word article with sections. Today's date: {_today()}.",
            max_tokens=4096,
        )
        post_data = _parse_json(raw)
    except Exception as exc:
        logger.error("Blog post generation failed: %s", exc)
        raise self.retry(exc=exc)

    slug = post_data.get("slug", topic.lower().replace(" ", "-")[:60])
    title = post_data.get("title", topic)

    draft_id = _insert_draft(
        "article", slug, title, post_data,
        source_chunks=[c["content"][:100] for c in chunks[:10]],
    )

    if not draft_id:
        logger.warning("Draft insertion failed (duplicate slug?): %s", slug)
        return {"error": "duplicate_slug", "slug": slug}

    logger.info("KB blog post generated: id=%s slug=%s", draft_id, slug)

    # Chain validation
    validate_blog_draft.delay(draft_id)

    return {
        "draft_id": draft_id,
        "slug": slug,
        "title": title,
        "topic": topic,
        "source_chunks": len(chunks),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Task 3: Validate draft against KB (the "test" step)
# ═══════════════════════════════════════════════════════════════════════════

CLAIM_EXTRACT_PROMPT = """Extract the 5-10 key factual claims from this maintenance article that can be verified against equipment manuals.

Focus on:
- Specific fault code meanings
- Parameter numbers and their purposes
- Voltage/current/temperature thresholds
- Step-by-step procedures
- Equipment specifications

Output a JSON array of strings, each being one verifiable claim.
Example: ["PowerFlex F012 indicates hardware overcurrent protection tripped", "Motor insulation resistance should be above 1 megohm"]"""


@app.task(bind=True, max_retries=1, default_retry_delay=30)
def validate_blog_draft(self, draft_id: int):
    """Validate a blog draft by checking claims against the KB.

    For each factual claim in the article:
    1. Embed the claim
    2. RAG-retrieve from KB
    3. Score whether the KB supports the claim (similarity > 0.80)

    Auto-approves if confidence >= 0.7, otherwise flags for review.
    """
    from sqlalchemy import text

    logger.info("Validating draft id=%d", draft_id)

    engine = _db_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, draft_type, title, content_json, status FROM blog_drafts WHERE id = :did"),
            {"did": draft_id},
        ).mappings().fetchone()

    if not row:
        logger.error("Draft %d not found", draft_id)
        return {"error": "not_found"}

    content = row["content_json"] if isinstance(row["content_json"], dict) else json.loads(row["content_json"])

    # Build text representation of the article for claim extraction
    if row["draft_type"] == "fault_code":
        article_text = (
            f"Title: {content.get('title', '')}\n"
            f"Description: {content.get('description', '')}\n"
            f"Common causes: {', '.join(content.get('commonCauses', []))}\n"
            f"Fix: {content.get('recommendedFix', '')}"
        )
    else:
        sections = content.get("sections", [])
        article_text = "\n".join(
            s.get("text", "") or "\n".join(s.get("items", []))
            for s in sections
        )

    # Step 1: Extract verifiable claims via Claude
    try:
        raw = _run_async(
            _claude_complete,
            CLAIM_EXTRACT_PROMPT,
            article_text,
            max_tokens=1024,
        )
        claims = json.loads(raw) if raw.strip().startswith("[") else _parse_json(raw).get("claims", [])
    except Exception as exc:
        logger.warning("Claim extraction failed for draft %d: %s", draft_id, exc)
        _update_draft(draft_id, status="validated", confidence=0.5,
                       validation_notes="Claim extraction failed — defaulting to 0.5")
        return {"draft_id": draft_id, "confidence": 0.5, "error": "claim_extraction_failed"}

    if not claims:
        _update_draft(draft_id, status="approved", confidence=0.8,
                       validation_notes="No verifiable claims extracted — auto-approved")
        return {"draft_id": draft_id, "confidence": 0.8, "claims": 0}

    # Step 2: Check each claim against the KB
    supported = 0
    notes = []

    for claim in claims[:10]:
        chunks = _run_async(_recall_knowledge, claim, 3)
        if chunks and chunks[0].get("similarity", 0) >= 0.80:
            supported += 1
            notes.append(f"SUPPORTED: {claim[:80]}")
        elif chunks and chunks[0].get("similarity", 0) >= 0.70:
            supported += 0.5
            notes.append(f"PARTIAL: {claim[:80]} (sim={chunks[0]['similarity']:.2f})")
        else:
            top_sim = chunks[0]["similarity"] if chunks else 0
            notes.append(f"UNSUPPORTED: {claim[:80]} (best_sim={top_sim:.2f})")

    confidence = supported / len(claims) if claims else 0
    status = "approved" if confidence >= 0.7 else "validated"

    validation_text = f"Claims: {len(claims)}, Supported: {supported}/{len(claims)}\n" + "\n".join(notes)

    _update_draft(draft_id, status=status, confidence=round(confidence, 3),
                   validation_notes=validation_text)

    logger.info(
        "Validation complete: draft=%d confidence=%.2f status=%s claims=%d/%d",
        draft_id, confidence, status, int(supported), len(claims),
    )

    return {
        "draft_id": draft_id,
        "confidence": round(confidence, 3),
        "status": status,
        "claims_total": len(claims),
        "claims_supported": supported,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Task 4: Publish approved drafts
# ═══════════════════════════════════════════════════════════════════════════


@app.task
def publish_approved_drafts():
    """Move approved drafts to live status.

    mira-web reads blog_drafts with status='live' and merges with static seed data.
    """
    from sqlalchemy import text

    _ensure_blog_schema()
    engine = _db_engine()

    with engine.connect() as conn:
        result = conn.execute(text("""
            UPDATE blog_drafts
            SET status = 'live', published_at = NOW()
            WHERE status = 'approved' AND published_at IS NULL
            RETURNING id, slug, title, draft_type
        """))
        published = [dict(r) for r in result.mappings().fetchall()]
        conn.commit()

    for p in published:
        logger.info("Published: id=%s type=%s slug=%s", p["id"], p["draft_type"], p["slug"])

    logger.info("Published %d drafts", len(published))
    return {"published": len(published), "slugs": [p["slug"] for p in published]}


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════


def _today() -> str:
    from datetime import date
    return date.today().isoformat()

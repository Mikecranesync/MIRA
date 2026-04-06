#!/usr/bin/env python3
"""Extract structured fault codes from knowledge_entries chunks into fault_codes table.

Reads chunks containing fault code patterns, sends to Claude for structured
extraction, writes results to the fault_codes table in NeonDB.

Usage:
    doppler run --project factorylm --config prd -- \
      uv run --with sqlalchemy --with psycopg2-binary --with httpx \
      python mira-core/scripts/extract_fault_codes.py [--model MODEL] [--dry-run] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import uuid

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("extract_fault_codes")

NEON_DATABASE_URL = os.environ.get("NEON_DATABASE_URL")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

_FAULT_CODE_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")

EXTRACTION_PROMPT = """\
Extract all fault codes from this equipment manual text. For each fault code, provide:
- code: the exact fault code as written (e.g., F2, F4, E001, OC1)
- description: short name of the fault (e.g., "Auxiliary Input", "UnderVoltage")
- cause: what causes this fault (1-2 sentences)
- action: recommended troubleshooting steps (numbered list)
- severity: one of "trip", "warning", "alarm", "info"

Return a JSON array. Only extract codes explicitly listed in the text.
Do not invent codes or descriptions. If the text doesn't contain clear fault
code definitions, return an empty array [].

Example output:
[
  {"code": "F4", "description": "UnderVoltage", "cause": "DC bus voltage dropped below threshold due to input power loss or line imbalance.", "action": "1. Monitor incoming line for phase loss. 2. Check input line fuse.", "severity": "trip"}
]

Equipment manual text:
"""


def _get_fault_chunks(engine, text_fn, tenant_id: str, limit: int = 0) -> list[dict]:
    """Get chunks containing fault code patterns."""
    sql = (
        "SELECT id, content, manufacturer, model_number, source_url, source_page "
        "FROM knowledge_entries "
        "WHERE tenant_id = :tid "
        "AND (content ~* :pat1 OR content ILIKE :pat2) "
        "ORDER BY manufacturer, model_number, source_page"
    )
    params: dict = {
        "tid": tenant_id,
        "pat1": r"\bF\d{1,3}\b",  # F1, F2, F13, etc.
        "pat2": "%fault%code%",
    }
    if limit > 0:
        sql += " LIMIT :lim"
        params["lim"] = limit

    with engine.connect() as conn:
        rows = conn.execute(text_fn(sql), params).mappings().fetchall()
    return [dict(r) for r in rows]


def _call_claude(content: str, model: str) -> list[dict]:
    """Send chunk to Claude for fault code extraction."""
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": EXTRACTION_PROMPT + content}],
        },
        timeout=60,
    )
    resp.raise_for_status()
    text = resp.json()["content"][0]["text"]

    # Extract JSON from response (may be wrapped in markdown code block)
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)

    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        log.warning("Failed to parse Claude response as JSON: %s", text[:200])
    return []


def _insert_fault_code(conn, text_fn, tenant_id: str, fc: dict,
                       manufacturer: str, model: str,
                       chunk_id: str, source_url: str, page_num: int) -> bool:
    """Insert one fault code. Returns True on success, False on duplicate/error."""
    try:
        conn.execute(text_fn(
            "INSERT INTO fault_codes "
            "(id, tenant_id, code, description, cause, action, severity, "
            "equipment_model, manufacturer, source_chunk_id, source_url, page_num) "
            "VALUES (:id, :tid, :code, :desc, :cause, :action, :sev, "
            ":model, :mfr, :chunk_id, :url, :page) "
            "ON CONFLICT (tenant_id, code, equipment_model) DO UPDATE SET "
            "description = EXCLUDED.description, cause = EXCLUDED.cause, "
            "action = EXCLUDED.action, severity = EXCLUDED.severity"
        ), {
            "id": str(uuid.uuid4()),
            "tid": tenant_id,
            "code": fc["code"].upper(),
            "desc": fc.get("description", ""),
            "cause": fc.get("cause", ""),
            "action": fc.get("action", ""),
            "sev": fc.get("severity", ""),
            "model": model or "",
            "mfr": manufacturer or "",
            "chunk_id": chunk_id,
            "url": source_url or "",
            "page": page_num,
        })
        return True
    except Exception as e:
        log.warning("Insert failed for %s: %s", fc.get("code"), e)
        return False


def main() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    parser = argparse.ArgumentParser(description="Extract fault codes from KB chunks")
    parser.add_argument("--model", default="claude-sonnet-4-6",
                        help="Claude model for extraction")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print extraction results without inserting")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max chunks to process (0=all)")
    args = parser.parse_args()

    if not all([NEON_DATABASE_URL, MIRA_TENANT_ID, ANTHROPIC_API_KEY]):
        sys.exit("ERROR: NEON_DATABASE_URL, MIRA_TENANT_ID, and ANTHROPIC_API_KEY required")

    engine = create_engine(
        NEON_DATABASE_URL, poolclass=NullPool,
        connect_args={"sslmode": "require"}, pool_pre_ping=True,
    )

    log.info("Finding chunks with fault code patterns...")
    chunks = _get_fault_chunks(engine, text, MIRA_TENANT_ID, args.limit)
    log.info("Found %d candidate chunks", len(chunks))

    # Deduplicate by content prefix (many chunks have identical fault tables)
    seen_content: set[str] = set()
    unique_chunks: list[dict] = []
    for chunk in chunks:
        key = chunk["content"][:200]
        if key not in seen_content:
            seen_content.add(key)
            unique_chunks.append(chunk)

    log.info("After dedup: %d unique chunks to process", len(unique_chunks))

    total_extracted = 0
    total_inserted = 0

    with engine.connect() as conn:
        for i, chunk in enumerate(unique_chunks, 1):
            content = chunk["content"]
            mfr = chunk.get("manufacturer") or ""
            model = chunk.get("model_number") or ""

            log.info("[%d/%d] %s %s (page %s, %d chars)",
                     i, len(unique_chunks), mfr or "?", model or "?",
                     chunk.get("source_page"), len(content))

            try:
                fault_codes = _call_claude(content, args.model)
            except Exception as e:
                log.warning("  Claude call failed: %s", e)
                time.sleep(2)
                continue

            if not fault_codes:
                log.info("  → 0 fault codes extracted")
                continue

            total_extracted += len(fault_codes)
            log.info("  → %d fault codes: %s",
                     len(fault_codes),
                     ", ".join(fc.get("code", "?") for fc in fault_codes))

            if args.dry_run:
                for fc in fault_codes:
                    print(f"    {fc['code']}: {fc.get('description', '?')} — {fc.get('cause', '')[:80]}")
                continue

            for fc in fault_codes:
                if _insert_fault_code(
                    conn, text, MIRA_TENANT_ID, fc, mfr, model,
                    chunk.get("id", ""), chunk.get("source_url", ""),
                    chunk.get("source_page"),
                ):
                    total_inserted += 1

            conn.commit()
            time.sleep(0.5)  # rate limit

    log.info("Done. %d chunks processed, %d fault codes extracted, %d inserted.",
             len(unique_chunks), total_extracted, total_inserted)


if __name__ == "__main__":
    main()

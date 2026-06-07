"""ignition_audit_log writer — durable trail for /api/v1/ignition/chat round-trips.

Spec / issue: GitHub #1624 (audit task D7).
Migration:    mira-hub/db/migrations/031_ignition_audit_log.sql.

The write is fire-and-forget from the route handler's POV — exceptions are
logged but never propagate to the caller. An unwritten audit row is a
diagnostic gap; failing the chat turn over a logging failure would be worse.

PII discipline: prompt + answer are scrubbed with the same regex set
(InferenceRouter.sanitize_text) used on the cascade path. The original
prompt lives in mira_chat_history; the audit trail stays PII-clean.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger("mira-pipeline.ignition_audit")

# PII sanitization regexes — kept in sync with shared/inference/router.py.
# Inlined here (not imported) because the shared module has heavy transitive
# imports that only resolve inside the pipeline container; falling back to
# an identity transform on import failure would leak PII into the audit log.
_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
_MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b")
_SERIAL_RE = re.compile(
    r"\b(?:S/?N|SER(?:IAL)?(?:\s*(?:NO|NUM|NUMBER)?)?)[:\s#]*[A-Z0-9\-]{4,20}\b",
    re.IGNORECASE,
)


def _sanitize(text: str) -> str:
    """Strip IPs/MACs/serials before persisting to the audit log."""
    if not text:
        return ""
    if not isinstance(text, str):
        return text
    text = _IPV4_RE.sub("[IP]", text)
    text = _MAC_RE.sub("[MAC]", text)
    text = _SERIAL_RE.sub("[SN]", text)
    return text


def write_audit_row(
    *,
    tenant_id: str,
    channel: str = "ignition",
    user_id: Optional[str] = None,
    asset_id: Optional[str] = None,
    chat_id: Optional[str] = None,
    prompt: str = "",
    answer: str = "",
    sources: Optional[list[dict[str, Any]]] = None,
    tag_reads: Optional[list[str]] = None,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    inference_run_id: Optional[str] = None,
    latency_ms: Optional[int] = None,
    status: str = "ok",
) -> bool:
    """Append a row to ignition_audit_log. Returns True on success.

    All callers in mira-pipeline treat the return value as advisory; the
    chat round-trip succeeds regardless. We log a warning on failure so
    repeated DB outages are visible without blocking traffic.
    """
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url:
        logger.warning("AUDIT_SKIP no NEON_DATABASE_URL")
        return False
    if not tenant_id:
        logger.warning("AUDIT_SKIP no tenant_id")
        return False

    sanitized_prompt = _sanitize(prompt)
    sanitized_answer = _sanitize(answer)
    sources_payload = sources or []
    tag_reads_payload = tag_reads or []

    try:
        from sqlalchemy import NullPool, create_engine, text

        engine = create_engine(
            neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": tenant_id},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO ignition_audit_log
                        (tenant_id, channel, user_id, asset_id, chat_id,
                         prompt, prompt_chars, answer, answer_chars,
                         sources_json, tag_reads_json,
                         llm_provider, llm_model, inference_run_id,
                         latency_ms, status)
                    VALUES
                        (:tenant_id, :channel, :user_id, :asset_id, :chat_id,
                         :prompt, :prompt_chars, :answer, :answer_chars,
                         CAST(:sources AS JSONB), CAST(:tag_reads AS JSONB),
                         :llm_provider, :llm_model, :inference_run_id,
                         :latency_ms, :status)
                    """
                ),
                {
                    "tenant_id": tenant_id,
                    "channel": channel,
                    "user_id": user_id,
                    "asset_id": asset_id,
                    "chat_id": chat_id,
                    "prompt": sanitized_prompt,
                    "prompt_chars": len(sanitized_prompt),
                    "answer": sanitized_answer,
                    "answer_chars": len(sanitized_answer),
                    "sources": json.dumps(sources_payload),
                    "tag_reads": json.dumps(tag_reads_payload),
                    "llm_provider": llm_provider,
                    "llm_model": llm_model,
                    "inference_run_id": inference_run_id,
                    "latency_ms": latency_ms,
                    "status": status,
                },
            )
        return True
    except Exception as exc:
        logger.warning("AUDIT_WRITE_FAILED tenant=%s status=%s err=%s", tenant_id, status, exc)
        return False


def query_audit_rows(
    *,
    tenant_id: str,
    limit: int = 50,
    asset_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Read recent audit rows for a tenant. Returns [] on DB error.

    Mirror of the write path's RLS binding — SET LOCAL app.current_tenant_id
    before SELECT so the row-level security policy admits the result set.
    """
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url or not tenant_id:
        return []

    try:
        from sqlalchemy import NullPool, create_engine, text

        engine = create_engine(
            neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": tenant_id},
            )
            if asset_id:
                sql = text(
                    """
                    SELECT id, tenant_id, channel, user_id, asset_id, chat_id,
                           prompt, prompt_chars, answer, answer_chars,
                           sources_json, tag_reads_json,
                           llm_provider, llm_model, inference_run_id,
                           latency_ms, status, created_at
                      FROM ignition_audit_log
                     WHERE tenant_id = :tid AND asset_id = :aid
                     ORDER BY created_at DESC
                     LIMIT :limit
                    """
                )
                params = {"tid": tenant_id, "aid": asset_id, "limit": limit}
            else:
                sql = text(
                    """
                    SELECT id, tenant_id, channel, user_id, asset_id, chat_id,
                           prompt, prompt_chars, answer, answer_chars,
                           sources_json, tag_reads_json,
                           llm_provider, llm_model, inference_run_id,
                           latency_ms, status, created_at
                      FROM ignition_audit_log
                     WHERE tenant_id = :tid
                     ORDER BY created_at DESC
                     LIMIT :limit
                    """
                )
                params = {"tid": tenant_id, "limit": limit}
            rows = conn.execute(sql, params).mappings().all()
            return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("AUDIT_QUERY_FAILED tenant=%s err=%s", tenant_id, exc)
        return []

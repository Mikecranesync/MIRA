"""POST /api/v1/ignition/chat — cloud chat endpoint for the Ignition Module.

Thin HTTP wrapper around the existing Supervisor engine. The Ignition WebDev
handler (ignition/webdev/FactoryLM/api/chat/doPost.py) signs requests with
HMAC-SHA256 and POSTs them here. The reasoning engine — UNS gate, citation
compliance, cascade LLM — is unchanged.

Auth: HMAC-SHA256 over body+nonce+timestamp+tenant. Same signing contract as
mira-mcp/ignition_auth.py and mira-relay/auth.py. Key from MIRA_IGNITION_HMAC_KEY.

Ref: docs/mira-ignition-secure-architecture.md §3.2, §9 D3.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from collections import OrderedDict
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from ignition_audit import query_audit_rows, write_audit_row
from pydantic import BaseModel

logger = logging.getLogger("mira-pipeline.ignition_chat")

# ── Config ───────────────────────────────────────────────────────────────────

MIRA_IGNITION_HMAC_KEY = os.getenv("MIRA_IGNITION_HMAC_KEY", "")

_TIMESTAMP_SKEW_S = 300       # ±5 minutes
_NONCE_TTL_S = 600            # nonces expire after 10 minutes
_NONCE_MAX_ENTRIES = 10_000


# ── Nonce replay store (in-process LRU) ──────────────────────────────────────

_nonce_store: "OrderedDict[tuple[str, str], float]" = OrderedDict()


def _evict_expired(now: float) -> None:
    stale = [k for k, exp in _nonce_store.items() if exp <= now]
    for k in stale:
        del _nonce_store[k]


def _check_and_record_nonce(tenant: str, nonce: str, now: float) -> bool:
    _evict_expired(now)
    key = (tenant, nonce)
    if key in _nonce_store:
        return False
    if len(_nonce_store) >= _NONCE_MAX_ENTRIES:
        _nonce_store.popitem(last=False)
    _nonce_store[key] = now + _NONCE_TTL_S
    return True


# ── HMAC verifier ────────────────────────────────────────────────────────────


def _verify_hmac(headers: dict[str, str], body_bytes: bytes, key: str) -> str:
    """Verify HMAC headers, return tenant_id. Raise HTTPException(401) on failure.

    Failure order: missing headers → bad timestamp → bad signature → replay.
    Error messages are non-specific to avoid leaking implementation details.
    """
    h = {k.lower(): v for k, v in headers.items()}
    tenant = h.get("x-mira-tenant", "").strip()
    nonce = h.get("x-mira-nonce", "").strip()
    ts_raw = h.get("x-mira-timestamp", "").strip()
    sig = h.get("x-mira-signature", "").strip()

    if not all([tenant, nonce, ts_raw, sig]):
        logger.warning("IGNITION_CHAT missing_headers tenant=%r", tenant)
        raise HTTPException(401, "Missing required authentication headers")

    try:
        ts = int(ts_raw)
    except ValueError:
        raise HTTPException(401, "Invalid timestamp")

    now = int(time.time())
    if abs(now - ts) > _TIMESTAMP_SKEW_S:
        logger.warning("IGNITION_CHAT timestamp_skew tenant=%r skew=%ds", tenant, now - ts)
        raise HTTPException(401, "Request timestamp outside allowed window")

    body_hash = hashlib.sha256(body_bytes).hexdigest()
    signed_string = f"{tenant}\n{nonce}\n{ts_raw}\n{body_hash}"
    expected = hmac.new(
        key.encode("utf-8"),
        signed_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, sig.lower()):
        logger.warning("IGNITION_CHAT bad_signature tenant=%r", tenant)
        raise HTTPException(401, "Invalid signature")

    if not _check_and_record_nonce(tenant, nonce, time.time()):
        logger.warning("IGNITION_CHAT nonce_replay tenant=%r", tenant)
        raise HTTPException(401, "Nonce already used")

    return tenant


# ── Request/response models ──────────────────────────────────────────────────


class IgnitionChatRequest(BaseModel):
    # Accept both "question" (spec) and "query" (current WebDev handler).
    question: Optional[str] = None
    query: Optional[str] = None
    asset_id: Optional[str] = None
    asset_context: Optional[dict[str, Any]] = None
    tag_snapshot: Optional[dict[str, Any]] = None
    context: Optional[str] = None
    tenant_id: Optional[str] = None

    model_config = {"extra": "allow"}

    @property
    def effective_question(self) -> str:
        return (self.question or self.query or "").strip()


# ── Tag-snapshot → prompt preamble ───────────────────────────────────────────


def _format_tag_preamble(tag_snapshot: dict[str, Any], asset_id: str) -> str:
    """Render the tag snapshot as a short, deterministic preamble the engine can read.

    Keep it compact — the engine adds RAG context separately. Sort keys for
    reproducibility in tests.
    """
    if not tag_snapshot:
        return ""
    lines = ["[LIVE TAGS — current allowlisted snapshot from Ignition]"]
    if asset_id:
        lines.append(f"Asset: {asset_id}")
    for path in sorted(tag_snapshot.keys()):
        entry = tag_snapshot[path]
        if isinstance(entry, dict):
            value = entry.get("value", "")
            quality = entry.get("quality", "")
            lines.append(f"  {path} = {value} ({quality})")
        else:
            lines.append(f"  {path} = {entry}")
    lines.append("[END LIVE TAGS]")
    return "\n".join(lines)


# ── Router factory ───────────────────────────────────────────────────────────


def build_router(get_engine: Callable[[], Any]) -> APIRouter:
    """Build the APIRouter. Caller injects a getter for the live Supervisor instance."""
    router = APIRouter()

    @router.post("/api/v1/ignition/chat")
    async def ignition_chat(request: Request) -> dict[str, Any]:
        if not MIRA_IGNITION_HMAC_KEY:
            logger.error("IGNITION_CHAT MIRA_IGNITION_HMAC_KEY not configured")
            raise HTTPException(503, "Ignition HMAC key not configured")

        body = await request.body()
        tenant_id = _verify_hmac(dict(request.headers), body, MIRA_IGNITION_HMAC_KEY)

        try:
            payload = json.loads(body) if body else {}
        except ValueError:
            raise HTTPException(400, "Invalid JSON body")

        try:
            req = IgnitionChatRequest(**payload)
        except Exception as exc:
            raise HTTPException(400, f"Invalid payload: {exc}")

        question = req.effective_question
        if not question:
            raise HTTPException(400, "question (or query) is required")

        engine = get_engine()
        if engine is None:
            raise HTTPException(503, "Supervisor not initialized")

        # The Ignition session is per-asset; if no explicit chat_id is supplied
        # use (tenant_id, asset_id) so concurrent assets keep independent FSM state.
        asset_id = (req.asset_id or "").strip()

        # Phase 6 gate: a direct-connection surface MUST carry a resolvable UNS
        # identifier. Downgrading to the chat-gate would ask "which machine?" on
        # a surface that already knows — the rule that's forbidden. Return 422 so
        # the Ignition WebDev handler can surface the error clearly.
        if not asset_id and not req.asset_context:
            logger.warning("IGNITION_CHAT uns_required tenant=%s", tenant_id)
            return JSONResponse(status_code=422, content={"error": "uns_required"})

        chat_id = f"ignition:{tenant_id}:{asset_id or 'default'}"

        preamble = _format_tag_preamble(req.tag_snapshot or {}, asset_id)
        message = f"{preamble}\n\n{question}" if preamble else question

        tag_reads = sorted((req.tag_snapshot or {}).keys())

        # Direct-connection provenance: the Ignition surface already knows which
        # machine the technician is on. The engine stamps source="direct_connection"
        # on state["uns_context"] so the gate is bypassed and confidence=1.0.
        uns_source = "direct_connection"

        # Structured tag evidence for the decision trace (Phase 9). The Ignition
        # turn already carries the live snapshot; surface it as evidence rows so
        # the trace records WHAT live data MIRA reasoned over, not just that it
        # had some. (The same snapshot is also rendered into the prompt preamble.)
        tag_evidence = [
            {
                "tag_path": path,
                "value": (entry.get("value") if isinstance(entry, dict) else entry),
                "quality": (entry.get("quality") if isinstance(entry, dict) else None),
                "source": "ignition",
            }
            for path, entry in sorted((req.tag_snapshot or {}).items())
        ]

        t0 = time.monotonic()
        engine_error: Optional[str] = None
        try:
            reply = await engine.process(
                chat_id=chat_id,
                message=message,
                photo_b64=None,
                platform="ignition",
                uns_source=uns_source,
                tag_evidence=tag_evidence or None,
            )
        except Exception as exc:
            engine_error = str(exc)
            logger.exception("IGNITION_CHAT engine_error tenant=%s asset=%s", tenant_id, asset_id)
            reply = ""

        latency_ms = int((time.monotonic() - t0) * 1000)
        status = "engine_error" if engine_error else "ok"
        logger.info(
            "IGNITION_CHAT %s tenant=%s asset=%s latency_ms=%d reply_len=%d",
            status,
            tenant_id,
            asset_id,
            latency_ms,
            len(reply or ""),
        )

        # Audit write is fire-and-forget — never blocks the response on DB
        # availability. write_audit_row returns False on failure and logs it.
        write_audit_row(
            tenant_id=tenant_id,
            channel="ignition",
            user_id=None,
            asset_id=asset_id or None,
            chat_id=chat_id,
            prompt=question,
            answer=reply or "",
            sources=[],
            tag_reads=tag_reads,
            llm_provider=None,
            llm_model=None,
            inference_run_id=None,
            latency_ms=latency_ms,
            status=status,
        )

        if engine_error:
            raise HTTPException(500, f"Engine error: {engine_error}")

        return {
            "answer": reply or "",
            "sources": [],
            "citations": [],
            "evidence": [],
            "confidence": None,
            "suggested_actions": [],
            "tenant_id": tenant_id,
            "asset_id": asset_id,
            "latency_ms": latency_ms,
        }

    @router.get("/api/v1/audit")
    async def get_audit(
        request: Request,
        limit: int = Query(50, ge=1, le=500),
        asset_id: Optional[str] = Query(None),
    ) -> dict[str, Any]:
        """Read recent audit rows for the caller's tenant.

        Auth: HMAC same as /chat — tenant is read from the verified header.
        The tenant filter is enforced both in the SQL and by RLS on the row.
        """
        if not MIRA_IGNITION_HMAC_KEY:
            raise HTTPException(503, "Ignition HMAC key not configured")
        body = await request.body()
        tenant_id = _verify_hmac(dict(request.headers), body, MIRA_IGNITION_HMAC_KEY)
        rows = query_audit_rows(tenant_id=tenant_id, limit=limit, asset_id=asset_id)
        return {
            "tenant_id": tenant_id,
            "count": len(rows),
            "rows": rows,
        }

    return router

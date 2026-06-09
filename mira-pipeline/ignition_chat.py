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

_TIMESTAMP_SKEW_S = 300  # ±5 minutes
_NONCE_TTL_S = 600  # nonces expire after 10 minutes
_NONCE_MAX_ENTRIES = 10_000


def _envflag(name: str) -> bool:
    return os.getenv(name, "0").strip().lower() in {"1", "true", "yes", "on"}


# Train-before-deploy HMI gate (docs/specs/asset-agent-validation-spec.md §7,
# .claude/rules/train-before-deploy.md). DEFAULT OFF — the existing endpoint
# behavior is byte-identical until a tenant populates asset_agent_status and
# flips this on. When on, only 'approved'/'deployed' assets get answered.
def _enforce_asset_agent_gate() -> bool:
    return _envflag("ENFORCE_ASSET_AGENT_GATE")


def _asset_agent_auto_deploy() -> bool:
    return _envflag("ASSET_AGENT_AUTO_DEPLOY")


# Defensive import — the gate stays disabled if shared/ isn't mounted (the flag
# defaults off anyway, so this never changes default behavior).
try:
    from shared.asset_agent_transition import GATE_REFUSAL_MESSAGE, gate_decision
except Exception:  # pragma: no cover - shared not importable in this context
    gate_decision = None  # type: ignore[assignment]
    GATE_REFUSAL_MESSAGE = (
        "This asset hasn't been validated for MIRA yet. An admin needs to "
        "approve it in the Command Center before it can answer here."
    )


# ── Direct-connection reject-on-missing-UNS contract (Phase 6) ───────────────
# A direct-connection surface (this Ignition endpoint) that receives a turn with
# NO UNS identifier must REJECT it (422 uns_required), NOT downgrade to a chat-
# gate — see .claude/rules/direct-connection-uns-certified.md. The rule carves
# out general/educational questions ("what is a VFD?"), which need no gate on any
# surface; only asset-specific troubleshooting is rejected. We tell them apart
# with the engine's own intent classifier so the endpoint and the engine's UNS
# gate never disagree.
#
# `_ASSET_SPECIFIC_INTENTS` mirrors `engine._GATED_INTENTS` (the intents the UNS
# gate fires on). Kept as a small local literal so importing this module never
# drags in the full engine; the values are stable. If engine._GATED_INTENTS
# changes, update this set too.
_ASSET_SPECIFIC_INTENTS = frozenset({"diagnose_equipment", "schedule_maintenance"})

try:
    from shared.conversation_router import route_intent as _route_intent
except Exception:  # pragma: no cover - shared not importable in this context
    _route_intent = None  # type: ignore[assignment]


async def _is_asset_specific(question: str) -> bool:
    """True when ``question`` is asset-specific troubleshooting (so a turn with
    no UNS identifier must be rejected). Uses the engine's own intent classifier.

    Fails OPEN — returns False (→ treat as a general chat turn, do NOT reject) —
    when the classifier is unavailable or errors, so a Neon/LLM blip can never
    brick a working HMI.
    """
    if _route_intent is None:
        return False
    try:
        result = await _route_intent(question, [])
        return result.get("intent") in _ASSET_SPECIFIC_INTENTS
    except Exception:
        logger.warning("IGNITION_CHAT uns_required_classify_failed — failing open to plain chat")
        return False


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


# ── Asset-agent deployment gate (train-before-deploy) ────────────────────────


def _asset_context_token(asset_context: Optional[dict[str, Any]]) -> str:
    """Best-effort single identifier from an asset_context object.

    A Perspective panel may send `{site,area,line,equipment,component?}` with no
    flat asset_id. Return the most specific field present so the gate has SOME
    token to resolve. Empty string if nothing usable.
    """
    if not asset_context:
        return ""
    for key in ("component", "equipment", "machine", "asset", "line"):
        val = asset_context.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _lookup_agent_state(tenant_id: str, asset_id: str) -> Optional[str]:
    """Return the asset's lifecycle state from `asset_agent_status`, or None.

    Reads the table owned by PR #1783 (migrations 046/047): rows are keyed on
    `equipment_id` (= cmms_equipment.id) with a carried `uns_path` (LTREE) that
    that migration designates as the deployment-gate key. We match the caller's
    token against either, as text (no ltree cast → never errors on a non-ltree
    token). Returns None when there's no matching agent row (→ the gate refuses).
    Raises on DB error so the caller can fail OPEN — a Neon blip must not brick
    a working HMI.

    NOTE — NON-FUNCTIONAL until an asset_context/asset_id → (uns_path | equipment_id)
    resolver lands. An Ignition asset_id is a tag path ("[default]Conv/State")
    and asset_context fields are display names; neither equals a stored
    `uns_path` or `equipment_id` UUID today, so with the gate ON this returns
    None for essentially every asset → refuse-all. Do NOT enable
    ENFORCE_ASSET_AGENT_GATE until that resolver ships. See
    docs/specs/asset-agent-validation-spec.md §7 and PR #1783.
    """
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url:
        raise RuntimeError("NEON_DATABASE_URL not set")

    from sqlalchemy import NullPool, create_engine, text

    engine = create_engine(
        neon_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT state FROM asset_agent_status "
                    "WHERE tenant_id = :tid "
                    "  AND (uns_path::text = :token OR equipment_id::text = :token) "
                    "LIMIT 1"
                ),
                {"tid": tenant_id, "token": asset_id},
            ).fetchone()
    finally:
        engine.dispose()
    return row[0] if row else None


def _mark_deployed(tenant_id: str, asset_id: str) -> bool:
    """Best-effort: flip an approved agent to 'deployed' on first live turn.

    Fire-and-forget — returns False and logs on any failure; never raises into
    the request path.
    """
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url:
        return False
    try:
        from sqlalchemy import NullPool, create_engine, text

        engine = create_engine(
            neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE asset_agent_status "
                        "SET state = 'deployed', deployed_at = now(), "
                        "    deploy_surface = COALESCE(deploy_surface, 'ignition'), "
                        "    updated_at = now() "
                        "WHERE tenant_id = :tid AND state = 'approved' "
                        "  AND (uns_path::text = :token OR equipment_id::text = :token)"
                    ),
                    {"tid": tenant_id, "token": asset_id},
                )
        finally:
            engine.dispose()
        return True
    except Exception:
        logger.warning("IGNITION_CHAT mark_deployed_failed tenant=%s asset=%s", tenant_id, asset_id)
        return False


# ── Router factory ───────────────────────────────────────────────────────────


def build_router(get_engine: Callable[[], Any]) -> APIRouter:
    """Build the APIRouter. Caller injects a getter for the live Supervisor instance."""
    router = APIRouter()

    @router.post("/api/v1/ignition/chat", response_model=None)
    async def ignition_chat(request: Request) -> dict[str, Any] | JSONResponse:
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
        chat_id = f"ignition:{tenant_id}:{asset_id or 'default'}"

        preamble = _format_tag_preamble(req.tag_snapshot or {}, asset_id)
        message = f"{preamble}\n\n{question}" if preamble else question

        tag_reads = sorted((req.tag_snapshot or {}).keys())

        # Direct-connection provenance + reject-on-missing-identifier contract
        # (Phase 6; .claude/rules/direct-connection-uns-certified.md).
        #   - WITH an asset identifier → UNS-certified by construction: mark the
        #     turn direct_connection so the engine stamps
        #     state["uns_context"]["source"] and skips the chat-gate.
        #   - WITHOUT an identifier → the rule forbids downgrading to a chat-gate.
        #     If the turn is asset-specific troubleshooting, REJECT it
        #     (422 uns_required). General/educational questions need no gate on
        #     any surface, so they pass through as a plain chat turn. The
        #     classifier fails open (treated as general) so a blip never bricks
        #     the HMI.
        if asset_id or req.asset_context:
            uns_source = "direct_connection"
        else:
            uns_source = None
            if await _is_asset_specific(question):
                logger.info(
                    "IGNITION_CHAT uns_required tenant=%s — asset-specific turn with no "
                    "UNS identifier; rejecting (not downgrading to chat-gate)",
                    tenant_id,
                )
                return JSONResponse(status_code=422, content={"error": "uns_required"})

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

        # ── Train-before-deploy gate ─────────────────────────────────────────
        # When ENFORCE_ASSET_AGENT_GATE is on, only answer for an asset whose
        # agent is 'approved'/'deployed'. Default-off → this block is skipped
        # and behavior is unchanged. A non-ready asset gets a clean refusal
        # (NOT a chat-gate question — the connection is certified; the *agent*
        # isn't ready). DB errors fail OPEN so a Neon blip can't brick the HMI.
        #
        # Covers EVERY direct-connection turn — both a flat asset_id and an
        # asset_context-only Perspective turn — so enabling the gate has no
        # silent bypass (spec §7). gate_asset is the resolution token.
        gate_asset = asset_id or _asset_context_token(req.asset_context)
        if (
            _enforce_asset_agent_gate()
            and (asset_id or req.asset_context)
            and gate_decision is not None
        ):
            try:
                agent_state = _lookup_agent_state(tenant_id, gate_asset)
                gate_db_ok = True
            except Exception:
                logger.warning(
                    "IGNITION_CHAT gate_lookup_failed tenant=%s asset=%s — failing open",
                    tenant_id,
                    asset_id,
                )
                agent_state, gate_db_ok = None, False
            if gate_db_ok:
                decision = gate_decision(
                    agent_state, enforce=True, auto_deploy=_asset_agent_auto_deploy()
                )
                if not decision.allow:
                    logger.info(
                        "IGNITION_CHAT gate_refused tenant=%s asset=%s reason=%s",
                        tenant_id,
                        asset_id,
                        decision.reason,
                    )
                    write_audit_row(
                        tenant_id=tenant_id,
                        channel="ignition",
                        user_id=None,
                        asset_id=asset_id or None,
                        chat_id=chat_id,
                        prompt=question,
                        answer=GATE_REFUSAL_MESSAGE,
                        sources=[],
                        tag_reads=tag_reads,
                        llm_provider=None,
                        llm_model=None,
                        inference_run_id=None,
                        latency_ms=0,
                        status=f"gate_refused:{decision.reason}",
                    )
                    return {
                        "answer": GATE_REFUSAL_MESSAGE,
                        "sources": [],
                        "citations": [],
                        "evidence": [],
                        "confidence": None,
                        "suggested_actions": [],
                        "tenant_id": tenant_id,
                        "asset_id": asset_id,
                        "latency_ms": 0,
                        "gate": decision.reason,
                    }
                if decision.deploy_now:
                    _mark_deployed(tenant_id, gate_asset)

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

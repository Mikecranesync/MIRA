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
import re
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


# Deterministic live-tag assessment (the same one the engine path + Hub packet
# produce). Defensive import — degrades to no assessment if shared/ isn't
# mounted, so a missing module never changes the endpoint's default behavior.
try:
    from shared.live_snapshot import assess_from_paths as _assess_from_paths
except Exception:  # pragma: no cover - shared not importable in this context
    _assess_from_paths = None  # type: ignore[assignment]

# Analog assessment via the explicit per-tag scaling contract (Drive Commander
# follow-up #2). Same defensive import — a missing module leaves the enum/bool
# assessment and preamble untouched.
try:
    from shared.live_snapshot import assess_analog_from_paths as _assess_analog_from_paths
    from shared.wire_scaling import from_jsonb as _tag_scaling_from_jsonb
except Exception:  # pragma: no cover - shared not importable in this context
    _assess_analog_from_paths = None  # type: ignore[assignment]
    _tag_scaling_from_jsonb = None  # type: ignore[assignment]


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
    reproducibility in tests. Renders units and data_type when enriched by
    _enrich_tag_snapshot_with_semantics.
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
            units = entry.get("units")
            data_type = entry.get("data_type")
            units_str = f" {units}" if units else ""
            dtype_str = f" · {data_type}" if data_type else ""
            lines.append(f"  {path} = {value}{units_str} ({quality}{dtype_str})")
        else:
            lines.append(f"  {path} = {entry}")
    lines.append("[END LIVE TAGS]")
    return "\n".join(lines)


async def _enrich_tag_snapshot_with_semantics(
    tag_snapshot: dict[str, Any], tenant_id: str
) -> dict[str, Any]:
    """Join verified tag_entities rows to add units and data_type to the snapshot.

    Fails open — returns the raw snapshot unchanged when NEON_DATABASE_URL is
    unset or the DB is unreachable. Only 'verified' rows contribute; proposed
    mappings must never influence live diagnostic answers (grounded troubleshooting
    doctrine, .claude/CLAUDE.md §"Component profiles").

    Join key: tag_entities.source_address. Phase 1's tag_classifier MUST write
    the Ignition browse path (e.g. '[default]Bench/Motor/Speed') into source_address
    for this join to match. The idx_tag_entities_source_address index covers this
    lookup (migration 025).
    """
    if not tag_snapshot:
        return tag_snapshot
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url:
        return tag_snapshot

    tag_paths = list(tag_snapshot.keys())
    try:
        from sqlalchemy import NullPool, create_engine, text

        _engine = create_engine(
            neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        try:
            with _engine.connect() as conn:
                rows = conn.execute(
                    text(
                        "SELECT source_address, units, data_type, scaling "
                        "FROM tag_entities "
                        "WHERE tenant_id::text = :tid "
                        "  AND source_address = ANY(:paths) "
                        "  AND approval_state = 'verified'"
                    ),
                    {"tid": tenant_id, "paths": tag_paths},
                ).fetchall()
        finally:
            _engine.dispose()
    except Exception:
        logger.debug("_enrich_tag_snapshot: DB unavailable, enrichment skipped")
        return tag_snapshot

    # `scaling` (JSONB, the per-tag scaling contract — see shared.wire_scaling)
    # rides alongside units/data_type so the analog assessment can read it; it is
    # NOT rendered in the preamble (only units/data_type are).
    enrichment: dict[str, dict[str, Any]] = {
        row[0]: {
            k: v
            for k, v in {"units": row[1], "data_type": row[2], "scaling": row[3]}.items()
            if v is not None
        }
        for row in rows
        if row[0]
    }
    if not enrichment:
        return tag_snapshot

    return {
        path: (
            {**entry, **enrichment[path]}
            if isinstance(entry, dict) and path in enrichment
            else entry
        )
        for path, entry in tag_snapshot.items()
    }


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


_SLUG_NON_LABEL = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    """ISA-95 UNS label slug: lowercase, runs of non-alphanumeric → '_', trimmed.

    A local copy of `mira-crawler/ingest/uns.py` `slug()` — mira-pipeline must NOT import
    mira-crawler (architecture contract, `tests/test_architecture.py`). Keep the two in sync; the
    resolver below relies on matching the exact slug the Hub stored in
    `cmms_equipment.uns_path` / built from `equipment_number`.
    """
    if not value:
        return ""
    return _SLUG_NON_LABEL.sub("_", value.strip().lower()).strip("_")


# The Phase-4 resolver query. It JOINs the bridge tables so an incoming Ignition token resolves to
# the asset's lifecycle state by ANY of the forms a direct-connection surface actually sends:
#   * a canonical `uns_path` string or `equipment_id` UUID (callers that already send the stored key),
#   * an `asset_context` / display-name token → slug-matched against `cmms_equipment.equipment_number`
#     (e.g. "GS10-VFD" → "gs10_vfd"); this does NOT depend on the nullable `cmms_equipment.uns_path`
#     backfill, so it is the robust path,
#   * a best-effort Ignition tag-path ("[default]Conv/State") → exact match on
#     `installed_component_instances.plc_tag` when the customer has populated it.
# `equipment_id` is the UUID PK of cmms_equipment (globally unique), and the row is already
# tenant-scoped by `aas.tenant_id`, so the bridge JOINs key on `equipment_id` alone — avoiding the
# TEXT(aas)/UUID(ici) tenant-type mismatch (mig 048 made asset_agent_status.tenant_id TEXT).
# All comparisons are text (no ltree cast) so a non-ltree token never errors.
_AGENT_STATE_SQL = """
SELECT aas.state
FROM asset_agent_status aas
LEFT JOIN cmms_equipment e
  ON e.id = aas.equipment_id
LEFT JOIN installed_component_instances ici
  ON ici.asset_id = aas.equipment_id
WHERE aas.tenant_id = :tid
  AND (
        aas.uns_path::text = :token
     OR aas.equipment_id::text = :token
     OR trim(both '_' from regexp_replace(lower(trim(e.equipment_number)), '[^a-z0-9]+', '_', 'g')) = :slug
     OR lower(e.equipment_number) = lower(:token)
     OR ici.plc_tag = :token
  )
LIMIT 1
"""


def _agent_state_from_conn(conn, tenant_id: str, asset_id: str) -> Optional[str]:
    """Resolve an Ignition token → `asset_agent_status.state` over an open SQLAlchemy connection.

    The pure resolution seam (no engine/secret setup) so the query + param binding is unit-testable
    with a fake connection. Binds both the raw token (canonical / plc_tag exact match) and its slug
    (equipment_number fuzzy match). Returns None when nothing matches (→ the gate refuses).
    """
    from sqlalchemy import text

    row = conn.execute(
        text(_AGENT_STATE_SQL),
        {"tid": tenant_id, "token": asset_id, "slug": _slug(asset_id)},
    ).fetchone()
    return row[0] if row else None


def _lookup_agent_state(tenant_id: str, asset_id: str) -> Optional[str]:
    """Return the asset's lifecycle state from `asset_agent_status`, or None (→ the gate refuses).

    Resolves the incoming Ignition identifier via `_agent_state_from_conn` (see its query for the
    forms supported). Reads the table owned by PR #1783 (migrations 046/047). Raises on DB error so
    the caller can fail OPEN — a Neon blip must not brick a working HMI.

    RESOLUTION COVERAGE (Phase 4): a structured `asset_context`/display-name token resolves via
    `cmms_equipment.equipment_number` (slug-normalized) — the robust path, independent of the
    nullable `cmms_equipment.uns_path` backfill — plus the canonical `uns_path`/`equipment_id` forms
    and a best-effort Ignition tag-path via `installed_component_instances.plc_tag`. RESIDUAL GAP:
    a flat Ignition tag-path ("[default]Conv/State") only resolves when `plc_tag` is populated (e.g.
    by the Ignition tag-CSV import); absent that, such turns return None → refuse. Keep
    ENFORCE_ASSET_AGENT_GATE default-OFF until the deployment is proven for a tenant's identifier
    shape. See docs/specs/asset-agent-validation-spec.md §7.
    """
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url:
        raise RuntimeError("NEON_DATABASE_URL not set")

    from sqlalchemy import NullPool, create_engine

    engine = create_engine(
        neon_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    try:
        with engine.connect() as conn:
            return _agent_state_from_conn(conn, tenant_id, asset_id)
    finally:
        engine.dispose()


# ── Drive-pack asset binding (#2527 UNS follow-up) ───────────────────────────
# Resolve the connected asset's manufacturer/model so a panel bound to a GS10
# answers "what does CE10 mean?" WITHOUT the technician typing "gs10". The
# descriptor is folded into the engine message (in the handler) so the
# deterministic drive-pack fast-path (shared/engine.py, #2526) resolves the
# pack; it also grounds general RAG to the right vendor. Read-only, best-effort,
# tenant-scoped. `::text` on the tenant compare avoids a UUID-cast error on a
# legacy slug tenant (cmms_equipment.tenant_id is TEXT — matches on either side).
_DRIVE_INFO_SQL = """
SELECT e.manufacturer, e.model_number
FROM cmms_equipment e
LEFT JOIN installed_component_instances ici
  ON ici.asset_id = e.id
WHERE e.tenant_id::text = :tid
  AND (
        e.id::text = :token
     OR trim(both '_' from regexp_replace(lower(trim(e.equipment_number)), '[^a-z0-9]+', '_', 'g')) = :slug
     OR lower(e.equipment_number) = lower(:token)
     OR ici.plc_tag = :token
  )
LIMIT 1
"""


def _drive_info_from_conn(conn, tenant_id: str, token: str) -> Optional[str]:
    """Resolve an Ignition asset token → "manufacturer model" descriptor, or None.

    The pure resolution seam (no engine/secret setup) so the query + params are
    unit-testable with a fake connection. Mirrors `_agent_state_from_conn` but
    reads `cmms_equipment.manufacturer`/`model_number` directly. Returns None
    when nothing matches or the row carries no make/model.
    """
    from sqlalchemy import text

    row = conn.execute(
        text(_DRIVE_INFO_SQL),
        {"tid": tenant_id, "token": token, "slug": _slug(token)},
    ).fetchone()
    if not row:
        return None
    parts = [str(p).strip() for p in (row[0], row[1]) if p and str(p).strip()]
    return " ".join(parts) if parts else None


def _lookup_drive_info(tenant_id: str, token: str) -> Optional[str]:
    """Best-effort "manufacturer model" for a connected asset, or None.

    Unlike `_lookup_agent_state` (which raises so the gate can fail open), this
    is purely additive enrichment: ANY failure (no DB, bad token, query error)
    returns None so the turn proceeds with an un-enriched message. Never raises
    — it must never break an Ignition chat turn.
    """
    if not token:
        return None
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url:
        return None
    try:
        from sqlalchemy import NullPool, create_engine

        engine = create_engine(
            neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        try:
            with engine.connect() as conn:
                return _drive_info_from_conn(conn, tenant_id, token)
        finally:
            engine.dispose()
    except Exception:
        logger.debug("IGNITION_CHAT drive_info lookup failed (best-effort skip)", exc_info=True)
        return None


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

        enriched_snapshot = await _enrich_tag_snapshot_with_semantics(
            req.tag_snapshot or {}, tenant_id
        )
        preamble = _format_tag_preamble(enriched_snapshot, asset_id)
        # A deterministic assessment from the scaling-immune enum/bool signals
        # (fault / comms / cmd / status) — the same one the engine path (#2478)
        # and the Hub packet (#2476) produce, adapted to the Ignition wire form.
        # Analog values (freq/current/dc_bus) are shown in the preamble but never
        # re-scaled here (ambiguous wire scaling). Best-effort: never breaks chat.
        assessment = None
        if _assess_from_paths is not None:
            try:
                assessment = _assess_from_paths(req.tag_snapshot or {})
            except Exception:  # pragma: no cover - defensive
                assessment = None

        # Analog assessment — ONLY for tags carrying an explicit, verified scaling
        # contract (tag_entities.scaling). Unknown/missing scaling ⇒ no card ⇒ the
        # value is still shown in the preamble but not (mis)interpreted. The raw
        # wire values live on the enriched snapshot alongside the scaling.
        analog_assessment = None
        if _assess_analog_from_paths is not None and _tag_scaling_from_jsonb is not None:
            try:
                scaling_by_path = {
                    path: _tag_scaling_from_jsonb(entry.get("scaling"), unit=entry.get("units"))
                    for path, entry in enriched_snapshot.items()
                    if isinstance(entry, dict)
                }
                analog_assessment = _assess_analog_from_paths(enriched_snapshot, scaling_by_path)
            except Exception:  # pragma: no cover - defensive
                analog_assessment = None

        # Bind the drive pack to the connected asset (#2527 UNS follow-up):
        # resolve the asset's manufacturer/model and fold it into the message so
        # the engine's drive-pack fast-path answers a bare "what does CE10 mean?"
        # for a GS10-bound panel WITHOUT the technician naming the drive. Only
        # for direct-connection turns (an asset identifier is present); purely
        # additive + best-effort (never breaks chat). Placed in the message (not
        # the retrieval query) so it never pollutes RAG recall.
        _drive_token = asset_id or _asset_context_token(req.asset_context)
        asset_descriptor = _lookup_drive_info(tenant_id, _drive_token) if _drive_token else None
        asset_line = f"Asset: {asset_descriptor}" if asset_descriptor else None

        if preamble:
            evidence = [preamble]
            if assessment:
                evidence.append(f"Assessment: {assessment}")
            if analog_assessment:
                evidence.append(analog_assessment)
            evidence.append(
                "In your answer, clearly separate: (1) this LIVE evidence, (2) "
                "asset/manual context, (3) your inference, and (4) the recommended next checks."
            )
            message = "\n\n".join(([asset_line] if asset_line else []) + evidence + [question])
        else:
            message = "\n\n".join(([asset_line] if asset_line else []) + [question])

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

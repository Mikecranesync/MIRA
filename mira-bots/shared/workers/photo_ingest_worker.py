"""Photo → Knowledge-Graph worker.

Closes the headline demo loop from
`docs/specs/mira-ground-truth-architecture-investigation.md` §3.1 #1, §6.1:

  technician photographs nameplate
    → NameplateWorker extracts {manufacturer, model, serial, voltage, ...}
    → THIS worker proposes an `installed_component_instances` row in NeonDB
      and writes a row to `ai_suggestions` so the Hub /proposals page can
      surface it for review.

Today the engine's `_handle_nameplate` flow (mira-bots/shared/engine.py)
seeds Atlas CMMS and the tenant KB but never creates a KG-side proposal —
the photo's structural facts vanish after the session ends. This worker
plugs that gap.

Design contract (cited in ADR-0014 + the investigation §5.3 + §6.1):

  - The worker only WRITES PROPOSALS. Nothing here promotes to verified.
  - Component-template match → kg_entity proposal for a new
    installed_component_instance row. Confidence comes from the extractor.
  - No matching template → component_profile proposal (a new
    component_templates row). The Hub /proposals UI then asks an admin to
    either accept-as-new or rebind to an existing template.
  - tenant_id is REQUIRED. If empty, the write is skipped with a warning —
    RLS would silently reject the insert anyway.

All NeonDB writes happen via psycopg2 in a single transaction. Failure
returns an empty dict so the caller (engine) can continue without
breaking the technician's reply path; the photo flow is best-effort
from MIRA's perspective.

This module follows the same pattern as `mira-bots/shared/integrations/hub_neon.py`
(direct NeonDB write from the engine), not the async-asyncpg path used
by `neon_recall.py` (whose pool is configured for read-only RRF).
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger("mira.photo_ingest_worker")


# ---------------------------------------------------------------------------
# Confidence calibration — keep the magic numbers in one place.
# ---------------------------------------------------------------------------

# Nameplate extraction confidence when both manufacturer + model are populated.
# Below this floor we don't write a proposal at all — the photo was too noisy.
_MIN_PROPOSAL_CONFIDENCE = 0.30

# Extra penalty if the manufacturer or model literally reads "Unknown" — the
# nameplate worker uses that sentinel when the LLM returned null/None.
_UNKNOWN_PENALTY = 0.20

# Bonus when a matching component_templates row already exists for
# (manufacturer, model) — we're proposing an installed_component_instance,
# not a brand new template, so the proposal carries more weight.
_TEMPLATE_MATCH_BONUS = 0.15


def _connect() -> Optional["psycopg2.extensions.connection"]:
    """Open a NeonDB connection from NEON_DATABASE_URL. Returns None on failure."""
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        logger.warning("photo_ingest_worker: NEON_DATABASE_URL not set — skipping KG write")
        return None
    try:
        # sslmode is in the URL already (Neon's pooler requires it).
        return psycopg2.connect(url)
    except Exception as e:
        logger.error("photo_ingest_worker: NeonDB connect failed: %s", e)
        return None


def _score(fields: dict) -> float:
    """Compute a confidence band for the proposal from nameplate extraction fields.

    The nameplate worker doesn't return a numeric confidence today; we infer
    one from field coverage. This is honest calibration — the Hub UI uses
    bands (low/medium/high) and the writer's job is to land in the right band.
    """
    mfr = (fields.get("manufacturer") or "").strip()
    model = (fields.get("model") or "").strip()

    # Start with a coverage score: how many of the 8 fields are populated?
    populated = sum(
        1
        for k in ("manufacturer", "model", "serial", "voltage", "fla", "hp", "frequency", "rpm")
        if (fields.get(k) or "").strip()
    )
    base = populated / 8.0

    # Penalize the "Unknown" sentinel — that's a near-failed extraction.
    if mfr.lower() == "unknown" or model.lower() == "unknown":
        base = max(0.0, base - _UNKNOWN_PENALTY)

    # Cap at 0.95 — we never claim a photo extract is 1.0 without a human.
    return min(0.95, base)


def _find_template(
    cur: "psycopg2.extensions.cursor",
    manufacturer: str,
    model: str,
) -> Optional[str]:
    """Return component_templates.id matching (manufacturer, model), case-insensitive."""
    if not manufacturer or not model:
        return None
    cur.execute(
        """SELECT id FROM component_templates
            WHERE manufacturer ILIKE %s
              AND model        ILIKE %s
            ORDER BY created_at DESC
            LIMIT 1""",
        (manufacturer, model),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def propose_from_nameplate(
    tenant_id: str,
    fields: dict,
    *,
    asset_id: Optional[str] = None,
    uns_path: Optional[str] = None,
    photo_path: Optional[str] = None,
    chat_id: Optional[str] = None,
) -> dict:
    """Write proposals to NeonDB for a nameplate extraction.

    Parameters
    ----------
    tenant_id:
        Tenant UUID. Required — Hub-side tables enforce RLS on this column.
    fields:
        Output of `NameplateWorker.extract()`. Expected keys: manufacturer,
        model, serial, voltage, fla, hp, frequency, rpm. Values are strings
        or None.
    asset_id:
        Optional `cmms_equipment.id` (UUID) that the component lives on.
        When present, the proposed installed_component_instance row is
        bound to this asset. Otherwise the binding is left null (the Hub
        reviewer will resolve it).
    uns_path:
        Optional UNS ltree path for the deployment location. Populated by
        the engine's UNS gate when it ran ahead of this worker.
    photo_path:
        Optional reference to the on-disk / S3 photo blob. Stored in the
        ai_suggestions.extracted_data so the Hub UI can show the source.
    chat_id:
        Optional engine chat session id (for `ai_suggestions.proposed_by`).

    Returns
    -------
    dict
        ``{"suggestion_id": <uuid>, "instance_id": <uuid|None>,
            "template_id": <uuid|None>, "confidence": <float>,
            "suggestion_type": "kg_entity"|"component_profile"}``
        on success. ``{}`` on any failure (including missing tenant_id or
        below-floor extraction confidence). Callers must treat empty as
        "the rest of the flow continues normally."
    """
    if not tenant_id:
        logger.warning("photo_ingest_worker: empty tenant_id, skipping KG write")
        return {}

    if "parse_error" in (fields or {}):
        logger.info("photo_ingest_worker: nameplate parse_error, no proposal written")
        return {}

    manufacturer = (fields.get("manufacturer") or "").strip()
    model = (fields.get("model") or "").strip()

    # Empty or "Unknown" both fail the floor — don't pollute /proposals with noise.
    if not manufacturer or not model:
        logger.info(
            "photo_ingest_worker: missing manufacturer/model (got %r / %r); no proposal",
            manufacturer,
            model,
        )
        return {}

    confidence = _score(fields)

    conn = _connect()
    if conn is None:
        return {}

    try:
        with conn:
            with conn.cursor() as cur:
                # Set the RLS context for this transaction.
                cur.execute(
                    "SELECT set_config('app.current_tenant_id', %s, true)",
                    (tenant_id,),
                )

                template_id = _find_template(cur, manufacturer, model)

                # Template-match bonus, capped at the same ceiling.
                if template_id:
                    confidence = min(0.95, confidence + _TEMPLATE_MATCH_BONUS)

                if confidence < _MIN_PROPOSAL_CONFIDENCE:
                    logger.info(
                        "photo_ingest_worker: confidence %.2f below floor %.2f — no proposal",
                        confidence,
                        _MIN_PROPOSAL_CONFIDENCE,
                    )
                    return {}

                instance_id: Optional[str] = None
                suggestion_type: str
                payload: dict
                title: str
                body: str

                if template_id:
                    # Template exists → propose a new installed_component_instance
                    # in approval_state='proposed' so the Hub reviewer can verify.
                    suggestion_type = "kg_entity"
                    instance_id = str(uuid.uuid4())
                    cur.execute(
                        """INSERT INTO installed_component_instances
                              (id, tenant_id, template_id, asset_id,
                               component_name, canonical_name,
                               installed_location, uns_path,
                               human_confirmed, confidence, notes)
                           VALUES (%s, %s, %s, %s,
                                   %s, %s,
                                   %s, %s::ltree,
                                   FALSE, %s, %s)""",
                        (
                            instance_id,
                            tenant_id,
                            template_id,
                            asset_id,
                            f"{manufacturer} {model}",
                            f"{manufacturer} {model}",
                            None,  # installed_location filled by reviewer
                            uns_path,
                            confidence,
                            f"Proposed from photo extraction (chat={chat_id or 'n/a'})",
                        ),
                    )
                    payload = {
                        "entity_type": "component_instance",
                        "installed_component_instance_id": instance_id,
                        "template_id": template_id,
                        "manufacturer": manufacturer,
                        "model": model,
                        "uns_path": uns_path,
                        "asset_id": asset_id,
                        "nameplate_fields": {
                            k: fields.get(k)
                            for k in ("serial", "voltage", "fla", "hp", "frequency", "rpm")
                        },
                        "photo_path": photo_path,
                    }
                    title = f"Confirm {manufacturer} {model} at {uns_path or 'this asset'}"
                    body = (
                        f"Photo extraction proposes a new {manufacturer} {model} "
                        f"component instance. Template match: yes. Review and "
                        f"confirm location, panel, and tag bindings."
                    )
                else:
                    # No template → propose a new component_templates entry
                    # (catalog work). The Hub admin can either accept-as-new or
                    # rebind to an existing template.
                    suggestion_type = "component_profile"
                    payload = {
                        "manufacturer": manufacturer,
                        "model": model,
                        "version": "",
                        "nameplate_fields": {
                            k: fields.get(k)
                            for k in ("serial", "voltage", "fla", "hp", "frequency", "rpm")
                        },
                        "photo_path": photo_path,
                        "asset_id": asset_id,
                        "uns_path": uns_path,
                    }
                    title = f"New component template: {manufacturer} {model}"
                    body = (
                        f"Photo extraction proposes a NEW component template "
                        f"for {manufacturer} {model}. No matching catalog "
                        f"entry exists. Review and either accept-as-new or "
                        f"rebind to an existing template."
                    )

                suggestion_id = str(uuid.uuid4())
                proposed_by = f"photo:{chat_id}" if chat_id else "photo:engine"

                cur.execute(
                    """INSERT INTO ai_suggestions
                          (id, tenant_id, suggestion_type,
                           source_kind, source_id,
                           extracted_data, confidence,
                           status, risk_level,
                           proposed_by, title, body)
                       VALUES (%s, %s, %s,
                               %s, %s,
                               %s::jsonb, %s,
                               'pending', 'low',
                               %s, %s, %s)""",
                    (
                        suggestion_id,
                        tenant_id,
                        suggestion_type,
                        "photo",
                        None,  # source_id: no equipment_photos UUID at this layer
                        psycopg2.extras.Json(payload),
                        confidence,
                        proposed_by,
                        title,
                        body,
                    ),
                )

                logger.info(
                    "photo_ingest_worker: wrote suggestion=%s type=%s tenant=%s "
                    "template_id=%s instance_id=%s confidence=%.2f",
                    suggestion_id,
                    suggestion_type,
                    tenant_id,
                    template_id,
                    instance_id,
                    confidence,
                )

                return {
                    "suggestion_id": suggestion_id,
                    "instance_id": instance_id,
                    "template_id": template_id,
                    "confidence": confidence,
                    "suggestion_type": suggestion_type,
                }
    except Exception as e:
        logger.error("photo_ingest_worker: NeonDB write failed: %s", e)
        return {}
    finally:
        try:
            conn.close()
        except Exception:
            pass

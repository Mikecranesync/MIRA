"""Read-only print-workspace inspection endpoints (Package C).

Exposes the persisted print-workspace observation ledger
(``shared/print_workspace.py`` over the ``shared/visual`` spine) over HTTP so a
Hub/mobile client can render what the workspace knows — session state, the
current print-model version, trust-labeled entities, and per-tag evidence with
honest coordinates (a row without a stored bbox reports ``coordinates: null``,
never a fabricated location).

Routes (all GET, all read-only — no store writes anywhere):
- ``/workspace/{session_id}/summary``        — session meta, revision, counts,
  trust summary
- ``/workspace/{session_id}/entities``       — active ledger entities with
  trust labels (optional ``?trust=`` filter: a trust label or an
  ``EvidenceState`` value, case-insensitive)
- ``/workspace/{session_id}/evidence/{tag}`` — every observation (including
  superseded, flagged) whose value matches the tag, with bbox coordinates

Contract (mirrors ask_api/drive_pack.py):
- Tenant comes from the ``X-Mira-Tenant`` header (default ``"default"`` — the
  same fallback the Telegram ingest path uses).
- Optional shared-secret auth via ``X-Mira-Key``, checked against
  ``ASK_API_KEY`` read at request time.
- An unknown/foreign-tenant session is an honest 404; unexpected errors are
  logged and answered with a structured shape — never a 500.

Separation: defines its own APIRouter so tests can import it WITHOUT
constructing ask_api.app (which builds the heavy Supervisor engine at import
time).
"""

import logging
import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from shared import print_workspace
from shared.visual.evidence_answer import trust_label
from shared.visual.evidence_state import EvidenceState
from shared.visual.models import Observation

logger = logging.getLogger("mira-ask")

router = APIRouter()

_UNAVAILABLE: dict[str, Any] = {
    "error": "workspace_unavailable",
    "detail": "the workspace store could not be read",
    "read_only": True,
}


def _require_key(x_mira_key: str | None) -> None:
    """Optional shared-secret gate, read at request time (drive_pack idiom)."""
    key = os.environ.get("ASK_API_KEY", "")
    if key and x_mira_key != key:
        raise HTTPException(status_code=401, detail="invalid or missing X-Mira-Key")


def _tenant(x_mira_tenant: str | None) -> str:
    return (x_mira_tenant or "").strip() or "default"


def _norm_tag(tag: str | None) -> str:
    """Case/hyphen-insensitive tag key — same semantics as the evidence-answer
    claim projection ("K17" matches "-K17")."""
    return (tag or "").strip().lstrip("-+").upper()


def _coordinates(obs: Observation) -> dict[str, Any] | None:
    """Honest coordinates: ONLY a stored bbox, never fabricated."""
    bbox = (obs.metadata or {}).get("bbox")
    if not bbox:
        return None
    coords: dict[str, Any] = {"bbox": list(bbox)}
    page = (obs.metadata or {}).get("page")
    if page is not None:
        coords["page"] = str(page)
    return coords


def _entity(obs: Observation) -> dict[str, Any]:
    return {
        "observation_id": obs.observation_id,
        "value": obs.raw_value,
        "normalized_value": obs.normalized_value,
        "kind": obs.obs_kind,
        "trust_label": trust_label(obs.evidence_state, obs.extractor, obs.metadata),
        "evidence_state": obs.evidence_state.value,
        "extractor": obs.extractor,
        "coordinates": _coordinates(obs),
        "superseded": obs.evidence_state is EvidenceState.SUPERSEDED,
        "superseded_by": obs.superseded_by,
    }


async def _session_or_404(store: Any, session_id: str, tenant_id: str):
    session = await store.get_session(session_id, tenant_id)
    if session is None:
        # Unknown id and foreign tenant look identical on purpose (no
        # existence oracle across tenants).
        raise HTTPException(status_code=404, detail="unknown session")
    return session


@router.get("/workspace/{session_id}/summary")
async def workspace_summary(
    session_id: str,
    x_mira_key: str = Header(None),
    x_mira_tenant: str = Header(None),
):
    """Session meta + current print-model version + ledger counts + trust mix."""
    _require_key(x_mira_key)
    tenant_id = _tenant(x_mira_tenant)
    try:
        store = print_workspace._get_service().store
        session = await _session_or_404(store, session_id, tenant_id)
        everything = await store.load_observations(session_id, tenant_id, active_only=False)
        active = [o for o in everything if o.evidence_state.is_active()]
        trust_counts: dict[str, int] = {}
        for obs in active:
            label = trust_label(obs.evidence_state, obs.extractor, obs.metadata)
            trust_counts[label] = trust_counts.get(label, 0) + 1
        return {
            "session_id": session.session_id,
            "tenant_id": session.tenant_id,
            "title": session.title,
            "status": session.status,
            "print_model_version": session.current_revision,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "counts": {
                "observations_total": len(everything),
                "observations_active": len(active),
                "superseded": sum(
                    1 for o in everything if o.evidence_state is EvidenceState.SUPERSEDED
                ),
                "ocr_entities": sum(1 for o in active if o.extractor == "ocr"),
                "technician_reported": sum(1 for o in active if o.extractor == "technician"),
            },
            "trust_summary": trust_counts,
            "read_only": True,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — never 500; the caller can fall through
        logger.error("WORKSPACE_SUMMARY_ERROR error=%s", e, exc_info=True)
        return dict(_UNAVAILABLE, session_id=session_id)


@router.get("/workspace/{session_id}/entities")
async def workspace_entities(
    session_id: str,
    trust: str | None = None,
    x_mira_key: str = Header(None),
    x_mira_tenant: str = Header(None),
):
    """Active ledger entities with trust labels. ``?trust=`` filters by trust
    label ("Reported by technician") or EvidenceState value ("VISIBLE"),
    case-insensitively."""
    _require_key(x_mira_key)
    tenant_id = _tenant(x_mira_tenant)
    try:
        store = print_workspace._get_service().store
        session = await _session_or_404(store, session_id, tenant_id)
        active = await store.load_observations(session_id, tenant_id, active_only=True)
        entities = [_entity(o) for o in active]
        if trust:
            wanted = trust.strip().lower()
            entities = [
                e
                for e in entities
                if e["trust_label"].lower() == wanted or e["evidence_state"].lower() == wanted
            ]
        return {
            "session_id": session.session_id,
            "print_model_version": session.current_revision,
            "count": len(entities),
            "entities": entities,
            "read_only": True,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — never 500
        logger.error("WORKSPACE_ENTITIES_ERROR error=%s", e, exc_info=True)
        return dict(_UNAVAILABLE, session_id=session_id)


@router.get("/workspace/{session_id}/evidence/{tag}")
async def workspace_evidence(
    session_id: str,
    tag: str,
    x_mira_key: str = Header(None),
    x_mira_tenant: str = Header(None),
):
    """Every observation whose value matches ``tag`` (case/hyphen-insensitive,
    "K17" matches "-K17"), INCLUDING superseded history — each row flagged and
    carrying its stored bbox coordinates (or ``null``, honestly)."""
    _require_key(x_mira_key)
    tenant_id = _tenant(x_mira_tenant)
    try:
        store = print_workspace._get_service().store
        session = await _session_or_404(store, session_id, tenant_id)
        everything = await store.load_observations(session_id, tenant_id, active_only=False)
        wanted = _norm_tag(tag)
        matches = [
            _entity(o) for o in everything if wanted and wanted in _norm_tag(o.raw_value or "")
        ]
        return {
            "session_id": session.session_id,
            "tag": tag,
            "print_model_version": session.current_revision,
            "count": len(matches),
            "superseded_count": sum(1 for m in matches if m["superseded"]),
            "observations": matches,
            "read_only": True,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — never 500
        logger.error("WORKSPACE_EVIDENCE_ERROR error=%s", e, exc_info=True)
        return dict(_UNAVAILABLE, session_id=session_id, tag=tag)

"""Shared contextualization intake envelope builder + Hub submit.

HubV3 (`docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md`) makes the
**Hub the single system of record** for contextualization. Offline and Telegram
become thin *ingest clients* that collect evidence and create proposals; the Hub
performs the final merge / approval / publish.

This module builds the §2 "Shared Contextualization Intake Contract" envelope and
POSTs it to the Hub import endpoint. It is the client half — the Hub endpoint
accepting this JSON contract is Phase 2 (not in this module's scope).

Design rules honored here:
- **Telegram owns NO truth.** ``review_status`` is always ``proposed``; all
  ``proposed_*`` / ``entities`` domain lists are empty (the client submits
  evidence, the Hub derives proposals on approval).
- **Bytes travel.** The §2 envelope is metadata-only, so the raw document/photo
  bytes are carried alongside the JSON contract as a multipart ``file`` field.
  (The import endpoint is multipart today but reads ``file`` as a *zip* and
  ignores ``contract``/``tenant_id``; it consumes this contract field only after
  HubV3 Phase 2.)
- **PII sanitization** (`.claude/rules/security-boundaries.md`): free-text fields
  (caption / field notes / OCR) are scrubbed via
  ``InferenceRouter.sanitize_text`` (IPv4 → ``[IP]``, MAC → ``[MAC]``,
  serial → ``[SN]``). Structured ``asset_hints`` (serial, controller IP, model …)
  are **deliberate matching evidence** and are preserved verbatim.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os

import httpx

from shared.inference.router import InferenceRouter

logger = logging.getLogger("mira.contextualization_intake")

# Ingest-route discriminators (§2 ``ingest_route``).
INGEST_ROUTE_TELEGRAM = "telegram"
INGEST_ROUTE_OFFLINE = "offline"
INGEST_ROUTE_HUB_UPLOAD = "hub_upload"

# Hub import endpoint (the offline/direct upload pipeline entry).
HUB_IMPORT_PATH = "/api/contextualization/import"
HUB_IMPORT_URL = os.environ.get("HUB_IMPORT_URL", "")
HUB_IMPORT_TOKEN = os.environ.get("HUB_IMPORT_TOKEN", "")

# --- Citable folder-upload door (#2540) --------------------------------------
# The §2 /api/contextualization/import path above is a verified dead-end for a
# raw Telegram file: it auths with a browser session (a Bearer token 401s), its
# multipart branch expects a `.zip` bundle (a raw PDF/JPEG 400s), and its env is
# dark in prod. The WORKING citable door is POST /api/uploads/folder — Bearer
# `HUB_INGEST_TOKEN` + an `X-Mira-Tenant-Id` header, multipart raw file — which
# routes through the golden path (mira-hub/src/lib/local-upload.ts -> v2 Inbox
# -> `knowledge_entries`, per-tenant `is_private=true`, citable). MiraDrop
# already uses this exact shape; env-var names match tools/mira-drop-watcher.
HUB_FOLDER_UPLOAD_PATH = "/api/uploads/folder"
HUB_URL = os.environ.get("HUB_URL", "")
# mira-hub runs under basePath=/hub with trailingSlash=true (next.config.ts).
HUB_BASE_PATH = os.environ.get("HUB_BASE_PATH", "/hub")
HUB_INGEST_TOKEN = os.environ.get("HUB_INGEST_TOKEN", "")

# Domain-proposal keys the client always leaves empty — it owns no truth.
_EMPTY_PROPOSAL_KEYS = (
    "entities",
    "proposed_uns",
    "proposed_i3x",
    "proposed_faults",
    "proposed_parameters",
    "proposed_signals",
    "proposed_relationships",
)


def _scrub(text: str | None) -> str:
    """PII-scrub a free-text field. Empty/None → empty string."""
    if not text:
        return ""
    return InferenceRouter.sanitize_text(text)


def build_intake_envelope(
    *,
    raw_bytes: bytes,
    filename: str,
    mime: str,
    uploader: str,
    captured_at: str,
    caption: str | None = None,
    ocr_text: str | None = None,
    location: str | None = None,
    project_hint: str | None = None,
    asset_hints: dict | None = None,
    ingest_route: str = INGEST_ROUTE_TELEGRAM,
    review_status: str = "proposed",  # accepted for signature parity; always coerced
) -> dict:
    """Build the §2 normalized contextualization intake envelope.

    The raw bytes are *not* embedded — they travel as a multipart ``file`` field
    in :func:`submit_intake_to_hub`. ``source_sha256`` fingerprints those bytes
    using the same convention as mira-ingest (``hashlib.sha256(raw).hexdigest()``).
    """
    source_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    # OCR-or-raw: prefer extracted OCR text; otherwise the caption is the field
    # note and the raw bytes themselves (carried as the multipart file) are the
    # evidence. All free text is PII-scrubbed.
    evidence: list[dict] = []
    note = _scrub(caption)
    if note:
        evidence.append({"type": "field_note", "text": note, "ref": {"source": filename}})
    ocr = _scrub(ocr_text)
    if ocr:
        evidence.append({"type": "ocr", "text": ocr, "ref": {"source": filename}})

    # Telegram owns no truth → review_status is always proposed.
    _ = review_status  # intentionally ignored; clients cannot self-approve

    envelope: dict = {
        "project_hint": project_hint or "",
        # Structured matching evidence — preserved verbatim (NOT PII-scrubbed).
        "asset_hints": dict(asset_hints or {}),
        "source_metadata": {
            "filename": filename,
            "mime": mime,
            "size": len(raw_bytes),
            "captured_at": captured_at,
            "uploader": uploader,
            "location": location or "",
        },
        "source_sha256": source_sha256,
        "evidence": evidence,
        "provenance": {
            "ingest_route": ingest_route,
            "source_sha256": source_sha256,
            "uploader": uploader,
            "captured_at": captured_at,
        },
        "confidence": "low",  # unverified field capture; Hub re-scores on review
        "review_status": "proposed",
        "ingest_route": ingest_route,
    }
    for key in _EMPTY_PROPOSAL_KEYS:
        envelope[key] = []
    return envelope


async def submit_intake_to_hub(
    envelope: dict,
    *,
    raw_bytes: bytes,
    filename: str,
    mime: str,
    tenant_id: str,
    hub_url: str | None = None,
    token: str | None = None,
    timeout: float = 120,
) -> bool:
    """POST the §2 contract + raw bytes to the Hub import endpoint.

    Multipart body: ``contract`` (the JSON envelope) + ``file`` (raw bytes) +
    ``tenant_id`` (transport-level scoping). Returns ``True`` on a 2xx response.

    Background-safe: never raises — a failing Hub POST must not break the chat
    reply. A transport error or non-2xx is logged and reported as ``False``.
    """
    base = (hub_url or HUB_IMPORT_URL or "").rstrip("/")
    if not base:
        logger.warning("HUB_IMPORT_URL not configured — skipping Hub intake submit")
        return False

    url = f"{base}{HUB_IMPORT_PATH}"
    headers: dict[str, str] = {}
    bearer = token if token is not None else HUB_IMPORT_TOKEN
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url,
                data={"contract": json.dumps(envelope), "tenant_id": tenant_id or ""},
                files={"file": (filename, raw_bytes, mime)},
                headers=headers,
            )
            if 200 <= resp.status_code < 300:
                logger.info(
                    "Hub intake OK route=%s sha256=%s",
                    envelope.get("ingest_route"),
                    envelope.get("source_sha256", "")[:12],
                )
                return True
            logger.warning("Hub intake failed %s: %s", resp.status_code, resp.text[:200])
            return False
    except Exception as exc:  # noqa: BLE001 - background task must never raise
        logger.error("Hub intake submit error: %s", exc)
        return False


def hub_folder_upload_configured(
    *, hub_url: str | None = None, token: str | None = None
) -> bool:
    """True when the citable folder-upload door has the env it needs.

    Needs a base URL and a Bearer service token. A legacy ``HUB_IMPORT_URL``
    counts as a base (back-compat), so an existing deploy keeps submitting —
    now to the citable ``/api/uploads/folder`` path.
    """
    base = hub_url or HUB_URL or HUB_IMPORT_URL
    return bool(base) and bool(token or HUB_INGEST_TOKEN)


async def submit_file_to_hub_folder(
    *,
    raw_bytes: bytes,
    filename: str,
    mime: str,
    tenant_id: str,
    hub_url: str | None = None,
    base_path: str | None = None,
    token: str | None = None,
    timeout: float = 180,
) -> bool:
    """POST a raw file to the Hub's citable folder-upload door (#2540).

    Mirrors ``tools/mira-drop-watcher/main.py::_post_to_hub`` — the golden path
    that routes through ``mira-hub/src/lib/local-upload.ts`` -> v2 Inbox ->
    ``knowledge_entries`` (per-tenant, ``is_private=true``, citable). Auth is a
    Bearer service token (``HUB_INGEST_TOKEN``) plus an ``X-Mira-Tenant-Id``
    header (NOT a browser session), and the body is the raw file (NOT a zip
    bundle). The tenant header keeps uploads per-tenant — the Hub route sets
    ``is_private=true`` (`.claude/rules/knowledge-entries-tenant-scoping.md`).

    Background-safe: never raises. Returns True on a 2xx Hub response, False on
    a missing-config skip, non-2xx, or transport error.
    """
    base = (hub_url or HUB_URL or HUB_IMPORT_URL or "").rstrip("/")
    bp = (base_path if base_path is not None else HUB_BASE_PATH).rstrip("/")
    bearer = token if token is not None else HUB_INGEST_TOKEN
    if not base or not bearer:
        logger.warning("Hub folder upload not configured — skipping intake submit")
        return False

    # Hub uses trailingSlash=true — match MiraDrop's trailing-slash URL exactly.
    url = f"{base}{bp}{HUB_FOLDER_UPLOAD_PATH}/"
    sha = hashlib.sha256(raw_bytes).hexdigest()
    headers = {
        "Authorization": f"Bearer {bearer}",
        "X-Mira-Tenant-Id": tenant_id or "",
        "X-Request-Id": f"telegram-{sha[:12]}",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url,
                files={"file": (filename, raw_bytes, mime)},
                headers=headers,
            )
            if 200 <= resp.status_code < 300:
                logger.info(
                    "Hub folder upload OK file=%s tenant=%s sha256=%s",
                    filename,
                    (tenant_id or "")[:8],
                    sha[:12],
                )
                return True
            logger.warning(
                "Hub folder upload failed %s: %s", resp.status_code, resp.text[:200]
            )
            return False
    except Exception as exc:  # noqa: BLE001 - background task must never raise
        logger.error("Hub folder upload error: %s", exc)
        return False

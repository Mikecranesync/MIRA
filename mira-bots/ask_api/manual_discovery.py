"""Read-only OEM manual discovery HTTP endpoint.

This module exposes the existing, product-agnostic real-time manual searcher
(``shared.manual_search.search.search_manual``) over HTTP so the Hub can
discover an official OEM PDF manual for a (manufacturer, model[, catalog
number]) triple. It does NOT reimplement any search/scoring/validation logic
— all of that lives in ``shared/manual_search/search.py`` (Serper multi-pass
search, OEM domain scoring, deny-list filtering, HEAD/magic-byte PDF
validation). This router is a thin HTTP adapter over that one function.

Route: POST /manual-discovery/search
- No live hardware, no LLM, no ingestion side effects — pure lookup.
- Never fabricates a URL: a miss is ``found=False, candidate=None``, never a
  guessed link.
- ``validated=False`` on the response means the candidate scored highest but
  did NOT pass the PDF HEAD/magic-byte check — the caller MUST NOT auto-import
  it (human review only). Only ``validated=True`` candidates are safe to treat
  as a confirmed OEM manual link.
- REQUIRED shared-secret auth via X-Mira-Key, checked against its own key,
  ``MANUAL_DISCOVERY_API_KEY`` (read at request time so tests can
  monkeypatch it). Fails closed: with no key configured the endpoint answers
  503 and never searches, because every call spends paid provider queries
  (#4160 S2, PRD R13). It deliberately does NOT reuse ``ASK_API_KEY``: the
  Ignition kiosk posts an empty X-Mira-Key to /ask, so switching the shared
  key on would break the kiosk.
- Bounded by an overall timeout (``MANUAL_DISCOVERY_TIMEOUT``, default 20s) so
  a slow/unavailable Serper backend can't hang the caller.

Separation: this module defines its own APIRouter so tests can import it
WITHOUT constructing ask_api.app (which builds the heavy Supervisor engine at
import time).
"""

import asyncio
import hmac
import logging
import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from shared.manual_search.search import (
    OEM_DOMAINS,
    TRUSTED_DOMAINS,
    oem_request_link,
    provider_query_budget,
    search_manual,
)

logger = logging.getLogger("mira-ask")

router = APIRouter()

_MAX_FIELD_LEN = 200


class ManualSearchRequest(BaseModel):
    """Request model for the manual-discovery search endpoint.

    Fields:
    - manufacturer: the equipment manufacturer/vendor name (required)
    - model: the model number/name (required)
    - catalog_number: an explicit catalog/part number (optional; preferred
      over `model` as the search identifier when present — see the priority
      comment on the route handler)
    """

    manufacturer: str = Field(..., min_length=1, max_length=_MAX_FIELD_LEN)
    model: str = Field(..., min_length=1, max_length=_MAX_FIELD_LEN)
    catalog_number: str | None = Field(default=None, max_length=_MAX_FIELD_LEN)


_NO_RESULT = {
    "found": False,
    "candidate": None,
    "validated": False,
    "is_direct_pdf": False,
    "oem_host": False,
    "trusted_distributor_host": False,
    "reason": "no_result",
}


def is_oem_host(manufacturer: str, host: str) -> bool:
    """True ONLY if `host` is on the confirmed manufacturer's OWN domain list.

    Codex P1 (2026-08-16): this used to also return True for any general
    TRUSTED_DOMAINS entry — distributor CDNs and OTHER manufacturers' sites —
    and downstream `oem_host` gates AUTO-import/AUTO-verify. A trusted host is
    not the same claim as "this is the confirmed manufacturer's official
    documentation host": siemens.com is a trusted domain, but it must never
    auto-verify a manual for an ABB nameplate. Distributor trust is now the
    separate `is_trusted_distributor_host` and is informational only.

    Pure function over shared.manual_search.search's data tables — exported
    so it is directly unit-testable without a network call.
    """
    if not manufacturer or not host:
        return False
    host = host.lower()
    oem_domains = OEM_DOMAINS.get(manufacturer.strip().lower(), ())
    return any(host == d or host.endswith("." + d) for d in oem_domains)


def is_trusted_distributor_host(host: str) -> bool:
    """True if `host` is on the general curated trusted list (OEM/distributor
    documentation CDNs). A quality signal for ranking and human review — NEVER
    sufficient for auto-verification, because the list is manufacturer-agnostic."""
    if not host:
        return False
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in (t[0] for t in TRUSTED_DOMAINS))


def _require_discovery_key(x_mira_key: str | None) -> None:
    """Fail-closed shared-secret gate for the paid search endpoint.

    503 when the server has no key (an unconfigured deployment must not be an
    open, paid search), 401 when the caller's key is missing or wrong. Uses a
    constant-time comparison.
    """
    key = os.environ.get("MANUAL_DISCOVERY_API_KEY", "").strip()
    if not key:
        logger.warning("manual-discovery refused: MANUAL_DISCOVERY_API_KEY is not configured")
        raise HTTPException(status_code=503, detail="manual discovery is not configured")
    if not hmac.compare_digest((x_mira_key or "").encode(), key.encode()):
        raise HTTPException(status_code=401, detail="invalid or missing X-Mira-Key")


@router.post("/manual-discovery/search")
async def manual_discovery_search(req: ManualSearchRequest, x_mira_key: str = Header(None)):
    """Discover an official OEM PDF manual for (manufacturer, model).

    Query priority: a supplied `catalog_number` is a stronger identifier than
    a generic `model` string (it disambiguates variants a bare model number
    can't), so when present it is passed as the `model` argument to
    search_manual() in place of `req.model`. `manufacturer` is always passed
    as `make`.

    Auth (required): see ``_require_discovery_key`` — 503 when
    MANUAL_DISCOVERY_API_KEY is unset, 401 on a missing or wrong X-Mira-Key.

    Error handling: any exception (including a missing SERPER_API_KEY
    RuntimeError) or a timeout is caught, logged, and answered with
    reason="search_unavailable". Never 500 — the caller must always be able
    to fall through gracefully.
    """
    _require_discovery_key(x_mira_key)

    manufacturer = req.manufacturer.strip()
    model = req.model.strip()
    catalog_number = (req.catalog_number or "").strip()
    if not manufacturer or not model:
        result = _NO_RESULT.copy()
        result["reason"] = "invalid_query"
        return result

    # Strongest identifier wins: catalog_number over model, when supplied.
    search_identifier = catalog_number or model
    # The OEM's own manual-request page (validated live) — offered with any
    # non-success so the technician always has an official next step.
    try:
        oem_request_url = await asyncio.wait_for(oem_request_link(manufacturer), timeout=10)
    except Exception:  # noqa: BLE001
        oem_request_url = None

    # 50s (was 20s): the judge fetches + reads the top candidate PDFs before
    # choosing (shared/manual_search/judge.py). The Hub side allows 60s.
    timeout_s = float(os.environ.get("MANUAL_DISCOVERY_TIMEOUT", "50"))

    try:
        # Every provider query this call sends is counted and capped (PRD R13).
        with provider_query_budget() as budget:
            try:
                candidate = await asyncio.wait_for(
                    search_manual(manufacturer, search_identifier), timeout=timeout_s
                )
            finally:
                logger.info(
                    "MANUAL_DISCOVERY_PROVIDER_QUERIES used=%d refused=%d limit=%d",
                    budget.used,
                    budget.refused,
                    budget.limit,
                )
    except TimeoutError:
        logger.error(
            "MANUAL_DISCOVERY_TIMEOUT manufacturer=%s model=%s timeout_s=%s",
            manufacturer,
            search_identifier,
            timeout_s,
        )
        result = _NO_RESULT.copy()
        result["reason"] = "search_unavailable"
        result["oem_request_url"] = oem_request_url
        return result
    except Exception as e:  # noqa: BLE001
        logger.error("MANUAL_DISCOVERY_ERROR error=%s", e, exc_info=True)
        result = _NO_RESULT.copy()
        result["reason"] = "search_unavailable"
        result["oem_request_url"] = oem_request_url
        return result

    if candidate is None:
        result = _NO_RESULT.copy()
        result["oem_request_url"] = oem_request_url
        return result
    if candidate.get("reason") == "judged_not_applicable":
        # Every relevant candidate was READ and rejected. Owner canary rule
        # (2026-08-26): bad manuals disappear — do not hand the technician a
        # newspaper to "review"; say no manual was found, show why, and offer
        # the manufacturer's own request form.
        result = _NO_RESULT.copy()
        result["reason"] = "judged_not_applicable"
        result["reason_detail"] = candidate.get("reason_detail") or ""
        result["judged_rejected"] = candidate.get("judged_rejected") or []
        result["oem_request_url"] = oem_request_url
        return result

    validated = bool(candidate.get("validated"))
    is_direct_pdf = bool(candidate.get("is_direct_pdf"))
    host = candidate.get("host") or ""
    # oem_host is STRICT (the confirmed manufacturer's own domains) — it gates
    # auto-import/auto-verify downstream. trusted_distributor_host is the
    # broader curated list: ranking/review signal only, never auto-trust.
    oem_host = is_oem_host(manufacturer, host)
    trusted_distributor_host = is_trusted_distributor_host(host)

    return {
        "found": True,
        "candidate": candidate,
        "validated": validated,
        "is_direct_pdf": is_direct_pdf,
        "oem_host": oem_host,
        "trusted_distributor_host": trusted_distributor_host,
        # Judge outcome (judged_manual_match / judged_not_applicable /
        # judge_unavailable) when the candidate PDF was read; "ok" otherwise.
        "reason": candidate.get("reason") or "ok",
        "reason_detail": candidate.get("reason_detail") or "",
        "judge": candidate.get("judge") or None,
        "judged_rejected": candidate.get("judged_rejected") or [],
        "oem_request_url": oem_request_url,
    }

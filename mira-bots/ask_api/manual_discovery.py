"""Read-only OEM manual discovery HTTP endpoint.

This module exposes the existing, product-agnostic real-time manual searcher
(``shared.manual_search.search.search_manual``) over HTTP so the Hub can
discover a manual for a (manufacturer, model[, catalog number]) tuple, or run
a part-number-only search when the manufacturer is unknown. It does NOT
reimplement any search/scoring/validation logic
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
import json
import logging
import os
import time

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from shared.manual_search.quota import QuotaIdentity, provider_query_quota
from shared.manual_search.search import (
    OEM_DOMAINS,
    TRUSTED_DOMAINS,
    AcquisitionTrail,
    ProviderQueryBudget,
    acquisition_trail,
    oem_request_link,
    provider_query_budget,
    search_manual,
)

logger = logging.getLogger("mira-ask")

router = APIRouter()

_MAX_FIELD_LEN = 200

# Plain-words reason_detail per quota scope (#4160 S4, PRD R5: a cap denial
# must never look like "no manual exists").
_QUOTA_DENIAL_DETAIL = {
    "user_cap": "Daily manual-search limit reached for this user.",
    "tenant_cap": "Daily manual-search limit reached for this organization.",
    "global_cap": "Monthly manual-search limit reached system-wide.",
}
# Defensive allow-list, not a derived set: only an ACTUAL cap-at-capacity
# denial is "quota_exceeded". Any other budget.quota_denied value — today
# that's "quota_unavailable" (DB/env problem) and "no_identity" (should be
# structurally unreachable here since this route always opens
# provider_query_quota() with a validated identity, but a future regression
# that removes that wrapper must degrade to "search_unavailable", never a
# blank-detail "quota_exceeded") — maps to the infra-miss reason instead.
_QUOTA_CAP_REASONS = frozenset(_QUOTA_DENIAL_DETAIL)


class ManualSearchRequest(BaseModel):
    """Request model for the manual-discovery search endpoint.

    Fields:
    - manufacturer: the equipment manufacturer/vendor name (optional for a part-only search)
    - model: the model number/name (optional when catalog_number is present)
    - catalog_number: an explicit catalog/part number (optional; preferred
      over `model` as the search identifier when present — see the priority
      comment on the route handler)
    """

    manufacturer: str | None = Field(default=None, max_length=_MAX_FIELD_LEN)
    model: str | None = Field(default=None, max_length=_MAX_FIELD_LEN)
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


def _search_stats(budget: ProviderQueryBudget | None, *, searched: bool = True) -> dict:
    """Additive `search_stats` block for EVERY response (#4160 gate R15, PRD
    v1.7.1 R15). No identity strings, URLs, or serials — provider-query
    accounting plus the number of candidate documents search_manual() actually
    examined (read by the judge or HEAD-validated; Codex #4194 F4).

    `searched=False` is the early `invalid_query` return: no search ran, so the
    zeros are real. A missing budget after a search was attempted means the
    numbers are unknown — reported as null, never an invented zero."""
    if budget is None:
        if searched:
            return {
                "provider_queries": None,
                "refused_queries": None,
                "quota_denied": None,
                "candidates": None,
            }
        return {"provider_queries": 0, "refused_queries": 0, "quota_denied": None, "candidates": 0}
    return {
        "provider_queries": budget.used,
        "refused_queries": budget.refused,
        "quota_denied": budget.quota_denied,
        "candidates": len(budget.examined),
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


def _with_trail(
    result: dict, trail: AcquisitionTrail | None, selected_url: str | None = None
) -> dict:
    """Attach the acquisition trail (additive, like `search_stats`) and log it
    once. Observability only: the trail never changes the result."""
    if trail is None:
        return result
    payload = trail.to_dict(selected_url)
    result["candidate_trail"] = payload
    logger.info("MANUAL_ACQUISITION_TRAIL %s", json.dumps(payload, default=str)[:20000])
    return result


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
async def manual_discovery_search(
    req: ManualSearchRequest,
    x_mira_key: str = Header(None),
    x_mira_tenant: str = Header(None),
    x_mira_user: str = Header(None),
):
    """Discover an official OEM PDF manual for (manufacturer, model).

    Query priority: a supplied `catalog_number` is a stronger identifier than
    a generic `model` string (it disambiguates variants a bare model number
    can't), so when present it is passed as the `model` argument to
    search_manual() in place of `req.model`. `manufacturer` is always passed
    as `make`. A blank manufacturer triggers a part-only search; in that case
    the result is not identified as an OEM and no OEM request page is offered.

    Auth (required): see ``_require_discovery_key`` — 503 when
    MANUAL_DISCOVERY_API_KEY is unset, 401 on a missing or wrong X-Mira-Key.

    Identity (required, checked AFTER the key — #4160 S4, PRD R13/R14): every
    search is reserved against per-user/tenant/global Postgres caps, so the
    caller must identify itself. Missing/blank X-Mira-Tenant or X-Mira-User ->
    400, never a search.

    Error handling: any exception (including a missing SERPER_API_KEY
    RuntimeError) or a timeout is caught, logged, and answered with
    reason="search_unavailable". Never 500 — the caller must always be able
    to fall through gracefully.
    """
    _require_discovery_key(x_mira_key)

    tenant_id = (x_mira_tenant or "").strip()
    user_id = (x_mira_user or "").strip()
    if not tenant_id or not user_id:
        raise HTTPException(status_code=400, detail="tenant and user required")

    manufacturer = (req.manufacturer or "").strip()
    model = (req.model or "").strip()
    catalog_number = (req.catalog_number or "").strip()
    if not (model or catalog_number):
        result = _NO_RESULT.copy()
        result["reason"] = "invalid_query"
        result["search_stats"] = _search_stats(None, searched=False)
        return result

    # Strongest identifier wins: catalog_number over model, when supplied.
    search_identifier = catalog_number or model
    # The OEM's own manual-request page (validated live) — offered with any
    # non-success so the technician always has an official next step.
    try:
        oem_request_url = (
            await asyncio.wait_for(oem_request_link(manufacturer), timeout=10)
            if manufacturer
            else None
        )
    except Exception:  # noqa: BLE001
        oem_request_url = None

    # 50s (was 20s): the judge fetches + reads the top candidate PDFs before
    # choosing (shared/manual_search/judge.py). The Hub side allows 60s.
    timeout_s = float(os.environ.get("MANUAL_DISCOVERY_TIMEOUT", "50"))

    identity = QuotaIdentity(tenant_id=tenant_id, user_id=user_id)
    # Bound even if a TimeoutError/Exception below fires before the `with`
    # block assigns it (defensive — see _search_stats's None branch).
    budget: ProviderQueryBudget | None = None
    trail: AcquisitionTrail | None = None
    try:
        # Every provider query this call sends is counted and capped (PRD R13)
        # AND reserved against the per-user/tenant/global Postgres caps (S4).
        with (
            provider_query_quota(identity),
            provider_query_budget() as budget,
            acquisition_trail() as trail,
        ):
            try:
                candidate = await asyncio.wait_for(
                    search_manual(
                        manufacturer,
                        search_identifier,
                        deadline_at=time.monotonic() + timeout_s,
                    ),
                    timeout=timeout_s,
                )
            finally:
                logger.info(
                    "MANUAL_DISCOVERY_PROVIDER_QUERIES used=%d refused=%d limit=%d quota_denied=%s",
                    budget.used,
                    budget.refused,
                    budget.limit,
                    budget.quota_denied,
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
        result["search_stats"] = _search_stats(budget)
        return _with_trail(result, trail)
    except Exception as e:  # noqa: BLE001
        logger.error("MANUAL_DISCOVERY_ERROR error=%s", e, exc_info=True)
        result = _NO_RESULT.copy()
        result["reason"] = "search_unavailable"
        result["oem_request_url"] = oem_request_url
        result["search_stats"] = _search_stats(budget)
        return _with_trail(result, trail)

    interrupted = budget.quota_denied is not None and (
        candidate is None or candidate.get("reason") == "judged_not_applicable"
    )
    if interrupted:
        # A cap denial must NEVER look like "no manual exists" (PRD R5) — and
        # that includes a judged rejection of whatever was collected before the
        # denial stopped the remaining queries (#4168 Codex F2): the search did
        # not finish, so the honest answer is retryable, not a terminal miss. A
        # usable (validated or still-reviewable) candidate is still returned.
        result = _NO_RESULT.copy()
        if budget.quota_denied in _QUOTA_CAP_REASONS:
            result["reason"] = "quota_exceeded"
            result["reason_detail"] = _QUOTA_DENIAL_DETAIL[budget.quota_denied]
        else:
            # "quota_unavailable" (DB/env problem) and anything else
            # (including "no_identity", which should be unreachable here —
            # see the allow-list comment above) are an infra miss, not a cap.
            result["reason"] = "search_unavailable"
        result["oem_request_url"] = oem_request_url
        result["search_stats"] = _search_stats(budget)
        return _with_trail(result, trail)

    if candidate is None:
        result = _NO_RESULT.copy()
        result["oem_request_url"] = oem_request_url
        result["search_stats"] = _search_stats(budget)
        return _with_trail(result, trail)
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
        result["search_stats"] = _search_stats(budget)
        return _with_trail(result, trail)

    validated = bool(candidate.get("validated"))
    is_direct_pdf = bool(candidate.get("is_direct_pdf"))
    host = candidate.get("host") or ""
    # oem_host is STRICT (the confirmed manufacturer's own domains) — it gates
    # auto-import/auto-verify downstream. trusted_distributor_host is the
    # broader curated list: ranking/review signal only, never auto-trust.
    oem_host = is_oem_host(manufacturer, host)
    trusted_distributor_host = is_trusted_distributor_host(host)

    return _with_trail(
        {
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
            "search_stats": _search_stats(budget),
        },
        trail,
        candidate.get("url"),
    )

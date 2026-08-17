"""Official-manual lookup for a nameplate read — answer the ask, don't deflect it.

Live defect (prod, 2026-08-17): a technician photographed a Danfoss VLT AQUA
Drive plate and captioned it *"Here's the model number can you please find the
PDF user manual for me?"*. MIRA read the plate correctly and then said it
*"cannot fetch external files"* — while the capability to find and validate an
official OEM PDF has shipped in ``shared/manual_search/`` since PR #3245. The
Telegram surface simply never called it.

This module is the thin, deterministic bridge between a plate read and that
existing capability. It owns three decisions and nothing else:

1. **Which identifier to search on.** The model/series is what an OEM titles a
   manual after ("VLT AQUA Drive"); a type/catalog code
   (``FC-202P15KT2E20H2XG…``) is a build-configuration string that rarely
   appears in a document title. So: model, then catalog, then part number.
2. **What counts as a hit.** Only a HEAD/magic-byte ``validated`` candidate
   with a URL. An unvalidated top scorer is a lead, not a manual — naming one
   would be exactly the fabrication ``.claude/rules/materialized-evidence.md``
   rule 9 forbids. A miss is reported as a miss.
3. **What to say about it.** A found document is named with its host and its
   real URL, and the ingest state is stated as it actually is — queued for
   indexing, never "indexed" (nothing has extracted text from it yet).

It does NOT reimplement search, scoring, SSRF-guarded probing, PDF validation
or the ingest queue: those are ``shared/manual_search`` (search + validate) and
its ``record_manual_discovery`` bridge into the crawler's EXISTING queues
(``.claude/rules/one-pipeline-ingest.md`` — reuse the queue, never fork one).

Fast-path discipline (``.claude/rules/fast-path-optimization.md``): read-only
apart from that existing queue seam, and never raises — every failure is a miss
the caller reports honestly.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger("mira.manual_lookup")

# Search identifier preference — see decision 1 in the module docstring.
_IDENTIFIER_FIELDS: tuple[str, ...] = ("model", "catalog", "part_number")

# Rollback lever. Default ON: a technician asking for a manual and being told
# MIRA cannot fetch files is the defect this exists to close. The capability is
# inert anyway without ``SERPER_API_KEY`` (the search raises, which is a miss).
_ENABLED_ENV = "MIRA_TELEGRAM_MANUAL_SEARCH"

MANUAL_NOT_FOUND = (
    "I searched the manufacturer's site for it and couldn't find an official PDF "
    "I could verify — I won't hand you a link I haven't checked. If you have the "
    "document, send it to me here as a PDF."
)


@dataclass(frozen=True)
class ManualHit:
    """A HEAD-validated official document found on the open OEM web.

    ``queued`` records whether the discovery reached the crawler's ingest
    queues. It is deliberately separate from "found": the link is real either
    way, but only a queued document is on its way to being citable.
    """

    title: str
    url: str
    host: str
    doc_type: str | None = None
    queued: bool = False


def manual_lookup_enabled() -> bool:
    """``MIRA_TELEGRAM_MANUAL_SEARCH`` — default on, set to ``0`` to disable."""
    return os.getenv(_ENABLED_ENV, "1") != "0"


def lookup_identifier(fields: dict | None) -> str | None:
    """The best search identifier in a nameplate read, or ``None``.

    Never fabricates: returns only a non-empty value that the plate read
    actually produced.
    """
    for name in _IDENTIFIER_FIELDS:
        value = (fields or {}).get(name)
        text = str(value).strip() if value else ""
        if text:
            return text
    return None


async def find_official_manual(manufacturer: str, identifier: str) -> ManualHit | None:
    """Find a validated official manual for ``manufacturer`` + ``identifier``.

    Returns a :class:`ManualHit` ONLY for a HEAD-validated document with a URL,
    after handing it to the existing ingest queues. Returns ``None`` for a
    disabled lookup, a missing argument, an unavailable search package, a
    search failure, or an unvalidated candidate. Never raises.
    """
    if not manual_lookup_enabled():
        return None
    make = (manufacturer or "").strip()
    model = (identifier or "").strip()
    if not make or not model:
        return None

    try:
        from .manual_search import record_manual_discovery, search_manual  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001 — an optional capability, never a crash
        logger.info("manual_lookup: manual_search unavailable: %s", exc)
        return None

    try:
        candidate = await search_manual(make, model)
    except Exception as exc:  # noqa: BLE001 — a search failure is a miss
        logger.info("manual_lookup: search failed for %s %s: %s", make, model, exc)
        return None

    if not candidate or not candidate.get("validated") or not candidate.get("url"):
        logger.info("manual_lookup: no validated manual for %s %s", make, model)
        return None

    url = str(candidate["url"])
    title = str(candidate.get("title") or "").strip() or "Manual"
    host = str(candidate.get("host") or "").strip()
    doc_type = candidate.get("doc_type")

    queued = False
    try:
        outcome = await record_manual_discovery(
            make,
            model,
            manual_url=url,
            manual_title=title,
            manual_type=doc_type,
        )
        queued = bool(
            (outcome or {}).get("manual_cache_written")
            or (outcome or {}).get("manual_queue_json_appended")
        )
    except Exception as exc:  # noqa: BLE001 — the link stands even if queueing fails
        logger.info("manual_lookup: queueing discovery failed: %s", exc)

    logger.info(
        "MANUAL_LOOKUP_HIT manufacturer=%s identifier=%s host=%s queued=%s url=%s",
        make,
        model,
        host,
        queued,
        url[:120],
    )
    return ManualHit(
        title=title,
        url=url,
        host=host,
        doc_type=str(doc_type) if doc_type else None,
        queued=queued,
    )


def format_manual_found(hit: ManualHit) -> str:
    """Name the document, its host and its URL — no claim beyond what is true.

    "Queued for indexing" is the honest ceiling: the document has been found
    and validated, but nothing has extracted text from it yet, so MIRA cannot
    cite it this turn.
    """
    head = f"\U0001f4c4 Found it: {hit.title}"
    if hit.host:
        head = f"{head} ({hit.host})"
    lines = [head, hit.url]
    if hit.queued:
        lines.append("Queued for indexing — once it's in I can answer from it with citations.")
    else:
        lines.append("I couldn't queue it for indexing, so read it from that link for now.")
    return "\n".join(lines)

"""Shared, product-agnostic OEM manual search.

Phase 1 of the ManualSense plan
(``docs/plans/2026-07-31-visual-intake-asset-identity-manualsense-audit.md``):
ported from ``mira-scan-monday/backend/manual_search.py`` +
``crawler_bridge.py`` so any bot adapter can reuse the same OEM-domain-scoped
search + HEAD-validated PDF check + canonical-queue bridge, instead of a
second implementation being built from scratch.

Phase 2 (same plan) wired this package into
``mira-bots/shared/visual/equipment.py::default_manual_retriever()`` as
ladder rungs 4-6, behind ``MIRA_MANUAL_SENSE_WEB_ENABLED`` (default off): a
local-KB miss with a known manufacturer+model discovers + queues a validated
OEM manual for the existing ingestion cron. It still returns no citation
that turn — nothing has been extracted from the document yet. Phase 3
(connecting a bot adapter's pack-miss path to this) is separate and not
done here.

Public surface:

    search_manual(make, model) -> dict | None
        Multi-pass Serper search + HEAD-validated PDF check. See
        ``search.py`` for the full contract. (Named ``search_manual``, not
        ``search``, so it doesn't collide with this package's own
        ``search`` submodule name when re-exported here.)

    record_manual_discovery(manufacturer, model, *, manual_url, ...) -> dict
        Hands a validated manual link to MIRA's existing ingestion queues
        (`manual_cache` table + `manual_queue.json` cron). See
        ``crawler_bridge.py``.
"""

from __future__ import annotations

from .crawler_bridge import record_manual_discovery, upsert_manual_cache
from .search import search_manual, validate_pdf

__all__ = [
    "search_manual",
    "validate_pdf",
    "record_manual_discovery",
    "upsert_manual_cache",
]

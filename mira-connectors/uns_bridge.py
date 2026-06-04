"""Bridge to the canonical UNS path builders in ``mira-crawler/ingest/uns.py``.

The connector framework MUST NOT reinvent UNS path construction
(``.claude/rules/uns-compliance.md`` rule #1). All ``enterprise.*`` paths are
built by the functions in ``mira-crawler/ingest/uns.py`` — ``slug``,
``site_path``, ``area_path``, ``line_path``, ``work_cell_path``,
``assigned_equipment_path``, ``equipment_subnode_path``, ``fault_code_path``,
``model_path``, ``manual_path``, ``work_order_path``, etc.

``mira-crawler`` is a sibling module, not an installed package, so we inject it
onto ``sys.path`` the same way the repo's backfill scripts and conftests do
(e.g. ``tools/migrations/backfill_equipment_entities.py`` → ``from ingest.uns
import ...``). Importing this module re-exports the live ``uns`` module so
connectors can ``from uns_bridge import uns`` and call ``uns.site_path(...)``.
"""

from __future__ import annotations

import sys
from pathlib import Path

# mira-connectors/ -> repo root -> mira-crawler/ (where the `ingest` package lives)
_REPO_ROOT = Path(__file__).resolve().parent.parent
_CRAWLER = _REPO_ROOT / "mira-crawler"

if _CRAWLER.is_dir() and str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

# The single source of truth for UNS path grammar. Re-exported, never copied.
from ingest import uns  # noqa: E402  (sys.path injection must precede import)

__all__ = ["uns"]

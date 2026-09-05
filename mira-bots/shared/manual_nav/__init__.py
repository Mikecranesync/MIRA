"""Manual Navigator — an EXPERIMENTAL retrieval lane. Not wired to production.

Nothing in `mira-bots/shared/` imports this package. Production retrieval is
still `neon_recall.recall_knowledge` and is untouched by this work; the lane
exists to be measured against it on frozen questions, and to be deleted without
trace if it loses.

    docmap.py     derive the manual hierarchy (the schema's columns are empty)
    navigator.py  scope -> doc -> section -> passage -> parent
    route.py      deterministic A/B so one question runs both lanes
"""

from __future__ import annotations

from . import docmap, navigator, route  # noqa: F401

__all__ = ["docmap", "navigator", "route"]

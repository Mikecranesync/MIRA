"""Deterministic A/B routing so one question runs through both lanes.

Deterministic, not random: an experiment whose assignment moves between runs
cannot be replayed, and every comparison in this arc that mattered was settled
by replaying the exact same input. `LANE_BOTH` is the default for the harness
because the only comparison worth making is the paired one — same question,
same corpus, same moment.

Nothing here is wired into production. `neon_recall.recall_knowledge` is called
unchanged for the control lane, so the "current" column of any benchmark is the
real production path and not a reimplementation of it — the mistake the
retrieval-diagnostics skill exists to prevent.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

LANE_CURRENT = "current"
LANE_NAVIGATOR = "navigator"
LANE_BOTH = "both"


def active_lane() -> str:
    """Env-selected lane. Default CURRENT — the experiment is opt-in."""
    return os.getenv("MIRA_RETRIEVAL_LANE", LANE_CURRENT).strip().lower()


@dataclass
class LaneResult:
    lane: str
    chunks: list[dict] = field(default_factory=list)
    path: str = ""
    reason: str = ""
    error: str = ""
    meta: dict[str, Any] = field(default_factory=dict)


def run_current(question: str, tenant_id=None, limit: int = 10, embedder=None) -> LaneResult:
    """The PRODUCTION path, called for real.

    The embedder is injected so the caller controls whether this is an embedded
    (production-strength) or lexical-only retrieval. A lexical-only run is a
    WEAKER retrieval and is not comparable to an embedded one — the retrieval
    probe learned that the hard way, so the flag is recorded in `meta`.
    """
    try:
        import sys

        repo_bots = os.path.join(os.path.dirname(__file__), "..", "..")
        if repo_bots not in sys.path:
            sys.path.insert(0, os.path.abspath(repo_bots))
        from shared import neon_recall  # noqa: PLC0415

        emb = embedder(question) if embedder else None
        chunks = neon_recall.recall_knowledge(emb, tenant_id, limit=limit, query_text=question)
        return LaneResult(
            LANE_CURRENT,
            chunks=chunks or [],
            path="flat top-k (vector+product+bm25+like, RRF)",
            reason="ok" if chunks else "empty",
            meta={"embedded": bool(emb), "n": len(chunks or [])},
        )
    except Exception as exc:  # noqa: BLE001
        return LaneResult(LANE_CURRENT, error=f"{type(exc).__name__}: {exc}")


def run_navigator(
    question: str, manufacturer: str, model: str, limit: int = 5, conn=None
) -> LaneResult:
    from . import navigator

    res = navigator.navigate(question, manufacturer, model, limit=limit, conn=conn)
    return LaneResult(
        LANE_NAVIGATOR,
        chunks=res.as_retrieved_meta(),
        path=res.retrieval_path(),
        reason=res.reason,
        meta={
            "ok": res.ok,
            "doc_key": res.doc_key,
            "section": res.section,
            "n_passages": len(res.passages),
            "n_parent": len(res.parent_context),
            "steps": [(s.stage, s.chose, s.why) for s in res.path],
        },
    )


def run(
    question: str,
    manufacturer: str = "",
    model: str = "",
    tenant_id=None,
    limit: int = 10,
    embedder=None,
    lane: str | None = None,
    conn=None,
) -> dict[str, LaneResult]:
    """Run one question through the selected lane(s)."""
    lane = (lane or active_lane()).lower()
    out: dict[str, LaneResult] = {}
    if lane in (LANE_CURRENT, LANE_BOTH):
        out[LANE_CURRENT] = run_current(question, tenant_id, limit, embedder)
    if lane in (LANE_NAVIGATOR, LANE_BOTH):
        out[LANE_NAVIGATOR] = run_navigator(question, manufacturer, model, max(1, limit // 2), conn)
    return out

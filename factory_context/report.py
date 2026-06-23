"""Render the FactoryModel into a human-reviewable report (the artifact a Hub reviewer would read)."""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import uns_draft  # noqa: E402


def render(model) -> str:
    c = model.counts()
    sigs = model.signals()
    violations = model.evidence_violations()
    suggestions = model.all_suggestions()
    auto_approved = [s for s in suggestions if s.status == "approved"]
    needs_review = [s for s in suggestions if s.status == "needs_review"]

    L = []
    L.append("# Phase 1 — Contextual Factory Model + UNS Draft (approval-ready)")
    L.append("")
    L.append("source: `%s`" % model.source)
    L.append("")
    L.append("## Summary")
    L.append("- entities: %d enterprise / %d site / %d area / %d line / %d (proposed) cell / %d asset"
             % (c["enterprise"], c["site"], c["area"], c["line"], c["cell"], c["asset"]))
    L.append("- signals: %d (live + metadata) ; relationships: %d" % (c["signal"], c["relationships"]))
    L.append("- suggestions: %d total, %d auto-approved (must be 0), %d need review"
             % (len(suggestions), len(auto_approved), len(needs_review)))
    L.append("- **no fact without evidence:** %s"
             % ("OK (0 violations)" if not violations else "FAIL (%d)" % len(violations)))
    L.append("")

    L.append("## Entity UNS draft (enterprise -> asset)")
    L.append("| level | uns_path | name | confidence | status |")
    L.append("|---|---|---|---|---|")
    for lvl in ("enterprise", "site", "area", "line", "cell", "asset"):
        for n in model.by_level(lvl):
            L.append("| %s | `%s` | %s | %s | %s |"
                     % (lvl, n.uns_path, n.name, n.suggestion.confidence, n.suggestion.status))
    L.append("")

    L.append("## Live signal UNS draft (by archetype)")
    for arch in uns_draft.LIVE_ARCHETYPES:
        rows = [n for n in sigs if n.archetype == arch]
        if not rows:
            continue
        L.append("### %s (%d)" % (arch, len(rows)))
        for n in rows:
            L.append("- `%s`  (%s, %s)  unit=%s" % (n.uns_path, n.suggestion.confidence,
                                                    n.suggestion.status, n.unit or "-"))
    meta = [n for n in sigs if n.archetype == "static_metadata"]
    unkn = [n for n in sigs if n.archetype == "unknown"]
    L.append("")
    L.append("- static_metadata signals (excluded from UNS draft): %d" % len(meta))
    L.append("- unknown signals (needs_review): %d" % len(unkn))
    L.append("")

    L.append("## Relationships")
    contains = [r for r in model.relationships if r.rel_type == "contains"]
    feeds = [r for r in model.relationships if r.rel_type == "feeds"]
    L.append("- `contains` (structural, high): %d" % len(contains))
    L.append("- `feeds` (inferred upstream->downstream, low/needs_review): %d" % len(feeds))
    for r in feeds:
        L.append("  - `%s` -> `%s`  (%s, %s)"
                 % (r.source_path, r.target_path, r.suggestion.confidence, r.suggestion.status))
    L.append("")

    L.append("## Needs review (uncertain -- not presented as fact)")
    for s in needs_review:
        L.append("- [%s] %s" % (s.confidence, s.statement))
    L.append("")
    L.append("_Every row above is a SUGGESTION carrying source evidence + confidence + the human "
             "approval it needs. Nothing here is an asserted fact; a Hub reviewer accepts, rejects, "
             "or sends each to review._")
    return "\n".join(L)

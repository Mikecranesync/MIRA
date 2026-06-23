"""The Ask-MIRA answer card — the plain-language view a maintenance person reads and trusts.

The Phase 3 report shows the full auditable receipts (UNS paths and all). The answer CARD is the
human-facing checkpoint: can a technician understand and trust the answer with NO one explaining it?
It renders the same Phase 3 Explanation into nine plain sections — most likely cause, confidence, why,
evidence for, evidence against, manuals/procedures, similar history, technician checks, and what needs
human review. Friendly tag names; no jargon wall.
"""
from __future__ import annotations

import re

# The nine required sections (the gate checks all are present).
REQUIRED_SECTIONS = (
    "Most likely cause", "Confidence", "Why MIRA thinks that", "Evidence FOR", "Evidence AGAINST",
    "Manuals & procedures", "Similar history", "Technician checks", "What needs human review",
)


def _humanize(dotted: str) -> str:
    """Turn an Ignition UDT signal name into a plain label a technician recognises."""
    parts = dotted.split(".")
    low = [p.lower() for p in parts]
    if "photoeye" in low:
        return "Photoeye blocked"
    if low and low[0] == "blocked":
        return "Blocked state"
    if low and low[0] == "starved":
        return "Starved state"
    if low and low[0] == "productionrun" and "running" in low:
        return "Running"
    if low and low[0] == "counts":
        return "%s count" % (parts[1].capitalize() if len(parts) > 1 else "Outfeed")
    if low and low[0] == "state":
        return "State duration" if "duration" in low else "Machine state"
    if low and low[0] == "drive" and "motorcurrent" in low:
        return "Motor current"
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", parts[0]) if parts else dotted


def _tag_line(graph, asset_name: str, citation) -> str:
    node = graph.nodes.get(citation.ref) if graph else None
    name = (node.attrs or {}).get("name") if node else None
    friendly = _humanize(name) if name else citation.ref.split(".")[-1]
    state = citation.statement.split(" = ", 1)[1] if " = " in citation.statement else citation.statement
    return "%s — %s: %s" % (asset_name, friendly, state)


def render_card(explanation, graph=None) -> str:
    L = []
    L.append("=" * 60)
    L.append("  ASK MIRA — ANSWER CARD")
    L.append("=" * 60)
    L.append("Question: Why is the line %s?" % explanation.symptom.replace("_", " "))
    L.append("")

    if not explanation.hypotheses:
        L.append("Most likely cause: (none could be determined from the available evidence)")
        return "\n".join(L)

    top = explanation.hypotheses[0]
    L.append("Most likely cause:  %s — on %s" % (top.title, top.asset_name))
    note = "  (lowered by contradicting evidence)" if top.contradicted else ""
    L.append("Confidence:         %s%s" % (top.confidence.upper(), note))
    L.append("")

    L.append("Why MIRA thinks that:")
    for step in top.causal_chain:
        L.append("  - %s" % step)
    L.append("")

    L.append("Evidence FOR:")
    for c in top.tag_evidence:
        L.append("  - %s" % _tag_line(graph, top.asset_name, c))
    for c in top.asset_evidence:
        L.append("  - %s" % c.statement)
    L.append("")

    L.append("Evidence AGAINST:")
    if top.contradicting_evidence:
        for c in top.contradicting_evidence:
            L.append("  - %s" % _tag_line(graph, top.asset_name, c))
    else:
        L.append("  - None found — no current reading argues against this.")
    L.append("")

    L.append("Manuals & procedures:")
    for c in top.manual_evidence:
        L.append("  - %s" % c.statement)
    for p in top.procedures:
        L.append("  - Procedure: %s" % p["title"])
    L.append("")

    L.append("Similar history:")
    hs = top.history_summary or {}
    if hs.get("occurrences"):
        L.append("  - Seen %s time(s) before; typically ~%s min; last fixed by: %s."
                 % (hs.get("occurrences"), hs.get("avg_duration_min"), hs.get("last_corrective_action")))
    else:
        L.append("  - No prior history recorded for this fault.")
    L.append("")

    L.append("Technician checks:")
    for chk in top.recommended_checks:
        L.append("  - %s" % chk)
    L.append("")

    L.append("What needs human review:")
    L.append("  - Confirm the cause on the floor — this is MIRA's most likely hypothesis (%s "
             "confidence), not a confirmed fact." % top.confidence)
    L.append("  - The '%s' on %s is an inferred component (not in the tag export) — confirm it exists."
             % (top.component_type, top.asset_name))
    if top.contradicting_evidence:
        L.append("  - Contradicting evidence was found (see Evidence AGAINST) — resolve it before acting.")
    if len(explanation.hypotheses) > 1:
        L.append("  - Other possibilities were considered (e.g. %s) — rule them out with the checks above."
                 % explanation.hypotheses[1].title)
    L.append("")
    L.append("-" * 60)
    L.append("MIRA's best hypothesis from the factory's own tags + documentation. Confirm before acting.")
    return "\n".join(L)

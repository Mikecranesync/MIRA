"""Render an Explanation as the auditable Ask-MIRA answer — every claim shows its receipts."""
from __future__ import annotations


def render_report(exp) -> str:
    L = []
    L.append("# Ask MIRA — %s" % exp.headline)
    L.append("")
    L.append("_line: `%s` · symptom: `%s`_" % (exp.line_uns, exp.symptom))
    L.append("")
    if not exp.hypotheses:
        L.append("No candidate cause could be ranked from the available evidence.")
        return "\n".join(L)

    for h in exp.hypotheses:
        marker = "Most likely cause" if h.rank == 1 else "Also possible"
        L.append("## %d. %s: %s" % (h.rank, marker, h.title))
        L.append("**Confidence: %s**%s" % (h.confidence.capitalize(),
                                           " _(reduced by contradicting evidence)_" if h.contradicted else ""))
        L.append("- **Where:** `%s` (component: %s)" % (h.asset_uns, h.component_type))
        L.append("")
        L.append("**Why (chain of effects):**")
        for step in h.causal_chain:
            L.append("- %s" % step)
        L.append("")
        L.append("**Evidence:**")
        L.append("- _Tag Evidence:_")
        for c in h.tag_evidence:
            L.append("    - %s" % c.render())
        L.append("- _Asset Evidence:_")
        for c in h.asset_evidence:
            L.append("    - %s" % c.render())
        L.append("- _Documentation Evidence:_")
        for c in h.manual_evidence:
            L.append("    - %s" % c.render())
        if h.historical_evidence:
            L.append("- _Historical Evidence:_")
            L.append("    - %s" % h.historical_evidence.render())
        if h.contradicting_evidence:
            L.append("- _Evidence AGAINST:_")
            for c in h.contradicting_evidence:
                L.append("    - %s" % c.render())
        L.append("")
        L.append("**Recommended checks:**")
        for chk in h.recommended_checks:
            L.append("- %s" % chk)
        if h.procedures:
            L.append("")
            L.append("**Reference procedures:**")
            for p in h.procedures:
                L.append("- %s (`%s`)" % (p["title"], p["id"]))
        L.append("")

    L.append("_Every claim above shows its receipts: each line traces to a tag, asset edge, manual "
             "page, or historical event in the evidence graph. Ranked hypotheses, not asserted facts._")
    return "\n".join(L)

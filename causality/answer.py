"""Render an Explanation as the Ask-MIRA answer a technician would read on the HMI."""
from __future__ import annotations


def render_explanation(exp) -> str:
    L = []
    L.append("# Ask MIRA — %s" % exp.headline)
    L.append("")
    L.append("_line: `%s` · symptom: `%s`_" % (exp.line_uns, exp.symptom))
    L.append("")
    if not exp.ranked_causes:
        L.append("No candidate cause could be ranked from the available evidence.")
        return "\n".join(L)

    for c in exp.ranked_causes:
        marker = "Most likely" if c.rank == 1 else "Also possible"
        L.append("## %d. %s — %s (%s confidence)" % (c.rank, marker, c.title, c.confidence))
        L.append("- **Where:** `%s` (component: %s)" % (c.asset_uns, c.component_type))
        L.append("- **Why (chain of effects):**")
        for step in c.causal_chain:
            L.append("    - %s" % step)
        L.append("- **Supporting tags (%d):**" % len(c.supporting_tags))
        for t in c.supporting_tags:
            L.append("    - `%s`" % t)
        if c.manual_citations:
            L.append("- **Related manual pages:**")
            for m in c.manual_citations:
                L.append("    - %s, p.%s — %s (\"%s\")"
                         % (m.get("doc", "?"), m.get("page", "?"), m.get("section", ""), m.get("snippet", "")))
        if c.technician_checks:
            L.append("- **Technician checks I would perform:**")
            for chk in c.technician_checks:
                L.append("    - %s" % chk)
        L.append("")

    L.append("_These are ranked hypotheses grounded in the factory's own tags + documentation — not "
             "asserted facts. Confirm on the floor; promote the confirmed cause for the work order._")
    return "\n".join(L)

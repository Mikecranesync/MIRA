"""Contextualization Scorecard — how much does this project KNOW about its machine, and can MIRA
reason about it?

The Hub's L0-L6 health score measures tenant-wide namespace *buildout* (sites/lines/assets/proposals).
This is the complementary, per-project *answerability* score: it grades the knowledge dimensions a
grounded diagnostic answer needs (identity, signals, types, descriptions, faults, units/ranges,
fault cause->next-check, placement) and lists the highest-value gaps. Pure + deterministic; the result
ships in the export bundle so downstream MIRA knows what it's standing on.
"""

from __future__ import annotations

GRADES = [
    (85, "Answer-ready", "Enough context for grounded fault/cause/next-check answers."),
    (
        65,
        "Diagnosable",
        "Faults + descriptions present; add units/ranges + cause mapping to close the loop.",
    ),
    (45, "Described", "Tags have meaning (types/roles/comments); not yet diagnostic."),
    (20, "Inventory", "Tags captured, little meaning attached."),
    (0, "Skeleton", "Bare tag list — needs descriptions, docs, and a machine model."),
]


def _frac(n: int, d: int) -> float:
    return (n / d) if d else 0.0


def compute_scorecard(extractions: list[dict], sources: list[dict]) -> dict:
    """extractions: store rows (tagName/roles/unsPathProposed/evidenceJson/confidence/status).
    sources: store source rows (sourceType/...). Returns a scorecard dict."""
    tags = [e for e in extractions if "controller" not in (e.get("roles") or [])]
    n = len(tags)
    ev = [(e.get("evidenceJson") or {}) for e in tags]

    has_controller = any("controller" in (e.get("roles") or []) for e in extractions)
    with_type = sum(1 for x in ev if x.get("data_type"))
    with_addr = sum(1 for x in ev if x.get("modbus_address"))
    with_desc = sum(1 for x in ev if x.get("comment") or x.get("description"))
    with_role = sum(1 for e in tags if e.get("roles"))
    has_terminal = any(x.get("terminal") for x in ev)
    has_docs = any((s.get("sourceType") == "manual") for s in sources) or any(
        x.get("source") == "document" for x in ev
    )
    has_faults = any(
        ("fault_code" in (e.get("roles") or []) or "fault" in (e.get("roles") or []))
        for e in extractions
    )
    has_units = any(x.get("units") or x.get("range") or x.get("setpoint") for x in ev)
    has_fault_semantics = any(x.get("cause") or x.get("next_check") for x in ev)
    with_uns = sum(1 for e in tags if e.get("unsPathProposed"))
    accepted = sum(1 for e in extractions if e.get("status") == "accepted")

    # (key, label, weight, coverage 0..1, "what to add" when low, tier)
    # tier 0 = foundational (must come first), 1 = meaning, 2 = advanced/diagnostic.
    dims = [
        (
            "signals",
            "Signals captured",
            1.0,
            1.0 if n else 0.0,
            "Upload MbSrvConf.xml / LogicalValues.csv to capture the tag list.",
            0,
        ),
        (
            "identity",
            "Controller identity",
            1.0,
            1.0 if has_controller else 0.0,
            "Add the .st/.stf source or DevicePref.xml so the controller model + IP are captured.",
            1,
        ),
        (
            "types",
            "Data types",
            1.0,
            _frac(with_type, n),
            "Include MbSrvConf.xml or .iecst declarations so each tag has a data type.",
            1,
        ),
        (
            "addressing",
            "Modbus / I-O addressing",
            1.0,
            _frac(with_addr, n),
            "Add MbSrvConf.xml / .ccwmod so signals carry Modbus addresses.",
            1,
        ),
        (
            "descriptions",
            "Descriptions / comments",
            1.5,
            _frac(with_desc, n),
            "Add the .st/.stf/.iecst sources (inline comments) — the .accdb symbol descriptions if exportable.",
            1,
        ),
        (
            "roles",
            "Role classification",
            1.0,
            _frac(with_role, n),
            "Review tags so motor/fault/sensor/safety roles are confirmed.",
            1,
        ),
        (
            "io_mapping",
            "Physical I-O mapping",
            1.0,
            1.0 if has_terminal else 0.0,
            "Add ST comments mapping terminals to signals (I-02 = e_stop_active).",
            1,
        ),
        (
            "documents",
            "Equipment docs",
            1.5,
            1.0 if has_docs else 0.0,
            "Upload the machine/drive manual (Documents tab) for cited answers.",
            1,
        ),
        (
            "faults",
            "Fault catalog",
            1.5,
            1.0 if has_faults else 0.0,
            "Upload the manual so fault codes are extracted, or confirm fault-role tags.",
            1,
        ),
        (
            "approved",
            "Human-approved",
            1.0,
            _frac(accepted, len(extractions)),
            "Accept the correct proposals so they are trusted, not just suggested.",
            1,
        ),
        (
            "units_ranges",
            "Units / ranges / setpoints",
            2.0,
            1.0 if has_units else 0.0,
            "Capture engineering units + normal ranges — without them no value can be judged abnormal.",
            2,
        ),
        (
            "fault_semantics",
            "Fault cause -> next-check",
            2.0,
            1.0 if has_fault_semantics else 0.0,
            "Map each fault to a likely cause + the next thing to check (the core of a useful answer).",
            2,
        ),
        (
            "placement",
            "UNS placement",
            1.5,
            _frac(with_uns, n),
            "Assign each accepted signal a UNS path (site/area/line/asset/signal).",
            2,
        ),
    ]

    total_w = sum(d[2] for d in dims)
    score = round(sum(d[2] * d[3] for d in dims) / total_w * 100) if total_w else 0
    grade, blurb = next((g, b) for thr, g, b in GRADES if score >= thr)

    dimensions = [
        {
            "key": k,
            "label": lbl,
            "weight": w,
            "coverage": round(cov, 2),
            "tier": tier,
            "needed": None if cov >= 0.99 else need,
        }
        for (k, lbl, w, cov, need, tier) in dims
    ]
    # Top gaps: foundational first (tier), then highest-weight, then lowest coverage — so guidance
    # progresses (capture signals → attach meaning → add units/fault-cause), not "add units" to an
    # empty project.
    gaps = sorted([d for d in dims if d[3] < 0.75], key=lambda d: (d[5], -d[2], d[3]))
    top_gaps = [{"label": d[1], "needed": d[4], "coverage": round(d[3], 2)} for d in gaps[:5]]

    return {
        "schema": "mira-contextualizer/scorecard@1",
        "score": score,
        "grade": grade,
        "summary": blurb,
        "counts": {"signals": n, "accepted": accepted, "sources": len(sources)},
        "dimensions": dimensions,
        "topGaps": top_gaps,
    }

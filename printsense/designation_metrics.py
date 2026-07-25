"""Deterministic wire/conductor designation accuracy — exact characters, honest absence.

Why this module exists. The repo already grades wire tags
(``grader.grade()["wire"]``), but that grade only runs when a frozen rubric
supplies ground truth; without one ``grade_case`` emitted ``metric_results: {}``.
A downstream summary then invented its own counter keyed on a field the schema
does not define (``conductor["wire_number"]``), so it read that empty result as
"0 designation errors" — reporting *nothing was measured* as *nothing was wrong*.
On a 17-sheet acceptance corpus that hid 16 of 16 PLC I/O wire numbers each
missing a character (`P9DI900-0` extracted as `P9D900-0`).

Two rules follow:

1. **Absence is never zero.** Every result carries ``measured``. When there is no
   ground truth the result is an explicit ``not_measured`` state with a reason —
   there is no code path that returns a zero error count without a comparison.
2. **Exact characters.** Comparison normalizes case and whitespace ONLY (via
   :func:`grader._norm`). Homoglyph pairs — ``I``/``1``, ``O``/``0``, ``S``/``5``,
   ``B``/``8``, ``Z``/``2`` — are the error class being measured and must never be
   collapsed. ``P9D900-0`` and ``P9DI900-0`` are different designations.

Mismatch pairing: a missing expected value and an unexpected observed value that
differ by a single character edit are reported together as one ``mismatch`` with
both sides, which is what makes the defect legible ("expected `P9DI900-0`,
observed `P9D900-0`") rather than two unrelated list entries.
"""

from __future__ import annotations

from printsense import grader

#: Sections whose tags are conductor/wire designations.
WIRE_SECTIONS = ("conductors", "cables")

#: Homoglyph pairs that must NEVER be normalized away — the measured error class.
HOMOGLYPH_PAIRS = (("I", "1"), ("O", "0"), ("S", "5"), ("B", "8"), ("Z", "2"))


def _edit_distance_at_most_1(a: str, b: str) -> bool:
    """True when ``a`` becomes ``b`` with one substitution, insertion or deletion."""
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long = (a, b) if la < lb else (b, a)
    i = j = 0
    skipped = False
    while i < len(short) and j < len(long):
        if short[i] != long[j]:
            if skipped:
                return False
            skipped = True
            j += 1
            continue
        i += 1
        j += 1
    return True


def observed_designations(graph: dict) -> list[str]:
    """Every conductor/cable designation the graph asserts, normalized, in order.

    ``UNREADABLE`` is an honest refusal, not a designation — it is excluded here
    and counted separately by :func:`measure`.
    """
    out: list[str] = []
    for section in WIRE_SECTIONS:
        for e in graph.get(section) or []:
            if not isinstance(e, dict):
                continue
            tag = grader._norm(e.get("tag", ""))
            if tag and tag != "UNREADABLE":
                out.append(tag)
    return out


def count_unreadable(graph: dict) -> int:
    """Conductor/cable entries the model explicitly declined to read."""
    n = 0
    for section in WIRE_SECTIONS:
        for e in graph.get(section) or []:
            if isinstance(e, dict) and grader._norm(e.get("tag", "")) == "UNREADABLE":
                n += 1
    return n


def not_measured(reason: str, **extra) -> dict:
    """The explicit no-ground-truth state. Never a zero error count."""
    return {"measured": False, "reason": reason, "status": "not_measured", **extra}


def measure(graph: object, rubric: dict | None) -> dict:
    """Compare asserted wire designations against a rubric's expected set.

    Returns ``{"measured": True, "expected", "exact_matches", "mismatches",
    "missing", "extra", "unreadable", "exact_match_rate"}`` when ground truth is
    available, otherwise an explicit :func:`not_measured` result. It NEVER
    returns a zero mismatch count for an uncompared graph.
    """
    try:
        g = grader._as_dict(graph)
    except TypeError as exc:
        return not_measured("unsupported_graph_type", detail=str(exc))

    if not isinstance(g, dict):
        return not_measured("unsupported_graph_type", detail=type(g).__name__)

    observed = observed_designations(g)
    unreadable = count_unreadable(g)

    if not rubric:
        return not_measured("no_rubric", observed_count=len(observed), unreadable=unreadable)
    if not isinstance(rubric, dict):
        return not_measured("unsupported_rubric_type", detail=type(rubric).__name__)

    spec = ((rubric.get("categories") or {}).get("wire")) or {}
    if "expected" not in spec:
        return not_measured(
            "no_expected_wire_designations",
            observed_count=len(observed),
            unreadable=unreadable,
        )

    expected = [grader._norm(t) for t in spec.get("expected") or []]
    observed_set, expected_set = set(observed), set(expected)

    exact = sorted(expected_set & observed_set)
    missing = sorted(expected_set - observed_set)
    extra = sorted(observed_set - expected_set)

    # Pair a missing expected value with a near-miss observation so the failure
    # reads as one mismatch with both sides, not two disconnected entries.
    mismatches: list[dict] = []
    for want in list(missing):
        for got in list(extra):
            if _edit_distance_at_most_1(want, got):
                mismatches.append({"expected": want, "observed": got})
                missing.remove(want)
                extra.remove(got)
                break

    return {
        "measured": True,
        "status": "measured",
        "expected": len(expected),
        "exact_matches": len(exact),
        "mismatches": mismatches,
        "missing": missing,
        "extra": extra,
        "unreadable": unreadable,
        "exact_match_rate": round(len(exact) / len(expected), 3) if expected else None,
    }


def summarize(results: list[dict]) -> dict:
    """Roll per-case :func:`measure` results into a corpus total.

    Cases that were not measured are counted in ``not_measured`` and excluded
    from the totals — they are never folded in as zero errors.
    """
    measured = [r for r in results if r.get("measured")]
    unmeasured = [r for r in results if not r.get("measured")]
    total_expected = sum(r["expected"] for r in measured)
    total_exact = sum(r["exact_matches"] for r in measured)
    return {
        "cases": len(results),
        "cases_measured": len(measured),
        "cases_not_measured": len(unmeasured),
        "not_measured_reasons": sorted({r.get("reason", "unknown") for r in unmeasured}),
        "expected": total_expected,
        "exact_matches": total_exact,
        "mismatches": sum(len(r["mismatches"]) for r in measured),
        "missing": sum(len(r["missing"]) for r in measured),
        "extra": sum(len(r["extra"]) for r in measured),
        "exact_match_rate": (round(total_exact / total_expected, 3) if total_expected else None),
    }

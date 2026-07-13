"""Deterministic PrintSense grader — turns "A" into a number (roadmap Phase 1).

NO LLM, NO network. Scores a Claude-produced ``PrintSynthGraph`` (or its JSON)
against a per-case **rubric** (the grading ground truth) on the 100-point scale
defined in ``printsense/PATH_TO_A.md``:

    package id 10 · structure 10 · device/terminal tags 20 · wire/cable 15 ·
    cross-ref/power/PE 15 · grounding+honesty 30
    (honesty = 20 − 5×confident_misreads + 10×unresolved_recall; trust violation ⇒ 0)

    A = overall ≥ 90 AND confident_misreads == 0 AND package id = 10/10 AND
        device-tag F1 ≥ 0.85 AND wire-tag F1 ≥ 0.85 AND zero trust violations.
    A single confident misread caps the grade at C, no matter the total.

Matching discipline (the whole point of a deterministic grader): tags are
normalized (case/space) but **digits are never fuzzy-collapsed** — digit drift
(``15.7`` → ``15.5``, ``-W5497`` → ``-WK902``) *is* the error we are measuring, so
a near-miss must not score as a hit. A **confident misread** is a known-wrong tag
present in the response's structured tag/connects pool; the interpreter's
confidence gate keeps low-confidence guesses OUT of that pool (it rewrites them to
``UNREADABLE``), so a misread here means the model asserted a wrong reading with
structural confidence.

The rubric JSON shape (see ``benchmarks/<case>/rubric.json``):

    {
      "case": "...",
      "package": {"drawing_no": "...", "cabinet": "...", "sheet": "..."},
      "categories": {
        "device": {"expected": [...], "known_misreads": [...]},
        "wire":   {"expected": [...], "known_misreads": [...]},
        "xref":   {"expected": [...], "known_misreads": [...]}
      },
      "structure": [{"desc": "...", "any_of": ["...", "..."]}, ...],
      "should_be_unresolved": ["...", ...]
    }
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Rubric weights (must sum to 100).
W_PACKAGE = 10
W_STRUCTURE = 10
W_DEVICE = 20
W_WIRE = 15
W_XREF = 15
W_HONESTY = 30

# The A-grade gate thresholds.
A_OVERALL = 90
A_TAG_F1 = 0.85

_CONFIDENT_TRUST = {"proposed", "machine_verified", "human_verified"}
# The machine must NEVER claim `human_verified` (that is a technician sign-off, per
# the models.py TrustState doctrine + roadmap Phase 3 "Never write human_verified").
# `machine_verified` is a LEGITIMATE machine state earned by Phase-3 independent
# agreement, so it is NOT a violation — flagging it would wrongly tank a verified
# graph. A fresh full-page pass is all `proposed`, so this does not change its grade.
_VERIFIED_TRUST = {"human_verified"}
_ENTITY_SECTIONS = (
    "devices",
    "terminals",
    "conductors",
    "cables",
    "contacts",
    "power_domains",
    "pe_bonds",
    "off_page_references",
    "plc_io_channels",
    "network_links",
)


def _norm(tag: object) -> str:
    """Normalize a designation for comparison — upper-case, collapse whitespace.

    Digits, dots, slashes, colons, and hyphens are preserved: digit drift is the
    error we grade, so we must NOT canonicalize it away.
    """
    return re.sub(r"\s+", "", str(tag).strip().upper())


def _as_dict(graph: object) -> dict:
    """Accept a PrintSynthGraph, a dict, or a JSON string; return a plain dict."""
    if hasattr(graph, "model_dump"):
        return graph.model_dump()
    if isinstance(graph, str):
        return json.loads(graph)
    if isinstance(graph, dict):
        return graph
    raise TypeError(f"cannot grade a {type(graph).__name__}")


def _structured_tag_pool(g: dict) -> set[str]:
    """Every normalized tag the response ASSERTS structurally — entity ``tag`` +
    ``connects`` targets + package identity + functional-path steps. Deliberately
    excludes free-text ``evidence``/``detail`` (where a demoted guess is parked), so
    a confidence-gated ``UNREADABLE`` tag does not leak back in as a misread."""
    pool: set[str] = set()
    for section in _ENTITY_SECTIONS:
        for e in g.get(section) or []:
            if not isinstance(e, dict):
                continue
            pool.add(_norm(e.get("tag", "")))
            if e.get("type"):
                pool.add(_norm(e["type"]))  # module type (e.g. ITS.LWL-K-01.2) is a graded claim
            for c in e.get("connects") or []:
                pool.add(_norm(c))
    for fp in g.get("functional_paths") or []:
        for step in (fp or {}).get("sequence") or []:
            pool.add(_norm(step))
    pkg = g.get("package") or {}
    for v in pkg.values():
        if isinstance(v, (str, int)):
            pool.add(_norm(v))
    pool.discard("")
    pool.discard("UNREADABLE")
    return pool


def _package_value_tokens(g: dict) -> set[str]:
    """All normalized tokens appearing in the package block (values split on
    whitespace) — used for lenient package-identity matching."""
    tokens: set[str] = set()
    for v in (g.get("package") or {}).values():
        if isinstance(v, (str, int)):
            for tok in re.split(r"\s+", str(v).strip()):
                if tok:
                    tokens.add(_norm(tok))
    return tokens


def _package_present(expected: str, tokens: set[str]) -> bool:
    """Lenient identity match: the expected core token appears among package
    tokens, tolerating a leading ``+`` on locations and a leading ``-`` on sheets."""
    e = _norm(expected)
    variants = {e, e.lstrip("+"), e.lstrip("-"), "-" + e.lstrip("-")}
    return bool(variants & tokens)


def _prf(hits: int, expected: int, misreads: int) -> tuple[float, float, float]:
    """Precision / recall / F1 for a category. Recall = found ÷ expected; a
    confident misread of an expected slot lowers precision (found ÷ found+misreads)."""
    recall = hits / expected if expected else 1.0
    precision = hits / (hits + misreads) if (hits + misreads) else 1.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return precision, recall, f1


def _grade_category(spec: dict, pool: set[str]) -> dict:
    """Score one tag category (device / wire / xref) against the response pool."""
    expected = [_norm(t) for t in spec.get("expected", [])]
    known_misreads = [_norm(t) for t in spec.get("known_misreads", [])]
    found = [t for t in expected if t in pool]
    misreads = [t for t in known_misreads if t in pool]
    precision, recall, f1 = _prf(len(found), len(expected), len(misreads))
    return {
        "expected": len(expected),
        "found": len(found),
        "missed": [t for t in expected if t not in pool],
        "misreads": misreads,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
    }


def grade(graph: object, rubric: dict) -> dict:
    """Grade a response graph against a rubric. Returns a full result dict with
    per-category scores, ``overall``, the ``letter``, the ``is_A`` gate and the
    per-gate booleans."""
    g = _as_dict(graph)
    pool = _structured_tag_pool(g)

    # Package identity (10) — drawing_no / cabinet / sheet.
    pkg_tokens = _package_value_tokens(g)
    pkg_expected = rubric.get("package", {})
    pkg_hits = {k: _package_present(v, pkg_tokens) for k, v in pkg_expected.items()}
    package_frac = (sum(pkg_hits.values()) / len(pkg_hits)) if pkg_hits else 1.0
    package_score = W_PACKAGE * package_frac

    # Structure (10) — checklist of any_of substring probes over the whole graph.
    blob = json.dumps(g, ensure_ascii=False).lower()
    checks = rubric.get("structure", [])
    struct_pass = [c for c in checks if any(s.lower() in blob for s in c.get("any_of", []))]
    structure_frac = (len(struct_pass) / len(checks)) if checks else 1.0
    structure_score = W_STRUCTURE * structure_frac

    # Tag categories.
    cats = rubric.get("categories", {})
    device = _grade_category(cats.get("device", {}), pool)
    wire = _grade_category(cats.get("wire", {}), pool)
    xref = _grade_category(cats.get("xref", {}), pool)
    device_score = W_DEVICE * device["f1"]
    wire_score = W_WIRE * wire["f1"]
    xref_score = W_XREF * xref["f1"]

    confident_misreads = len(device["misreads"]) + len(wire["misreads"]) + len(xref["misreads"])

    # Trust violations — a fresh interpretation must be entirely `proposed`
    # (or gate-demoted to `unresolved`); it must never self-promote.
    trust_violations = 0
    for section in _ENTITY_SECTIONS:
        for e in g.get(section) or []:
            if isinstance(e, dict) and str(e.get("trust", "proposed")) in _VERIFIED_TRUST:
                trust_violations += 1

    # Grounding + honesty (30) = 20 − 5·misreads + 10·unresolved_recall, ⇒0 on a
    # trust violation. unresolved_recall = of the items that SHOULD be flagged
    # unreadable, the fraction the response placed in `unresolved` (1.0 when the
    # case has nothing genuinely unreadable — honesty isn't penalized for a clean sheet).
    unresolved_blob = " ".join(
        str((u or {}).get("item", "")) for u in (g.get("unresolved") or [])
    ).lower()
    should_unres = rubric.get("should_be_unresolved", [])
    unres_hits = [s for s in should_unres if s.lower() in unresolved_blob]
    unresolved_recall = (len(unres_hits) / len(should_unres)) if should_unres else 1.0
    honesty_score = 0.0
    if trust_violations == 0:
        honesty_score = max(0.0, min(float(W_HONESTY), 20 - 5 * confident_misreads + 10 * unresolved_recall))

    overall = package_score + structure_score + device_score + wire_score + xref_score + honesty_score

    gates = {
        "overall_ge_90": overall >= A_OVERALL,
        "zero_confident_misreads": confident_misreads == 0,
        "package_id_full": package_frac >= 0.999,
        "device_f1_ge_085": device["f1"] >= A_TAG_F1,
        "wire_f1_ge_085": wire["f1"] >= A_TAG_F1,
        "zero_trust_violations": trust_violations == 0,
    }
    is_A = all(gates.values())

    return {
        "case": rubric.get("case", "?"),
        "overall": round(overall, 1),
        "letter": _letter(overall, confident_misreads, trust_violations),
        "is_A": is_A,
        "gates": gates,
        "confident_misreads": confident_misreads,
        "trust_violations": trust_violations,
        "unresolved_recall": round(unresolved_recall, 3),
        "scores": {
            "package": round(package_score, 1),
            "structure": round(structure_score, 1),
            "device": round(device_score, 1),
            "wire": round(wire_score, 1),
            "xref": round(xref_score, 1),
            "honesty": round(honesty_score, 1),
        },
        "package_detail": pkg_hits,
        "structure_passed": [c.get("desc", "?") for c in struct_pass],
        "structure_failed": [c.get("desc", "?") for c in checks if c not in struct_pass],
        "device": device,
        "wire": wire,
        "xref": xref,
    }


def _letter(overall: float, misreads: int, trust_violations: int) -> str:
    """Letter grade. A single confident misread caps at C; a trust violation at F."""
    if trust_violations:
        return "F"
    cap = "C" if misreads else "A+"
    for letter, lo in (("A", 90), ("B", 80), ("C", 70), ("D", 60), ("F", 0)):
        if overall >= lo:
            grade_letter = letter
            break
    else:
        grade_letter = "F"
    order = ["F", "D", "C", "B", "A"]
    if cap == "C" and order.index(grade_letter) > order.index("C"):
        return "C"
    return grade_letter


def format_report(result: dict) -> str:
    """A compact, human-readable grade report for the terminal / benchmark file."""
    s = result["scores"]
    lines = [
        f"# PrintSense grade -- {result['case']}",
        f"OVERALL: {result['overall']}/100  ->  {result['letter']}"
        f"   {'[A-GRADE]' if result['is_A'] else '[not yet A]'}",
        "",
        f"  package    {s['package']:>5}/{W_PACKAGE}   {result['package_detail']}",
        f"  structure  {s['structure']:>5}/{W_STRUCTURE}   passed {len(result['structure_passed'])}"
        f"/{len(result['structure_passed']) + len(result['structure_failed'])}"
        f"  (failed: {result['structure_failed'] or 'none'})",
        f"  device     {s['device']:>5}/{W_DEVICE}   F1={result['device']['f1']} "
        f"(found {result['device']['found']}/{result['device']['expected']}, "
        f"misreads {result['device']['misreads'] or 'none'})",
        f"  wire       {s['wire']:>5}/{W_WIRE}   F1={result['wire']['f1']} "
        f"(found {result['wire']['found']}/{result['wire']['expected']}, "
        f"misreads {result['wire']['misreads'] or 'none'})",
        f"  xref/pwr   {s['xref']:>5}/{W_XREF}   F1={result['xref']['f1']} "
        f"(found {result['xref']['found']}/{result['xref']['expected']}, "
        f"misreads {result['xref']['misreads'] or 'none'})",
        f"  honesty    {s['honesty']:>5}/{W_HONESTY}   "
        f"confident_misreads={result['confident_misreads']}, "
        f"unresolved_recall={result['unresolved_recall']}, "
        f"trust_violations={result['trust_violations']}",
        "",
        "A-gate: " + "  ".join(f"{k}={'ok' if v else 'NO'}" for k, v in result["gates"].items()),
    ]
    if result["device"]["missed"] or result["wire"]["missed"] or result["xref"]["missed"]:
        missed = result["device"]["missed"] + result["wire"]["missed"] + result["xref"]["missed"]
        lines += ["", f"missed tags: {missed}"]
    return "\n".join(lines)


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Grade a PrintSynth response against a rubric.")
    ap.add_argument("response", type=Path, help="path to the response graph JSON")
    ap.add_argument("rubric", type=Path, help="path to the rubric JSON (grading ground truth)")
    ap.add_argument("--json", action="store_true", help="emit the raw result JSON")
    args = ap.parse_args(argv)

    graph = json.loads(args.response.read_text(encoding="utf-8"))
    rubric = json.loads(args.rubric.read_text(encoding="utf-8"))
    result = grade(graph, rubric)
    print(json.dumps(result, indent=2) if args.json else format_report(result))
    return 0 if result["is_A"] else 1


if __name__ == "__main__":
    sys.exit(_main())

"""Deterministic graph-integrity gates (PRD §10.4). NO LLM, NO network.

These answer the second axis a print interpretation must pass — *is the structured
graph safe to auto-import?* — independently of how fluent the prose is. A failure here
is **import-blocking** by definition: the deterministic layer owns ``import_verdict``
(PRD §8.2), and an LLM judge may explain a failure but never clear it.

Two families:

* **Structural (truth-free)** — ``duplicate_identifier`` / ``off_page_from_pagination``.
  They need no per-case ground truth, so they apply to the open internet corpus, not just
  frozen benchmarks.
* **Rubric-truth** (rubric-driven) — exact-label / path / connector-ownership AND
  ``dangling_reference`` checks, driven by the frozen ``rubric.json`` (``safety_critical``
  / ``paths`` / expected connectors). Dangling detection in particular needs the rubric's
  expected-entity context: run truth-free it false-positives on legitimate sub-terminal
  and cross-sheet references (verified against the rich multi-sheet SCU2 graph — a graph
  that models at device/block granularity and references sub-terminals like ``-A1-X3:2``),
  so it is deliberately NOT a truth-free gate.

Each gate is a pure function returning a list of ``Failure`` dicts
(``{"gate", "detail", "items"}``); :func:`run_gates` aggregates them. Normalization is
shared with :mod:`printsense.grader` (the same digit-preserving ``_norm``) so a tag
matches identically here and in the scorer — digit drift is the error we grade, never
canonicalized away.
"""

from __future__ import annotations

import re

from .grader import _ENTITY_SECTIONS, _norm, _structured_tag_pool

# A tag/reference that resolves to nothing but is a legitimate non-entity marker.
_NON_ENTITY_REFS = frozenset({"UNREADABLE"})


def check_duplicate_ids(graph: dict) -> list[dict]:
    """G4 — an entity ``tag`` may not appear on two entities without a variant scope.

    The ATV340 graph carries ``M``, ``CN9:PA/+`` and ``CN9:PC/-`` twice (the S1/S2 and S3
    variants sharing one unqualified id) — a downstream graph writer cannot tell which
    entity a connection references. The fix is a variant-qualified id (``S1S2:M`` /
    ``S3:M``), so *any* unqualified duplicate is import-blocking.
    """
    counts: dict[str, int] = {}
    for section in _ENTITY_SECTIONS:
        for e in graph.get(section) or []:
            if not isinstance(e, dict):
                continue
            tag = _norm(e.get("tag", ""))
            if not tag or tag in _NON_ENTITY_REFS:
                continue
            counts[tag] = counts.get(tag, 0) + 1
    dups = sorted(t for t, n in counts.items() if n > 1)
    if dups:
        return [{
            "gate": "duplicate_identifier",
            "detail": f"unqualified tag(s) on >=2 entities (need variant scope): {dups}",
            "items": dups,
        }]
    return []


def check_off_page_from_pagination(graph: dict) -> list[dict]:
    """G8 — a document's page count (``1/2``) is metadata, not an electrical off-page
    reference. Flag an ``off_page_references`` entry whose tag is a bare ``N/M`` pagination
    token sharing the sheet's denominator (the ATV340 invented ``2/2`` off the footer
    ``1/2``). A real off-page ref carries a continuation arrow / sheet coordinate /
    destination, not just a page number.
    """
    pkg = graph.get("package") or {}
    sheet_denom = None
    m = re.fullmatch(r"\d+/(\d+)", str(pkg.get("sheet", "")).strip())
    if m:
        sheet_denom = m.group(1)
    bad: list[str] = []
    for e in graph.get("off_page_references") or []:
        if not isinstance(e, dict):
            continue
        tag = str(e.get("tag", "")).strip()
        tm = re.fullmatch(r"\d+/(\d+)", tag)
        if tm and (sheet_denom is None or tm.group(1) == sheet_denom):
            bad.append(tag)
    if bad:
        return [{
            "gate": "off_page_from_pagination",
            "detail": f"pagination token(s) modeled as an electrical off-page ref: {bad}",
            "items": bad,
        }]
    return []


def _entity_tag_set(graph: dict) -> set[str]:
    """Every defined entity ``tag`` (normalized) — the set a reference must resolve into."""
    tags: set[str] = set()
    for section in _ENTITY_SECTIONS:
        for e in graph.get(section) or []:
            if isinstance(e, dict):
                t = _norm(e.get("tag", ""))
                if t:
                    tags.add(t)
    return tags


# --- Rubric-truth gates: they read the frozen per-case rubric and no-op when the
#     relevant field is absent, so they apply only where ground truth exists.


def check_exact_label(graph: dict, rubric: dict | None) -> list[dict]:
    """G1 — a known-misread printed label asserted in the structured pool is an exact-label
    substitution (the ATV340 graph asserted ``DO1``/``DO2`` for the printed ``DQ1``/``DQ2``).
    Digits are never fuzzy-collapsed (``_norm``), so ``15.5`` for ``15.7`` also counts."""
    if not rubric:
        return []
    pool = _structured_tag_pool(graph)
    misreads = sorted({
        m for cat in (rubric.get("categories") or {}).values()
        for m in (cat or {}).get("known_misreads") or []
        if _norm(m) in pool
    })
    if misreads:
        return [{
            "gate": "exact_label_mismatch",
            "detail": f"known-misread label(s) asserted in the graph: {misreads}",
            "items": misreads,
        }]
    return []


def check_dangling_refs(graph: dict, rubric: dict | None) -> list[dict]:
    """G3 — every ``connects[]`` / ``functional_paths[].sequence[]`` target must resolve to a
    defined entity ``tag`` (or ``UNREADABLE``). Gated on ``rubric.require_refs_resolve``:
    run truth-free it false-positives on legitimate cross-sheet / sub-terminal references
    (SCU2's ``+SCU1/5.3`` / ``-A1-X3:2``), and an import blocker must have ~zero false
    positives — so it fires only where the rubric opts in (the deferral lesson from PR2)."""
    if not rubric or not rubric.get("require_refs_resolve"):
        return []
    defined = _entity_tag_set(graph)
    dangling: set[str] = set()

    def _check(target: object) -> None:
        norm = _norm(target)
        if norm and norm not in _NON_ENTITY_REFS and norm not in defined:
            dangling.add(str(target).strip())

    for section in _ENTITY_SECTIONS:
        for e in graph.get(section) or []:
            if isinstance(e, dict):
                for c in e.get("connects") or []:
                    _check(c)
    for fp in graph.get("functional_paths") or []:
        for step in (fp or {}).get("sequence") or []:
            _check(step)
    if dangling:
        items = sorted(dangling)
        return [{
            "gate": "dangling_reference",
            "detail": f"connection/path target(s) resolve to no defined entity: {items}",
            "items": items,
        }]
    return []


def check_connector_ownership(graph: dict, rubric: dict | None) -> list[dict]:
    """G7 — a signal must land on its rightful connector. Each ``rubric.paths`` entry with a
    ``signal`` + ``forbidden_from`` flags any entity that carries the signal yet references a
    forbidden connector (the graph put ``RS422`` on ``CN3``, the encoder, not ``CN4``)."""
    if not rubric:
        return []
    failures: list[dict] = []
    for spec in rubric.get("paths") or []:
        signal, forbidden_from = spec.get("signal"), spec.get("forbidden_from")
        if not signal or not forbidden_from:
            continue
        nsignal = _norm(signal)
        found: list[str] = []
        for section in _ENTITY_SECTIONS:
            for e in graph.get(section) or []:
                if not isinstance(e, dict):
                    continue
                tag = _norm(e.get("tag", ""))
                refs = {_norm(c) for c in (e.get("connects") or [])}
                if nsignal not in tag and nsignal not in refs:
                    continue
                found += [fb for fb in forbidden_from if _norm(fb) in refs or _norm(fb) in tag]
        if found:
            items = sorted(set(found))
            failures.append({
                "gate": "incorrect_connector_ownership",
                "detail": f"{signal} referenced from forbidden connector(s) {items}; expected {spec.get('from')}",
                "items": items,
            })
    return failures


def check_functional_paths(graph: dict, rubric: dict | None) -> list[dict]:
    """G5/G6 — a functional path must not string incompatible members together or conflate
    per-variant wiring. Each ``rubric.paths`` entry with ``forbidden_members`` flags a path
    that contains one (G6 ``incompatible_functional_path`` — the graph mixed DC-bus ``PC/-``
    into the brake loop); ``member_variants`` flags a path that spans >1 variant
    (G5 ``variant_crossover`` — the graph merged S1&S2 with the dc-bus terminals)."""
    if not rubric:
        return []
    failures: list[dict] = []
    for spec in rubric.get("paths") or []:
        forbidden = spec.get("forbidden_members")
        member_variants = spec.get("member_variants")
        if not forbidden and not member_variants:
            continue
        match = [m.lower() for m in (spec.get("match") or [spec.get("name", "")]) if m]
        for fp in graph.get("functional_paths") or []:
            name = str((fp or {}).get("name", "")).lower()
            if not any(m in name for m in match):
                continue
            seq = {_norm(s) for s in (fp.get("sequence") or [])}
            if forbidden:
                present = sorted({f for f in forbidden if _norm(f) in seq})
                if present:
                    failures.append({
                        "gate": "incompatible_functional_path",
                        "detail": f"path '{fp.get('name')}' contains forbidden member(s) {present}",
                        "items": present,
                    })
            if member_variants:
                variants = sorted({v for m, v in member_variants.items() if _norm(m) in seq})
                if len(variants) > 1:
                    failures.append({
                        "gate": "variant_crossover",
                        "detail": f"path '{fp.get('name')}' spans variants {variants}",
                        "items": variants,
                    })
    return failures


def check_safety_critical(graph: dict, rubric: dict | None) -> list[dict]:
    """G12 — a safety-critical entity must be represented correctly. ``rubric.safety_critical``
    lists the safety-critical tags; the gate flags any that are absent from the structured
    pool, or any known-misread that lands on a safety-critical tag. Import-blocking AND fed
    into ``safety_critical_misreads`` so it also bars the APPROVABLE tier."""
    if not rubric:
        return []
    sc = list(rubric.get("safety_critical") or [])
    if not sc:
        return []
    pool = _structured_tag_pool(graph)
    sc_norm = {_norm(s) for s in sc}
    missing = [s for s in sc if _norm(s) not in pool]
    misread = [
        m for cat in (rubric.get("categories") or {}).values()
        for m in (cat or {}).get("known_misreads") or []
        if _norm(m) in pool and _norm(m) in sc_norm
    ]
    items = sorted(set(missing) | set(misread))
    if items:
        return [{
            "gate": "safety_critical_misread",
            "detail": f"safety-critical entity/label misrepresented or absent: {items}",
            "items": items,
        }]
    return []


# Structural gates that need no ground truth — safe on the open corpus.
_STRUCTURAL_GATES = (
    check_duplicate_ids,
    check_off_page_from_pagination,
)

# Rubric-truth gates — run only when a frozen rubric is supplied.
_RUBRIC_GATES = (
    check_exact_label,
    check_dangling_refs,
    check_connector_ownership,
    check_functional_paths,
    check_safety_critical,
)


def run_gates(graph: dict, rubric: dict | None = None) -> dict:
    """Run every applicable deterministic gate. Returns ``{"failures": [Failure, ...],
    "codes": [sorted unique gate codes], "safety_critical_misreads": [sorted items]}``.

    Structural gates always run (truth-free — safe on the open corpus). The rubric-truth
    gates run only when a frozen ``rubric`` is supplied, reading ``rubric["categories"]``
    (known-misreads), ``rubric["require_refs_resolve"]``, ``rubric["paths"]`` and
    ``rubric["safety_critical"]``. ``safety_critical_misreads`` is surfaced separately so
    :mod:`printsense.grade_case` can bar the APPROVABLE tier, not just fail import.
    """
    failures: list[dict] = []
    for gate in _STRUCTURAL_GATES:
        failures.extend(gate(graph))
    if rubric is not None:
        for gate in _RUBRIC_GATES:
            failures.extend(gate(graph, rubric))
    codes = sorted({f["gate"] for f in failures})
    safety_critical_misreads = sorted({
        i for f in failures if f["gate"] == "safety_critical_misread" for i in f["items"]
    })
    return {"failures": failures, "codes": codes, "safety_critical_misreads": safety_critical_misreads}

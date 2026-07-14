"""Deterministic graph-integrity gates (PRD §10.4). NO LLM, NO network.

These answer the second axis a print interpretation must pass — *is the structured
graph safe to auto-import?* — independently of how fluent the prose is. A failure here
is **import-blocking** by definition: the deterministic layer owns ``import_verdict``
(PRD §8.2), and an LLM judge may explain a failure but never clear it.

Two families:

* **Structural (truth-free)** — ``duplicate_identifier`` / ``off_page_from_pagination``.
  They need no per-case ground truth, so they apply to the open internet corpus, not just
  frozen benchmarks.
* **Rubric-truth** (next slice) — exact-label / path / connector-ownership AND
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

from .grader import _ENTITY_SECTIONS, _norm

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


# Structural gates that need no ground truth — safe on the open corpus.
_STRUCTURAL_GATES = (
    check_duplicate_ids,
    check_off_page_from_pagination,
)


def run_gates(
    graph: dict,
    rubric: dict | None = None,  # noqa: ARG001  wired to the rubric-truth gates in the next slice
) -> dict:
    """Run every applicable deterministic gate. Returns
    ``{"failures": [Failure, ...], "codes": [sorted unique gate codes]}``.

    ``rubric`` is accepted now for a stable signature; the rubric-truth gates (exact-label
    / paths / dangling) are wired in the next slice, reading ``rubric["safety_critical"]``,
    ``rubric["paths"]`` and the expected-entity set.
    """
    failures: list[dict] = []
    for gate in _STRUCTURAL_GATES:
        failures.extend(gate(graph))
    codes = sorted({f["gate"] for f in failures})
    return {"failures": failures, "codes": codes}

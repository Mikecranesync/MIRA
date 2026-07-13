"""Stable two-axis grade interface for PrintSense (PRD §10.2, roadmap Phase 1).

ONE canonical callable that the skill, the internet runner, local dev, the report
generator, and CI all use — so the grading *bar* lives in exactly one place. It
separates the two questions a print interpretation must answer independently
(PRD §8):

* ``quality_tier``   — how useful/accurate is the whole result?
  ``AUTO_IMPORT`` / ``APPROVABLE_WITH_FIELD_VERIFICATION`` / ``USEFUL_DRAFT`` / ``REJECT``
* ``import_verdict``  — is the *structured graph* safe to auto-import?  ``PASS`` / ``FAIL``

Good prose does not imply a trustworthy graph: a result can be ``USEFUL_DRAFT`` and
still ``import_verdict=FAIL``. The deterministic layer OWNS ``import_verdict``; an LLM
judge may explain a FAIL but must never clear it. ``bot_importable`` is true only in
the single ``AUTO_IMPORT``/``PASS`` corner — so ``bot_importable=true`` alongside a FAIL
verdict is impossible by construction (PRD §10.4 G11).

This module WRAPS the existing deterministic :func:`grader.grade` (its scoring is
unchanged). The structural graph-integrity gates — duplicate ids, dangling refs,
variant crossover, off-page-from-pagination, exact-label (PRD §10.4 G3/G4/G5/G7/G8)
— land in a later PR and *append* to ``import_blocking_failures`` behind this same
signature. Today the import verdict is driven by the two import-blockers the grader
already proves (confident misreads, trust violations), so the contract is stable and
already useful; the gate set only grows behind it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import grader

# Release-tier score thresholds (PRD §8.1).
_AUTO_IMPORT_MIN = 90
_APPROVABLE_MIN = 75
_USEFUL_DRAFT_MIN = 60

# The stable envelope shape (PRD §10.2). Exposed so callers/tests assert against it.
ENVELOPE_KEYS = (
    "score",
    "letter",
    "quality_tier",
    "import_verdict",
    "bot_importable",
    "hard_failures",
    "safety_critical_misreads",
    "confident_misreads",
    "trust_violations",
    "import_blocking_failures",
    "gate_results",
    "metric_results",
    "evidence",
)


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _tier(score: float | None, import_verdict: str, safety_critical_misreads: list) -> str | None:
    """Map score + gates to a release tier (PRD §8.1). ``None`` when ungraded.

    A failing import verdict or any safety-critical misread bars ``AUTO_IMPORT`` and
    ``APPROVABLE`` regardless of the number — a structurally unsafe graph is at best a
    ``USEFUL_DRAFT`` (still useful to read, never safe to import).
    """
    if score is None:
        return None
    safe = import_verdict == "PASS" and not safety_critical_misreads
    if score >= _AUTO_IMPORT_MIN and safe:
        return "AUTO_IMPORT"
    if score >= _APPROVABLE_MIN and safe:
        return "APPROVABLE_WITH_FIELD_VERIFICATION"
    if score >= _USEFUL_DRAFT_MIN:
        return "USEFUL_DRAFT"
    return "REJECT"


def grade_case(
    extraction_path: str | Path,
    rubric_path: str | Path | None = None,
    truth_set_path: str | Path | None = None,  # noqa: ARG001  reserved: frozen truth-set metadata (PRD §10.7); used from PR3
    artifacts_dir: str | Path | None = None,  # noqa: ARG001  reserved: evidence/provenance gates (PRD §10.4 G9); used from PR2
) -> dict:
    """Grade one case and return the stable two-axis envelope (PRD §10.2).

    ``rubric_path`` is optional: without a frozen rubric there is no ground truth, so
    ``score``/``quality_tier`` are ``None`` and only truth-free structural gates apply
    (those arrive in a later PR). With a rubric, the deterministic grader scores it.
    """
    graph = _load(extraction_path)

    result: dict = {
        "score": None,
        "letter": None,
        "quality_tier": None,
        "import_verdict": "PASS",
        "bot_importable": False,
        "hard_failures": [],
        "safety_critical_misreads": [],
        "confident_misreads": [],
        "trust_violations": 0,
        "import_blocking_failures": [],
        "gate_results": {},
        "metric_results": {},
        "evidence": [],
    }

    if rubric_path is not None:
        rubric = _load(rubric_path)
        g = grader.grade(graph, rubric)
        result["score"] = g["overall"]
        result["letter"] = g["letter"]
        result["confident_misreads"] = (
            g["device"]["misreads"] + g["wire"]["misreads"] + g["xref"]["misreads"]
        )
        result["trust_violations"] = g["trust_violations"]
        result["gate_results"] = g["gates"]
        result["metric_results"] = {
            "overall": g["overall"],
            "is_A": g["is_A"],
            "device_f1": g["device"]["f1"],
            "wire_f1": g["wire"]["f1"],
            "xref_f1": g["xref"]["f1"],
            "unresolved_recall": g["unresolved_recall"],
            "scores": g["scores"],
        }

    # Import-blocking failures the deterministic layer can already prove. PR2 appends
    # the structural gates (duplicate_identifier / dangling_reference / variant_crossover
    # / incorrect_connector_ownership / incompatible_functional_path / off_page_from_pagination)
    # to this same list.
    blocking: list[str] = []
    if result["confident_misreads"]:
        blocking.append("confident_misread")
    if result["trust_violations"]:
        blocking.append("trust_violation")
    result["import_blocking_failures"] = blocking
    result["import_verdict"] = "FAIL" if blocking else "PASS"

    result["quality_tier"] = _tier(
        result["score"], result["import_verdict"], result["safety_critical_misreads"]
    )
    # G11: the ONLY tier that may set bot_importable=true is AUTO_IMPORT under a PASS.
    result["bot_importable"] = (
        result["quality_tier"] == "AUTO_IMPORT" and result["import_verdict"] == "PASS"
    )
    return result

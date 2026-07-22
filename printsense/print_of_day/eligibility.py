"""Three-state POTD eligibility (supersedes the single ``gold_eligible`` bool).

The 2026-07-22 benchmark exposed that the old boolean conflated two very
different things: "the run executed cleanly on the runtime" and "this is a
gold-standard candidate". An *ungraded* clean run read as ``gold_eligible=true``
even though, with no ground truth, no one can call it gold. And a *repaired*
response (JSON recovered structurally, POTD directive) must never be auto-
promoted.

So eligibility is now three separated states, each strictly stronger:

* ``runtime_eligible`` — the run executed on the approved provider/model with the
  OCR floor present and produced schema-valid output. A **repaired** response can
  be runtime-eligible (it ran and validated) but is flagged degraded.
* ``gold_candidate`` — runtime-eligible AND clean: not repaired, not degraded,
  the graded page is the selected page, an independent judge ran, AND the run was
  **graded** with a passing grade. **Ungraded runs are never gold candidates.**
* ``approved_gold`` — a human explicitly approved the candidate. Never computed
  True by the pipeline; only an ``approved_by`` identity sets it.

Pure: booleans in, a classification dict out. No I/O.
"""

from __future__ import annotations

RUNTIME_ELIGIBLE = "runtime_eligible"
GOLD_CANDIDATE = "gold_candidate"
APPROVED_GOLD = "approved_gold"
INELIGIBLE = "ineligible"


def classify_eligibility(
    *,
    valid_output: bool,
    approved_pair: bool,
    ocr_ok: bool,
    page_match: bool,
    repaired: bool,
    degraded: bool,
    graded: bool,
    grade_ok: bool,
    judge_ok: bool,
    approved_by: str | None = None,
) -> dict:
    """Classify one run into the three eligibility states + the blockers that
    stop it reaching the next level up. Fail-closed: any missing signal keeps the
    run at the lower state."""
    blockers: list[str] = []

    runtime_eligible = bool(valid_output and approved_pair and ocr_ok)
    if not valid_output:
        blockers.append("no schema-valid interpretation")
    if not approved_pair:
        blockers.append("provider/model not the approved POTD pair")
    if not ocr_ok:
        blockers.append("OCR floor unavailable")

    # gold_candidate is the tightening of the old gold_eligible.
    gold_blockers: list[str] = []
    if repaired:
        gold_blockers.append("response was JSON-repaired (degraded — needs human review)")
    if degraded:
        gold_blockers.append("run is degraded")
    if not page_match:
        gold_blockers.append("graded page is not the selected page")
    if not graded:
        gold_blockers.append("run is ungraded (no ground-truth rubric)")
    if graded and not grade_ok:
        gold_blockers.append("grade did not pass")
    if not judge_ok:
        gold_blockers.append("independent judge did not run")

    gold_candidate = bool(runtime_eligible and not gold_blockers)

    approved_gold = bool(gold_candidate and approved_by)

    if approved_gold:
        state = APPROVED_GOLD
    elif gold_candidate:
        state = GOLD_CANDIDATE
    elif runtime_eligible:
        state = RUNTIME_ELIGIBLE
        blockers = gold_blockers  # what stops it from being a gold candidate
    else:
        state = INELIGIBLE

    return {
        "state": state,
        "runtime_eligible": runtime_eligible,
        "gold_candidate": gold_candidate,
        "approved_gold": approved_gold,
        "approved_by": approved_by or None,
        "blockers": blockers,
    }

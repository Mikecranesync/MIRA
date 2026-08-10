"""Technician Reliability Harness v2 — turn a bad answer into a diagnosed defect.

v1 (the surrounding `campaign/` package) answers **"did this turn pass?"**. It is
good at that: deterministic gates, multi-seed consistency, an offline lab, an
issue filer. What it cannot answer is **"which layer broke, and what do I fix?"**
— so every red cell still costs a manual investigation, and this arc's record is
that those investigations repeatedly blamed the wrong layer:

  * #3165 blamed the generator for inventing `P0594`. The generator was
    downstream; RETRIEVAL never surfaced the fault-clear procedure.
  * #3156/#3160/#3165 were declared one root cause. Two of them are — the third
    (GS10) is an INGEST/tagging gap no retrieval change can touch.
  * The spec's own option A blamed grounding, and measured 1 TP / 2 FP because
    a retrieval-grounded guard inherits the retrieval defect.

v2 adds the diagnosis layer on top of v1, reusing its detectors rather than
replacing them:

    stages.py      grade one turn at each of 8 layers, honestly (a layer nobody
                   observed is NOT_OBSERVED, never PASS)
    oracles.py     expected-evidence oracles — does the answer EXIST in the
                   corpus, and if so at what retrieval rank
    classify.py    the first FAILING layer in causal order is the primary class,
                   because downstream symptoms are not root causes
    synthesize.py  neighbouring technician phrasings anchored to fixed evidence
    mutations.py   prove a protection has teeth by breaking it on purpose
    pipeline.py    a live failure -> fixture + neighbours + class + defect report
    report.py      the campaign report the directive specifies

Design rules inherited from the arc, and they are load-bearing:

1. **A pass is not a fix, and a green cell can hide a defect.** Stage grades are
   emitted for passing turns too, so a masked defect is visible.
2. **NOT_OBSERVED is not PASS.** Old ledgers carry text only; a grader that reads
   missing telemetry as success manufactures confidence. `TurnEvidence.observed()`
   is the discriminator.
3. **Every detector false-positives on first contact with real data.** So every
   stage grade carries the evidence that produced it, and the classifier explains
   itself in English rather than emitting a bare label.
"""

from __future__ import annotations

from .stages import (  # noqa: F401
    INCONCLUSIVE,
    NOT_OBSERVED,
    PASS,
    FAIL,
    Stage,
    StageGrade,
    TurnDiagnosis,
    grade_turn,
)

__all__ = [
    "Stage",
    "StageGrade",
    "TurnDiagnosis",
    "grade_turn",
    "PASS",
    "FAIL",
    "INCONCLUSIVE",
    "NOT_OBSERVED",
]

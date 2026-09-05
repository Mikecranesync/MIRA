"""MIRA Answer Radar — real-world maintenance-question benchmark.

Turns fresh public industrial-maintenance questions into a daily measurement of how many
MIRA answers correctly, and converts failures into regression cases and knowledge gaps.

The north-star metric is **VCAD — Verified Correct Answers per Day**.

Scope of this package
---------------------
PRS §27 Step 1 + Step 2 only: the benchmark itself plus the six seed questions. Platform
collectors (X / YouTube / RSS / Reddit) are Phase 1 and deliberately absent — the PRS is
explicit that the benchmark comes first, and a collector without a measured rubric produces
volume nobody can grade.

What this package does NOT define
---------------------------------
It reuses, and must never fork:

- `tests/eval/local_pipeline.py::LocalPipeline` — the canonical in-process MIRA runner.
- The Continuous Learning Factory contracts (ADR-0030,
  `docs/specs/continuous-learning-factory/`) for rights, judge independence, and
  leakage partitioning. `LicenseClass`, `Rights`, `IndependenceClass` and
  `document_lineage_key` below are that vocabulary, not a second one.

Per the CLF README: "Do not introduce parallel region, evidence, grading, or approval
abstractions." Answer Radar is a different corpus (public text questions rather than
rendered print pages), so it needs its own record types — but the *vocabulary* those
records are built from is CLF's.
"""

from answer_radar.schema import (
    EvaluationRecord,
    IndependenceClass,
    LicenseClass,
    QuestionRecord,
    Rights,
    SafetyClass,
)

__all__ = [
    "EvaluationRecord",
    "IndependenceClass",
    "LicenseClass",
    "QuestionRecord",
    "Rights",
    "SafetyClass",
]

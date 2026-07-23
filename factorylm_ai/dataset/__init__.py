"""Dataset v0 assembly + the Phase-3 paid-gate evidence (PR 3).

PR 1 gave the per-source governance gate; PR 2 gave the corpus adapters that feed it. PR 3
is the bridge to a training set: a :class:`DatasetRecord` pairs one training example
(chat-format ``messages`` + human ``approved_by`` + interaction type) with its source's PR-1
governance envelope (a :class:`~factorylm_ai.adapters.source_candidate.SourceCandidate`).
:func:`assemble_dataset_v0` partitions records into the training-eligible dataset v0 (with a
reproducible content-addressed manifest) and a typed reject list; :func:`evaluate_paid_gate`
reports whether that dataset clears the Phase-3 thresholds.

**Evidence only.** Nothing here spends, calls the network, writes JSONL to Together, or
launches a job. A paid-gate PASS is *necessary but not sufficient* — the metered fine-tune
run still requires Mike's explicit go (spend law).
"""

from __future__ import annotations

from .assemble import DatasetV0, RejectedRecord, assemble_dataset_v0
from .paid_gate import (
    COST_CAP_USD,
    MIN_HELD_OUT_LINEAGES,
    MIN_LINEAGES,
    MIN_RECORDS,
    MIN_SAFETY_SENSITIVE,
    MIN_VALUED_INTERACTIONS,
    GateCheck,
    ModelSupportEvidence,
    PaidGateReport,
    ReadinessEvidence,
    estimate_finetune_cost,
    evaluate_paid_gate,
)
from .record import SAFETY_SENSITIVE_TAG, VALUED_INTERACTION_TYPES, DatasetRecord

__all__ = [
    "DatasetRecord",
    "VALUED_INTERACTION_TYPES",
    "SAFETY_SENSITIVE_TAG",
    "DatasetV0",
    "RejectedRecord",
    "assemble_dataset_v0",
    "PaidGateReport",
    "GateCheck",
    "ReadinessEvidence",
    "ModelSupportEvidence",
    "evaluate_paid_gate",
    "estimate_finetune_cost",
    "MIN_RECORDS",
    "MIN_LINEAGES",
    "MIN_VALUED_INTERACTIONS",
    "MIN_HELD_OUT_LINEAGES",
    "MIN_SAFETY_SENSITIVE",
    "COST_CAP_USD",
]

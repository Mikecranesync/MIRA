"""Corpus adapters (PR 2) — lower real corpus sources into the PR-1 governance gate.

PR 1 (``factorylm_ai.governance``) defined the contract; these adapters feed it. Each
adapter takes a source-system record (a PrintSense print, a Drive Commander pack, a
SimLab/MIRA frozen benchmark) and produces a single shared :class:`SourceCandidate`,
whose ``to_eligibility_input()`` runs through ``check_training_eligibility`` and whose
``to_leakage_record()`` feeds ``find_leakage``.

The dependency points inward: adapters import ``governance``; governance never imports
an adapter. Adapters do NOT re-implement rights resolution, split assignment, the
eligibility gate, or the leakage guard — they call the governance functions. They add
exactly two things governance cannot: (1) the correct **lineage key** for each source
(never a content/pack hash), and (2) **source-specific fail-closed hardening**
(tenant/private data stays private; frozen benchmark material stays eval-only).
"""

from __future__ import annotations

from .drive_commander import drive_commander_candidate
from .mira_simlab import frozen_benchmark_candidate, simlab_candidate
from .printsense import printsense_candidate
from .source_candidate import (
    SourceCandidate,
    build_corpus_source,
    frozen_lineage_key,
)

__all__ = [
    "SourceCandidate",
    "build_corpus_source",
    "frozen_lineage_key",
    "printsense_candidate",
    "drive_commander_candidate",
    "simlab_candidate",
    "frozen_benchmark_candidate",
]

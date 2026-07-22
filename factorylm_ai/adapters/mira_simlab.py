"""PR 2C — MIRA + SimLab frozen-benchmark corpus adapter.

SimLab scenarios and frozen MIRA benchmark records are **eval-only by construction** — they
exist to measure the model, never to train it. This adapter enforces that with two
independent locks so the material can never leak into a training set:

1. ``frozen_eval=True`` — the eligibility gate rejects it as ``FROZEN_EVAL`` outright, and
2. a ``public-eval-only`` license — ``resolve_rights`` denies training regardless of flags.

Lineage keys are stable synthetic identifiers (``simlab:<scenario>``, ``mira:<ident>``) that
pass PR-1 validation, so every replay of a scenario shares one lineage (and one split) and
never forks. The synthetic origin is kept visible in ``metadata``.
"""

from __future__ import annotations

from factorylm_ai.governance.rights import LICENSE_PUBLIC_EVAL_ONLY

from .source_candidate import SourceCandidate, build_corpus_source, frozen_lineage_key


def frozen_benchmark_candidate(
    *,
    source: str,
    ident: str,
    record: dict | None = None,
) -> SourceCandidate:
    """Build a frozen, eval-only benchmark candidate for ``source`` (e.g. ``"simlab"`` or
    ``"mira"``) identified by ``ident``. Always ``frozen_eval=True`` + ``public-eval-only``;
    no combination of record fields can make it trainable."""
    record = record or {}
    lineage = frozen_lineage_key(source, ident)
    corpus_source = build_corpus_source(
        license_class=LICENSE_PUBLIC_EVAL_ONLY,
        confidentiality_class="public",
        rights_resolved=True,
        training_allowed=False,  # eval-only license denies training regardless
        evaluation_allowed=True,
        public_export_allowed=True,
    )
    metadata = {
        "synthetic": True,
        "origin": source,
        "ident": ident,
        **(record.get("metadata") or {}),
    }
    return SourceCandidate(
        source_system=source,
        record_id=str(record.get("record_id") or record.get("id") or f"{source}:{ident}"),
        document_lineage_key=lineage,
        corpus_source=corpus_source,
        gold_status=str(record.get("gold_status", "ungraded")),
        validation_passed=bool(record.get("validation_passed", False)),
        safety_status=str(record.get("safety_status", "clear")),
        provenance_present=bool(record.get("provenance", True)),
        frozen_eval=True,
        sensitive=False,
        tenant_id=None,
        confidentiality_class="public",
        evidence_id=None,
        metadata=metadata,
    )


def simlab_candidate(record: dict) -> SourceCandidate:
    """Build a frozen SimLab benchmark candidate from a scenario record.

    Requires ``scenario_id`` (the stable lineage identifier). The scenario is eval-only and
    frozen — permanent benchmark material."""
    scenario_id = record.get("scenario_id") or record.get("scenario")
    if not scenario_id:
        raise ValueError("SimLab record needs a scenario_id for its lineage key")
    return frozen_benchmark_candidate(source="simlab", ident=str(scenario_id), record=record)

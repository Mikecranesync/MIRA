"""Diagnostic cards — a derived, cited view over a pack's fault table.

Per ADR-0025 §1 ("Diagnostic cards"), a card is generated at build/query time
from the pack alone (v1) plus, via an injected seam, the
``component_templates``/KG extracted-intelligence layer. It is **not** a new
hand-authored store — ``build_cards`` derives cards fresh from ``DrivePack``
every call; nothing here writes or caches to disk/DB.

The ``TemplateReader`` protocol is the documented reuse seam for a future
``component_templates``/KG-backed reader (ADR-0025 §1, layer 2). This module
never implements or calls a real DB/network reader — the default ``None``
produces pack-only, fully-offline cards; tests exercise the seam with an
in-memory fake. See ``.claude/rules/fieldbus-readonly.md`` (Constraint 1/6:
read-only, no live DB/network here) and CONTEXT.md's ``diagnostic card`` /
``pack provenance`` glossary entries (never bare "verified").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from .schema import Citation, DrivePack

# ``Citation`` is defined in ``schema.py`` (so the pack-stored v2 cards can
# reference it without a schema→cards cycle) and re-exported here for backward
# compatibility — existing callers do ``from .cards import Citation``.
__all__ = ["Citation", "DiagnosticCard", "TemplateReader", "build_cards"]

_NO_ACTIVE_FAULT_CODE = 0


@runtime_checkable
class TemplateReader(Protocol):
    """The ``component_templates``/KG reuse seam (ADR-0025 §1, layer 2).

    A future reader backed by ``component_templates`` + ``kg_entities``
    implements this. ``build_cards`` calls it ONLY when a caller injects one
    — the default ``None`` keeps card-building pure/offline.
    """

    def causes_for(self, pack_id: str, fault_code: int) -> list[str]: ...

    def checks_for(self, pack_id: str, fault_code: int) -> list[str]: ...

    def citations_for(self, pack_id: str, fault_code: int) -> list[Citation]: ...


@dataclass(frozen=True)
class DiagnosticCard:
    """One derived, cited diagnostic view — the unit the UI shows and the
    LLM cites. See CONTEXT.md's ``diagnostic card`` glossary entry."""

    fault_or_symptom: str
    meaning: str
    likely_causes: list[str] = field(default_factory=list)
    first_checks: list[str] = field(default_factory=list)
    citations: list[Citation] = field(default_factory=list)
    confidence: str | float | None = None
    provenance_tier: str = "manual_cited"


def _pack_level_citations(pack: DrivePack) -> list[Citation]:
    """v1 citations: the pack-level provenance sources, until a
    ``template_reader`` supplies richer per-fault citations."""
    return [
        Citation(
            doc=source.get("doc", ""),
            page=source.get("page", ""),
            excerpt=source.get("excerpt", ""),
        )
        for source in pack.provenance.sources
    ]


def build_cards(
    pack: DrivePack, *, template_reader: TemplateReader | None = None
) -> list[DiagnosticCard]:
    """Derive one diagnostic card per real fault code in ``pack``.

    Excludes code ``0`` ("no active fault") — it isn't a fault. Pure/offline
    by default (``template_reader=None``): ``likely_causes``/``first_checks``
    stay empty and ``confidence`` stays ``None``, ``citations`` reflect only
    the pack-level provenance sources. When a ``template_reader`` is
    injected, its ``causes_for``/``checks_for``/``citations_for`` are called
    per fault code to enrich the card — this module never reads a live
    DB/network itself.
    """
    provenance_tier = pack.provenance.items.get("live_decode.fault_codes", "manual_cited")
    pack_citations = _pack_level_citations(pack)

    cards: list[DiagnosticCard] = []
    for code, name in pack.live_decode.fault_codes.items():
        if code == _NO_ACTIVE_FAULT_CODE:
            continue

        likely_causes: list[str] = []
        first_checks: list[str] = []
        citations = pack_citations

        if template_reader is not None:
            reader_causes = template_reader.causes_for(pack.pack_id, code)
            reader_checks = template_reader.checks_for(pack.pack_id, code)
            reader_citations = template_reader.citations_for(pack.pack_id, code)
            if reader_causes:
                likely_causes = reader_causes
            if reader_checks:
                first_checks = reader_checks
            if reader_citations:
                citations = reader_citations

        cards.append(
            DiagnosticCard(
                fault_or_symptom=f"{code} — {name}",
                meaning=name,
                likely_causes=likely_causes,
                first_checks=first_checks,
                citations=citations,
                confidence=None,
                provenance_tier=provenance_tier,
            )
        )

    return cards

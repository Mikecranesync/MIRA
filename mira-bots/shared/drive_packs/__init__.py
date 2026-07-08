"""Language-neutral drive-pack loader — pure, read-only, no fieldbus I/O.

A drive pack (co-located package data at ``packs/<pack_id>/pack.json``,
i.e. ``mira-bots/shared/drive_packs/packs/<pack_id>/pack.json``) is a
family-keyed manifest of live-decode tables, an expected operating envelope,
and ID pointers into the existing KB/KG stores. See ``packs/README.md`` for
the schema and
``docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`` for the
product decision.

Public API: ``load_pack``, ``list_packs``, ``resolve_pack`` (``loader.py``),
``resolve_pack_from_vision`` (``nameplate.py``), ``resolve_service_pack`` +
``PackResolution`` (``resolver.py`` — the surface-agnostic resolution
contract), ``build_cards`` + ``DiagnosticCard``/``Citation``/``TemplateReader``
(``cards.py``) plus the frozen dataclasses in ``schema.py``.
"""

from __future__ import annotations

from .ask import DrivePackAnswer, answer_question
from .cards import Citation, DiagnosticCard, TemplateReader, build_cards
from .loader import list_packs, load_pack, resolve_pack
from .nameplate import resolve_pack_from_vision
from .resolver import PackResolution, resolve_service_pack
from .schema import (
    DrivePack,
    Envelope,
    EnvelopeBand,
    Family,
    KeypadNavigationCard,
    Knowledge,
    LiveDecode,
    Nameplate,
    ParameterCard,
    Provenance,
    RegisterEntry,
    ValueMeaning,
)

__all__ = [
    "Citation",
    "DiagnosticCard",
    "DrivePack",
    "DrivePackAnswer",
    "Envelope",
    "EnvelopeBand",
    "Family",
    "KeypadNavigationCard",
    "Knowledge",
    "LiveDecode",
    "Nameplate",
    "PackResolution",
    "ParameterCard",
    "Provenance",
    "RegisterEntry",
    "TemplateReader",
    "ValueMeaning",
    "answer_question",
    "build_cards",
    "list_packs",
    "load_pack",
    "resolve_pack",
    "resolve_pack_from_vision",
    "resolve_service_pack",
]

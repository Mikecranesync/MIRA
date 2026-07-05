"""Language-neutral drive-pack loader — pure, read-only, no fieldbus I/O.

A drive pack (``packs/<pack_id>/pack.json``) is a family-keyed manifest of
live-decode tables, an expected operating envelope, and ID pointers into the
existing KB/KG stores. See ``packs/README.md`` for the schema and
``docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`` for the
product decision.

Public API: ``load_pack``, ``list_packs``, ``resolve_pack`` (``loader.py``)
plus the frozen dataclasses in ``schema.py``.
"""

from __future__ import annotations

from .loader import list_packs, load_pack, resolve_pack
from .schema import (
    DrivePack,
    Envelope,
    EnvelopeBand,
    Family,
    Knowledge,
    LiveDecode,
    Nameplate,
    Provenance,
    RegisterEntry,
)

__all__ = [
    "DrivePack",
    "Envelope",
    "EnvelopeBand",
    "Family",
    "Knowledge",
    "LiveDecode",
    "Nameplate",
    "Provenance",
    "RegisterEntry",
    "list_packs",
    "load_pack",
    "resolve_pack",
]

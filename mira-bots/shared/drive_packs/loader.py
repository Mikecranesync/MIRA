"""Pure, read-only loader for drive packs (``packs/<pack_id>/pack.json``).

Hard boundary (ADR-0025 + ``.claude/rules/fieldbus-readonly.md``): this module
NEVER opens a socket, NEVER touches a fieldbus, NEVER writes. Its only I/O is
reading a JSON file from the repo's ``packs/`` directory. See
``packs/README.md`` for the schema and
``docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`` for why
packs exist (family-keyed drive intelligence, data not code).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

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

_VALID_PROVENANCE = {"bench_verified", "manual_cited"}

_REQUIRED_TOP_LEVEL_KEYS = {
    "pack_id",
    "schema_version",
    "family",
    "nameplate",
    "live_decode",
    "envelope",
    "knowledge",
    "provenance",
}


def _packs_dir() -> Path:
    """Locate the repo's ``packs/`` directory relative to this module.

    Walks up from this file's location (never a hardcoded absolute path) so
    the loader works no matter where the repo is checked out.
    """
    start = Path(__file__).resolve().parent
    for parent in (start, *start.parents):
        candidate = parent / "packs"
        if candidate.is_dir():
            return candidate
    raise RuntimeError(
        "Could not locate a 'packs/' directory above mira-bots/shared/drive_packs — "
        "is the repo checked out correctly?"
    )


def _int_keyed(raw: dict[str, str]) -> dict[int, str]:
    """JSON object keys are always strings; the wire enum tables are int-keyed."""
    return {int(k): v for k, v in raw.items()}


def _band(raw: dict[str, Any] | None) -> EnvelopeBand:
    raw = raw or {}
    return EnvelopeBand(
        nominal=raw.get("nominal"),
        min=raw.get("min"),
        max=raw.get("max"),
        rated=raw.get("rated"),
        unit=raw.get("unit"),
    )


def _registers(raw: dict[str, dict[str, Any]]) -> dict[str, RegisterEntry]:
    return {
        key: RegisterEntry(
            addr=entry.get("addr"),
            unit=entry.get("unit"),
            scaling=entry.get("scaling", 1.0),
            datapoint=entry.get("datapoint", key),
        )
        for key, entry in raw.items()
    }


def _validate_provenance(items: dict[str, str], pack_id: str) -> None:
    bad = {k: v for k, v in items.items() if v not in _VALID_PROVENANCE}
    if bad:
        raise ValueError(
            f"pack '{pack_id}': invalid provenance value(s) {bad!r} — "
            f"must be one of {sorted(_VALID_PROVENANCE)}"
        )


def load_pack(pack_id: str) -> DrivePack:
    """Load and validate ``packs/<pack_id>/pack.json``.

    Raises ``FileNotFoundError`` when the pack doesn't exist, ``ValueError``
    on a structurally invalid pack (missing keys, bad JSON, an invalid
    provenance value, or a ``pack_id`` mismatch). Pure — no caching, no
    network, no DB.
    """
    path = _packs_dir() / pack_id / "pack.json"
    if not path.is_file():
        raise FileNotFoundError(f"no pack.json for pack_id={pack_id!r} (looked at {path})")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"pack '{pack_id}': invalid JSON in {path}: {exc}") from exc

    missing = _REQUIRED_TOP_LEVEL_KEYS - raw.keys()
    if missing:
        raise ValueError(f"pack '{pack_id}': missing required key(s) {sorted(missing)} in {path}")

    if raw["pack_id"] != pack_id:
        raise ValueError(
            f"pack '{pack_id}': pack.json at {path} declares "
            f"pack_id={raw['pack_id']!r}, expected {pack_id!r}"
        )

    live_decode_raw = raw["live_decode"]
    live_decode = LiveDecode(
        status_bits=_int_keyed(live_decode_raw["status_bits"]),
        cmd_word=_int_keyed(live_decode_raw["cmd_word"]),
        fault_codes=_int_keyed(live_decode_raw["fault_codes"]),
        registers=_registers(live_decode_raw.get("registers", {})),
    )

    envelope_raw = raw["envelope"]
    envelope = Envelope(
        dc_bus=_band(envelope_raw.get("dc_bus")),
        current=_band(envelope_raw.get("current")),
        frequency=_band(envelope_raw.get("frequency")),
    )

    knowledge_raw = raw["knowledge"]
    knowledge = Knowledge(
        kb_document_ids=list(knowledge_raw.get("kb_document_ids", [])),
        component_template_id=knowledge_raw.get("component_template_id"),
        kg_entity_ids=list(knowledge_raw.get("kg_entity_ids", [])),
    )

    provenance_raw = raw["provenance"]
    provenance_items = dict(provenance_raw.get("items", {}))
    _validate_provenance(provenance_items, pack_id)
    provenance = Provenance(
        items=provenance_items,
        sources=list(provenance_raw.get("sources", [])),
    )

    family_raw = raw["family"]
    family = Family(
        manufacturer=family_raw["manufacturer"],
        series=family_raw["series"],
        aliases=list(family_raw.get("aliases", [])),
    )

    nameplate = Nameplate(match_keywords=list(raw["nameplate"].get("match_keywords", [])))

    return DrivePack(
        pack_id=raw["pack_id"],
        schema_version=raw["schema_version"],
        family=family,
        nameplate=nameplate,
        live_decode=live_decode,
        envelope=envelope,
        knowledge=knowledge,
        provenance=provenance,
    )


def list_packs() -> list[str]:
    """Discover pack ids under ``packs/`` (any subdirectory with a pack.json)."""
    root = _packs_dir()
    return sorted(
        child.name for child in root.iterdir() if child.is_dir() and (child / "pack.json").is_file()
    )


def resolve_pack(text: str) -> DrivePack | None:
    """Case-insensitive match of ``text`` against known packs' keywords.

    Checks each pack's ``family.aliases`` first, then its
    ``nameplate.match_keywords`` (family-first per ADR-0025 §1a). Returns the
    first matching pack, or ``None`` when nothing matches. Pure text match —
    no vision/LLM call, no network.
    """
    if not text:
        return None
    haystack = text.lower()
    for pack_id in list_packs():
        pack = load_pack(pack_id)
        family_hit = any(alias.lower() in haystack for alias in pack.family.aliases)
        if family_hit:
            return pack
        nameplate_hit = any(kw.lower() in haystack for kw in pack.nameplate.match_keywords)
        if nameplate_hit:
            return pack
    return None

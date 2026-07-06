"""Pure, read-only loader for drive packs (``packs/<pack_id>/pack.json``).

Hard boundary (ADR-0025 + ``.claude/rules/fieldbus-readonly.md``): this module
NEVER opens a socket, NEVER touches a fieldbus, NEVER writes. Its only I/O is
reading a JSON file from the co-located ``packs/`` directory shipped as
package data alongside this module (``mira-bots/shared/drive_packs/packs/``)
— NOT a repo-root directory. See ``packs/README.md`` for the schema and
``docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`` for why
packs exist (family-keyed drive intelligence, data not code).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .schema import (
    Citation,
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

_VALID_PROVENANCE = {"bench_verified", "manual_cited"}

# schema_version generations this loader understands. v1 = live-decode + envelope
# + knowledge pointers. v2 adds the OPTIONAL `parameters` + `keypad_navigation`
# blocks (DriveSense manual-keypad phase). An unknown version is a hard error —
# never a silent best-effort parse.
_SUPPORTED_SCHEMA_VERSIONS = frozenset({1, 2})

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
    """Locate the co-located ``packs/`` directory next to this module.

    The pack JSON ships as package data inside ``drive_packs/`` (not a
    repo-root directory) precisely so it is present in every Docker image
    that copies ``mira-bots/shared/`` — a repo-root ``packs/`` walk-up broke
    the mira-pipeline image, which never COPYs anything outside
    ``mira-bots/shared/``. See ADR-0025 amendment + the Docker Build Check
    fix.
    """
    candidate = Path(__file__).resolve().parent / "packs"
    if candidate.is_dir():
        return candidate
    raise RuntimeError(
        f"Could not locate the co-located 'packs/' directory at {candidate} — "
        "is mira-bots/shared/drive_packs/packs/ present in this checkout/image?"
    )


def _int_keyed(raw: dict[str, str], *, pack_id: str, field_name: str) -> dict[int, str]:
    """JSON object keys are always strings; the wire enum tables are int-keyed.

    Raises ``ValueError`` (pack-id-scoped, actionable) on a non-numeric key —
    never a bare ``ValueError: invalid literal for int()``.
    """
    out: dict[int, str] = {}
    for key, value in raw.items():
        try:
            out[int(key)] = value
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"pack '{pack_id}': non-numeric key {key!r} in live_decode.{field_name} — "
                "wire enum tables must be int-keyed"
            ) from exc
    return out


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


def _check_provenance_tier(tier: str, *, pack_id: str, where: str) -> str:
    """Validate a single card's provenance_tier against the closed vocabulary
    (ADR-0025 axiom 2 — never bare 'verified'). Returns the tier unchanged."""
    if tier not in _VALID_PROVENANCE:
        raise ValueError(
            f"pack '{pack_id}': invalid provenance_tier {tier!r} on {where} — "
            f"must be one of {sorted(_VALID_PROVENANCE)}"
        )
    return tier


def _citation(raw: dict[str, Any] | None) -> Citation:
    """Parse one source_citation object. Missing fields default to '' — never a
    fabricated page/excerpt."""
    raw = raw or {}
    return Citation(
        doc=raw.get("doc", ""),
        page=raw.get("page", ""),
        excerpt=raw.get("excerpt", ""),
    )


def _value_meanings(raw_list: list[dict[str, Any]]) -> list[ValueMeaning]:
    return [
        ValueMeaning(value=str(vm.get("value", "")), meaning=vm.get("meaning", ""))
        for vm in raw_list
    ]


def _parameters(raw_list: list[dict[str, Any]], pack_id: str) -> list[ParameterCard]:
    """Parse the v2 ``parameters`` block into ``ParameterCard``s (v1 packs have
    none). ``drive_family`` is injected from ``pack_id`` — the JSON never repeats
    it. ``parameter_id`` is required per entry."""
    out: list[ParameterCard] = []
    for entry in raw_list:
        pid = entry.get("parameter_id")
        if not pid:
            raise ValueError(
                f"pack '{pack_id}': a parameters[] entry is missing required 'parameter_id'"
            )
        out.append(
            ParameterCard(
                drive_family=pack_id,
                parameter_id=pid,
                name=entry.get("name", ""),
                purpose=entry.get("purpose", ""),
                source_citation=_citation(entry.get("source_citation")),
                value_meanings=_value_meanings(entry.get("value_meanings", [])),
                default=entry.get("default"),
                range=entry.get("range"),
                unit=entry.get("unit"),
                related_faults=list(entry.get("related_faults", [])),
                provenance_tier=_check_provenance_tier(
                    entry.get("provenance_tier", "manual_cited"),
                    pack_id=pack_id,
                    where=f"parameter {pid!r}",
                ),
                confidence_tier=entry.get("confidence_tier"),
            )
        )
    return out


def _keypad_navigation(raw_list: list[dict[str, Any]], pack_id: str) -> list[KeypadNavigationCard]:
    """Parse the v2 ``keypad_navigation`` block into ``KeypadNavigationCard``s.

    Enforces the safety contract: ``view_only_warning`` MUST be present and
    non-empty (a keypad card that can't say "view only, don't press ENTER" is
    invalid). ``drive_family`` is injected from ``pack_id``.
    """
    out: list[KeypadNavigationCard] = []
    for entry in raw_list:
        warning = entry.get("view_only_warning", "")
        if not warning or not warning.strip():
            raise ValueError(
                f"pack '{pack_id}': keypad_navigation entry (goal={entry.get('goal')!r}) has an "
                "empty view_only_warning — the safety contract requires a non-empty view-only warning"
            )
        out.append(
            KeypadNavigationCard(
                drive_family=pack_id,
                goal=entry.get("goal", ""),
                keypad_steps=list(entry.get("keypad_steps", [])),
                view_only_warning=warning,
                source_citation=_citation(entry.get("source_citation")),
                confidence_tier=entry.get("confidence_tier", "low"),
                provenance_tier=_check_provenance_tier(
                    entry.get("provenance_tier", "manual_cited"),
                    pack_id=pack_id,
                    where=f"keypad_navigation goal={entry.get('goal')!r}",
                ),
                parameter_id=entry.get("parameter_id"),
                menu_group=entry.get("menu_group"),
                edit_warning=entry.get("edit_warning"),
            )
        )
    return out


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

    return _parse_pack(raw, pack_id, str(path))


def _parse_pack(raw: dict[str, Any], pack_id: str, path_label: str) -> DrivePack:
    """Validate + build a ``DrivePack`` from an already-parsed JSON dict.

    Split out of ``load_pack`` so the pure parse (incl. schema_version 2's
    ``parameters``/``keypad_navigation`` blocks) is unit-testable without a
    disk fixture. ``path_label`` is only used in error messages.
    """
    missing = _REQUIRED_TOP_LEVEL_KEYS - raw.keys()
    if missing:
        raise ValueError(
            f"pack '{pack_id}': missing required key(s) {sorted(missing)} in {path_label}"
        )

    if raw["pack_id"] != pack_id:
        raise ValueError(
            f"pack '{pack_id}': pack.json at {path_label} declares "
            f"pack_id={raw['pack_id']!r}, expected {pack_id!r}"
        )

    version = raw["schema_version"]
    if version not in _SUPPORTED_SCHEMA_VERSIONS:
        raise ValueError(
            f"pack '{pack_id}': unsupported schema_version {version!r} in {path_label} — "
            f"supported: {sorted(_SUPPORTED_SCHEMA_VERSIONS)}"
        )

    live_decode_raw = raw["live_decode"]
    live_decode = LiveDecode(
        status_bits=_int_keyed(
            live_decode_raw["status_bits"], pack_id=pack_id, field_name="status_bits"
        ),
        cmd_word=_int_keyed(live_decode_raw["cmd_word"], pack_id=pack_id, field_name="cmd_word"),
        fault_codes=_int_keyed(
            live_decode_raw["fault_codes"], pack_id=pack_id, field_name="fault_codes"
        ),
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

    # schema_version 2 blocks — absent in v1, so these default to empty and a v1
    # pack loads exactly as before.
    parameters = _parameters(raw.get("parameters", []), pack_id)
    keypad_navigation = _keypad_navigation(raw.get("keypad_navigation", []), pack_id)

    return DrivePack(
        pack_id=raw["pack_id"],
        schema_version=version,
        family=family,
        nameplate=nameplate,
        live_decode=live_decode,
        envelope=envelope,
        knowledge=knowledge,
        provenance=provenance,
        parameters=parameters,
        keypad_navigation=keypad_navigation,
    )


def list_packs() -> list[str]:
    """Discover pack ids under ``packs/`` (any subdirectory with a pack.json)."""
    root = _packs_dir()
    return sorted(
        child.name for child in root.iterdir() if child.is_dir() and (child / "pack.json").is_file()
    )


def resolve_pack(text: str) -> DrivePack | None:
    """Case-insensitive match of ``text`` against known packs' keywords.

    A true two-pass "family-first" match across ALL packs (ADR-0025 §1a): the
    first pass checks every pack's ``family.aliases``; only if none of them
    match does the second pass check every pack's ``nameplate.match_keywords``.
    This guarantees a family-alias match always wins over a nameplate-keyword
    match regardless of pack iteration order — a single pack-by-pack loop
    would let an earlier pack's nameplate keyword win over a later pack's
    family alias once more than one pack exists. Returns the first matching
    pack in each pass, or ``None`` when nothing matches in either pass. Pure
    text match — no vision/LLM call, no network.
    """
    if not text:
        return None
    haystack = text.lower()
    packs = [load_pack(pack_id) for pack_id in list_packs()]

    for pack in packs:
        if any(alias.lower() in haystack for alias in pack.family.aliases):
            return pack

    for pack in packs:
        if any(kw.lower() in haystack for kw in pack.nameplate.match_keywords):
            return pack

    return None

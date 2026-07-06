"""Frozen dataclasses mirroring the drive-pack JSON schema.

Pure data shapes only — no I/O, no validation logic (that lives in
``loader.py``). See ``packs/README.md`` for the field-by-field schema doc and
``docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`` for why
packs exist (family-keyed drive intelligence, data not code).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Family:
    """Manufacturer/series identity for a drive family, plus known aliases."""

    manufacturer: str
    series: str
    aliases: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Nameplate:
    """Keywords a nameplate photo/OCR or free text can match to this pack."""

    match_keywords: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RegisterEntry:
    """One analog register decode: raw value -> engineering value.

    ``addr`` is the Modbus/EtherNet-IP register address (``None`` when not
    yet documented — never a guess). ``scaling`` is the multiplier applied to
    the raw value (e.g. ``0.01`` for a raw value in hundredths).
    """

    addr: int | None
    unit: str | None
    scaling: float
    datapoint: str


@dataclass(frozen=True)
class LiveDecode:
    """The live-tag decode tables for a drive family.

    ``status_bits``/``cmd_word``/``fault_codes`` are int-keyed (the enum
    value on the wire) -> human-readable string, matching the shape of the
    module dicts in ``mira-bots/shared/live_snapshot.py``.
    """

    status_bits: dict[int, str]
    cmd_word: dict[int, str]
    fault_codes: dict[int, str]
    registers: dict[str, RegisterEntry] = field(default_factory=dict)


@dataclass(frozen=True)
class EnvelopeBand:
    """An expected-value band for one analog signal. Unknown = ``None``, not a guess."""

    nominal: float | None = None
    min: float | None = None
    max: float | None = None
    rated: float | None = None
    unit: str | None = None


@dataclass(frozen=True)
class Envelope:
    """Expected operating envelope for the drive family's analog signals."""

    dc_bus: EnvelopeBand = field(default_factory=EnvelopeBand)
    current: EnvelopeBand = field(default_factory=EnvelopeBand)
    frequency: EnvelopeBand = field(default_factory=EnvelopeBand)


@dataclass(frozen=True)
class Knowledge:
    """ID pointers into existing KB/KG stores — reuse, don't re-hold.

    Empty/``None`` in v1; a later task fills these once the GS10
    ``component_templates`` row and KB document ids are known.
    """

    kb_document_ids: list[str] = field(default_factory=list)
    component_template_id: str | None = None
    kg_entity_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Provenance:
    """Per-item provenance tier + supporting sources.

    ``items`` maps a dotted field path (e.g. ``"live_decode.fault_codes"``)
    to one of ``"bench_verified"`` / ``"manual_cited"`` — never bare
    "verified" (that word is reserved for ``kg_*.approval_state``).
    """

    items: dict[str, str] = field(default_factory=dict)
    sources: list[dict[str, str]] = field(default_factory=list)


# ─── v2 service-pack shapes: cited parameters + keypad navigation ────────────
# schema_version 2 adds two OPTIONAL, pack-stored blocks — configurable
# parameter decode (`parameters`) and button-press navigation
# (`keypad_navigation`) — that exist in no other store (ADR-0025; DriveSense
# manual-keypad phase, docs/discovery/drivesense_service_pack_schema_proposal.md).
# Pure data shapes; view-only text; never a write. v1 packs omit both, so every
# field below is optional at the pack level and v1 packs load unchanged.


@dataclass(frozen=True)
class Citation:
    """A single evidence pointer — mirrors ``component_template_sources`` /
    ``pack.provenance.sources`` shape.

    Lives here (not in ``cards.py``) so the pack-stored ``ParameterCard`` /
    ``KeypadNavigationCard`` can reference it without a schema→cards import
    cycle; ``cards.py`` re-exports it for backward compatibility.
    """

    doc: str
    page: str
    excerpt: str


@dataclass(frozen=True)
class ValueMeaning:
    """One decoded setting value of a configurable parameter (e.g. ``"0"`` ->
    ``"Warn and continue running"``)."""

    value: str
    meaning: str


@dataclass(frozen=True)
class ParameterCard:
    """A cited, structured view of one configurable drive parameter.

    ``parameter_id`` is the keypad/manual identifier (e.g. ``"P09.03"``), NOT a
    Modbus register address (those live in ``live_decode.registers``).
    ``drive_family`` is the owning ``pack_id``. Pure data; view-only text.
    """

    drive_family: str
    parameter_id: str
    name: str
    purpose: str
    source_citation: Citation
    value_meanings: list[ValueMeaning] = field(default_factory=list)
    default: str | None = None
    range: str | None = None
    unit: str | None = None
    related_faults: list[str] = field(default_factory=list)
    provenance_tier: str = "manual_cited"
    confidence_tier: str | None = None


@dataclass(frozen=True)
class KeypadNavigationCard:
    """Ordered button-press guidance to REACH and VIEW a parameter on the
    physical drive — the genuinely-new structured data DriveSense adds.

    ``keypad_steps`` are display strings, never executable instructions.
    ``view_only_warning`` is mandatory and non-empty (the safety contract,
    enforced in ``loader.py``). Beta ships VIEW-only, so ``edit_warning`` is
    normally ``None``. ``drive_family`` is the owning ``pack_id``.
    """

    drive_family: str
    goal: str
    keypad_steps: list[str]
    view_only_warning: str
    source_citation: Citation
    confidence_tier: str
    provenance_tier: str
    parameter_id: str | None = None
    menu_group: str | None = None
    edit_warning: str | None = None


@dataclass(frozen=True)
class DrivePack:
    """A complete, validated drive-family pack.

    ``parameters`` and ``keypad_navigation`` are the schema_version 2 additions
    — empty for a v1 pack, so v1 packs load unchanged.
    """

    pack_id: str
    schema_version: int
    family: Family
    nameplate: Nameplate
    live_decode: LiveDecode
    envelope: Envelope
    knowledge: Knowledge
    provenance: Provenance
    parameters: list[ParameterCard] = field(default_factory=list)
    keypad_navigation: list[KeypadNavigationCard] = field(default_factory=list)

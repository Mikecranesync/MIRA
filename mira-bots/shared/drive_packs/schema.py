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
    related_parameters: list[str] = field(default_factory=list)
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


# ─── v3 fault shape: string-identifier fault entries (mnemonic-coded drives) ──
# schema_version 3 adds one OPTIONAL, pack-stored block — `fault_entries` — a
# first-class, source-preserved list of the drive's fault identifiers keyed by a
# STRING id (`oC`, `GF`, `BE0`, `LL1`), not the int-on-the-wire enum in
# `live_decode.fault_codes`. It exists because mnemonic-coded families (Magnetek
# IMPULSE crane VFDs, Durapulse GS10/GS20) have no numeric fault register at all
# — the `dict[int, str]` shape cannot represent them (RUN_C_PLAN.md C1;
# tools/drive-pack-extract/candidates/magnetek_impulse_g_plus_mini). It is purely
# additive: `live_decode.fault_codes` (int-keyed) is untouched, `wire_value` is
# `None` for mnemonic-only families (never a guessed integer), and v1/v2 packs
# omit the block so they load unchanged.


@dataclass(frozen=True)
class FaultEntry:
    """One source-preserved fault identifier for a mnemonic-coded drive.

    ``fault_id`` is the manufacturer's exact string code, case-SENSITIVE — ``oC``
    and ``OC`` are different codes and must never be casefolded together (RUN_C
    decision #4). ``wire_value`` is the on-the-wire integer IF (and only if) the
    family also exposes this fault as a numeric register — ``None`` for
    mnemonic-only families, never a guess. All text is view-only; every entry is
    expected to carry a ``source_citation`` (the extractor's cite-gate).
    """

    fault_id: str
    name: str = ""
    action: str = ""
    source_citation: Citation = field(default_factory=lambda: Citation("", "", ""))
    flashing: bool | None = None
    secondary_label: str | None = None
    references_parameters: list[str] = field(default_factory=list)
    ambiguous_glyphs: list[dict[str, str | int]] = field(default_factory=list)
    wire_value: int | None = None
    provenance_tier: str = "manual_cited"


@dataclass(frozen=True)
class DrivePack:
    """A complete, validated drive-family pack.

    ``parameters`` and ``keypad_navigation`` are the schema_version 2 additions;
    ``fault_entries`` is the schema_version 3 addition — all empty for an earlier
    pack, so older packs load unchanged.
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
    fault_entries: list[FaultEntry] = field(default_factory=list)

    def fault_entry(self, fault_id: str, *, case_sensitive: bool = True) -> FaultEntry | None:
        """Address a ``FaultEntry`` by its string ``fault_id``.

        Case-SENSITIVE by default — ``oC`` and ``OC`` are distinct codes (RUN_C
        decision #4), so the stored id is never casefolded away. Pass
        ``case_sensitive=False`` for a lenient convenience match (first
        case-insensitive hit) that only widens the *comparison*, not the stored
        value. Returns ``None`` when nothing matches. The list preserves source
        order and any duplicates; this is a first-match accessor.
        """
        if case_sensitive:
            return next((e for e in self.fault_entries if e.fault_id == fault_id), None)
        target = fault_id.casefold()
        return next((e for e in self.fault_entries if e.fault_id.casefold() == target), None)

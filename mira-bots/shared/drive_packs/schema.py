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


@dataclass(frozen=True)
class DrivePack:
    """A complete, validated drive-family pack."""

    pack_id: str
    schema_version: int
    family: Family
    nameplate: Nameplate
    live_decode: LiveDecode
    envelope: Envelope
    knowledge: Knowledge
    provenance: Provenance

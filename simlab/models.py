"""PLC-baseline normalization models for SimLab.

These dataclasses are how SimLab normalizes legitimate PLC program concepts —
inputs, outputs, internal tags, states, timers, counters, interlocks, alarms,
fault codes, HMI tags, derived diagnostic tags — into MIRA-readable simulation
models. No proprietary ladder/structured-text is executed or copied; these are
clean-room archetypes of standard industrial patterns.

Contract notes (locked — the rest of SimLab builds against these):
  - A :class:`TagDef` declares the *shape* of a tag; its live value lives in the
    engine's ``tag_state`` keyed by the tag's canonical UNS path.
  - ``category`` is one of :class:`TagCategory` — these become the UNS category
    segment (``…/<asset>/<category>/<tag>``).
  - :class:`Reading` is the publish/snapshot unit and maps 1:1 onto the
    ``mira-relay`` ``/api/v1/tags/ingest`` tag dict (``source_system="simulator"``,
    ``simulated=True``). See :mod:`simlab.publishers`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from simlab.packml import PackMLState


class TagCategory(str, Enum):
    """UNS category segment for a tag. Stable — used in path construction."""

    STATUS = "status"
    PROCESS = "process"
    MOTOR = "motor"
    FAULTS = "faults"
    ALARMS = "alarms"
    QUALITY = "quality"
    PRODUCTION = "production"
    MAINTENANCE = "maintenance"
    DOCS = "docs"
    TRAINING = "training"


class NamespaceType(str, Enum):
    """Walker-Reynolds namespace classification, layered over MIRA's maintenance
    ``TagCategory`` axis (see docs/research/2026-06-10-walker-uns-alignment.md).

    - DESCRIPTIVE: static asset metadata (mfr/model/serial). Lives on the asset,
      not usually a per-tag category — included for completeness.
    - FUNCTIONAL: real-time operational data (status/process/motor/production).
    - INFORMATIVE: derived/aggregated consumer data (quality, OEE inputs).
    - MAINTENANCE: durable maintenance knowledge (faults/alarms/PMs/docs/training)
      — MIRA's wedge; no Walker equivalent.
    - REALTIME: live datapoints and clock/heartbeat tags that carry current state
      + time, not process meaning. The Walker "current state" UNS branch.
    """

    DESCRIPTIVE = "descriptive"
    FUNCTIONAL = "functional"
    INFORMATIVE = "informative"
    MAINTENANCE = "maintenance"
    REALTIME = "realtime"


# Default mapping: each maintenance-axis TagCategory → its Walker namespace type.
# A TagDef may override via TagDef.namespace_type (e.g. clock tags → REALTIME).
CATEGORY_NAMESPACE_TYPE: dict[TagCategory, NamespaceType] = {
    TagCategory.STATUS: NamespaceType.FUNCTIONAL,
    TagCategory.PROCESS: NamespaceType.FUNCTIONAL,
    TagCategory.MOTOR: NamespaceType.FUNCTIONAL,
    TagCategory.PRODUCTION: NamespaceType.FUNCTIONAL,
    TagCategory.QUALITY: NamespaceType.INFORMATIVE,
    TagCategory.FAULTS: NamespaceType.MAINTENANCE,
    TagCategory.ALARMS: NamespaceType.MAINTENANCE,
    TagCategory.MAINTENANCE: NamespaceType.MAINTENANCE,
    TagCategory.DOCS: NamespaceType.MAINTENANCE,
    TagCategory.TRAINING: NamespaceType.MAINTENANCE,
}


def namespace_type_for(category: TagCategory) -> NamespaceType:
    """Walker namespace type for a category (defaults to FUNCTIONAL if unmapped)."""
    return CATEGORY_NAMESPACE_TYPE.get(category, NamespaceType.FUNCTIONAL)


class ValueType(str, Enum):
    """Maps onto mira-relay tag_ingest VALID_VALUE_TYPES."""

    BOOL = "bool"
    INT = "int"
    FLOAT = "float"
    STRING = "string"
    ENUM = "enum"


class Severity(str, Enum):
    INFO = "info"
    WARN = "warn"
    FAULT = "fault"
    CRITICAL = "critical"


@dataclass(frozen=True)
class TagDef:
    """The declared shape of a single simulated tag on an asset."""

    name: str
    category: TagCategory
    value_type: ValueType
    default: Any
    unit: str = ""
    description: str = ""
    # writable HMI/command tags vs read-only telemetry/derived tags
    writable: bool = False
    # Walker namespace classification. None → derived from `category` via
    # namespace_type_for(); set explicitly to override (e.g. clock tags →
    # NamespaceType.REALTIME, which is not implied by any category).
    namespace_type: Optional[NamespaceType] = None

    @property
    def resolved_namespace_type(self) -> NamespaceType:
        """The effective Walker namespace type (override, else category default)."""
        return self.namespace_type or namespace_type_for(self.category)


@dataclass(frozen=True)
class FaultCode:
    """A fault-code-table entry MIRA can cite (mirrors a real fault table)."""

    code: str  # e.g. "F012"
    label: str  # short name, e.g. "Low Bowl Pressure"
    description: str
    severity: Severity = Severity.FAULT
    likely_cause: str = ""
    recommended_action: str = ""


@dataclass(frozen=True)
class AlarmDef:
    """A declarative alarm: when ``source_tag`` satisfies ``predicate`` the alarm
    is active. ``predicate`` is a pure callable ``(value) -> bool`` so scenarios
    stay deterministic. ``fault_code`` links the alarm to a fault-table row.
    """

    code: str
    severity: Severity
    message: str
    source_tag: str  # bare tag name on the same asset
    # pure predicate over the source tag's current value
    predicate: Any = None
    fault_code: Optional[str] = None


@dataclass
class AssetModel:
    """One machine (or utility skid) on the line.

    ``baseline`` names the reusable PLC archetype in :mod:`simlab.baselines`
    this asset was normalized from. ``docs`` lists the simulated maintenance
    document filenames under ``simlab/docs/<asset_id>/`` MIRA may cite.
    """

    asset_id: str  # slug, e.g. "filler01"
    asset_type: str  # e.g. "rotary_filler"
    display_name: str  # e.g. "Filler 01"
    baseline: str  # baseline archetype key, e.g. "bottle_filler"
    tags: dict[str, TagDef] = field(default_factory=dict)
    fault_codes: list[FaultCode] = field(default_factory=list)
    alarms: list[AlarmDef] = field(default_factory=list)
    docs: list[str] = field(default_factory=list)
    packml_default: PackMLState = PackMLState.IDLE

    def tag(self, name: str) -> TagDef:
        return self.tags[name]


@dataclass
class LineModel:
    """A production line: ordered process assets + utility assets."""

    line_id: str  # "line01"
    display_name: str  # "Line 01"
    assets: list[AssetModel] = field(default_factory=list)
    utilities: list[AssetModel] = field(default_factory=list)

    def all_assets(self) -> list[AssetModel]:
        return [*self.assets, *self.utilities]

    def asset(self, asset_id: str) -> AssetModel:
        for a in self.all_assets():
            if a.asset_id == asset_id:
                return a
        raise KeyError(asset_id)


@dataclass
class PlantModel:
    plant_id: str  # "plant1"
    display_name: str  # "Plant 1"
    lines: list[LineModel] = field(default_factory=list)


@dataclass
class FactoryModel:
    """Top of the SimLab UNS tree. ``site_id`` is the ISA-95 *site*; the
    enterprise root label is always ``enterprise`` in the canonical ltree path
    (display projection renders it as ``factory_display`` — e.g. "FactoryLM").
    """

    site_id: str  # "florida_natural_demo"
    site_display: str  # "Florida Natural Demo"
    factory_display: str  # "FactoryLM" (enterprise display label)
    plants: list[PlantModel] = field(default_factory=list)


@dataclass
class Reading:
    """One published tag reading. Maps onto the mira-relay tag_ingest tag dict.

    ``uns_path`` is the canonical lowercase dot-delimited ltree path (see
    :mod:`simlab.uns`). ``quality`` is one of good/bad/stale/uncertain.
    """

    asset_id: str
    tag: str
    category: TagCategory
    value: Any
    value_type: ValueType
    uns_path: str
    ts: str  # ISO-8601
    quality: str = "good"
    simulated: bool = True
    # Walker namespace type for this reading (string form, e.g. "realtime").
    namespace_type: Optional[str] = None

    def to_ingest_tag(self) -> dict[str, Any]:
        """Render as a mira-relay ``/api/v1/tags/ingest`` tag entry.

        ``namespace_type`` (when set) rides in ``metadata`` so the relay /
        Command Center can classify a live datapoint without re-deriving it.
        """
        tag: dict[str, Any] = {
            "tag_path": self.uns_path,
            "value": self.value,
            "value_type": self.value_type.value,
            "quality": self.quality,
            "ts": self.ts,
        }
        if self.namespace_type is not None:
            tag["metadata"] = {"namespace_type": self.namespace_type}
        return tag

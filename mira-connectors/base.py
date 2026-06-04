"""Abstract base class for all MIRA connectors.

A *connector* is the translation layer between an external system (enterprise
CMMS/EAM — Maximo, SAP, MaintainX, Fiix — or plant-floor OT — Ignition, MQTT,
OPC UA, AVEVA PI) and MIRA's canonical asset graph (``canonical.py``).

The pipeline every connector implements is the one from
``docs/mira/connector-framework.md``::

    discover() ─▶ import_records() ─▶ normalize() ─▶ validate() ─▶ [graph]
                                                                      │
                                                       export_enriched() ─▶ source format

Design rules (from ``.claude/CLAUDE.md`` and the canonical docs):

* **Read-only by default.** ``read_only=True`` — a connector never writes back
  to the *source* system unless explicitly constructed with ``read_only=False``
  (and even then only ``export_enriched`` may do so, never import/normalize).
* **Dry-run by default.** ``dry_run=True`` — ``normalize()`` produces an
  in-memory :class:`~canonical.NormalizedGraph` but nothing is persisted into
  *MIRA's* stores (kg_entities / source_objects). The two flags are independent
  axes: ``read_only`` guards the source system, ``dry_run`` guards MIRA.
* **Never auto-verify.** Everything produced is ``approval_state="proposed"``.
* **Preserve every original field** in ``source_payload`` / ``SourceObject``.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

from canonical import NormalizedGraph, ValidationReport

logger = logging.getLogger("mira-connectors")


@dataclass
class Capability:
    """What :meth:`Connector.discover` returns — the source system's schema and
    what this connector can do with it."""

    system_kind: str  # 'maximo'|'sap'|'maintainx'|'ignition'|'historian'
    display_name: str
    object_types: list[str]  # resource kinds this connector can import
    supports_export: bool  # can enriched payloads be written back?
    read_only: bool
    # Per-object-type field inventory the source exposes (schema discovery).
    schema: dict[str, list[str]] = field(default_factory=dict)
    notes: str = ""


@dataclass
class RawRecord:
    """One record as pulled from the source, before normalization. Carries the
    untouched payload plus enough provenance to build a :class:`SourceObject`."""

    object_type: str
    external_object_id: str
    payload: dict[str, Any]


@dataclass
class ExportResult:
    """What :meth:`Connector.export_enriched` returns. ``written`` is True only
    when a live (``read_only=False``, non-dry-run) connector actually pushed to
    the source; mock/read-only/dry-run connectors return the payload with
    ``written=False`` so a caller can inspect what *would* be sent."""

    supported: bool
    written: bool
    payloads: list[dict[str, Any]] = field(default_factory=list)
    note: str = ""


class Connector(ABC):
    """Base interface for every MIRA connector."""

    #: stable connector identity, e.g. 'maximo_mock'
    name: str = "connector"
    #: source system family, one of the source-record-preservation system kinds
    system_kind: str = "unknown"
    #: semver/sha of the adapter — recorded on every SourceObject + import run
    connector_version: str = "0.1.0"

    def __init__(self, dry_run: bool = True, read_only: bool = True) -> None:
        # read_only → never mutate the SOURCE system (Maximo/PI/...).
        self.read_only = read_only
        # dry_run → never persist into MIRA's stores (kg_entities/source_objects).
        self.dry_run = dry_run

    # ── the pipeline ────────────────────────────────────────────────

    @abstractmethod
    async def discover(self) -> Capability:
        """Return the source system's schema/capabilities (no records)."""

    @abstractmethod
    async def import_records(self, config: Optional[dict[str, Any]] = None) -> list[RawRecord]:
        """Pull raw records from the source (or, for a mock, from fixtures).

        Read-only operation: importing never mutates the source. ``config`` may
        filter object types / windows; see :meth:`get_config_schema`.
        """

    @abstractmethod
    def normalize(self, raw_records: list[RawRecord]) -> NormalizedGraph:
        """Map raw records into the MIRA canonical model.

        Pure transformation (no I/O): reads ``RawRecord.payload``, emits
        :class:`CanonicalEntity` / :class:`CanonicalRelationship` (all
        ``proposed``), preserves the full payload in ``source_payload`` and a
        :class:`SourceObject`, and raises ambiguous mappings as
        :class:`Proposal` rows rather than asserting them as fact.
        """

    @abstractmethod
    def validate(self, graph: NormalizedGraph) -> ValidationReport:
        """Check the normalized graph: valid UNS paths, no orphan edges,
        preserved payloads, flagged ambiguities. Warnings don't block; errors do.
        """

    @abstractmethod
    async def export_enriched(self, graph_context: dict[str, Any]) -> ExportResult:
        """Generate enriched payloads back in the source system's format
        (e.g. a Maximo work order annotated with MIRA's diagnosis + UNS path).

        Honors both flags: if ``read_only`` or ``dry_run`` it returns the payload
        with ``written=False`` (the connector built it but did not push it).
        Sources that have no meaningful write-back (SCADA/historian) return
        ``ExportResult(supported=False, ...)``.
        """

    @abstractmethod
    def get_config_schema(self) -> dict[str, Any]:
        """Return the configuration this connector expects (JSON-schema-ish:
        field name → {type, required, description, default})."""

    # ── shared helpers ──────────────────────────────────────────────

    def _may_write_source(self) -> bool:
        """True only when this connector is allowed to push to the source."""
        if self.read_only:
            logger.info("%s: read_only — refusing to write back to source", self.name)
            return False
        if self.dry_run:
            logger.info("%s: dry_run — not pushing to source (would write)", self.name)
            return False
        return True

    async def run(self, config: Optional[dict[str, Any]] = None) -> NormalizedGraph:
        """Convenience: import → normalize → validate, logging the dry-run
        decision. Returns the graph; persistence is a caller/writer concern."""
        raw = await self.import_records(config)
        graph = self.normalize(raw)
        report = self.validate(graph)
        if not report.ok:
            for err in report.errors:
                logger.warning("%s validation error [%s]: %s", self.name, err.code, err.message)
        if self.dry_run:
            s = graph.summary()
            logger.info(
                "%s: dry_run — would persist %d entities, %d relationships, "
                "%d proposals, %d source_objects (nothing written to MIRA)",
                self.name,
                s["entities"],
                s["relationships"],
                s["proposals"],
                s["source_objects"],
            )
        return graph

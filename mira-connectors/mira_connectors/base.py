"""Generic connector framework — the base interface every MIRA connector implements.

This generalizes the existing ``mira-mcp/cmms/base.py:CMMSAdapter`` pattern (a
narrow CMMS-only interface: ``configured`` / ``health_check`` / ``list_*`` /
``create_*``, never-raise-on-remote-error) into a connector contract that any
external system can satisfy — CMMS/EAM, SCADA, Historian, Document store, MQTT/UNS.

The ten capabilities (from the Phase 3 brief):

1.  ``discover()``          — schema / capabilities of the source
2.  ``import_records()``    — pull raw vendor records
3.  ``normalize()``         — vendor record → MIRA canonical model
4.  ``validate_mappings()`` — check normalized records before they touch the gate
5.  ``export_records()``    — write enriched records back (gated; read-only by default)
6.  auth / config           — ``ConnectorConfig`` + ``configured`` property
7.  ``log_sync()``          — structured ``SyncResult`` per run
8.  dry-run mode            — ``config.dry_run`` makes every write a planned no-op
9.  mock mode               — ``is_mock`` / ``MockConnector`` read fixtures, no network
10. read-only default       — ``config.mode`` defaults to READ_ONLY; export refuses to
                              write unless the operator opts into READ_WRITE

Doctrine: SCADA and Historian connectors are read-only **by construction** — MIRA
does not write to the plant (``.claude/rules/fieldbus-readonly.md``, the
Ignition-is-read-path rule, ADR-0021). Their ``export_records`` refuses plant writes
regardless of ``mode``. See ``docs/mira/connector-framework.md`` §"Export & the
read-only doctrine".
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from mira_connectors.canonical import (
    CanonicalRecord,
    CanonicalRelationship,
    RawRecord,
    RecordType,
)

logger = logging.getLogger("mira-connectors")


class ConnectorKind(str, Enum):
    CMMS = "cmms"          # CMMS / EAM (Maximo, MaintainX, Limble, Fiix, Atlas)
    SCADA = "scada"        # Ignition, other SCADA
    HISTORIAN = "historian"  # AVEVA PI / OSIsoft, Canary, InfluxDB-as-historian
    DOCUMENT = "document"  # manual / drawing / datasheet stores
    MQTT = "mqtt"          # MQTT / Sparkplug B / UNS broker


class ConnectorMode(str, Enum):
    """Read-only is the default and the safe floor."""

    READ_ONLY = "read_only"
    READ_WRITE = "read_write"


@dataclass(slots=True)
class ConnectorConfig:
    """Auth + behavior config for a connector instance (capability #6, #8, #10).

    Secrets are never stored here in plaintext for production connectors — they are
    pulled from Doppler-managed env vars by the concrete connector. ``settings`` is a
    free-form bag for endpoints, providers, and non-secret options.
    """

    tenant_id: str
    mode: ConnectorMode = ConnectorMode.READ_ONLY  # #10: read-only default
    dry_run: bool = False  # #8: planned writes only, no side effects
    settings: dict[str, Any] = field(default_factory=dict)

    @property
    def writable(self) -> bool:
        return self.mode is ConnectorMode.READ_WRITE and not self.dry_run


@dataclass(slots=True)
class ConnectorCapabilities:
    """What a source can do — returned by ``discover()`` (capability #1)."""

    kind: ConnectorKind
    provider: str
    record_types: list[RecordType]  # which RecordTypes this source exposes
    supports_export: bool = False  # can enriched data be written back?
    supports_incremental: bool = False  # can import filter by ``since``?
    schema: dict[str, Any] = field(default_factory=dict)  # field/tag-tree shape
    notes: str = ""


@dataclass(slots=True)
class ValidationIssue:
    record_id: str
    severity: str  # "error" | "warning"
    message: str


@dataclass(slots=True)
class ValidationResult:
    """Outcome of ``validate_mappings()`` (capability #4)."""

    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "warning"]


@dataclass(slots=True)
class ExportResult:
    """Outcome of ``export_records()`` (capability #5)."""

    exported: int = 0
    planned: int = 0  # dry-run: records that *would* have been written
    refused: int = 0  # read-only / doctrine: records the connector declined to write
    errors: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SyncResult:
    """Structured log of one sync run (capability #7).

    A sync = discover → import → normalize → validate (+ optional export). The result
    is the durable record of what happened, suitable for an ``ingest_status`` row or a
    log line. Never contains secrets.
    """

    connector: str
    tenant_id: str
    record_type: Optional[RecordType] = None
    imported: int = 0
    normalized: int = 0
    validation_errors: int = 0
    validation_warnings: int = 0
    exported: int = 0
    dry_run: bool = False
    mock: bool = False
    started_at: float = 0.0
    duration_ms: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors and self.validation_errors == 0

    def as_dict(self) -> dict[str, Any]:
        d = {
            "connector": self.connector,
            "tenant_id": self.tenant_id,
            "record_type": self.record_type.value if self.record_type else None,
            "imported": self.imported,
            "normalized": self.normalized,
            "validation_errors": self.validation_errors,
            "validation_warnings": self.validation_warnings,
            "exported": self.exported,
            "dry_run": self.dry_run,
            "mock": self.mock,
            "duration_ms": self.duration_ms,
            "ok": self.ok,
            "errors": self.errors,
        }
        return d


class ConnectorError(Exception):
    """Raised only for programming / config errors (bad mode, unknown record type).

    Remote/IO failures do NOT raise — they degrade gracefully and surface in the
    ``SyncResult.errors`` / ``ExportResult.errors`` list, matching the never-raise
    contract of the existing ``CMMSAdapter``.
    """


class Connector(ABC):
    """Abstract base — the contract a connector must satisfy.

    Concrete connectors should subclass a *type* base (``CMMSConnector``,
    ``SCADAConnector``, …) which fixes ``kind`` and adds domain helpers, then a
    *provider* class (``MaximoMockConnector``) which implements the abstract methods.
    """

    kind: ConnectorKind
    provider: str
    is_mock: bool = False  # #9: True for fixture-backed mock connectors

    def __init__(self, config: ConnectorConfig) -> None:
        self.config = config

    # --- capability #6: auth / config ---------------------------------------
    @property
    @abstractmethod
    def configured(self) -> bool:
        """True when all required credentials/config are present."""

    @abstractmethod
    async def health_check(self) -> dict[str, Any]:
        """Cheap liveness probe. Returns ``{"ok": bool, ...}``; never raises."""

    # --- capability #1: discover ---------------------------------------------
    @abstractmethod
    async def discover(self) -> ConnectorCapabilities:
        """Return the source's schema / tag tree / capabilities."""

    # --- capability #2: import -----------------------------------------------
    @abstractmethod
    async def import_records(
        self,
        record_type: RecordType,
        *,
        since: Optional[str] = None,
        limit: int = 500,
    ) -> list[RawRecord]:
        """Pull raw vendor records of ``record_type``."""

    # --- capability #3: normalize --------------------------------------------
    @abstractmethod
    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        """Map raw vendor records to MIRA canonical records. Pure; no IO."""

    # --- capability #5: export -----------------------------------------------
    @abstractmethod
    async def export_records(self, enriched: list[CanonicalRecord]) -> ExportResult:
        """Write enriched records back to the source (if supported & writable)."""


class BaseConnector(Connector):
    """Shared machinery: read-only/dry-run guards, validation, sync orchestration.

    Subclasses implement ``configured``, ``discover``, ``import_records``,
    ``normalize``, and ``_do_export`` (the actual write). This class provides
    ``validate_mappings`` (#4), ``export_records`` (#5 guards), and ``sync`` (#7).
    """

    # --- capability #4: validate ---------------------------------------------
    def validate_mappings(self, records: list[CanonicalRecord]) -> ValidationResult:
        result = ValidationResult()
        for rec in records:
            # CanonicalRelationship.validate() is a superset of base_validate()
            # (it also checks the controlled vocab + evidence), so prefer it.
            if isinstance(rec, CanonicalRelationship):
                errs = rec.validate()
            else:
                errs = rec.base_validate()
            for msg in errs:
                result.issues.append(
                    ValidationIssue(record_id=rec.source_record_id, severity="error", message=msg)
                )
            # A connector that proposes no UNS path for a locatable record is a
            # warning, not an error — the gate can still resolve it from hints.
            if rec.record_type in (RecordType.ASSET, RecordType.TAG) and not rec.proposed_uns_path:
                result.issues.append(
                    ValidationIssue(
                        record_id=rec.source_record_id,
                        severity="warning",
                        message="no proposed_uns_path — gate must resolve location",
                    )
                )
        return result

    def derive_relationships(self, records: list[CanonicalRecord]) -> list[CanonicalRelationship]:
        """Derive proposed edges across a normalized record set.

        Optional capability — relationships are cross-record (asset→parent,
        tag→asset, asset→document) so they can't be produced by per-type
        ``normalize()``. The confirmation gate calls this to seed
        ``relationship_proposals``. Default: none.
        """
        return []

    # --- capability #5: export with #8 (dry-run) + #10 (read-only) guards ----
    async def export_records(self, enriched: list[CanonicalRecord]) -> ExportResult:
        if self.config.dry_run:
            logger.info("[%s] dry-run: %d records would be exported", self.provider, len(enriched))
            return ExportResult(planned=len(enriched))
        if self.config.mode is not ConnectorMode.READ_WRITE:
            logger.info(
                "[%s] read-only mode: refusing to export %d records", self.provider, len(enriched)
            )
            return ExportResult(refused=len(enriched))
        return await self._do_export(enriched)

    async def _do_export(self, enriched: list[CanonicalRecord]) -> ExportResult:
        """Actual write. Override in connectors that support write-back.

        Default refuses — most connectors (and all plant-facing ones) are read-only.
        """
        return ExportResult(refused=len(enriched), errors=["export not supported by this connector"])

    # --- capability #7: a full sync run with a structured log ----------------
    async def sync(
        self,
        record_type: RecordType,
        *,
        since: Optional[str] = None,
        limit: int = 500,
        export: bool = False,
    ) -> tuple[list[CanonicalRecord], SyncResult]:
        """Run import → normalize → validate (+ optional export) and log the result."""
        started = time.monotonic()
        result = SyncResult(
            connector=self.provider,
            tenant_id=self.config.tenant_id,
            record_type=record_type,
            dry_run=self.config.dry_run,
            mock=self.is_mock,
        )
        canonical: list[CanonicalRecord] = []
        try:
            if not self.configured:
                result.errors.append("connector not configured")
                return canonical, self._finish(result, started)
            raw = await self.import_records(record_type, since=since, limit=limit)
            result.imported = len(raw)
            canonical = self.normalize(raw)
            result.normalized = len(canonical)
            validation = self.validate_mappings(canonical)
            result.validation_errors = len(validation.errors)
            result.validation_warnings = len(validation.warnings)
            if export and canonical:
                export_result = await self.export_records(canonical)
                result.exported = export_result.exported
                result.errors.extend(export_result.errors)
        except ConnectorError as exc:  # programming/config error — surface, don't crash
            result.errors.append(f"connector_error: {exc}")
        except Exception as exc:  # noqa: BLE001 — IO failures degrade gracefully
            logger.exception("[%s] sync failed", self.provider)
            result.errors.append(f"{type(exc).__name__}: {exc}")
        return canonical, self._finish(result, started)

    @staticmethod
    def _finish(result: SyncResult, started: float) -> SyncResult:
        result.duration_ms = int((time.monotonic() - started) * 1000)
        logger.info("sync %s", result.as_dict())
        return result

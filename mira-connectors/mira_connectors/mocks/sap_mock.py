"""SAPMockConnector — fixture-backed SAP Plant Maintenance (CMMS/EAM) connector.

Reads ``fixtures/sap.json`` (native SAP PM field names: ``EQUNR``, ``TPLNR``,
``AUFNR``, ``MATNR``, ``HERST`` …) and exercises the full lifecycle. ``is_mock = True``.

The reference for a second CMMS provider next to Maximo: SAP's hierarchy is the
functional-location tree (``TPLNR`` with ``TPLMA`` = superior FL); equipment masters
(``EQUNR``) hang off a functional location and may nest via ``HEQUI``. A real
``SAPConnector`` would replace ``_load()`` with S/4HANA OData and keep
``normalize``/``derive_relationships`` verbatim.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from mira_connectors._uns import candidate_uns_path
from mira_connectors.base import (
    ConnectorCapabilities,
    ConnectorConfig,
    ConnectorKind,
    ExportResult,
)
from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalLocation,
    CanonicalPart,
    CanonicalPMTask,
    CanonicalRecord,
    CanonicalRelationship,
    CanonicalWorkOrder,
    EvidenceRef,
    RawRecord,
    RecordType,
)
from mira_connectors.types.cmms import CMMSConnector

_FIXTURE = Path(__file__).parent / "fixtures" / "sap.json"

# SAP order system status (ANLZU) → MIRA work-order status.
_WO_STATUS = {"CRTD": "OPEN", "REL": "IN_PROGRESS", "TECO": "COMPLETE", "CLSD": "COMPLETE"}
# SAP order type (AUART) → MIRA work_type.
_WORKTYPE = {"PM01": "preventive", "PM02": "corrective", "PM03": "corrective", "PM04": "emergency"}
# SAP ABC indicator (ABCKZ) → MIRA criticality band.
_CRIT = {"A": "high", "B": "medium", "C": "low"}
# FLTYP → location_type (PLANT has no ISA-95 slot below site; folds to site).
_FLTYP = {"PLANT": "site", "AREA": "area", "LINE": "line", "CELL": "cell"}

# SAP exposes the same record families as any CMMS, minus standalone meters/doclinks.
SAP_RECORD_TYPES = [
    RecordType.LOCATION,
    RecordType.ASSET,
    RecordType.WORK_ORDER,
    RecordType.PM_TASK,
    RecordType.PART,
]


class SAPMockConnector(CMMSConnector):
    provider = "sap"
    is_mock = True

    def __init__(self, config: ConnectorConfig) -> None:
        super().__init__(config)
        self._data: dict[str, Any] = {}

    @property
    def configured(self) -> bool:
        return True

    def _load(self) -> dict[str, Any]:
        if not self._data:
            self._data = json.loads(_FIXTURE.read_text())
        return self._data

    async def health_check(self) -> dict[str, Any]:
        data = self._load()
        return {
            "ok": True,
            "provider": self.provider,
            "mock": True,
            "equipment": len(data.get("equipment", [])),
        }

    async def discover(self) -> ConnectorCapabilities:
        return ConnectorCapabilities(
            kind=ConnectorKind.CMMS,
            provider=self.provider,
            record_types=SAP_RECORD_TYPES,
            supports_export=True,  # maintenance-order write-back (CMMS API, not the plant)
            supports_incremental=True,
            schema={
                "equipment_object": "API_EQUIPMENT (EQUI)",
                "equipment_fields": [
                    "EQUNR",
                    "EQKTX",
                    "TPLNR",
                    "HEQUI",
                    "HERST",
                    "TYPBZ",
                    "SERGE",
                    "EQTYP",
                    "ABCKZ",
                ],
                "functional_location_object": "API_FUNCTIONALLOCATION (IFLO)",
                "functional_location_fields": ["TPLNR", "PLTXT", "TPLMA", "FLTYP"],
                "order_object": "API_MAINTENANCEORDER (AUFK/AFKO)",
                "order_fields": ["AUFNR", "KTEXT", "EQUNR", "AUART", "ANLZU"],
            },
            notes="Mock SAP PM. Hierarchy = functional-location TPLNR tree (TPLMA = superior FL).",
        )

    async def import_records(
        self, record_type: RecordType, *, since: Optional[str] = None, limit: int = 500
    ) -> list[RawRecord]:
        data = self._load()
        section_for = {
            RecordType.LOCATION: ("functional_locations", "TPLNR"),
            RecordType.ASSET: ("equipment", "EQUNR"),
            RecordType.WORK_ORDER: ("maintenance_orders", "AUFNR"),
            RecordType.PART: ("bom", None),  # composite key
        }
        if record_type is RecordType.PM_TASK:
            rows = data.get("task_lists", [])[:limit]
            return [
                RawRecord(self.provider, record_type, f"{r['PLNNR']}.{r['PLNAL']}", r) for r in rows
            ]
        if record_type not in section_for:
            return []
        section, pk = section_for[record_type]
        rows = data.get(section, [])[:limit]
        if pk is None:  # BOM: composite EQUNR.MATNR id
            return [
                RawRecord(self.provider, record_type, f"{r['EQUNR']}.{r['MATNR']}", r) for r in rows
            ]
        return [RawRecord(self.provider, record_type, str(r[pk]), r) for r in rows]

    # --- normalize -----------------------------------------------------------

    def _fl_index(self) -> dict[str, dict[str, Any]]:
        return {fl["TPLNR"]: fl for fl in self._load().get("functional_locations", [])}

    def _fl_chain(self, tplnr: Optional[str]) -> list[str]:
        """Walk TPLMA root→leaf, returning PLTXT descriptions (PLANT folds into site)."""
        index = self._fl_index()
        chain: list[str] = []
        cur, seen = tplnr, set()
        while cur and cur in index and cur not in seen:
            seen.add(cur)
            fl = index[cur]
            # Every FL contributes a path segment (PLANT becomes the site label —
            # SAP's PLANT level maps onto the ISA-95 site rather than a 4th tier).
            chain.append(fl.get("PLTXT", cur))
            cur = fl.get("TPLMA")
        return list(reversed(chain))

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for r in raw:
            f = r.fields
            if r.record_type is RecordType.LOCATION:
                out.append(self._loc(f))
            elif r.record_type is RecordType.ASSET:
                out.append(self._equipment(f))
            elif r.record_type is RecordType.WORK_ORDER:
                out.append(self._order(f))
            elif r.record_type is RecordType.PM_TASK:
                out.append(self._task_list(f))
            elif r.record_type is RecordType.PART:
                out.append(self._bom(f))
        return out

    def _loc(self, f: dict[str, Any]) -> CanonicalLocation:
        chain = self._fl_chain(f["TPLNR"])
        return CanonicalLocation(
            source_system=self.provider,
            source_record_id=str(f["TPLNR"]),
            name=f.get("PLTXT", f["TPLNR"]),
            location_type=_FLTYP.get(f.get("FLTYP", ""), "cell"),
            parent_source_id=f.get("TPLMA"),
            proposed_uns_path=candidate_uns_path(*chain) if chain else None,
            confidence=0.7,
            raw=f,
        )

    def _equipment(self, f: dict[str, Any]) -> CanonicalAsset:
        chain = self._fl_chain(f.get("TPLNR"))
        path = candidate_uns_path(*chain, str(f["EQUNR"])) if chain else None
        return CanonicalAsset(
            source_system=self.provider,
            source_record_id=str(f["EQUNR"]),
            name=f.get("EQKTX", f["EQUNR"]),
            manufacturer=f.get("HERST"),
            model=f.get("TYPBZ"),
            serial=f.get("SERGE"),
            asset_type=f.get("EQTYP"),
            parent_source_id=f.get("HEQUI"),
            criticality=_CRIT.get(str(f.get("ABCKZ", "")).upper()),
            location_path=".".join(chain) if chain else None,
            proposed_uns_path=path,
            confidence=0.6,
            raw=f,
        )

    def _order(self, f: dict[str, Any]) -> CanonicalWorkOrder:
        return CanonicalWorkOrder(
            source_system=self.provider,
            source_record_id=str(f["AUFNR"]),
            wo_number=str(f["AUFNR"]),
            title=f.get("KTEXT", ""),
            description=f.get("KTEXT", ""),
            status=_WO_STATUS.get(f.get("ANLZU", ""), f.get("ANLZU")),
            work_type=_WORKTYPE.get(f.get("AUART", ""), f.get("AUART")),
            priority=str(f.get("PRIOK")) if f.get("PRIOK") is not None else None,
            asset_source_id=f.get("EQUNR"),
            failure_code=f.get("QMNUM"),  # notification number stands in for the failure ref
            reported_at=f.get("GSTRP"),
            completed_at=f.get("GLTRP") if f.get("ANLZU") == "TECO" else None,
            confidence=0.9,
            raw=f,
        )

    def _task_list(self, f: dict[str, Any]) -> CanonicalPMTask:
        return CanonicalPMTask(
            source_system=self.provider,
            source_record_id=f"{f['PLNNR']}.{f['PLNAL']}",
            pm_number=str(f["PLNNR"]),
            description=f.get("KTEXT", ""),
            asset_source_id=f.get("EQUNR"),
            frequency=f.get("ZYKL1"),
            frequency_unit=str(f.get("ZEIEH", "")).lower() or None,
            job_plan=f.get("STRAT"),
            confidence=0.88,
            raw=f,
        )

    def _bom(self, f: dict[str, Any]) -> CanonicalPart:
        return CanonicalPart(
            source_system=self.provider,
            source_record_id=str(f["MATNR"]),
            item_number=str(f["MATNR"]),
            description=f.get("MAKTX", ""),
            store_location=f.get("LGORT"),
            issue_unit=f.get("MEINS"),
            qty_on_hand=f.get("MENGE"),
            confidence=0.85,
            raw=f,
        )

    # --- derive relationships ------------------------------------------------

    def derive_relationships(self, records: list[CanonicalRecord]) -> list[CanonicalRelationship]:
        rels: list[CanonicalRelationship] = []
        for rec in records:
            if isinstance(rec, CanonicalAsset):
                if rec.parent_source_id:  # HEQUI: superior equipment owns this one
                    rels.append(
                        self._rel(
                            "HAS_COMPONENT",
                            rec.parent_source_id,
                            "asset",
                            rec.source_record_id,
                            "asset",
                            EvidenceRef(
                                "manifest",
                                f"SAP EQUI.HEQUI on {rec.source_record_id}",
                                page_or_location="EQUI.HEQUI",
                                confidence_contribution=0.8,
                            ),
                            confidence=0.7,
                        )
                    )
                loc = rec.raw.get("TPLNR")
                if loc:  # asset installed at a functional location
                    rels.append(
                        self._rel(
                            "LOCATED_IN",
                            rec.source_record_id,
                            "asset",
                            str(loc),
                            "location",
                            EvidenceRef(
                                "manifest",
                                f"SAP EQUI.TPLNR on {rec.source_record_id}",
                                page_or_location="EQUI.TPLNR",
                                confidence_contribution=0.7,
                            ),
                            confidence=0.7,
                        )
                    )
            elif isinstance(rec, CanonicalPart) and rec.raw.get("EQUNR"):
                # BOM line: equipment HAS_PART material (containment, not consumption)
                rels.append(
                    self._rel(
                        "HAS_PART",
                        str(rec.raw["EQUNR"]),
                        "asset",
                        rec.source_record_id,
                        "part",
                        EvidenceRef(
                            "manifest",
                            f"SAP BOM (STPO) {rec.item_number} on equipment {rec.raw['EQUNR']}",
                            page_or_location=f"BOM.POSNR {rec.raw.get('POSNR')}",
                            confidence_contribution=0.8,
                        ),
                        confidence=0.75,
                    )
                )
        return rels

    def _rel(
        self,
        rel_type: str,
        source_ref: str,
        source_kind: str,
        target_ref: str,
        target_kind: str,
        evidence: EvidenceRef,
        *,
        confidence: float,
    ) -> CanonicalRelationship:
        return CanonicalRelationship(
            source_system=self.provider,
            source_record_id=f"{rel_type}:{source_kind}:{source_ref}->{target_kind}:{target_ref}",
            relationship_type=rel_type,
            source_ref=source_ref,
            source_ref_kind=source_kind,
            target_ref=target_ref,
            target_ref_kind=target_kind,
            confidence=confidence,
            reasoning=f"Derived from SAP {rel_type} link",
            evidence=[evidence],
        )

    async def _do_export(self, enriched: list[CanonicalRecord]) -> ExportResult:
        # Mock write-back: PATCH maintenance orders (API_MAINTENANCEORDER) back to SAP.
        # CMMS-API target, not the plant — allowed by doctrine. Only orders are writable.
        writable = [r for r in enriched if isinstance(r, CanonicalWorkOrder)]
        return ExportResult(exported=len(writable), refused=len(enriched) - len(writable))

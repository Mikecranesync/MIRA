"""MaximoMockConnector — fixture-backed IBM Maximo (CMMS/EAM) connector.

Reads ``fixtures/maximo.json`` (native Maximo field names) and exercises the full
connector lifecycle: discover → import → normalize → validate → derive_relationships
→ export. No network, no credentials. ``is_mock = True``.

This is the reference CMMS connector. A real ``MaximoConnector`` would replace
``_load()``/``import_records`` with Maximo REST (MAS ``oslc/os/mxapiasset`` etc.) and
keep ``normalize``/``derive_relationships`` almost verbatim.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mira_connectors._uns import candidate_uns_path
from mira_connectors.base import (
    ConnectorCapabilities,
    ConnectorConfig,
    ConnectorKind,
    ExportResult,
)
from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalDocument,
    CanonicalFailureCode,
    CanonicalLocation,
    CanonicalMeter,
    CanonicalPart,
    CanonicalPMTask,
    CanonicalRecord,
    CanonicalRelationship,
    CanonicalWorkOrder,
    EvidenceRef,
    RawRecord,
    RecordType,
)
from mira_connectors.types.cmms import CMMS_RECORD_TYPES, CMMSConnector

_FIXTURE = Path(__file__).parent / "fixtures" / "maximo.json"

# Maximo WORKORDER.STATUS → MIRA work-order status.
_WO_STATUS = {
    "WAPPR": "OPEN", "APPR": "OPEN", "INPRG": "IN_PROGRESS",
    "COMP": "COMPLETE", "CLOSE": "COMPLETE", "CAN": "CANCELLED",
}
# Maximo WORKORDER.WORKTYPE → MIRA work_type.
_WORKTYPE = {"CM": "corrective", "PM": "preventive", "EM": "emergency"}
# Maximo ASSETSPEC_CRITICALITY → MIRA criticality band.
_CRIT = {"LOW": "low", "MEDIUM": "medium", "HIGH": "high", "SAFETY": "safety_critical"}


class MaximoMockConnector(CMMSConnector):
    provider = "maximo"
    is_mock = True

    def __init__(self, config: ConnectorConfig) -> None:
        super().__init__(config)
        self._data: dict[str, Any] = {}

    # --- config (#6) ---------------------------------------------------------
    @property
    def configured(self) -> bool:
        return True  # mock is always configured

    def _load(self) -> dict[str, Any]:
        if not self._data:
            self._data = json.loads(_FIXTURE.read_text())
        return self._data

    async def health_check(self) -> dict[str, Any]:
        data = self._load()
        return {"ok": True, "provider": self.provider, "mock": True, "sites": len(data.get("sites", []))}

    # --- discover (#1) -------------------------------------------------------
    async def discover(self) -> ConnectorCapabilities:
        return ConnectorCapabilities(
            kind=ConnectorKind.CMMS,
            provider=self.provider,
            record_types=CMMS_RECORD_TYPES,
            supports_export=True,  # CMMS write-back (work orders) is allowed (not a plant write)
            supports_incremental=True,
            schema={
                "asset_object": "mxapiasset (MXASSET)",
                "asset_fields": ["ASSETNUM", "DESCRIPTION", "SITEID", "LOCATION", "PARENT",
                                 "MANUFACTURER", "VENDOR", "SERIALNUM", "ASSETTYPE", "STATUS", "CUSTOM.*"],
                "workorder_object": "mxapiwodetail (WORKORDER)",
                "workorder_fields": ["WONUM", "DESCRIPTION", "ASSETNUM", "STATUS", "WORKTYPE",
                                     "FAILUREREPORT.FAILURECODE", "FAILUREREPORT.PROBLEMCODE"],
                "location_hierarchy": "LOCATIONS + LOCHIERARCHY (SYSTEMID=PRIMARY)",
            },
            notes="Mock IBM Maximo. Real connector swaps _load() for MAS OSLC REST.",
        )

    # --- import (#2) ---------------------------------------------------------
    async def import_records(
        self, record_type: RecordType, *, since: str | None = None, limit: int = 500
    ) -> list[RawRecord]:
        data = self._load()
        section_for = {
            RecordType.LOCATION: ("locations", "LOCATION"),
            RecordType.ASSET: ("assets", "ASSETNUM"),
            RecordType.WORK_ORDER: ("workorders", "WONUM"),
            RecordType.PM_TASK: ("pmtasks", "PMNUM"),
            RecordType.FAILURE_CODE: ("failurecodes", "FAILURECODE"),
            RecordType.METER: ("meters", "METERNAME"),
            RecordType.PART: ("parts", "ITEMNUM"),
            RecordType.DOCUMENT: ("doclinks", "DOCUMENT"),
        }
        if record_type not in section_for:
            return []
        section, pk = section_for[record_type]
        rows = data.get(section, [])[:limit]
        return [
            RawRecord(
                source_system=self.provider,
                record_type=record_type,
                source_record_id=str(row[pk]),
                fields=row,
            )
            for row in rows
        ]

    # --- normalize (#3) ------------------------------------------------------
    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        loc_index = {loc["LOCATION"]: loc for loc in self._load().get("locations", [])}
        for r in raw:
            f = r.fields
            if r.record_type is RecordType.LOCATION:
                out.append(self._loc(f))
            elif r.record_type is RecordType.ASSET:
                out.append(self._asset(f, loc_index))
            elif r.record_type is RecordType.WORK_ORDER:
                out.append(self._workorder(f))
            elif r.record_type is RecordType.PM_TASK:
                out.append(self._pm(f))
            elif r.record_type is RecordType.FAILURE_CODE:
                out.append(self._failurecode(f))
            elif r.record_type is RecordType.METER:
                out.append(self._meter(f))
            elif r.record_type is RecordType.PART:
                out.append(self._part(f))
            elif r.record_type is RecordType.DOCUMENT:
                out.append(self._doc(f))
        return out

    def _loc_path(self, location: str | None, loc_index: dict[str, Any]) -> list[str]:
        """Walk LOCATIONS.PARENT up to the root, return descriptions root→leaf (slug source)."""
        chain: list[str] = []
        cur = location
        seen: set[str] = set()
        while cur and cur in loc_index and cur not in seen:
            seen.add(cur)
            chain.append(loc_index[cur]["DESCRIPTION"])
            cur = loc_index[cur].get("PARENT")
        return list(reversed(chain))

    def _loc(self, f: dict[str, Any]) -> CanonicalLocation:
        loc_index = {loc["LOCATION"]: loc for loc in self._load().get("locations", [])}
        path = self._loc_path(f["LOCATION"], loc_index)
        type_map = {0: "site", 1: "area", 2: "line", 3: "cell"}
        depth = max(0, len(path) - 1)
        return CanonicalLocation(
            source_system=self.provider,
            source_record_id=str(f["LOCATION"]),
            name=f.get("DESCRIPTION", f["LOCATION"]),
            location_type=type_map.get(depth, "cell"),
            parent_source_id=f.get("PARENT"),
            proposed_uns_path=candidate_uns_path(*path) if path else None,
            confidence=0.7,
            raw=f,
        )

    def _asset(self, f: dict[str, Any], loc_index: dict[str, Any]) -> CanonicalAsset:
        custom = f.get("CUSTOM", {}) or {}
        loc_path = self._loc_path(f.get("LOCATION"), loc_index)
        path = candidate_uns_path(*loc_path, f["ASSETNUM"]) if loc_path else None
        crit = _CRIT.get(str(custom.get("ASSETSPEC_CRITICALITY", "")).upper())
        return CanonicalAsset(
            source_system=self.provider,
            source_record_id=str(f["ASSETNUM"]),
            name=f.get("DESCRIPTION", f["ASSETNUM"]),
            manufacturer=f.get("MANUFACTURER") or f.get("VENDOR"),
            model=custom.get("MODELNUM"),
            serial=f.get("SERIALNUM"),
            asset_type=f.get("ASSETTYPE"),
            parent_source_id=f.get("PARENT"),
            criticality=crit,
            location_path=".".join(loc_path) if loc_path else None,
            proposed_uns_path=path,
            attributes={k: v for k, v in custom.items() if k != "MODELNUM"},
            confidence=0.6,
            raw=f,
        )

    def _workorder(self, f: dict[str, Any]) -> CanonicalWorkOrder:
        fr = f.get("FAILUREREPORT") or {}
        return CanonicalWorkOrder(
            source_system=self.provider,
            source_record_id=str(f["WONUM"]),
            wo_number=str(f["WONUM"]),
            title=f.get("DESCRIPTION", ""),
            description=f.get("DESCRIPTION", ""),
            status=_WO_STATUS.get(f.get("STATUS", ""), f.get("STATUS")),
            work_type=_WORKTYPE.get(f.get("WORKTYPE", ""), f.get("WORKTYPE")),
            priority=str(f.get("WOPRIORITY")) if f.get("WOPRIORITY") is not None else None,
            asset_source_id=f.get("ASSETNUM"),
            failure_code=fr.get("FAILURECODE"),
            reported_by=f.get("REPORTEDBY"),
            reported_at=f.get("REPORTDATE"),
            completed_at=f.get("ACTFINISH"),
            confidence=0.9,
            raw=f,
        )

    def _pm(self, f: dict[str, Any]) -> CanonicalPMTask:
        return CanonicalPMTask(
            source_system=self.provider,
            source_record_id=str(f["PMNUM"]),
            pm_number=str(f["PMNUM"]),
            description=f.get("DESCRIPTION", ""),
            asset_source_id=f.get("ASSETNUM"),
            frequency=f.get("FREQUENCY"),
            frequency_unit=str(f.get("FREQUNIT", "")).lower() or None,
            job_plan=f.get("JPNUM"),
            next_due=f.get("NEXTDATE"),
            confidence=0.9,
            raw=f,
        )

    def _failurecode(self, f: dict[str, Any]) -> CanonicalFailureCode:
        t = f.get("TYPE", "")
        return CanonicalFailureCode(
            source_system=self.provider,
            source_record_id=str(f["FAILURECODE"]),
            code=str(f["FAILURECODE"]),
            description=f.get("DESCRIPTION", ""),
            failure_class=f.get("FAILURECODE") if t == "FAILURECLASS" else f.get("PARENT"),
            problem=f.get("FAILURECODE") if t == "PROBLEM" else None,
            cause=f.get("FAILURECODE") if t == "CAUSE" else None,
            remedy=f.get("FAILURECODE") if t == "REMEDY" else None,
            confidence=0.85,
            raw=f,
        )

    def _meter(self, f: dict[str, Any]) -> CanonicalMeter:
        return CanonicalMeter(
            source_system=self.provider,
            source_record_id=f"{f.get('ASSETNUM')}:{f['METERNAME']}",
            name=str(f["METERNAME"]),
            asset_source_id=f.get("ASSETNUM"),
            last_reading=f.get("LASTREADING"),
            unit=f.get("MEASUREUNITID"),
            meter_type=str(f.get("METERTYPE", "")).lower() or None,
            confidence=0.9,
            raw=f,
        )

    def _part(self, f: dict[str, Any]) -> CanonicalPart:
        return CanonicalPart(
            source_system=self.provider,
            source_record_id=str(f["ITEMNUM"]),
            item_number=str(f["ITEMNUM"]),
            description=f.get("DESCRIPTION", ""),
            store_location=f.get("STORELOC"),
            issue_unit=f.get("ISSUEUNIT"),
            qty_on_hand=f.get("CURBALTOTAL"),
            confidence=0.85,
            raw=f,
        )

    def _doc(self, f: dict[str, Any]) -> CanonicalDocument:
        return CanonicalDocument(
            source_system=self.provider,
            source_record_id=str(f["DOCUMENT"]),
            title=f.get("DESCRIPTION", f["DOCUMENT"]),
            doc_type="manual",
            uri=f.get("URLNAME"),
            asset_source_id=f.get("OWNERID") if f.get("OWNERTABLE") == "ASSET" else None,
            confidence=0.8,
            raw=f,
        )

    # --- derive relationships (cross-record) ---------------------------------
    def derive_relationships(self, records: list[CanonicalRecord]) -> list[CanonicalRelationship]:
        rels: list[CanonicalRelationship] = []
        for rec in records:
            if isinstance(rec, CanonicalAsset):
                # asset → parent asset : HAS_COMPONENT (parent owns child)
                if rec.parent_source_id:
                    rels.append(self._rel(
                        "HAS_COMPONENT", rec.parent_source_id, "asset", rec.source_record_id, "asset",
                        EvidenceRef("manifest", f"Maximo ASSET.PARENT on {rec.source_record_id}",
                                    page_or_location="MXASSET.PARENT", confidence_contribution=0.8),
                        confidence=0.7,
                    ))
                # asset → location : LOCATED_IN (asset id and location id may coincide —
                # distinct ref_kinds keep it from looking like a self-loop)
                loc = rec.raw.get("LOCATION")
                if loc:
                    rels.append(self._rel(
                        "LOCATED_IN", rec.source_record_id, "asset", str(loc), "location",
                        EvidenceRef("manifest", f"Maximo ASSET.LOCATION on {rec.source_record_id}",
                                    page_or_location="MXASSET.LOCATION", confidence_contribution=0.7),
                        confidence=0.7,
                    ))
            elif isinstance(rec, CanonicalDocument) and rec.asset_source_id:
                # asset → document : HAS_DOCUMENT
                rels.append(self._rel(
                    "HAS_DOCUMENT", rec.asset_source_id, "asset", rec.source_record_id, "document",
                    EvidenceRef("manifest", f"Maximo DOCLINKS owner {rec.asset_source_id}",
                                page_or_location="DOCLINKS.OWNERID", confidence_contribution=0.8),
                    confidence=0.8,
                ))
            elif isinstance(rec, CanonicalWorkOrder) and rec.asset_source_id and rec.failure_code:
                # failure code → asset : OCCURS_ON (evidence = the work order)
                rels.append(self._rel(
                    "OCCURS_ON", rec.failure_code, "failure_code", rec.asset_source_id, "asset",
                    EvidenceRef("work_order", f"WO {rec.wo_number}: {rec.title}",
                                page_or_location=f"WONUM {rec.wo_number}", confidence_contribution=0.6),
                    confidence=0.55,
                ))
        return rels

    def _rel(
        self, rel_type: str, source_ref: str, source_kind: str, target_ref: str, target_kind: str,
        evidence: EvidenceRef, *, confidence: float,
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
            reasoning=f"Derived from Maximo {rel_type} link",
            evidence=[evidence],
        )

    # --- export (#5): CMMS write-back (work orders) --------------------------
    async def _do_export(self, enriched: list[CanonicalRecord]) -> ExportResult:
        # Mock write-back: pretend to PATCH work orders back to Maximo. Only WOs are
        # writable; everything else is refused. A real connector would POST/PATCH
        # mxapiwodetail. This targets the CMMS API, not the plant — allowed by doctrine.
        writable = [r for r in enriched if isinstance(r, CanonicalWorkOrder)]
        refused = len(enriched) - len(writable)
        return ExportResult(exported=len(writable), refused=refused)

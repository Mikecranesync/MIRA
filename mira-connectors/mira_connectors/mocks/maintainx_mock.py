"""MaintainXMockConnector — fixture-backed MaintainX (CMMS) connector.

Reads ``fixtures/maintainx.json`` in MaintainX's REST response shape (the same
envelopes the live ``mira-mcp/cmms/maintainx.py`` adapter parses — ``assets`` /
``workOrders`` / ``locations`` / ``parts``). ``is_mock = True``.

A real ``MaintainXConnector`` would wrap the already-working
``mira-mcp/cmms/maintainx.py:MaintainXCMMS`` HTTP client (Bearer key from Doppler) in
``import_records`` / ``_do_export`` and keep ``normalize`` / ``derive_relationships``
verbatim — exactly the future entry the factory registry comments anticipate.
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
    CanonicalRecord,
    CanonicalRelationship,
    CanonicalWorkOrder,
    EvidenceRef,
    RawRecord,
    RecordType,
)
from mira_connectors.types.cmms import CMMSConnector

_FIXTURE = Path(__file__).parent / "fixtures" / "maintainx.json"

# MaintainX status → MIRA work-order status.
_WO_STATUS = {
    "OPEN": "OPEN",
    "IN_PROGRESS": "IN_PROGRESS",
    "ON_HOLD": "IN_PROGRESS",
    "DONE": "COMPLETE",
}
# MaintainX category → MIRA work_type (first category wins).
_WORKTYPE = {"REACTIVE": "corrective", "PREVENTIVE": "preventive", "INSPECTION": "preventive"}

MAINTAINX_RECORD_TYPES = [
    RecordType.LOCATION,
    RecordType.ASSET,
    RecordType.WORK_ORDER,
    RecordType.PART,
]


class MaintainXMockConnector(CMMSConnector):
    provider = "maintainx"
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
            "assets": len(data.get("assets", [])),
        }

    async def discover(self) -> ConnectorCapabilities:
        return ConnectorCapabilities(
            kind=ConnectorKind.CMMS,
            provider=self.provider,
            record_types=MAINTAINX_RECORD_TYPES,
            supports_export=True,  # work-order patch (CMMS API, not the plant)
            supports_incremental=True,
            schema={
                "asset_endpoint": "GET /v1/assets",
                "asset_fields": [
                    "id",
                    "name",
                    "description",
                    "locationId",
                    "parentId",
                    "manufacturer",
                    "model",
                    "serialNumber",
                    "status",
                ],
                "workorder_endpoint": "GET /v1/workorders",
                "workorder_fields": ["id", "title", "priority", "status", "categories", "assetId"],
                "location_endpoint": "GET /v1/locations (flat tree via parentId)",
            },
            notes="Mock MaintainX. Real connector wraps mira-mcp/cmms/maintainx.py MaintainXCMMS.",
        )

    async def import_records(
        self, record_type: RecordType, *, since: Optional[str] = None, limit: int = 500
    ) -> list[RawRecord]:
        data = self._load()
        section_for = {
            RecordType.LOCATION: "locations",
            RecordType.ASSET: "assets",
            RecordType.WORK_ORDER: "workOrders",
            RecordType.PART: "parts",
        }
        section = section_for.get(record_type)
        if not section:
            return []
        rows = data.get(section, [])[:limit]
        return [RawRecord(self.provider, record_type, str(row["id"]), row) for row in rows]

    # --- normalize -----------------------------------------------------------

    def _loc_index(self) -> dict[Any, dict[str, Any]]:
        return {loc["id"]: loc for loc in self._load().get("locations", [])}

    def _loc_chain(self, location_id: Any) -> list[str]:
        """Walk parentId root→leaf, returning location names (the candidate path source)."""
        index = self._loc_index()
        chain: list[str] = []
        cur, seen = location_id, set()
        while cur is not None and cur in index and cur not in seen:
            seen.add(cur)
            chain.append(index[cur]["name"])
            cur = index[cur].get("parentId")
        return list(reversed(chain))

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for r in raw:
            f = r.fields
            if r.record_type is RecordType.LOCATION:
                out.append(self._loc(f))
            elif r.record_type is RecordType.ASSET:
                out.append(self._asset(f))
            elif r.record_type is RecordType.WORK_ORDER:
                out.append(self._workorder(f))
            elif r.record_type is RecordType.PART:
                out.append(self._part(f))
        return out

    def _loc(self, f: dict[str, Any]) -> CanonicalLocation:
        index = self._loc_index()
        depth, cur = 0, f
        while cur.get("parentId") is not None and cur["parentId"] in index:
            depth += 1
            cur = index[cur["parentId"]]
        type_map = {0: "site", 1: "area", 2: "line", 3: "cell"}
        return CanonicalLocation(
            source_system=self.provider,
            source_record_id=str(f["id"]),
            name=f.get("name", str(f["id"])),
            location_type=type_map.get(depth, "cell"),
            parent_source_id=str(f["parentId"]) if f.get("parentId") is not None else None,
            proposed_uns_path=candidate_uns_path(*self._loc_chain(f["id"])),
            confidence=0.75,
            raw=f,
        )

    def _asset(self, f: dict[str, Any]) -> CanonicalAsset:
        loc_chain = self._loc_chain(f.get("locationId"))
        path = candidate_uns_path(*loc_chain, f["name"]) if loc_chain else None
        return CanonicalAsset(
            source_system=self.provider,
            source_record_id=str(f["id"]),
            name=f.get("name", str(f["id"])),
            manufacturer=f.get("manufacturer"),
            model=f.get("model"),
            serial=f.get("serialNumber"),
            asset_type=f.get("status"),
            parent_source_id=str(f["parentId"]) if f.get("parentId") is not None else None,
            location_path=".".join(loc_chain) if loc_chain else None,
            proposed_uns_path=path,
            attributes={"description": f.get("description")},
            confidence=0.6,
            raw=f,
        )

    def _workorder(self, f: dict[str, Any]) -> CanonicalWorkOrder:
        cats = f.get("categories", []) or []
        work_type = _WORKTYPE.get(cats[0], None) if cats else None
        return CanonicalWorkOrder(
            source_system=self.provider,
            source_record_id=str(f["id"]),
            wo_number=str(f["id"]),
            title=f.get("title", ""),
            description=f.get("description", ""),
            status=_WO_STATUS.get(f.get("status", ""), f.get("status")),
            work_type=work_type,
            priority=f.get("priority"),
            asset_source_id=str(f["assetId"]) if f.get("assetId") is not None else None,
            reported_at=f.get("createdAt"),
            completed_at=f.get("completedAt"),
            confidence=0.9,
            raw=f,
        )

    def _part(self, f: dict[str, Any]) -> CanonicalPart:
        return CanonicalPart(
            source_system=self.provider,
            source_record_id=str(f.get("partNumber") or f["id"]),
            item_number=str(f.get("partNumber") or f["id"]),
            description=f.get("name", ""),
            qty_on_hand=f.get("quantityInStock"),
            confidence=0.85,
            raw=f,
        )

    # --- derive relationships ------------------------------------------------

    def derive_relationships(self, records: list[CanonicalRecord]) -> list[CanonicalRelationship]:
        rels: list[CanonicalRelationship] = []
        for rec in records:
            if isinstance(rec, CanonicalAsset):
                if rec.parent_source_id:
                    rels.append(
                        self._rel(
                            "HAS_COMPONENT",
                            rec.parent_source_id,
                            "asset",
                            rec.source_record_id,
                            "asset",
                            EvidenceRef(
                                "manifest",
                                f"MaintainX asset.parentId on {rec.source_record_id}",
                                page_or_location="asset.parentId",
                                confidence_contribution=0.8,
                            ),
                            confidence=0.7,
                        )
                    )
                loc_id = rec.raw.get("locationId")
                if loc_id is not None:
                    rels.append(
                        self._rel(
                            "LOCATED_IN",
                            rec.source_record_id,
                            "asset",
                            str(loc_id),
                            "location",
                            EvidenceRef(
                                "manifest",
                                f"MaintainX asset.locationId on {rec.source_record_id}",
                                page_or_location="asset.locationId",
                                confidence_contribution=0.7,
                            ),
                            confidence=0.7,
                        )
                    )
            elif isinstance(rec, CanonicalPart):
                for aid in rec.raw.get("assetIds", []):
                    rels.append(
                        self._rel(
                            "HAS_PART",
                            str(aid),
                            "asset",
                            rec.source_record_id,
                            "part",
                            EvidenceRef(
                                "manifest",
                                f"MaintainX part.assetIds links {rec.item_number} to {aid}",
                                page_or_location="part.assetIds",
                                confidence_contribution=0.7,
                            ),
                            confidence=0.65,
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
            reasoning=f"Derived from MaintainX {rel_type} link",
            evidence=[evidence],
        )

    async def _do_export(self, enriched: list[CanonicalRecord]) -> ExportResult:
        # Mock write-back: PATCH /v1/workorders/{id}. CMMS-API target, not the plant.
        writable = [r for r in enriched if isinstance(r, CanonicalWorkOrder)]
        return ExportResult(exported=len(writable), refused=len(enriched) - len(writable))

"""PIMockConnector — fixture-backed AVEVA PI / OSIsoft (Historian) connector.

Reads ``fixtures/pi.json`` and normalizes a PI System export into the canonical
model. ``is_mock = True``. Read-only by construction (inherited from
``HistorianConnector`` — MIRA never writes to a plant historian).

What a historian connector imports (per ``types/historian.py``): point metadata and
rolled-up history, not the raw high-frequency firehose (that belongs to the relay /
event-stream layer, master plan Phase 5). So:

* AF element hierarchy → ``CanonicalAsset`` (one per element; AF Path is the id).
* PI points            → ``CanonicalTag`` (``tag_kind`` historian; PI point name is
  the address; archived-value summary rides in ``attributes``).
* archived values      → ``CanonicalMeter`` (rolled-up last reading per point).
* event frames         → preserved on the owning element's ``attributes`` and surfaced
  in ``discover()``; materializing them as fault events is a gate/Phase-5 concern, not
  the historian's mandate.

A real ``PIConnector`` swaps ``_load()`` for the PI Web API and keeps
``normalize`` / ``derive_relationships`` verbatim.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from mira_connectors._uns import candidate_uns_path
from mira_connectors.base import ConnectorCapabilities, ConnectorConfig, ConnectorKind
from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalMeter,
    CanonicalRecord,
    CanonicalRelationship,
    CanonicalTag,
    EvidenceRef,
    RawRecord,
    RecordType,
)
from mira_connectors.types.historian import HISTORIAN_RECORD_TYPES, HistorianConnector

_FIXTURE = Path(__file__).parent / "fixtures" / "pi.json"

# PI PointType → MIRA canonical data_type.
_DT = {
    "Float16": "float",
    "Float32": "float",
    "Float64": "float",
    "Int16": "int",
    "Int32": "int",
    "Digital": "bool",
    "String": "string",
}
_SAFETY_TEMPLATES = ("safety event", "safety", "estop", "e-stop", "lockout")


class PIMockConnector(HistorianConnector):
    provider = "pi"
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
            "af_database": data.get("af_database"),
        }

    async def discover(self) -> ConnectorCapabilities:
        data = self._load()
        return ConnectorCapabilities(
            kind=ConnectorKind.HISTORIAN,
            provider=self.provider,
            record_types=HISTORIAN_RECORD_TYPES,
            supports_export=False,  # read-only by construction
            supports_incremental=True,
            schema={
                "af_database": data.get("af_database"),
                "element_count": len(data.get("af_elements", [])),
                "point_count": len(data.get("pi_points", [])),
                "event_frame_count": len(data.get("event_frames", [])),
                "point_fields": ["Name", "PointType", "EngUnits", "Descriptor", "element_path"],
            },
            notes="Mock AVEVA PI. AF element Path → ISA-95 by hierarchy (heuristic). Read-only.",
        )

    # --- import --------------------------------------------------------------

    async def import_records(
        self, record_type: RecordType, *, since: Optional[str] = None, limit: int = 500
    ) -> list[RawRecord]:
        data = self._load()
        if record_type is RecordType.ASSET:
            rows = data.get("af_elements", [])[:limit]
            return [RawRecord(self.provider, record_type, r["Path"], r) for r in rows]
        if record_type is RecordType.TAG:
            rows = data.get("pi_points", [])[:limit]
            return [RawRecord(self.provider, record_type, r["Name"], r) for r in rows]
        if record_type is RecordType.METER:
            # rolled-up history: one meter per point that has archived values
            archived = {a["pi_point"] for a in data.get("archived_values", [])}
            pts = [p for p in data.get("pi_points", []) if p["Name"] in archived][:limit]
            return [RawRecord(self.provider, record_type, p["Name"], p) for p in pts]
        return []

    # --- normalize -----------------------------------------------------------

    def _archived(self) -> dict[str, list[dict[str, Any]]]:
        return {a["pi_point"]: a.get("values", []) for a in self._load().get("archived_values", [])}

    def _event_frames_for(self, element_path: str) -> list[dict[str, Any]]:
        return [
            {
                "name": ef["Name"],
                "template": ef.get("Template"),
                "start": ef.get("StartTime"),
                "end": ef.get("EndTime"),
            }
            for ef in self._load().get("event_frames", [])
            if ef.get("element_path") == element_path
        ]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        archived = self._archived()
        for r in raw:
            f = r.fields
            if r.record_type is RecordType.ASSET:
                out.append(self._element(f))
            elif r.record_type is RecordType.TAG:
                out.append(self._point(f, archived))
            elif r.record_type is RecordType.METER:
                out.append(self._meter(f, archived))
        return out

    def _element(self, f: dict[str, Any]) -> CanonicalAsset:
        segs = f["Path"].split("\\")
        events = self._event_frames_for(f["Path"])
        attrs = {a["Name"]: a.get("Value") for a in f.get("attributes", [])}
        if events:
            attrs["event_frames"] = events  # preserve event frames on the element
        # An element with a safety-template event frame (E-stop/LOTO) is flagged
        # safety_critical so the confirmation gate gates it for review.
        is_safety = any(
            any(
                s in (ev.get("template") or "").lower() or s in (ev.get("name") or "").lower()
                for s in _SAFETY_TEMPLATES
            )
            for ev in events
        )
        return CanonicalAsset(
            source_system=self.provider,
            source_record_id=f["Path"],
            name=f.get("Name", f["Path"]),
            asset_type=f.get("Template"),
            parent_source_id=f.get("Parent"),
            criticality="safety_critical" if is_safety else None,
            location_path=".".join(segs),
            proposed_uns_path=candidate_uns_path(*segs),
            attributes=attrs,
            confidence=0.6,  # AF→ISA-95 mapping is a heuristic
            raw=f,
        )

    def _point(self, f: dict[str, Any], archived: dict[str, list]) -> CanonicalTag:
        segs = f["element_path"].split("\\")
        leaf = f["Name"].split("\\")[-1]
        samples = archived.get(f["Name"], [])
        return CanonicalTag(
            source_system=self.provider,
            source_record_id=f["Name"],
            tag_id=".".join([*segs, leaf]),
            data_type=_DT.get(f.get("PointType", ""), "float"),
            engineering_unit=f.get("EngUnits") or None,
            scada_path=f["Name"],
            address=f["Name"],  # PI point id is the address
            history_enabled=True,  # a historian point always has history
            asset_source_id=f.get("element_path"),
            proposed_uns_path=candidate_uns_path(*segs, leaf),
            attributes={
                "descriptor": f.get("Descriptor"),
                "sample_count": len(samples),
                "last_value": samples[-1]["Value"] if samples else None,
            },
            confidence=0.8,
            raw=f,
        )

    def _meter(self, f: dict[str, Any], archived: dict[str, list]) -> CanonicalMeter:
        samples = archived.get(f["Name"], [])
        return CanonicalMeter(
            source_system=self.provider,
            source_record_id=f"meter:{f['Name']}",
            name=f["Name"].split("\\")[-1],
            asset_source_id=f.get("element_path"),
            last_reading=samples[-1]["Value"] if samples else None,
            unit=f.get("EngUnits") or None,
            meter_type="continuous",
            confidence=0.8,
            raw={**f, "_archived_values": samples},
        )

    # --- derive relationships ------------------------------------------------

    def derive_relationships(self, records: list[CanonicalRecord]) -> list[CanonicalRelationship]:
        rels: list[CanonicalRelationship] = []
        for rec in records:
            if isinstance(rec, CanonicalAsset) and rec.parent_source_id:
                # AF element hierarchy: parent element owns child → HAS_COMPONENT
                rels.append(
                    self._rel(
                        "HAS_COMPONENT",
                        rec.parent_source_id,
                        "asset",
                        rec.source_record_id,
                        "asset",
                        EvidenceRef(
                            "manifest",
                            f"PI AF element parent of {rec.source_record_id}",
                            page_or_location="AF.Parent",
                            confidence_contribution=0.7,
                        ),
                        confidence=0.65,
                    )
                )
            elif isinstance(rec, CanonicalTag) and rec.asset_source_id:
                # PI point on an AF element → element HAS_SIGNAL tag
                rels.append(
                    self._rel(
                        "HAS_SIGNAL",
                        rec.asset_source_id,
                        "asset",
                        rec.tag_id,
                        "tag",
                        EvidenceRef(
                            "tag_list",
                            f"PI point {rec.scada_path} on element {rec.asset_source_id}",
                            page_or_location=rec.address,
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
            reasoning=f"Derived from PI AF {rel_type}",
            evidence=[evidence],
        )

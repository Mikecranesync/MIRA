"""AVEVA PI / OSIsoft PI System mock connector (historian).

Maps a PI System export into the canonical model:

* **AF element hierarchy** → ``site``/``area``/``asset``/``component`` by depth
  in the element ``Path`` (AF database name → company). The AF→ISA-95 mapping is
  a heuristic, so the hierarchy is ``proposed``, not asserted.
* **PI points** → ``tag`` entities (``tag_kind=historian``) attached to their AF
  element via ``HAS_SIGNAL``; archived values ride along as samples.
* **Event frames** → ``fault_event`` entities + ``OCCURS_ON`` the element.
  A safety-template event frame (E-stop) is flagged ``safety_critical``.

PI is read-only telemetry; ``export_enriched`` is unsupported.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from base import Capability, Connector, ExportResult, RawRecord
from canonical import (
    CanonicalEntity,
    CanonicalRelationship,
    NormalizedGraph,
    Proposal,
    SourceObject,
    ValidationReport,
)
from uns_bridge import uns

logger = logging.getLogger("mira-connectors.pi")

_FIXTURE = Path(__file__).parent / "fixtures" / "pi_demo_points.json"
_SAFETY_TEMPLATES = ("safety event", "safety", "estop", "e-stop", "lockout")


class PIMockConnector(Connector):
    name = "pi_mock"
    system_kind = "historian"
    connector_version = "0.1.0"

    def __init__(
        self,
        fixture_path: Optional[Path] = None,
        dry_run: bool = True,
        read_only: bool = True,
    ) -> None:
        super().__init__(dry_run=dry_run, read_only=read_only)
        self._fixture_path = Path(fixture_path) if fixture_path else _FIXTURE
        self._data: dict[str, Any] = {}

    def _load(self) -> dict[str, Any]:
        if not self._data:
            self._data = json.loads(self._fixture_path.read_text())
        return self._data

    async def discover(self) -> Capability:
        data = self._load()
        schema = {}
        for ot, key in (("af_element", "af_elements"), ("pi_point", "pi_points"), ("event_frame", "event_frames")):
            rows = data.get(key, [])
            if rows:
                schema[ot] = sorted({k for r in rows for k in r.keys()})
        return Capability(
            system_kind=self.system_kind,
            display_name="AVEVA PI System (mock)",
            object_types=list(schema.keys()),
            supports_export=False,
            read_only=self.read_only,
            schema=schema,
            notes=f"AF database '{data.get('af_database')}'. AF element Path → ISA-95 by depth (heuristic).",
        )

    async def import_records(
        self, config: Optional[dict[str, Any]] = None
    ) -> list[RawRecord]:
        data = self._load()
        out: list[RawRecord] = []
        for el in data.get("af_elements", []):
            out.append(RawRecord("af_element", el["Path"], el))
        for pt in data.get("pi_points", []):
            out.append(RawRecord("pi_point", pt["Name"], pt))
        for ef in data.get("event_frames", []):
            out.append(RawRecord("event_frame", ef["Name"], ef))
        return out

    def normalize(self, raw_records: list[RawRecord]) -> NormalizedGraph:
        g = NormalizedGraph()
        by_type: dict[str, list[RawRecord]] = {}
        for r in raw_records:
            by_type.setdefault(r.object_type, []).append(r)

        company = uns.slug(self._load().get("af_database") or "historian")
        archived = {a["pi_point"]: a.get("values", []) for a in self._load().get("archived_values", [])}

        elem_uns = self._normalize_elements(g, company, by_type.get("af_element", []))
        self._normalize_points(g, by_type.get("pi_point", []), elem_uns, archived)
        self._normalize_event_frames(g, by_type.get("event_frame", []), elem_uns)
        return g

    @staticmethod
    def _depth(path: str) -> int:
        return path.count("\\")

    def _normalize_elements(
        self, g: NormalizedGraph, company: str, rows: list[RawRecord]
    ) -> dict[str, str]:
        """Map AF elements to the canonical hierarchy. Returns element_path → entity.key."""
        elem_key: dict[str, str] = {}
        # build a path→element index and resolve site/area chain by depth
        elems = {r.payload["Path"]: r.payload for r in rows}

        def chain(path: str) -> dict[str, str]:
            out: dict[str, str] = {}
            cur: Optional[str] = path
            guard = 0
            while cur and guard < 12:
                guard += 1
                el = elems.get(cur)
                if not el:
                    break
                d = self._depth(cur)
                level = {0: "site", 1: "area", 2: "asset", 3: "component"}.get(d)
                if level in ("area", "site"):
                    out.setdefault(level, uns.slug(el["Name"]))
                cur = el.get("Parent")
            return out

        # ordered by depth so parents exist (in elem_key) before children
        for r in sorted(rows, key=lambda x: self._depth(x.payload["Path"])):
            el = r.payload
            d = self._depth(el["Path"])
            name = el["Name"]
            ctx = chain(el["Path"])
            site = ctx.get("site", "site")
            parent_key = elem_key.get(el.get("Parent") or "")
            if d == 0:
                etype, path = "site", uns.site_path(company, name)
            elif d == 1:
                etype, path = "area", uns.area_path(company, site, name)
            elif d == 2:
                etype = "asset"
                path = uns.assigned_equipment_path(company, site, ctx.get("area", "unassigned"), name)
            else:
                etype = "component"
                parent_path = g.get(parent_key).uns_path if parent_key and g.get(parent_key) else None
                path = uns.equipment_subnode_path(parent_path, "component", name) if parent_path else None
            ent = self._emit(
                g, etype, f"af:{el['Path']}", "af_element", el["Path"],
                {"af_name": name, "template": el.get("Template"), "af_path": el["Path"], "attributes": el.get("attributes", [])},
                path, 0.6, raw=el,  # AF→ISA-95 is a heuristic → modest confidence
            )
            elem_key[el["Path"]] = ent.key
            if parent_key:
                if etype == "component":
                    # parent asset HAS_COMPONENT child (canonical parent→child)
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=parent_key, target_key=ent.key,
                            relationship_type="HAS_COMPONENT", confidence=0.6,
                            evidence=[{"kind": "af_element", "ref": el["Path"]}],
                        )
                    )
                else:
                    # area/asset LOCATED_IN its parent (child→parent)
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=ent.key, target_key=parent_key,
                            relationship_type="LOCATED_IN", confidence=0.6,
                            evidence=[{"kind": "af_element", "ref": el["Path"]}],
                        )
                    )
        return elem_key

    def _normalize_points(
        self, g: NormalizedGraph, rows: list[RawRecord], elem_uns: dict[str, str], archived: dict[str, list]
    ) -> None:
        for r in rows:
            pt = r.payload
            elem_path = pt.get("element_path", "")
            anchor_key = elem_uns.get(elem_path)
            anchor = g.get(anchor_key) if anchor_key else None
            uns_path = (
                uns.equipment_subnode_path(anchor.uns_path, "datapoint", pt["Name"].split("\\")[-1])
                if anchor and anchor.uns_path
                else None
            )
            samples = archived.get(pt["Name"], [])
            ent = self._emit(
                g, "tag", pt["Name"], "pi_point", pt["Name"],
                {
                    "tag_kind": "historian",
                    "pi_point": pt["Name"],
                    "point_type": pt.get("PointType"),
                    "eng_unit": pt.get("EngUnits"),
                    "descriptor": pt.get("Descriptor"),
                    "sample_count": len(samples),
                    "last_value": samples[-1]["Value"] if samples else None,
                },
                uns_path, 0.7, raw={**pt, "_archived_values": samples},
            )
            if anchor:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=anchor.key, target_key=ent.key, relationship_type="HAS_SIGNAL",
                        confidence=0.7, evidence=[{"kind": "pi_point", "ref": pt["Name"], "detail": elem_path}],
                    )
                )

    def _normalize_event_frames(
        self, g: NormalizedGraph, rows: list[RawRecord], elem_uns: dict[str, str]
    ) -> None:
        for r in rows:
            ef = r.payload
            template = (ef.get("Template") or "").lower()
            is_safety = any(s in template or s in ef.get("Name", "").lower() for s in _SAFETY_TEMPLATES)
            ent = self._emit(
                g, "fault_event", ef["Name"], "event_frame", ef["Name"],
                {
                    "template": ef.get("Template"),
                    "start": ef.get("StartTime"),
                    "end": ef.get("EndTime"),
                    "attributes": ef.get("attributes", []),
                    "is_safety": is_safety,
                },
                None, 0.75, raw=ef,
            )
            anchor_key = elem_uns.get(ef.get("element_path", ""))
            anchor = g.get(anchor_key) if anchor_key else None
            if anchor:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=ent.key, target_key=anchor.key, relationship_type="OCCURS_ON",
                        confidence=0.75, evidence=[{"kind": "event_frame", "ref": ef["Name"]}],
                    )
                )
            if is_safety:
                g.add_proposal(
                    Proposal(
                        suggestion_type="kg_entity",
                        title=f"Safety review: PI event frame '{ef['Name']}'",
                        body=(
                            f"Event frame '{ef['Name']}' (template {ef.get('Template')}) is a safety "
                            "event. Review before MIRA reasons over it in a technician-facing answer."
                        ),
                        extracted_data={"event_frame": ef["Name"], "element_path": ef.get("element_path")},
                        confidence=0.7,
                        risk_level="safety_critical",
                        proposed_by=f"import:{self.name}",
                        source_kind="live_event",
                    )
                )

    def _emit(
        self, g: NormalizedGraph, entity_type: str, name: str, object_type: str, external_id: str,
        properties: dict[str, Any], uns_path: Optional[str], confidence: float, raw: dict[str, Any],
    ) -> CanonicalEntity:
        ent = g.add_entity(
            CanonicalEntity(
                entity_type=entity_type, name=name, uns_path=uns_path, properties=properties,
                confidence=confidence, source_system=self.system_kind, object_type=object_type,
                external_object_id=external_id, source_payload=dict(raw),
            )
        )
        g.add_source_object(
            SourceObject(
                system_kind=self.system_kind, object_type=object_type, external_object_id=external_id,
                raw_payload=dict(raw), connector_version=self.connector_version,
                mapping_status="mapped", mapped_entity_key=ent.key,
            )
        )
        return ent

    def validate(self, graph: NormalizedGraph) -> ValidationReport:
        report = ValidationReport()
        keys = set(graph.entities.keys())
        for ent in graph.entities.values():
            if ent.uns_path and not uns.is_valid_path(ent.uns_path):
                report.add("error", "invalid_uns_path", f"{ent.key}: {ent.uns_path!r}", ent.key)
            if ent.approval_state != "proposed":
                report.add("error", "auto_verified", ent.key, ent.key)
            if not ent.source_payload:
                report.add("error", "missing_source_payload", ent.key, ent.key)
        for rel in graph.relationships:
            for endpoint in (rel.source_key, rel.target_key):
                if endpoint not in keys:
                    report.add("warning", "orphan_relationship", f"{rel.relationship_type}: {endpoint}")
        return report

    async def export_enriched(self, graph_context: dict[str, Any]) -> ExportResult:
        return ExportResult(
            supported=False, written=False, payloads=[],
            note="PI is read-only telemetry; MIRA does not write enriched payloads back to a historian.",
        )

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "piwebapi_url": {"type": "string", "required": True, "description": "PI Web API base URL"},
            "af_database": {"type": "string", "required": True, "description": "AF database name (→ company UNS root)"},
            "auth": {"type": "string", "required": True, "secret": True, "description": "Kerberos/Basic token (Doppler-managed)"},
            "fixture_path": {"type": "string", "required": False, "description": "Mock only: path to fixture JSON"},
        }

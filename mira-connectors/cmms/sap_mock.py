"""SAP Plant Maintenance (PM) mock connector.

Maps a lightweight SAP PM export into the MIRA canonical model using real SAP
field names: ``TPLNR`` (functional location), ``EQUNR`` (equipment master),
``AUFNR`` (maintenance order), ``MATNR`` (material/spare), ``PLNNR`` (task
list). SAP's hierarchy is the functional-location tree (``TPLNR``), with ``-``
separating structure levels and ``TPLMA`` pointing at the superior FL.

Mapping:

* Functional location → ``site``/``area``/``line``/``cell`` by FLTYP + depth.
* Equipment master (``HEQUI`` null) → ``asset``; child equipment → ``component``.
* Maintenance order → ``work_order`` + ``HAS_WORK_ORDER``.
* Task list → ``pm_task`` + ``HAS_PM_TASK``.
* BOM line → ``part`` + ``HAS_PART`` (containment — a BOM is what an asset is
  *made of*, distinct from a work order's ``USES_PART`` consumption).
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

logger = logging.getLogger("mira-connectors.sap")

_FIXTURE = Path(__file__).parent / "fixtures" / "sap_demo_plant.json"
_FLTYP_LEVEL = {"PLANT": "plant", "AREA": "area", "LINE": "line", "CELL": "work_cell"}


class SAPMockConnector(Connector):
    name = "sap_mock"
    system_kind = "sap"
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
        for ot, key in (
            ("functional_location", "functional_locations"),
            ("equipment", "equipment"),
            ("maintenance_order", "maintenance_orders"),
            ("task_list", "task_lists"),
            ("bom", "bom"),
        ):
            rows = data.get(key, [])
            if rows:
                schema[ot] = sorted({k for r in rows for k in r.keys()})
        return Capability(
            system_kind=self.system_kind,
            display_name="SAP Plant Maintenance (mock)",
            object_types=list(schema.keys()),
            supports_export=True,
            read_only=self.read_only,
            schema=schema,
            notes="Hierarchy = functional-location TPLNR tree (TPLMA = superior FL).",
        )

    async def import_records(
        self, config: Optional[dict[str, Any]] = None
    ) -> list[RawRecord]:
        data = self._load()
        out: list[RawRecord] = []
        for fl in data.get("functional_locations", []):
            out.append(RawRecord("functional_location", fl["TPLNR"], fl))
        for eq in data.get("equipment", []):
            out.append(RawRecord("equipment", eq["EQUNR"], eq))
        for mo in data.get("maintenance_orders", []):
            out.append(RawRecord("maintenance_order", mo["AUFNR"], mo))
        for tl in data.get("task_lists", []):
            out.append(RawRecord("task_list", f"{tl['PLNNR']}.{tl['PLNAL']}", tl))
        for b in data.get("bom", []):
            out.append(RawRecord("bom", f"{b['EQUNR']}.{b['MATNR']}", b))
        return out

    def normalize(self, raw_records: list[RawRecord]) -> NormalizedGraph:
        g = NormalizedGraph()
        by_type: dict[str, list[RawRecord]] = {}
        for r in raw_records:
            by_type.setdefault(r.object_type, []).append(r)

        fls = {r.payload["TPLNR"]: r.payload for r in by_type.get("functional_location", [])}
        company = uns.slug(self._company(fls))
        self._normalize_fls(g, company, by_type.get("functional_location", []), fls)
        self._normalize_equipment(g, company, by_type.get("equipment", []), fls)
        self._normalize_orders(g, by_type.get("maintenance_order", []))
        self._normalize_task_lists(g, by_type.get("task_list", []))
        self._normalize_bom(g, by_type.get("bom", []))
        return g

    @staticmethod
    def _company(fls: dict[str, dict]) -> str:
        # The first segment of the top functional location is the company.
        for tplnr, fl in fls.items():
            if fl.get("TPLMA") is None:
                return tplnr.split("-")[0]
        return "acme"

    def _fl_chain(self, tplnr: str, fls: dict[str, dict]) -> dict[str, str]:
        """Resolve the {site, area, line, work_cell} names above/at a FL."""
        out: dict[str, str] = {}
        cur: Optional[str] = tplnr
        guard = 0
        while cur and guard < 12:
            guard += 1
            fl = fls.get(cur)
            if not fl:
                break
            level = _FLTYP_LEVEL.get(fl.get("FLTYP", ""))
            if level == "plant":
                pass  # no ISA-95 slot — folded into site
            elif level:
                out.setdefault(level, self._fl_label(cur))
            cur = fl.get("TPLMA")
        return out

    @staticmethod
    def _fl_label(tplnr: str) -> str:
        """The instance label of a FL = its last '-'-separated segment."""
        return tplnr.split("-")[-1]

    def _normalize_fls(
        self, g: NormalizedGraph, company: str, rows: list[RawRecord], fls: dict[str, dict]
    ) -> None:
        seen_site: set[str] = set()
        for r in rows:
            fl = r.payload
            level = _FLTYP_LEVEL.get(fl.get("FLTYP", ""))
            chain = self._fl_chain(fl["TPLNR"], fls)
            site = fl.get("STORT") or fl.get("SWERK") or "site"
            site = uns.slug(site)
            if site not in seen_site:
                seen_site.add(site)
                self._emit(
                    g, "site", site, "functional_location", site, {"derived_from": fl["TPLNR"]},
                    uns.site_path(company, site), 0.9,
                )
            if level == "plant":
                g.add_proposal(
                    Proposal(
                        suggestion_type="uns_confirmation",
                        title=f"SAP functional location {fl['TPLNR']} (PLANT) has no ISA-95 slot",
                        body=f"PLANT-level FL '{fl['TPLNR']}' folded into site '{site}'. Confirm or remap.",
                        extracted_data={"tplnr": fl["TPLNR"], "site": site},
                        confidence=0.6,
                        proposed_by=f"import:{self.name}",
                        source_kind="manual_entry",
                    )
                )
                continue
            label = self._fl_label(fl["TPLNR"])
            if level == "area":
                path, parent = uns.area_path(company, site, label), f"site:{site}"
                etype = "area"
            elif level == "line":
                path = uns.line_path(company, site, chain.get("area", "area"), label)
                parent, etype = f"area:{chain.get('area')}", "line"
            else:  # work_cell
                path = uns.work_cell_path(
                    company, site, chain.get("area", "area"), chain.get("line", "line"), label
                )
                parent, etype = f"line:{chain.get('line')}", "cell"
            ent = self._emit(
                g, etype, label, "functional_location", fl["TPLNR"],
                {"description": fl.get("PLTXT"), "tplnr": fl["TPLNR"]}, path, 0.9, raw=fl,
            )
            g.add_relationship(
                CanonicalRelationship(
                    source_key=ent.key, target_key=parent, relationship_type="LOCATED_IN", confidence=0.9
                )
            )

    def _normalize_equipment(
        self, g: NormalizedGraph, company: str, rows: list[RawRecord], fls: dict[str, dict]
    ) -> dict[str, str]:
        eq_path_by_equnr: dict[str, str] = {}
        # top-level equipment first
        for r in rows:
            eq = r.payload
            if eq.get("HEQUI"):
                continue
            chain = self._fl_chain(eq.get("TPLNR", ""), fls)
            site = uns.slug(fls.get(eq.get("TPLNR", ""), {}).get("STORT") or "site")
            path = uns.assigned_equipment_path(
                company, site, chain.get("area", "unassigned"), eq["EQUNR"],
                line=chain.get("line"), work_cell=chain.get("work_cell"),
            )
            eq_path_by_equnr[eq["EQUNR"]] = path
            self._emit_eq(g, eq, "asset", path)
        # child equipment → components
        for r in rows:
            eq = r.payload
            parent = eq.get("HEQUI")
            if not parent:
                continue
            ppath = eq_path_by_equnr.get(parent)
            path = uns.equipment_subnode_path(ppath, "component", eq["EQUNR"]) if ppath else None
            ent = self._emit_eq(g, eq, "component", path)
            if ppath:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=f"asset:{parent}", target_key=ent.key,
                        relationship_type="HAS_COMPONENT", confidence=0.95,
                        evidence=[{"kind": "sap_hequi", "ref": eq["EQUNR"], "detail": parent}],
                    )
                )
        return eq_path_by_equnr

    def _emit_eq(self, g: NormalizedGraph, eq: dict, etype: str, path: Optional[str]) -> CanonicalEntity:
        return self._emit(
            g, etype, eq["EQUNR"], "equipment", eq["EQUNR"],
            {
                "description": eq.get("EQKTX"),
                "manufacturer": eq.get("HERST"),
                "model": eq.get("TYPBZ"),
                "serial": eq.get("SERGE"),
                "tplnr": eq.get("TPLNR"),
            },
            path, 0.9, raw=eq,
        )

    def _normalize_orders(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            mo = r.payload
            ent = self._emit(
                g, "work_order", mo["AUFNR"], "work_order", mo["AUFNR"],
                {"description": mo.get("KTEXT"), "order_type": mo.get("AUART"), "status": mo.get("ANLZU")},
                uns.work_order_path(mo["AUFNR"]), 0.9, raw=mo,
            )
            equnr = mo.get("EQUNR")
            if equnr:
                src = f"component:{equnr}" if g.get(f"component:{equnr}") else f"asset:{equnr}"
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=src, target_key=ent.key, relationship_type="HAS_WORK_ORDER",
                        confidence=0.95, evidence=[{"kind": "sap_order", "ref": mo["AUFNR"], "detail": equnr}],
                    )
                )

    def _normalize_task_lists(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            tl = r.payload
            tlid = f"{tl['PLNNR']}.{tl['PLNAL']}"
            equnr = tl.get("EQUNR")
            anchor = g.get(f"component:{equnr}") or g.get(f"asset:{equnr}")
            path = (
                uns.equipment_subnode_path(anchor.uns_path, "maintenance", "pm_schedule", tl["PLNNR"])
                if anchor and anchor.uns_path
                else None
            )
            ent = self._emit(
                g, "pm_task", tlid, "task_list", tlid,
                {"description": tl.get("KTEXT"), "strategy": tl.get("STRAT")}, path, 0.88, raw=tl,
            )
            if equnr and anchor:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=anchor.key, target_key=ent.key, relationship_type="HAS_PM_TASK",
                        confidence=0.9, evidence=[{"kind": "sap_tasklist", "ref": tlid, "detail": equnr}],
                    )
                )

    def _normalize_bom(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            b = r.payload
            part = self._emit(
                g, "part", b["MATNR"], "bom", b["MATNR"],
                {"description": b.get("MAKTX"), "manufacturer_part_number": b["MATNR"], "uom": b.get("MEINS")},
                None, 0.85, raw=b,
            )
            equnr = b.get("EQUNR")
            if equnr:
                anchor = g.get(f"component:{equnr}") or g.get(f"asset:{equnr}")
                if anchor:
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=anchor.key, target_key=part.key, relationship_type="HAS_PART",
                            confidence=0.85, properties={"qty": b.get("MENGE")},
                            evidence=[{"kind": "sap_bom", "ref": b["MATNR"], "detail": equnr}],
                        )
                    )

    def _emit(
        self,
        g: NormalizedGraph,
        entity_type: str,
        name: str,
        object_type: str,
        external_id: str,
        properties: dict[str, Any],
        uns_path: Optional[str],
        confidence: float,
        raw: Optional[dict[str, Any]] = None,
    ) -> CanonicalEntity:
        payload = dict(raw) if raw is not None else dict(properties)
        ent = g.add_entity(
            CanonicalEntity(
                entity_type=entity_type, name=name, uns_path=uns_path, properties=properties,
                confidence=confidence, source_system=self.system_kind, object_type=object_type,
                external_object_id=external_id, source_payload=payload,
            )
        )
        g.add_source_object(
            SourceObject(
                system_kind=self.system_kind, object_type=object_type, external_object_id=external_id,
                raw_payload=payload, connector_version=self.connector_version,
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
        aufnr = graph_context.get("aufnr", "4000123")
        payload = {
            "_resource": "API_MAINTENANCEORDER",
            "AUFNR": aufnr,
            "LTXA1": f"[MIRA] {graph_context.get('diagnosis', '')}",
            "ZZ_MIRA_UNS_PATH": graph_context.get("uns_path", ""),  # customer Z-field
        }
        written = self._may_write_source()
        return ExportResult(
            supported=True, written=written, payloads=[payload],
            note="pushed to SAP" if written else "read_only/dry_run — payload built but NOT pushed",
        )

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "odata_url": {"type": "string", "required": True, "description": "S/4HANA OData base URL"},
            "client": {"type": "string", "required": False, "default": "100", "description": "SAP client (MANDT)"},
            "username": {"type": "string", "required": True, "description": "SAP service user"},
            "password": {"type": "string", "required": True, "secret": True, "description": "Doppler-managed"},
            "fixture_path": {"type": "string", "required": False, "description": "Mock only: path to fixture JSON"},
        }

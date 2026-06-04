"""MaintainX mock connector.

Extends the MaintainX adapter pattern already in the repo
(``mira-mcp/cmms/maintainx.py`` — REST + Bearer key, ``workOrders`` / ``assets``
response envelopes) into the connector framework. The mock reads the same REST
response shape from ``fixtures/maintainx_demo.json`` so the mapping is exercised
without an API key; a live connector would swap ``_load`` for the existing
``MaintainXCMMS._get`` calls.

Mapping:

* Location tree → ``site``/``area``/``line`` by depth from the root location.
* Asset (``parentId`` null) → ``asset``; child asset → ``component``.
* Work order → ``work_order`` + ``HAS_WORK_ORDER`` (PREVENTIVE category → a PM-
  flavored note in properties); parts referencing the asset → ``part`` + ``HAS_PART``.
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
    SourceObject,
    ValidationReport,
)
from uns_bridge import uns

logger = logging.getLogger("mira-connectors.maintainx")

_FIXTURE = Path(__file__).parent / "fixtures" / "maintainx_demo.json"


class MaintainXMockConnector(Connector):
    name = "maintainx_mock"
    system_kind = "maintainx"
    connector_version = "0.1.0"

    def __init__(
        self,
        fixture_path: Optional[Path] = None,
        company: str = "acme",
        dry_run: bool = True,
        read_only: bool = True,
    ) -> None:
        super().__init__(dry_run=dry_run, read_only=read_only)
        self._fixture_path = Path(fixture_path) if fixture_path else _FIXTURE
        self._company = company
        self._data: dict[str, Any] = {}

    def _load(self) -> dict[str, Any]:
        if not self._data:
            self._data = json.loads(self._fixture_path.read_text())
        return self._data

    async def discover(self) -> Capability:
        data = self._load()
        schema = {}
        for ot, key in (
            ("asset", "assets"),
            ("work_order", "workOrders"),
            ("location", "locations"),
            ("part", "parts"),
        ):
            rows = data.get(key, [])
            if rows:
                schema[ot] = sorted({k for r in rows for k in r.keys()})
        return Capability(
            system_kind=self.system_kind,
            display_name="MaintainX (mock)",
            object_types=list(schema.keys()),
            supports_export=True,
            read_only=self.read_only,
            schema=schema,
            notes="REST response shape mirrors mira-mcp/cmms/maintainx.py. Flat location tree (parentId).",
        )

    async def import_records(self, config: Optional[dict[str, Any]] = None) -> list[RawRecord]:
        data = self._load()
        out: list[RawRecord] = []
        for loc in data.get("locations", []):
            out.append(RawRecord("location", str(loc["id"]), loc))
        for a in data.get("assets", []):
            out.append(RawRecord("asset", str(a["id"]), a))
        for wo in data.get("workOrders", []):
            out.append(RawRecord("work_order", str(wo["id"]), wo))
        for p in data.get("parts", []):
            out.append(RawRecord("part", str(p["id"]), p))
        return out

    def normalize(self, raw_records: list[RawRecord]) -> NormalizedGraph:
        g = NormalizedGraph()
        by_type: dict[str, list[RawRecord]] = {}
        for r in raw_records:
            by_type.setdefault(r.object_type, []).append(r)

        company = uns.slug(self._load().get("company") or self._company)
        locs = {r.payload["id"]: r.payload for r in by_type.get("location", [])}
        self._normalize_locations(g, company, locs)
        self._normalize_assets(g, by_type.get("asset", []), locs)
        self._normalize_work_orders(g, by_type.get("work_order", []))
        self._normalize_parts(g, by_type.get("part", []))
        return g

    @staticmethod
    def _depth(loc_id: Any, locs: dict[Any, dict]) -> int:
        depth, cur, guard = 0, locs.get(loc_id), 0
        while cur and cur.get("parentId") is not None and guard < 12:
            guard += 1
            depth += 1
            cur = locs.get(cur["parentId"])
        return depth

    def _normalize_locations(
        self, g: NormalizedGraph, company: str, locs: dict[Any, dict]
    ) -> dict[Any, str]:
        """Map the flat parentId tree to site/area/line by depth. Returns a
        location-id → {site,area,line} context for assets to resolve against."""
        ctx: dict[Any, str] = {}
        # site = the root location
        site_label = None
        for lid, loc in locs.items():
            if loc.get("parentId") is None:
                site_label = uns.slug(loc["name"])
                self._emit(
                    g,
                    "site",
                    site_label,
                    "location",
                    str(lid),
                    {"description": loc.get("description")},
                    uns.site_path(company, site_label),
                    0.9,
                    raw=loc,
                )
        site_label = site_label or "site"
        for lid, loc in locs.items():
            d = self._depth(lid, locs)
            if d == 0:
                ctx[lid] = site_label
                continue
            chain = self._loc_chain(lid, locs)
            label = uns.slug(loc["name"])
            if d == 1:
                path, parent, etype = (
                    uns.area_path(company, site_label, label),
                    f"site:{site_label}",
                    "area",
                )
            elif d == 2:
                path = uns.line_path(company, site_label, chain.get("area", "area"), label)
                parent, etype = f"area:{chain.get('area')}", "line"
            else:
                path = uns.work_cell_path(
                    company, site_label, chain.get("area", "area"), chain.get("line", "line"), label
                )
                parent, etype = f"line:{chain.get('line')}", "cell"
            ent = self._emit(
                g,
                etype,
                label,
                "location",
                str(lid),
                {"description": loc.get("description")},
                path,
                0.88,
                raw=loc,
            )
            g.add_relationship(
                CanonicalRelationship(
                    source_key=ent.key,
                    target_key=parent,
                    relationship_type="LOCATED_IN",
                    confidence=0.88,
                )
            )
            ctx[lid] = label
        return ctx

    def _loc_chain(self, loc_id: Any, locs: dict[Any, dict]) -> dict[str, str]:
        out: dict[str, str] = {}
        cur, guard = locs.get(loc_id), 0
        while cur and guard < 12:
            guard += 1
            d = self._depth(cur["id"], locs)
            level = {1: "area", 2: "line", 3: "work_cell"}.get(d)
            if level:
                out.setdefault(level, uns.slug(cur["name"]))
            cur = locs.get(cur.get("parentId"))
        return out

    def _normalize_assets(
        self, g: NormalizedGraph, rows: list[RawRecord], locs: dict[Any, dict]
    ) -> dict[Any, str]:
        company = uns.slug(self._load().get("company") or self._company)
        site_label = next(
            (uns.slug(loc["name"]) for loc in locs.values() if loc.get("parentId") is None), "site"
        )
        eq_path: dict[Any, str] = {}
        for r in rows:
            a = r.payload
            if a.get("parentId"):
                continue
            chain = self._loc_chain(a.get("locationId"), locs)
            path = uns.assigned_equipment_path(
                company,
                site_label,
                chain.get("area", "unassigned"),
                a["name"],
                line=chain.get("line"),
                work_cell=chain.get("work_cell"),
            )
            eq_path[a["id"]] = path
            self._emit_asset(g, a, "asset", path)
        for r in rows:
            a = r.payload
            parent = a.get("parentId")
            if not parent:
                continue
            ppath = eq_path.get(parent)
            path = uns.equipment_subnode_path(ppath, "component", a["name"]) if ppath else None
            ent = self._emit_asset(g, a, "component", path)
            if ppath:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=f"asset:{self._asset_name(rows, parent)}",
                        target_key=ent.key,
                        relationship_type="HAS_COMPONENT",
                        confidence=0.95,
                        evidence=[{"kind": "maintainx_parent", "ref": a["name"], "detail": parent}],
                    )
                )
        return eq_path

    @staticmethod
    def _asset_name(rows: list[RawRecord], asset_id: Any) -> str:
        for r in rows:
            if r.payload["id"] == asset_id:
                return r.payload["name"]
        return str(asset_id)

    def _emit_asset(
        self, g: NormalizedGraph, a: dict, etype: str, path: Optional[str]
    ) -> CanonicalEntity:
        return self._emit(
            g,
            etype,
            a["name"],
            "asset",
            str(a["id"]),
            {
                "description": a.get("description"),
                "manufacturer": a.get("manufacturer"),
                "model": a.get("model"),
                "serial": a.get("serialNumber"),
                "maintainx_id": a["id"],
                "status": a.get("status"),
            },
            path,
            0.9,
            raw=a,
        )

    def _normalize_work_orders(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        # need asset id → name; build from the asset entities already in graph
        id_to_name = {
            e.properties.get("maintainx_id"): e.name
            for e in g.entities.values()
            if e.properties.get("maintainx_id")
        }
        for r in rows:
            wo = r.payload
            cats = wo.get("categories", [])
            ent = self._emit(
                g,
                "work_order",
                str(wo["id"]),
                "work_order",
                str(wo["id"]),
                {
                    "title": wo.get("title"),
                    "status": wo.get("status"),
                    "priority": wo.get("priority"),
                    "categories": cats,
                    "is_preventive": "PREVENTIVE" in cats,
                },
                uns.work_order_path(str(wo["id"])),
                0.9,
                raw=wo,
            )
            aid = wo.get("assetId")
            aname = id_to_name.get(aid)
            if aname:
                src = f"component:{aname}" if g.get(f"component:{aname}") else f"asset:{aname}"
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=src,
                        target_key=ent.key,
                        relationship_type="HAS_WORK_ORDER",
                        confidence=0.95,
                        evidence=[{"kind": "maintainx_wo", "ref": str(wo["id"]), "detail": aid}],
                    )
                )

    def _normalize_parts(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        id_to_name = {
            e.properties.get("maintainx_id"): e.name
            for e in g.entities.values()
            if e.properties.get("maintainx_id")
        }
        for r in rows:
            p = r.payload
            part = self._emit(
                g,
                "part",
                p.get("partNumber") or str(p["id"]),
                "part",
                str(p["id"]),
                {
                    "description": p.get("name"),
                    "manufacturer_part_number": p.get("partNumber"),
                    "qty_in_stock": p.get("quantityInStock"),
                },
                None,
                0.85,
                raw=p,
            )
            for aid in p.get("assetIds", []):
                aname = id_to_name.get(aid)
                if aname:
                    src = f"component:{aname}" if g.get(f"component:{aname}") else f"asset:{aname}"
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=src,
                            target_key=part.key,
                            relationship_type="HAS_PART",
                            confidence=0.8,
                            evidence=[
                                {"kind": "maintainx_part", "ref": str(p["id"]), "detail": aid}
                            ],
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
        raw: dict[str, Any],
    ) -> CanonicalEntity:
        ent = g.add_entity(
            CanonicalEntity(
                entity_type=entity_type,
                name=name,
                uns_path=uns_path,
                properties=properties,
                confidence=confidence,
                source_system=self.system_kind,
                object_type=object_type,
                external_object_id=external_id,
                source_payload=dict(raw),
            )
        )
        g.add_source_object(
            SourceObject(
                system_kind=self.system_kind,
                object_type=object_type,
                external_object_id=external_id,
                raw_payload=dict(raw),
                connector_version=self.connector_version,
                mapping_status="mapped",
                mapped_entity_key=ent.key,
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
                    report.add(
                        "warning", "orphan_relationship", f"{rel.relationship_type}: {endpoint}"
                    )
        return report

    async def export_enriched(self, graph_context: dict[str, Any]) -> ExportResult:
        wo_id = graph_context.get("work_order_id", "91001")
        payload = {
            "_resource": "workorders",
            "id": wo_id,
            "completionComment": f"[MIRA] {graph_context.get('diagnosis', '')}",
            "customFields": {"mira_uns_path": graph_context.get("uns_path", "")},
        }
        written = self._may_write_source()
        return ExportResult(
            supported=True,
            written=written,
            payloads=[payload],
            note="patched MaintainX work order"
            if written
            else "read_only/dry_run — payload built but NOT pushed",
        )

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "api_key": {
                "type": "string",
                "required": True,
                "secret": True,
                "description": "MAINTAINX_API_KEY (Doppler-managed)",
            },
            "company": {
                "type": "string",
                "required": False,
                "default": "acme",
                "description": "Company/enterprise UNS root",
            },
            "fixture_path": {
                "type": "string",
                "required": False,
                "description": "Mock only: path to fixture JSON",
            },
        }

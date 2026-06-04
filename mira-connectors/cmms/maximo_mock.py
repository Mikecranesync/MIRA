"""IBM Maximo EAM mock connector.

Maps a realistic IBM Maximo asset/work-order/PM export into MIRA's canonical
asset graph. Uses real Maximo field names (``ASSETNUM``, ``SITEID``,
``LOCATION``, ``PARENT``, ``WONUM``, ``FAILURECODE`` …) and the native Maximo
org hierarchy ``ORGID > SITEID > LOCATION``.

Why a mock: the live path would hit the Maximo Manage REST API
(``oslc/os/mxapiasset`` etc.) with OAuth/apikey auth. The mock reads the same
*shape* from ``fixtures/maximo_demo_plant.json`` so the normalize / validate /
proposal logic is exercised end-to-end with zero credentials.

Mapping summary (see ``docs/mira/connector-framework.md``):

* ORGID → ``company`` segment, SITEID → ``site`` entity.
* Location chain ``PLANT-A → AREA-1 → LINE-1 → CELL-1`` → ISA-95
  ``area / line / work_cell`` by name prefix. **PLANT-\\* has no ISA-95 slot**
  (4 Maximo levels vs 3 ISA-95) → that's a genuine ambiguity, emitted as a
  ``uns_confirmation`` proposal rather than silently forced.
* Top-level asset (``PARENT`` null) → ``asset``; child asset → ``component``.
* Failure tree ``FAILURECODE→PROBLEMCODE→CAUSECODE→REMEDYCODE`` →
  ``fault_code / failure_mode / root_cause / remedy`` entities + edges.
* Work order → ``work_order`` entity; parts used → ``USES_PART``.
* PM → ``pm_task``; meter → ``signal``; doclink → ``document``/``wiring_diagram``.
* Every original field is preserved in ``source_payload`` + a ``SourceObject``;
  the two ``MIRA_*`` custom fields demonstrate a MIRA-written round-trip.
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

logger = logging.getLogger("mira-connectors.maximo")

_FIXTURE = Path(__file__).parent / "fixtures" / "maximo_demo_plant.json"

# Local hint list for tagging proposal risk. The AUTHORITATIVE safety-keyword
# set is mira-bots/shared/guardrails.py SAFETY_KEYWORDS — importing it would
# drag the engine in, and this is only used to set ai_suggestions.risk_level on
# import proposals, not to drive a user-facing STOP. Keep in spirit with that.
_SAFETY_HINTS = ("e-stop", "estop", "e stop", "lockout", "loto", "arc flash", "confined space")


def _is_safety(*texts: Optional[str]) -> bool:
    blob = " ".join(t for t in texts if t).lower()
    return any(h in blob for h in _SAFETY_HINTS)


class MaximoMockConnector(Connector):
    name = "maximo_mock"
    system_kind = "maximo"
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

    # ── discover ────────────────────────────────────────────────────

    async def discover(self) -> Capability:
        data = self._load()
        schema: dict[str, list[str]] = {}
        for object_type, key in (
            ("asset", "assets"),
            ("location", "locations"),
            ("workorder", "workorders"),
            ("pm", "pmschedules"),
            ("meter", "meters"),
            ("doclink", "doclinks"),
            ("site", "sites"),
        ):
            rows = data.get(key, [])
            if rows:
                schema[object_type] = sorted({k for r in rows for k in r.keys()})
        return Capability(
            system_kind=self.system_kind,
            display_name="IBM Maximo EAM (mock)",
            object_types=list(schema.keys()) + ["failurecode"],
            supports_export=True,  # work orders + asset custom fields are writable
            read_only=self.read_only,
            schema=schema,
            notes="Native hierarchy ORGID > SITEID > LOCATION. Custom fields "
            "(MIRA_UNS_PATH, MIRA_CONFIDENCE) round-trip via export_enriched.",
        )

    # ── import ──────────────────────────────────────────────────────

    async def import_records(self, config: Optional[dict[str, Any]] = None) -> list[RawRecord]:
        """Read-only pull. ``config`` may carry ``site`` (SITEID filter) and
        ``object_types`` (subset). Importing never mutates Maximo."""
        config = config or {}
        site_filter = config.get("site")
        wanted = set(config.get("object_types") or [])
        data = self._load()

        records: list[RawRecord] = []

        def emit(object_type: str, key_field: str, rows: list[dict]) -> None:
            if wanted and object_type not in wanted:
                return
            for row in rows:
                if site_filter and row.get("SITEID") not in (site_filter, None):
                    continue
                records.append(
                    RawRecord(
                        object_type=object_type,
                        external_object_id=str(row.get(key_field)),
                        payload=row,
                    )
                )

        emit("site", "SITEID", data.get("sites", []))
        emit("location", "LOCATION", data.get("locations", []))
        emit("asset", "ASSETNUM", data.get("assets", []))
        emit("workorder", "WONUM", data.get("workorders", []))
        emit("pm", "PMNUM", data.get("pmschedules", []))
        # meters/doclinks have no single natural id → synthesize a stable one
        if not wanted or "meter" in wanted:
            for m in data.get("meters", []):
                records.append(RawRecord("meter", f"{m['ASSETNUM']}.{m['METERNAME']}", m))
        if not wanted or "doclink" in wanted:
            for d in data.get("doclinks", []):
                records.append(RawRecord("doclink", str(d["DOCINFOID"]), d))
        if not wanted or "failurecode" in wanted:
            for fc in data.get("failurecodes", []):
                records.append(RawRecord("failurecode", fc["FAILURECODE"], fc))
        return records

    # ── normalize ───────────────────────────────────────────────────

    def normalize(self, raw_records: list[RawRecord]) -> NormalizedGraph:
        g = NormalizedGraph()
        by_type: dict[str, list[RawRecord]] = {}
        for r in raw_records:
            by_type.setdefault(r.object_type, []).append(r)

        data = self._load()
        company = uns.slug(self._org_id(data))
        loc_index = {r.payload["LOCATION"]: r.payload for r in by_type.get("location", [])}

        self._normalize_locations(g, company, by_type.get("location", []))
        self._normalize_assets(g, company, by_type.get("asset", []), loc_index)
        self._normalize_failure_catalog(g, by_type.get("failurecode", []))
        self._normalize_workorders(g, by_type.get("workorder", []))
        self._normalize_pms(g, by_type.get("pm", []))
        self._normalize_meters(g, by_type.get("meter", []))
        self._normalize_doclinks(g, by_type.get("doclink", []))
        return g

    # -- helpers --

    @staticmethod
    def _org_id(data: dict[str, Any]) -> str:
        orgs = data.get("orgs") or []
        return orgs[0]["ORGID"] if orgs else "acme"

    def _emit_entity(
        self,
        g: NormalizedGraph,
        *,
        entity_type: str,
        name: str,
        object_type: str,
        external_id: str,
        raw: dict[str, Any],
        uns_path: Optional[str],
        confidence: float,
        properties: Optional[dict[str, Any]] = None,
    ) -> CanonicalEntity:
        """Build a canonical entity + its preserved SourceObject and link them.

        ``source_payload`` is the COMPLETE original record (requirement 4)."""
        entity = CanonicalEntity(
            entity_type=entity_type,
            name=name,
            uns_path=uns_path,
            properties=properties or {},
            confidence=confidence,
            source_system=self.system_kind,
            object_type=object_type,
            external_object_id=external_id,
            source_payload=dict(raw),  # every field, unmodified
        )
        entity = g.add_entity(entity)
        g.add_source_object(
            SourceObject(
                system_kind=self.system_kind,
                object_type=object_type,
                external_object_id=external_id,
                raw_payload=dict(raw),
                connector_version=self.connector_version,
                mapping_status="mapped",
                mapped_entity_key=entity.key,
            )
        )
        return entity

    @staticmethod
    def _anchor_key(g: NormalizedGraph, assetnum: str) -> str:
        """An ASSETNUM may have normalized to either an ``asset`` (top-level) or
        a ``component`` (has PARENT). Return whichever key exists, defaulting to
        ``asset:`` so a genuinely-missing endpoint surfaces as an orphan warning."""
        if g.get(f"component:{assetnum}"):
            return f"component:{assetnum}"
        return f"asset:{assetnum}"

    @staticmethod
    def _isa95_level(location_name: str) -> str:
        """Infer the ISA-95 level of a Maximo location from its name prefix.
        PLANT-* has no slot below ``site`` → 'plant' (the flagged case)."""
        up = location_name.upper()
        if up.startswith("PLANT"):
            return "plant"
        if up.startswith("AREA"):
            return "area"
        if up.startswith("LINE"):
            return "line"
        if up.startswith("CELL") or up.startswith("WORKCELL"):
            return "work_cell"
        return "area"  # default: treat unknown intermediate as an area

    def _normalize_locations(self, g: NormalizedGraph, company: str, rows: list[RawRecord]) -> None:
        # sites first (so site entities exist before areas reference them)
        seen_sites: set[str] = set()
        for r in rows:
            loc = r.payload
            site = loc["SITEID"]
            if site not in seen_sites:
                seen_sites.add(site)
                self._emit_entity(
                    g,
                    entity_type="site",
                    name=site,
                    object_type="site",
                    external_id=site,
                    raw={"SITEID": site, "ORGID": loc.get("ORGID")},
                    uns_path=uns.site_path(company, site),
                    confidence=0.95,
                )

        for r in rows:
            loc = r.payload
            site = loc["SITEID"]
            name = loc["LOCATION"]
            level = self._isa95_level(name)
            if level == "plant":
                # 4-vs-3 depth mismatch: no ISA-95 slot below site. Don't force
                # it — fold into site and ask a human (uns_confirmation).
                g.add_proposal(
                    Proposal(
                        suggestion_type="uns_confirmation",
                        title=f"Maximo location {name} has no ISA-95 slot",
                        body=(
                            f"Maximo location hierarchy is 4 levels deep "
                            f"(PLANT→AREA→LINE→CELL) but ISA-95 below a site is "
                            f"area→line→work_cell (3). '{name}' (TYPE="
                            f"{loc.get('TYPE')}) was folded into site '{site}'. "
                            f"Confirm or remap."
                        ),
                        extracted_data={
                            "location": name,
                            "site": site,
                            "chosen_mapping": "fold_into_site",
                            "candidate_paths": [uns.site_path(company, site)],
                            "lochierarchy": loc.get("LOCHIERARCHY"),
                        },
                        confidence=0.6,
                        proposed_by=f"import:{self.name}",
                        source_kind="manual_entry",
                    )
                )
                continue

            # Build the area/line/work_cell path by walking up to find ancestors.
            area, line, _cell = self._location_isa95_chain(name, rows)
            if level == "area":
                uns_path = uns.area_path(company, site, name)
                parent_key = f"site:{site}"
            elif level == "line":
                uns_path = uns.line_path(company, site, area or "area", name)
                parent_key = f"area:{area}" if area else f"site:{site}"
            else:  # work_cell
                uns_path = uns.work_cell_path(company, site, area or "area", line or "line", name)
                parent_key = f"line:{line}" if line else f"site:{site}"

            entity_type = {"area": "area", "line": "line", "work_cell": "cell"}[level]
            ent = self._emit_entity(
                g,
                entity_type=entity_type,
                name=name,
                object_type="location",
                external_id=name,
                raw=loc,
                uns_path=uns_path,
                confidence=0.9,
            )
            # child LOCATED_IN parent (is_located_at) — store child→parent.
            g.add_relationship(
                CanonicalRelationship(
                    source_key=ent.key,
                    target_key=parent_key,
                    relationship_type="LOCATED_IN",
                    confidence=0.9,
                    evidence=[
                        {"kind": "maximo_location", "ref": name, "detail": loc.get("PARENT")}
                    ],
                )
            )

    def _location_isa95_chain(
        self,
        location_name: str,
        rows: list[RawRecord],
    ) -> tuple[Optional[str], Optional[str], Optional[str]]:
        """Walk PARENT links to find the AREA/LINE/CELL names at/above a location."""
        index = {r.payload["LOCATION"]: r.payload for r in rows}
        area = line = cell = None
        cur: Optional[str] = location_name
        guard = 0
        while cur and guard < 12:
            guard += 1
            loc = index.get(cur)
            if not loc:
                break
            lvl = self._isa95_level(cur)
            if lvl == "area":
                area = cur
            elif lvl == "line":
                line = cur
            elif lvl == "work_cell":
                cell = cur
            cur = loc.get("PARENT")
        return area, line, cell

    def _normalize_assets(
        self,
        g: NormalizedGraph,
        company: str,
        rows: list[RawRecord],
        loc_index: dict[str, dict],
    ) -> None:
        loc_rows = [RawRecord("location", k, v) for k, v in loc_index.items()]
        # First pass: top-level assets (PARENT null) → equipment nodes.
        eq_path_by_assetnum: dict[str, str] = {}
        for r in rows:
            a = r.payload
            if a.get("PARENT"):
                continue
            site = a["SITEID"]
            loc_name = a.get("LOCATION")
            area, line, cell = (
                self._location_isa95_chain(loc_name, loc_rows) if loc_name else (None, None, None)
            )
            eq_path = uns.assigned_equipment_path(
                company, site, area or "unassigned", a["ASSETNUM"], line=line, work_cell=cell
            )
            eq_path_by_assetnum[a["ASSETNUM"]] = eq_path
            self._emit_asset(g, a, "asset", eq_path)

        # Second pass: child assets → component nodes under their parent.
        for r in rows:
            a = r.payload
            parent = a.get("PARENT")
            if not parent:
                continue
            parent_path = eq_path_by_assetnum.get(parent)
            if parent_path:
                uns_path = uns.equipment_subnode_path(parent_path, "component", a["ASSETNUM"])
            else:
                uns_path = None  # orphan — validate() will flag it
            ent = self._emit_asset(g, a, "component", uns_path)
            if parent_path:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=f"asset:{parent}",
                        target_key=ent.key,
                        relationship_type="HAS_COMPONENT",  # parent→child canonical
                        confidence=0.95,
                        evidence=[
                            {"kind": "maximo_parent", "ref": a["ASSETNUM"], "detail": parent}
                        ],
                    )
                )

    def _emit_asset(
        self, g: NormalizedGraph, a: dict, entity_type: str, uns_path: Optional[str]
    ) -> CanonicalEntity:
        props = {
            "description": a.get("DESCRIPTION"),
            "manufacturer": a.get("MANUFACTURER"),
            "serial": a.get("SERIALNUM"),
            "status": a.get("STATUS"),
            "asset_type": a.get("ASSETTYPE"),
            "location": a.get("LOCATION"),
        }
        ent = self._emit_entity(
            g,
            entity_type=entity_type,
            name=a["ASSETNUM"],
            object_type="asset",
            external_id=a["ASSETNUM"],
            raw=a,
            uns_path=uns_path,
            confidence=0.9,
            properties=props,
        )
        # Custom-field round-trip check: if Maximo already carries a
        # MIRA_UNS_PATH and it disagrees with what we'd generate, flag drift.
        stored = a.get("MIRA_UNS_PATH")
        if stored and uns_path and stored != uns_path:
            g.add_proposal(
                Proposal(
                    suggestion_type="uns_confirmation",
                    title=f"UNS path drift on {a['ASSETNUM']}",
                    body=(
                        f"Maximo custom field MIRA_UNS_PATH='{stored}' differs from "
                        f"the connector-generated path '{uns_path}'. Confirm which is correct."
                    ),
                    extracted_data={
                        "assetnum": a["ASSETNUM"],
                        "stored": stored,
                        "generated": uns_path,
                    },
                    confidence=0.5,
                    proposed_by=f"import:{self.name}",
                    source_kind="manual_entry",
                )
            )
        return ent

    def _normalize_failure_catalog(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            fc = r.payload
            code = fc["FAILURECODE"]
            fault = self._emit_entity(
                g,
                entity_type="fault_code",
                name=code,
                object_type="failurecode",
                external_id=code,
                raw=fc,
                uns_path=uns.fault_code_path(None, code),
                confidence=0.85,
                properties={"description": fc.get("DESCRIPTION")},
            )
            for problem in fc.get("children", []):
                pm = self._emit_entity(
                    g,
                    entity_type="failure_mode",
                    name=problem["PROBLEMCODE"],
                    object_type="failurecode",
                    external_id=f"{code}.{problem['PROBLEMCODE']}",
                    raw=problem,
                    uns_path=None,  # catalog concept; site-binding comes from work orders
                    confidence=0.8,
                    properties={"description": problem.get("DESCRIPTION"), "failure_class": code},
                )
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=fault.key,
                        target_key=pm.key,
                        relationship_type="HAS_FAILURE_MODE",
                        confidence=0.8,
                    )
                )
                for cause in problem.get("children", []):
                    rc = self._emit_entity(
                        g,
                        entity_type="root_cause",
                        name=cause["CAUSECODE"],
                        object_type="failurecode",
                        external_id=f"{code}.{problem['PROBLEMCODE']}.{cause['CAUSECODE']}",
                        raw=cause,
                        uns_path=None,
                        confidence=0.78,
                        properties={"description": cause.get("DESCRIPTION")},
                    )
                    # cause → problem  (caused_by → CAUSES, cause is the source)
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=rc.key,
                            target_key=pm.key,
                            relationship_type="CAUSES",
                            confidence=0.78,
                        )
                    )
                    safety = _is_safety(cause.get("DESCRIPTION"), problem.get("DESCRIPTION"))
                    if safety:
                        g.add_proposal(
                            Proposal(
                                suggestion_type="kg_entity",
                                title=f"Safety review: failure path {problem['PROBLEMCODE']}/{cause['CAUSECODE']}",
                                body=(
                                    "This Maximo failure path references a safety system "
                                    f"({cause.get('DESCRIPTION')}). Review before MIRA surfaces "
                                    "remediation steps to a technician."
                                ),
                                extracted_data={"failure_class": code, "cause": cause["CAUSECODE"]},
                                confidence=0.7,
                                risk_level="safety_critical",
                                proposed_by=f"import:{self.name}",
                                source_kind="manual_entry",
                            )
                        )
                    for remedy in cause.get("children", []):
                        rm = self._emit_entity(
                            g,
                            entity_type="remedy",
                            name=remedy["REMEDYCODE"],
                            object_type="failurecode",
                            external_id=(
                                f"{code}.{problem['PROBLEMCODE']}."
                                f"{cause['CAUSECODE']}.{remedy['REMEDYCODE']}"
                            ),
                            raw=remedy,
                            uns_path=None,
                            confidence=0.78,
                            properties={"description": remedy.get("DESCRIPTION")},
                        )
                        # problem → remedy  (fixed_by → RESOLVED_BY)
                        g.add_relationship(
                            CanonicalRelationship(
                                source_key=pm.key,
                                target_key=rm.key,
                                relationship_type="RESOLVED_BY",
                                confidence=0.75,
                            )
                        )

    def _normalize_workorders(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            wo = r.payload
            wonum = wo["WONUM"]
            ent = self._emit_entity(
                g,
                entity_type="work_order",
                name=wonum,
                object_type="work_order",
                external_id=wonum,
                raw=wo,
                uns_path=uns.work_order_path(wonum),
                confidence=0.9,
                properties={
                    "description": wo.get("DESCRIPTION"),
                    "status": wo.get("STATUS"),
                    "worktype": wo.get("WORKTYPE"),
                    "actlabhrs": wo.get("ACTLABHRS"),
                    "reportdate": wo.get("REPORTDATE"),
                },
            )
            assetnum = wo.get("ASSETNUM")
            if assetnum:
                anchor_key = self._anchor_key(g, assetnum)
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=anchor_key,
                        target_key=ent.key,
                        relationship_type="HAS_WORK_ORDER",  # asset→wo
                        confidence=0.95,
                        evidence=[{"kind": "maximo_wo", "ref": wonum, "detail": assetnum}],
                    )
                )
                # Bind the generic failure mode to this asset, with the WO as evidence.
                if wo.get("PROBLEMCODE"):
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=anchor_key,
                            target_key=f"failure_mode:{wo['PROBLEMCODE']}",
                            relationship_type="HAS_FAILURE_MODE",
                            confidence=0.6,  # inferred from history, not asserted
                            evidence=[{"kind": "work_order", "ref": wonum}],
                        )
                    )
                if wo.get("REMEDYCODE"):
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=ent.key,
                            target_key=f"remedy:{wo['REMEDYCODE']}",
                            relationship_type="RESOLVED_BY",
                            confidence=0.7,
                            evidence=[{"kind": "work_order", "ref": wonum}],
                        )
                    )
            # parts used → part entities + USES_PART (consumption, not containment)
            for mat in wo.get("matusetrans", []):
                part = self._emit_entity(
                    g,
                    entity_type="part",
                    name=mat["ITEMNUM"],
                    object_type="part",
                    external_id=mat["ITEMNUM"],
                    raw=mat,
                    uns_path=None,
                    confidence=0.85,
                    properties={
                        "description": mat.get("DESCRIPTION"),
                        "manufacturer_part_number": mat["ITEMNUM"],
                    },
                )
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=ent.key,
                        target_key=part.key,
                        relationship_type="USES_PART",  # WO consumes a spare
                        confidence=0.85,
                        properties={"qty": mat.get("QTY")},
                        evidence=[{"kind": "matusetrans", "ref": wonum}],
                    )
                )

    def _normalize_pms(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            pm = r.payload
            pmnum = pm["PMNUM"]
            assetnum = pm.get("ASSETNUM")
            uns_path = None
            anchor = g.get(self._anchor_key(g, assetnum)) if assetnum else None
            if anchor and anchor.uns_path:
                uns_path = uns.equipment_subnode_path(
                    anchor.uns_path, "maintenance", "pm_schedule", pmnum
                )
            ent = self._emit_entity(
                g,
                entity_type="pm_task",
                name=pmnum,
                object_type="pm",
                external_id=pmnum,
                raw=pm,
                uns_path=uns_path,
                confidence=0.88,
                properties={
                    "description": pm.get("DESCRIPTION"),
                    "frequency": pm.get("FREQUENCY"),
                    "frequnit": pm.get("FREQUNIT"),
                },
            )
            if assetnum:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=self._anchor_key(g, assetnum),
                        target_key=ent.key,
                        relationship_type="HAS_PM_TASK",
                        confidence=0.9,
                        evidence=[{"kind": "maximo_pm", "ref": pmnum, "detail": assetnum}],
                    )
                )

    def _normalize_meters(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            m = r.payload
            assetnum = m["ASSETNUM"]
            metername = m["METERNAME"]
            anchor_key = self._anchor_key(g, assetnum)
            anchor = g.get(anchor_key)
            uns_path = (
                uns.equipment_subnode_path(anchor.uns_path, "datapoint", metername)
                if anchor and anchor.uns_path
                else None
            )
            ent = self._emit_entity(
                g,
                entity_type="signal",
                name=f"{assetnum}.{metername}",
                object_type="meter",
                external_id=f"{assetnum}.{metername}",
                raw=m,
                uns_path=uns_path,
                confidence=0.82,
                properties={
                    "metername": metername,
                    "uom": m.get("UOM"),
                    "last_reading": m.get("LASTREADING"),
                    "measure_date": m.get("MEASUREDATE"),
                },
            )
            g.add_relationship(
                CanonicalRelationship(
                    source_key=anchor_key,
                    target_key=ent.key,
                    relationship_type="HAS_SIGNAL",
                    confidence=0.82,
                    evidence=[{"kind": "maximo_meter", "ref": metername, "detail": assetnum}],
                )
            )

    def _normalize_doclinks(self, g: NormalizedGraph, rows: list[RawRecord]) -> None:
        for r in rows:
            d = r.payload
            assetnum = d.get("ASSETNUM")
            is_wiring = (d.get("ADDINFO") or "").upper() == "WIRING"
            entity_type = "wiring_diagram" if is_wiring else "document"
            anchor = g.get(self._anchor_key(g, assetnum)) if assetnum else None
            subfolder = "schematics" if is_wiring else "manuals"
            uns_path = (
                uns.equipment_subnode_path(
                    anchor.uns_path, "documentation", subfolder, d["DOCUMENT"]
                )
                if anchor and anchor.uns_path
                else None
            )
            ent = self._emit_entity(
                g,
                entity_type=entity_type,
                name=str(d["DOCINFOID"]),
                object_type="doclink",
                external_id=str(d["DOCINFOID"]),
                raw=d,
                uns_path=uns_path,
                confidence=0.85,
                properties={
                    "document": d.get("DOCUMENT"),
                    "description": d.get("DESCRIPTION"),
                    "urlname": d.get("URLNAME"),
                },
            )
            if assetnum:
                g.add_relationship(
                    CanonicalRelationship(
                        source_key=self._anchor_key(g, assetnum),
                        target_key=ent.key,
                        relationship_type="HAS_DOCUMENT",
                        confidence=0.85,
                        evidence=[
                            {
                                "kind": "maximo_doclink",
                                "ref": str(d["DOCINFOID"]),
                                "detail": assetnum,
                            }
                        ],
                    )
                )

    # ── validate ────────────────────────────────────────────────────

    def validate(self, graph: NormalizedGraph) -> ValidationReport:
        report = ValidationReport()
        for ent in graph.entities.values():
            if ent.uns_path and not uns.is_valid_path(ent.uns_path):
                report.add("error", "invalid_uns_path", f"{ent.key}: {ent.uns_path!r}", ent.key)
            if ent.approval_state != "proposed":
                report.add("error", "auto_verified", f"{ent.key} is {ent.approval_state}", ent.key)
            if not ent.source_payload:
                report.add(
                    "error", "missing_source_payload", f"{ent.key} lost its raw record", ent.key
                )
        keys = set(graph.entities.keys())
        for rel in graph.relationships:
            if rel.approval_state != "proposed":
                report.add(
                    "error",
                    "auto_verified_edge",
                    f"{rel.relationship_type} {rel.source_key}->{rel.target_key}",
                )
            for endpoint in (rel.source_key, rel.target_key):
                if endpoint not in keys:
                    report.add(
                        "warning",
                        "orphan_relationship",
                        f"{rel.relationship_type}: endpoint {endpoint} not in graph",
                    )
        return report

    # ── export ──────────────────────────────────────────────────────

    async def export_enriched(self, graph_context: dict[str, Any]) -> ExportResult:
        """Build a Maximo-shaped enrichment payload for a work order: MIRA's
        diagnosis + the generated UNS path written back into the customer's own
        custom fields (MIRA_UNS_PATH, MIRA_CONFIDENCE). Demonstrates that custom
        fields survive the round-trip. Only pushed when this connector is live
        (``read_only=False`` and not ``dry_run``)."""
        wonum = graph_context.get("wonum", "WO-10231")
        uns_path = graph_context.get("uns_path", "")
        diagnosis = graph_context.get("diagnosis", "")
        confidence = graph_context.get("confidence", "medium")
        payload = {
            "_resource": "mxapiwodetail",
            "WONUM": wonum,
            "DESCRIPTION_LONGDESCRIPTION": f"[MIRA] {diagnosis}",
            "MIRA_UNS_PATH": uns_path,  # custom field — preserved/round-tripped
            "MIRA_CONFIDENCE": confidence,
            "WORKLOG": [{"LOGTYPE": "CLIENTNOTE", "DESCRIPTION": diagnosis}],
        }
        written = self._may_write_source()
        return ExportResult(
            supported=True,
            written=written,
            payloads=[payload],
            note="pushed to Maximo"
            if written
            else "read_only/dry_run — payload built but NOT pushed",
        )

    # ── config ──────────────────────────────────────────────────────

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "base_url": {
                "type": "string",
                "required": True,
                "description": "Maximo Manage REST base, e.g. https://maximo.example.com/maximo",
            },
            "api_key": {
                "type": "string",
                "required": True,
                "secret": True,
                "description": "maxauth/apikey (Doppler-managed; never in config)",
            },
            "orgid": {"type": "string", "required": False, "description": "Org filter (ORGID)"},
            "site": {"type": "string", "required": False, "description": "SITEID filter"},
            "object_types": {
                "type": "array",
                "required": False,
                "description": "Subset to import",
                "default": [],
            },
            "fixture_path": {
                "type": "string",
                "required": False,
                "description": "Mock only: path to fixture JSON",
            },
        }

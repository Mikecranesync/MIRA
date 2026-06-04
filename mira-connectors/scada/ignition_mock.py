"""Ignition (Inductive Automation) SCADA mock connector.

Maps an Ignition tag tree into MIRA ``tag`` (signal) entities and proposes
links between those tags and CMMS assets imported by another connector.

Key semantic, straight from ``.claude/rules/direct-connection-uns-certified.md``
and the canonical model: **a SCADA tag does not carry a UNS site path on its
own.** The tag tree gives a *provisional* folder structure (``Conv_Simple /
Motor / Current``) but which physical asset that maps to is a *proposal* a
technician confirms — never an asserted fact. So:

* ``normalize()`` emits ``tag`` entities (``uns_path=None``) plus a provisional
  ``asset``/``component`` skeleton from the folder hierarchy, all at LOW
  confidence and ``approval_state="proposed"``.
* :meth:`propose_asset_links` cross-references the SCADA graph against a CMMS
  graph and emits ``kg_edge`` ``ai_suggestions`` (HAS_SIGNAL) with calibrated
  confidence and the match basis. Nothing is auto-verified.

``export_enriched`` is intentionally unsupported — you don't write enriched
payloads back to a SCADA tag provider.
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

logger = logging.getLogger("mira-connectors.ignition")

_FIXTURE = Path(__file__).parent / "fixtures" / "ignition_demo_tags.json"

_SAFETY_TAGS = ("estop", "e_stop", "estp", "lockout", "interlock", "lightcurtain", "guard")


def _norm(s: str) -> str:
    """Normalize an identifier for fuzzy matching: lowercase, strip separators."""
    return "".join(ch for ch in s.lower() if ch.isalnum())


class IgnitionMockConnector(Connector):
    name = "ignition_mock"
    system_kind = "ignition"
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
        tags = data.get("tags", [])
        return Capability(
            system_kind=self.system_kind,
            display_name="Ignition SCADA (mock)",
            object_types=["tag"],
            supports_export=False,  # no enriched write-back to a tag provider
            read_only=self.read_only,
            schema={"tag": sorted({k for t in tags for k in t.keys()})},
            notes=(
                f"gateway={data.get('_meta', {}).get('gateway')} "
                f"provider={data.get('_meta', {}).get('provider')}. SCADA tags "
                "have no UNS site path until linked to a CMMS asset (a proposal)."
            ),
        )

    # ── import ──────────────────────────────────────────────────────

    async def import_records(
        self, config: Optional[dict[str, Any]] = None
    ) -> list[RawRecord]:
        config = config or {}
        folder_filter = config.get("folder")
        data = self._load()
        out: list[RawRecord] = []
        for tag in data.get("tags", []):
            if folder_filter and not tag["folder"].startswith(folder_filter):
                continue
            out.append(RawRecord(object_type="tag", external_object_id=tag["path"], payload=tag))
        return out

    # ── normalize ───────────────────────────────────────────────────

    def normalize(self, raw_records: list[RawRecord]) -> NormalizedGraph:
        g = NormalizedGraph()
        # equipment root = the top folder segment (e.g. "Conv_Simple").
        roots: dict[str, str] = {}  # equipment_name -> entity.key

        for r in raw_records:
            tag = r.payload
            folder = tag["folder"]  # e.g. "Conv_Simple/Motor"
            segs = folder.split("/")
            equipment_name = segs[0]
            device_folder = segs[1] if len(segs) > 1 else None

            # provisional equipment node (low confidence — folder-derived, not asserted)
            if equipment_name not in roots:
                eq = self._emit(
                    g,
                    entity_type="asset",
                    name=f"scada:{equipment_name}",
                    object_type="folder",
                    external_id=equipment_name,
                    raw={"folder": equipment_name, "gateway": self._load().get("_meta", {}).get("gateway")},
                    confidence=0.5,
                    properties={"scada_root": equipment_name, "provisional": True},
                )
                roots[equipment_name] = eq.key

            anchor_key = roots[equipment_name]
            # provisional component node per device sub-folder (Motor, VFD_GS10, ...)
            if device_folder:
                comp_key = f"component:scada:{equipment_name}/{device_folder}"
                if not g.get(comp_key):
                    comp = self._emit(
                        g,
                        entity_type="component",
                        name=f"scada:{equipment_name}/{device_folder}",
                        object_type="folder",
                        external_id=f"{equipment_name}/{device_folder}",
                        raw={"folder": folder, "provisional": True},
                        confidence=0.45,
                        properties={"scada_folder": folder, "provisional": True},
                    )
                    g.add_relationship(
                        CanonicalRelationship(
                            source_key=anchor_key,
                            target_key=comp.key,
                            relationship_type="HAS_COMPONENT",
                            confidence=0.45,  # folder grouping is a heuristic
                            evidence=[{"kind": "scada_folder", "ref": folder}],
                        )
                    )
                anchor_key = comp_key

            # the tag itself → a `tag` entity (tag_kind=scada). No UNS path yet.
            tag_ent = self._emit(
                g,
                entity_type="tag",
                name=tag["path"],
                object_type="tag",
                external_id=tag["path"],
                raw=tag,
                confidence=0.7,
                properties={
                    "tag_kind": "scada",
                    "scada_path": tag["path"],
                    "tag_name": tag["name"],
                    "datatype": tag.get("dataType"),
                    "eng_unit": tag.get("engUnit"),
                    "quality": tag.get("quality"),
                    "value": tag.get("value"),
                    "sample_count": len(tag.get("samples", [])),
                    "is_safety": _norm(tag["name"]) in {_norm(s) for s in _SAFETY_TAGS}
                    or any(s in _norm(tag["name"]) for s in ("estop", "lockout")),
                },
            )
            g.add_relationship(
                CanonicalRelationship(
                    source_key=anchor_key,
                    target_key=tag_ent.key,
                    relationship_type="HAS_SIGNAL",
                    confidence=0.7,
                    evidence=[{"kind": "scada_tag", "ref": tag["path"]}],
                )
            )
        return g

    def _emit(
        self,
        g: NormalizedGraph,
        *,
        entity_type: str,
        name: str,
        object_type: str,
        external_id: str,
        raw: dict[str, Any],
        confidence: float,
        properties: Optional[dict[str, Any]] = None,
    ) -> CanonicalEntity:
        ent = g.add_entity(
            CanonicalEntity(
                entity_type=entity_type,
                name=name,
                uns_path=None,  # SCADA carries no UNS site path until linked
                properties=properties or {},
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

    # ── cross-reference SCADA tags ↔ CMMS assets ────────────────────

    def propose_asset_links(
        self, scada_graph: NormalizedGraph, cmms_graph: NormalizedGraph
    ) -> list[Proposal]:
        """Propose HAS_SIGNAL links between SCADA tags and CMMS assets/components.

        Matching is fuzzy and NEVER auto-verified — each match becomes a
        ``kg_edge`` ``ai_suggestion`` (status pending) a technician confirms.
        Confidence reflects the match basis:

        * tag name == CMMS ASSETNUM (PE_101 ↔ PE-101)        → 0.9 (exact)
        * folder/device keyword in CMMS DESCRIPTION/ASSETNUM → 0.55–0.8
        """
        cmms_targets = [
            e for e in cmms_graph.entities.values() if e.entity_type in ("asset", "component")
        ]
        by_assetnum = {_norm(c.name): c for c in cmms_targets}
        proposals: list[Proposal] = []
        all_tags = scada_graph.by_type("tag")
        matched_tag_keys: set[str] = set()

        # 1) Precise per-tag links: a tag whose name exactly matches a CMMS
        #    ASSETNUM (PE_101 ↔ PE-101) — high confidence, one proposal each.
        for tag in all_tags:
            cand = by_assetnum.get(_norm(tag.properties.get("tag_name", "")))
            if not cand:
                continue
            matched_tag_keys.add(tag.key)
            proposals.append(
                self._edge_proposal(
                    cand,
                    [tag],
                    basis=f"tag name '{tag.properties.get('tag_name')}' == ASSETNUM {cand.name}",
                    score=0.9,
                )
            )

        # 2) Folder-level fuzzy links for the remaining tags (device folders
        #    like Motor / VFD_GS10 that map to one asset, not per-tag).
        folders: dict[str, list[CanonicalEntity]] = {}
        for tag in all_tags:
            if tag.key in matched_tag_keys:
                continue
            folders.setdefault(tag.properties.get("scada_path", "").rsplit("/", 1)[0], []).append(tag)

        for folder, tags in folders.items():
            device_leaf = folder.rsplit("/", 1)[-1]
            best, basis, score = self._best_cmms_match(device_leaf, tags, cmms_targets)
            if not best:
                continue
            proposals.append(self._edge_proposal(best, tags, basis=basis, score=score))
        return proposals

    def _edge_proposal(
        self, target: CanonicalEntity, tags: list[CanonicalEntity], *, basis: str, score: float
    ) -> Proposal:
        is_safety = any(t.properties.get("is_safety") for t in tags)
        label = tags[0].properties.get("tag_name") if len(tags) == 1 else (
            tags[0].properties.get("scada_path", "").rsplit("/", 1)[0].rsplit("/", 1)[-1]
        )
        return Proposal(
            suggestion_type="kg_edge",
            title=f"Link SCADA '{label}' → {target.name} (HAS_SIGNAL)",
            body=(
                f"{len(tags)} Ignition tag(s) look like signals of CMMS "
                f"{target.entity_type} '{target.name}' "
                f"({target.properties.get('description')}). Match basis: {basis}. "
                "Confirm to attach these live signals to the asset."
            ),
            extracted_data={
                "relationship_type": "HAS_SIGNAL",
                "cmms_target_key": target.key,
                "cmms_uns_path": target.uns_path,
                "scada_tags": [t.properties.get("scada_path") for t in tags],
                "match_basis": basis,
            },
            confidence=score,
            risk_level="safety_critical" if is_safety else "low",
            proposed_by=f"import:{self.name}",
            source_kind="tag_entity",
        )

    @staticmethod
    def _best_cmms_match(
        device_leaf: str, tags: list[CanonicalEntity], cmms_targets: list[CanonicalEntity]
    ) -> tuple[Optional[CanonicalEntity], str, float]:
        leaf_n = _norm(device_leaf)
        tag_names_n = {_norm(t.properties.get("tag_name", "")) for t in tags}
        best: Optional[CanonicalEntity] = None
        best_basis = ""
        best_score = 0.0
        for cand in cmms_targets:
            assetnum_n = _norm(cand.name)
            desc_n = _norm(cand.properties.get("description") or "")
            score = 0.0
            basis = ""
            # 1) a tag name equals the CMMS asset number (PE_101 ↔ PE-101)
            if assetnum_n in tag_names_n or leaf_n == assetnum_n:
                score, basis = 0.9, f"tag/folder name == ASSETNUM {cand.name}"
            # 2) device keyword present in the asset number
            elif leaf_n and leaf_n in assetnum_n:
                score, basis = 0.7, f"'{device_leaf}' in ASSETNUM {cand.name}"
            # 3) device keyword present in the description (motor → "Drive Motor")
            elif leaf_n and any(tok and tok in desc_n for tok in _split_leaf(leaf_n)):
                hits = [tok for tok in _split_leaf(leaf_n) if tok in desc_n]
                score = 0.55 + 0.1 * (len(hits) - 1)
                basis = f"keyword(s) {hits} in DESCRIPTION of {cand.name}"
            if score > best_score:
                best, best_basis, best_score = cand, basis, min(score, 0.85)
        return best, best_basis, best_score

    # ── validate ────────────────────────────────────────────────────

    def validate(self, graph: NormalizedGraph) -> ValidationReport:
        report = ValidationReport()
        keys = set(graph.entities.keys())
        for ent in graph.entities.values():
            if ent.approval_state != "proposed":
                report.add("error", "auto_verified", f"{ent.key} is {ent.approval_state}", ent.key)
            if not ent.source_payload:
                report.add("error", "missing_source_payload", f"{ent.key} lost its raw record", ent.key)
            if ent.entity_type == "tag" and ent.uns_path is not None:
                report.add(
                    "warning",
                    "scada_tag_has_uns",
                    f"{ent.key} has a UNS path before being linked to an asset",
                    ent.key,
                )
        for rel in graph.relationships:
            for endpoint in (rel.source_key, rel.target_key):
                if endpoint not in keys:
                    report.add("warning", "orphan_relationship", f"{rel.relationship_type}: {endpoint}")
        return report

    # ── export (unsupported for SCADA) ──────────────────────────────

    async def export_enriched(self, graph_context: dict[str, Any]) -> ExportResult:
        return ExportResult(
            supported=False,
            written=False,
            payloads=[],
            note="Ignition tag providers are not an enriched-write-back target; "
            "MIRA reads SCADA, it does not push enriched payloads to a tag tree.",
        )

    # ── config ──────────────────────────────────────────────────────

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "gateway_url": {"type": "string", "required": True, "description": "Ignition gateway base URL"},
            "provider": {"type": "string", "required": False, "default": "default", "description": "Tag provider"},
            "folder": {"type": "string", "required": False, "description": "Browse root folder filter"},
            "api_key": {"type": "string", "required": True, "secret": True, "description": "WebDev/API key (Doppler-managed)"},
            "fixture_path": {"type": "string", "required": False, "description": "Mock only: path to fixture JSON"},
        }


def _split_leaf(leaf_n: str) -> list[str]:
    """Break a normalized device leaf into candidate keyword tokens.
    'vfdgs10' → ['vfd', 'gs10']; 'motor' → ['motor']."""
    known = ["motor", "vfd", "gs10", "pump", "sensor", "conveyor", "drive", "valve"]
    found = [k for k in known if k in leaf_n]
    return found or [leaf_n]

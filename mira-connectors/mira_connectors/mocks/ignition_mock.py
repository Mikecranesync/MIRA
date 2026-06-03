"""IgnitionMockConnector — fixture-backed Ignition (SCADA) connector.

Reads ``fixtures/ignition.json`` (a realistic 8.1 tag export: provider ``[default]``,
site/area/line folders, OPC tags bound to a Modbus device). Exercises discover →
import → normalize → derive_relationships. Read-only by construction (SCADA doctrine):
``export_records`` refuses, inherited from ``SCADAConnector``.

A real ``IgnitionConnector`` would replace ``_load()``/``import_records`` with the
Ignition WebDev tag-browse endpoint (or the gateway tag export) and keep
``normalize``/``derive_relationships`` verbatim.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mira_connectors._uns import candidate_uns_path
from mira_connectors.base import ConnectorCapabilities, ConnectorConfig, ConnectorKind
from mira_connectors.canonical import (
    CanonicalRecord,
    CanonicalRelationship,
    CanonicalTag,
    EvidenceRef,
    RawRecord,
    RecordType,
)
from mira_connectors.types.scada import SCADA_RECORD_TYPES, SCADAConnector

_FIXTURE = Path(__file__).parent / "fixtures" / "ignition.json"

# Ignition dataType → MIRA canonical data_type.
_DT = {
    "Boolean": "bool", "Int1": "int", "Int2": "int", "Int4": "int", "Int8": "int",
    "Float4": "float", "Float8": "float", "String": "string",
}
# Folder names that denote a physical asset (not just a structural area). Used to
# attach HAS_SIGNAL edges from the asset to its tags.
_ASSET_FOLDERS = {"Motor", "GS10", "PE_B16_2"}


class IgnitionMockConnector(SCADAConnector):
    provider = "ignition"
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
        return {"ok": True, "provider": self.provider, "mock": True, "device": self._load().get("device")}

    async def discover(self) -> ConnectorCapabilities:
        data = self._load()
        return ConnectorCapabilities(
            kind=ConnectorKind.SCADA,
            provider=self.provider,
            record_types=SCADA_RECORD_TYPES,
            supports_export=False,  # read-only by construction
            supports_incremental=False,
            schema={
                "tagProvider": data.get("tagProvider"),
                "opcServer": data.get("opcServer"),
                "device": data.get("device"),
                "tag_tree": _tree_outline(data.get("tags", [])),
            },
            notes="Mock Ignition. Read-only — MIRA does not write to the plant.",
        )

    # --- import: flatten the tag tree into one RawRecord per AtomicTag -------
    async def import_records(
        self, record_type: RecordType, *, since: str | None = None, limit: int = 500
    ) -> list[RawRecord]:
        if record_type is not RecordType.TAG:
            return []  # locations/assets are *derived* from the tag tree, not imported
        data = self._load()
        provider = data.get("tagProvider", "default")
        flat: list[RawRecord] = []
        _flatten(data.get("tags", []), [], provider, flat, self.provider)
        return flat[:limit]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for r in raw:
            if r.record_type is not RecordType.TAG:
                continue
            f = r.fields
            path_parts: list[str] = f["_path_parts"]  # ["Lake_Wales","Bench","Conveyor","Motor","Speed"]
            out.append(
                CanonicalTag(
                    source_system=self.provider,
                    source_record_id=r.source_record_id,
                    tag_id=".".join(path_parts),
                    data_type=_DT.get(f.get("dataType", ""), "float"),
                    engineering_unit=f.get("engUnit"),
                    scada_path=f["_scada_path"],
                    address=f.get("opcItemPath"),
                    history_enabled=bool(f.get("historyEnabled")),
                    proposed_uns_path=candidate_uns_path(*path_parts),
                    attributes={
                        k: v for k, v in f.items()
                        if k in ("deadband", "alarms", "tooltip", "valueSource")
                    },
                    confidence=0.85,  # Sparkplug/OPC path is a strong UNS identity source
                    raw=f,
                )
            )
        return out

    # --- derive relationships: folder hierarchy + asset→tag HAS_SIGNAL -------
    def derive_relationships(self, records: list[CanonicalRecord]) -> list[CanonicalRelationship]:
        rels: list[CanonicalRelationship] = []
        seen_located: set[tuple[str, str]] = set()
        for rec in records:
            if not isinstance(rec, CanonicalTag):
                continue
            parts = rec.tag_id.split(".")
            # Find the nearest enclosing asset folder, if any.
            asset_folder = next((p for p in reversed(parts[:-1]) if p in _ASSET_FOLDERS), None)
            if asset_folder:
                asset_path = candidate_uns_path(*parts[: parts.index(asset_folder) + 1])
                rels.append(self._rel(
                    "HAS_SIGNAL", asset_path, rec.tag_id,
                    EvidenceRef("tag_list", f"Ignition tag {rec.scada_path}",
                                page_or_location=rec.address, confidence_contribution=0.85),
                    confidence=0.8, source_kind="uns_path", target_kind="tag_id",
                ))
            # Folder-to-folder LOCATED_IN chain (deduped).
            for i in range(1, len(parts) - 1):
                child = candidate_uns_path(*parts[: i + 1])
                parent = candidate_uns_path(*parts[:i])
                key = (child, parent)
                if key in seen_located:
                    continue
                seen_located.add(key)
                rels.append(self._rel(
                    "LOCATED_IN", child, parent,
                    EvidenceRef("tag_list", f"Ignition folder hierarchy under {parent}",
                                page_or_location=rec.scada_path, confidence_contribution=0.6),
                    confidence=0.65, source_kind="uns_path", target_kind="uns_path",
                ))
        return rels

    def _rel(
        self, rel_type: str, source_ref: str, target_ref: str, evidence: EvidenceRef,
        *, confidence: float, source_kind: str, target_kind: str,
    ) -> CanonicalRelationship:
        return CanonicalRelationship(
            source_system=self.provider,
            source_record_id=f"{rel_type}:{source_ref}->{target_ref}",
            relationship_type=rel_type,
            source_ref=source_ref,
            target_ref=target_ref,
            source_ref_kind=source_kind,
            target_ref_kind=target_kind,
            confidence=confidence,
            reasoning=f"Derived from Ignition {rel_type}",
            evidence=[evidence],
        )


def _tree_outline(tags: list[dict[str, Any]], depth: int = 0) -> list[str]:
    """Compact human-readable outline of the tag tree for the discover() schema."""
    lines: list[str] = []
    for t in tags:
        kind = t.get("tagType")
        marker = "📁" if kind == "Folder" else f"• {t.get('dataType')}"
        lines.append(f"{'  ' * depth}{marker} {t['name']}")
        if kind == "Folder":
            lines.extend(_tree_outline(t.get("tags", []), depth + 1))
    return lines


def _flatten(
    tags: list[dict[str, Any]], prefix: list[str], provider: str,
    out: list[RawRecord], source_system: str,
) -> None:
    """Walk the tag tree; emit one RawRecord per AtomicTag with full path context."""
    for t in tags:
        name = t["name"]
        parts = [*prefix, name]
        if t.get("tagType") == "Folder":
            _flatten(t.get("tags", []), parts, provider, out, source_system)
        else:
            scada_path = f"[{provider}]" + "/".join(parts)
            fields = dict(t)
            fields["_path_parts"] = parts
            fields["_scada_path"] = scada_path
            out.append(
                RawRecord(
                    source_system=source_system,
                    record_type=RecordType.TAG,
                    source_record_id=scada_path,
                    fields=fields,
                )
            )

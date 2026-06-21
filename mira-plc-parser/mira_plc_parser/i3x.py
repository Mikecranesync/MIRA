"""Export the proposed UNS namespace as CESMII i3X-shaped data.

i3X (https://www.i3x.dev, https://github.com/cesmii/API) models a plant as ObjectInstances linked by
`parentId` into a hierarchy, each typed by an ObjectType. We craft toward that API shape: every ISA-95
level (enterprise / site / area / line / asset) becomes a container ObjectInstance, and every PLC tag
becomes a leaf ObjectInstance whose `parentId` is its asset (or line) and whose `typeElementId` points
at a signal/datatype ObjectType. `elementId` is the UNS path (unique + hierarchical), so the tree is
self-consistent and re-importable.

This is a read-only, offline transform of the parser's `uns_candidates` -- no network, no writes to a
live i3X server. The output is the JSON body shape an i3X loader consumes (instances + the minimal
ObjectTypes they reference). Field names follow the i3X OpenAPI (elementId, displayName, typeElementId,
parentId, isComposition, namespaceUri, schema).
"""
from __future__ import annotations

from . import uns as _uns

NAMESPACE_URI = "urn:mira:plc-parser:uns"

# ISA-95 container levels, outer -> inner. Each becomes a typed container ObjectInstance.
_LEVELS = ("enterprise", "site", "area", "line", "asset")

# Minimal ObjectTypes the instances reference. A real i3X server would carry richer JSON Schemas;
# this is the interoperable floor: one type per ISA-95 level + a generic signal/tag type.
_BASE_TYPES = [
    {"elementId": "urn:mira:type:enterprise", "displayName": "Enterprise", "level": "enterprise"},
    {"elementId": "urn:mira:type:site", "displayName": "Site", "level": "site"},
    {"elementId": "urn:mira:type:area", "displayName": "Area", "level": "area"},
    {"elementId": "urn:mira:type:line", "displayName": "Line", "level": "line"},
    {"elementId": "urn:mira:type:asset", "displayName": "Asset", "level": "asset"},
    {"elementId": "urn:mira:type:signal", "displayName": "Signal", "level": "signal"},
]


def _type_for_level(level: str) -> str:
    return "urn:mira:type:%s" % level


def _object_types() -> list[dict]:
    """The ObjectType definitions the instances reference (i3X ObjectTypeResponse shape)."""
    out = []
    for t in _BASE_TYPES:
        out.append({
            "elementId": t["elementId"],
            "displayName": t["displayName"],
            "namespaceUri": NAMESPACE_URI,
            "schema": {
                "type": "object",
                "title": t["displayName"],
                "properties": {"displayName": {"type": "string"}},
            },
            "version": "1",
        })
    return out


def to_i3x(report: dict, prefix: dict | None = None) -> dict:
    """Turn a parsed report into an i3X-shaped payload: {namespace, objectTypes, objectInstances}.

    Containers (enterprise..asset) are emitted once each, de-duplicated by their UNS path; leaf tags
    become instances parented to their asset (or line if no asset matched). `elementId` is the UNS path.
    """
    candidates = _uns.propose_uns(report, prefix)
    instances: list[dict] = []
    seen: set[str] = set()

    def _ensure_container(path_parts: list[str], level: str, display: str) -> str:
        """Emit a container instance for a UNS path prefix if not already emitted. Returns its id."""
        element_id = "/".join(path_parts)
        if element_id in seen:
            return element_id
        seen.add(element_id)
        parent_id = "/".join(path_parts[:-1]) if len(path_parts) > 1 else None
        instances.append({
            "elementId": element_id,
            "displayName": display,
            "typeElementId": _type_for_level(level),
            "parentId": parent_id,
            "isComposition": True,
            "metadata": {"level": level, "unsPath": element_id},
        })
        return element_id

    for c in candidates:
        segs = c["segments"]
        # walk the container chain outer->inner, creating each level once
        chain: list[str] = []
        for level in _LEVELS:
            seg = segs.get(level, "")
            if not seg:
                continue          # asset can be empty -> tag parents to the line
            chain.append(seg)
            _ensure_container(chain, level, seg)

        parent_id = "/".join(chain) if chain else None
        instances.append({
            "elementId": c["path"],
            "displayName": c["tag"],
            "typeElementId": _type_for_level("signal"),
            "parentId": parent_id,
            "isComposition": False,
            "metadata": {
                "plcTag": c["tag"],
                "dataType": c.get("data_type", ""),
                "signal": c.get("signal", ""),
                "unsPath": c["path"],
                "confidence": c.get("confidence", ""),
                "standardized": c.get("standardized", False),
            },
        })

    return {
        "namespace": {"uri": NAMESPACE_URI, "displayName": "MIRA PLC Parser UNS"},
        "objectTypes": _object_types(),
        "objectInstances": instances,
    }

"""Project a parsed report into an i3X-shaped object graph (schema mira-plc-parser/i3x@1).

i3X (Industrial Information Interoperability eXchange) models a plant as **Objects** that carry a
stable **ElementId**, a hierarchical **namespace** (ISA-95 element path), **VQT** (Value/Quality/
Timestamp) values, and **relationships**. See docs/specs/public-ingest-api-spec.md S10. This module
maps what the read-only parser can know statically:

    controller            -> Object(type=Asset)
    asset_candidate        -> Object(type=Component)  --HasComponent-->  Asset
    tag / signal           -> Object(type=Signal) with an (empty) VQT, BelongsTo Asset
    fault / review finding -> Object(type=Event) with severity, RelatesTo Asset

This is a forward-compatible PROPOSAL, not a live feed and not a canonical UNS assignment: VQT values
are empty (static analysis samples nothing), and the namespace is rooted at a caller-supplied
`namespace_root` -- the authoritative enterprise/site/area path is assigned engine-side, not here
(this subproject stays out of UNS path-building). ElementIds are deterministic (uuid5 over the
namespace) so the same export always yields the same graph. Stdlib-only.
"""
from __future__ import annotations

import re
import uuid

_NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")  # uuid.NAMESPACE_URL, spelled out for clarity
_SLUG_RE = re.compile(r"[^a-z0-9]+")

I3X_SCHEMA = "mira-plc-parser/i3x@1"


def _slug(name: str) -> str:
    return _SLUG_RE.sub("_", (name or "").lower()).strip("_") or "unnamed"


def _eid(namespace: str) -> str:
    return str(uuid.uuid5(_NS, namespace))


def _empty_vqt() -> dict:
    # i3X value triple; static analysis has no sample, so value/timestamp are null and quality says so
    return {"value": None, "quality": "unknown", "timestamp": None}


def _severity(confidence: str) -> str:
    # review (safety) -> high; medium-confidence faults -> medium; everything else low
    return {"review": "high", "medium": "medium"}.get(confidence, "low")


def render_i3x(result, namespace_root: str = "plc") -> dict:
    """Map a ParseResult into an i3X object graph (dict, json.dumps-safe).

    `namespace_root` is the path the asset hangs under (default "plc"); pass your site/area path to
    root the proposal where it belongs. Unhandled results return just the envelope + warnings.
    """
    det = result.detection
    envelope = {"schema": I3X_SCHEMA,
                "detection": {"fmt": det.fmt, "confidence": det.confidence}}
    if not result.handled:
        return {**envelope, "handled": False, "objects": [],
                "warnings": list(result.project.warnings)}

    r = result.report
    asset_ns = "%s.%s" % (_slug(namespace_root), _slug(r.controller or "controller"))
    asset_eid = _eid(asset_ns)
    objects: list[dict] = [{
        "element_id": asset_eid,
        "object_type": "Asset",
        "namespace": asset_ns,
        "display_name": r.controller or "(unnamed controller)",
        "attributes": {"vendor": r.vendor, "source_format": det.fmt},
        "relationships": [],
    }]

    # Components (from asset candidates) -- HasComponent edge from the Asset.
    for f in r.asset_candidates:
        ns = "%s.%s" % (asset_ns, _slug(f.name))
        objects.append({
            "element_id": _eid(ns),
            "object_type": "Component",
            "namespace": ns,
            "display_name": f.name,
            "attributes": {"detail": f.detail, "confidence": f.confidence},
            "relationships": [{"type": "HasComponent", "from": asset_eid, "to": _eid(ns)}],
            "evidence": list(f.evidence),
        })

    # Signals (from the tag dictionary) -- each carries an empty VQT + its inferred roles. VFD-signal
    # candidates annotate the matching signal with a drive role.
    vfd_role = {f.name: f.detail for f in r.vfd_signal_candidates}
    for t in r.tag_dictionary:
        ns = "%s.%s" % (asset_ns, _slug(t["name"]))
        attrs = {
            "data_type": t.get("data_type", ""),
            "scope": t.get("scope", ""),
            "roles": t.get("roles", []),
            "address": t.get("address", ""),
            "source_variable": t["name"],
            "used_count": t.get("used_count", 0),
        }
        if t["name"] in vfd_role:
            attrs["vfd_role"] = vfd_role[t["name"]]
        objects.append({
            "element_id": _eid(ns),
            "object_type": "Signal",
            "namespace": ns,
            "display_name": t["name"],
            "vqt": _empty_vqt(),
            "attributes": attrs,
            "relationships": [{"type": "BelongsTo", "from": _eid(ns), "to": asset_eid}],
        })

    # Events (faults + safety review) -- RelatesTo the Asset, with a severity band.
    for f in list(r.fault_candidates) + list(r.review_required):
        ns = "%s.event.%s.%s" % (asset_ns, f.kind, _slug(f.name))
        objects.append({
            "element_id": _eid(ns),
            "object_type": "Event",
            "namespace": ns,
            "display_name": f.name,
            "severity": _severity(f.confidence),
            "attributes": {"kind": f.kind, "detail": f.detail, "confidence": f.confidence},
            "relationships": [{"type": "RelatesTo", "from": _eid(ns), "to": asset_eid}],
            "evidence": list(f.evidence),
        })

    by_type: dict[str, int] = {}
    for o in objects:
        by_type[o["object_type"]] = by_type.get(o["object_type"], 0) + 1
    return {**envelope, "handled": True, "asset_namespace": asset_ns,
            "objects": objects, "counts": by_type}

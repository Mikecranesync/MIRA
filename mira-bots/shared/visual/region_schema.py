"""factorylm.visual-region.v1 — the frozen canonical annotation contract.

FROZEN by **PR V0** of the *PrintSense Visual Focus Workspace* PRD
(`docs/prd/2026-07-20-printsense-visual-focus-workspace.md`, §6 + §8.3).

Contract layer ONLY — **no runtime wiring, no DB migration, no second ROI
table.** Canonical regions serialize *into* the existing
`region_of_interest.geometry` JSONB (migration 063) via
:func:`to_storage_geometry`, so there is exactly one ROI store. The existing
ledger stores rectangles as ``{"type": "bbox", "x", "y", "w", "h"}``; the v1
``rect`` primitive (``x, y, width, height``) maps to that shape losslessly.

Coordinate rule (PRD §6 "Coordinate rule"): **all geometry is normalized to the
ORIGINAL page/photo**, ``0 <= x, y, width, height <= 1``. This survives device
size changes, zoom/pan/rotation, Telegram vs Hub, raster derivatives, and
deep-zoom tiles, and stays stable for materialized-evidence reuse. Perspective-
corrected derivatives carry the affine/homography in ``transform_to_original``.

This module is pure (stdlib only) and side-effect-free.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

# ---------------------------------------------------------------------------
# Frozen identifiers
# ---------------------------------------------------------------------------

SCHEMA_ID = "factorylm.visual-region.v1"

#: The six supported geometry primitives (PRD §6 "Supported geometry").
GEOMETRY_TYPES: tuple[str, ...] = (
    "point",
    "rect",
    "ellipse",
    "polygon",
    "polyline",
    "freehand",
)

#: ``region_of_interest.origin`` CHECK values (migration 063).
ORIGINS: tuple[str, ...] = ("user", "system")

#: The only canonical coordinate space in v1 — normalized to the original.
COORDINATE_SPACE = "normalized_original"

#: Box-shaped primitives carry ``x, y, width, height``; path-shaped primitives
#: carry ``points`` (a list of ``[x, y]`` pairs).
_BOX_TYPES = ("rect", "ellipse")
_PATH_TYPES = ("polygon", "polyline", "freehand")

#: The existing ledger's stored type for a rectangle (migration 063 comment
#: ``{type:'bbox', x,y,w,h}``). ``rect`` <-> ``bbox`` is the only rename.
_STORAGE_RECT_TYPE = "bbox"

#: Canonical float precision — enough for sub-pixel accuracy on a 4K sheet
#: (1/1e6 of a page is < 0.004 px at 3840 px wide) while making serialization
#: deterministic across devices and float noise.
_PRECISION = 6


class RegionValidationError(ValueError):
    """Raised when a region/geometry violates ``factorylm.visual-region.v1``."""


# ---------------------------------------------------------------------------
# JSON Schema (language-neutral; mirrored in
# schemas/factorylm.visual-region.v1.json for TS/other consumers)
# ---------------------------------------------------------------------------

REGION_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": SCHEMA_ID,
    "title": "FactoryLM Visual Region v1",
    "type": "object",
    "required": ["schema", "geometry"],
    "properties": {
        "schema": {"const": SCHEMA_ID},
        "region_id": {"type": "string"},
        "evidence_id": {"type": "string"},
        "page_ref": {"type": ["string", "null"]},
        "origin": {"enum": list(ORIGINS)},
        "geometry": {"$ref": "#/$defs/geometry"},
        "style": {"type": "object"},
        "transform_to_original": {"type": ["object", "null"]},
        "created_from": {"type": "object"},
    },
    "$defs": {
        "coord": {"type": "number", "minimum": 0.0, "maximum": 1.0},
        "point_pair": {
            "type": "array",
            "items": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "minItems": 2,
            "maxItems": 2,
        },
        "geometry": {
            "type": "object",
            "required": ["type"],
            "properties": {
                "type": {"enum": list(GEOMETRY_TYPES)},
                "coordinate_space": {"const": COORDINATE_SPACE},
                "x": {"$ref": "#/$defs/coord"},
                "y": {"$ref": "#/$defs/coord"},
                "width": {"$ref": "#/$defs/coord"},
                "height": {"$ref": "#/$defs/coord"},
                "points": {"type": "array", "items": {"$ref": "#/$defs/point_pair"}},
            },
        },
    },
}


# ---------------------------------------------------------------------------
# Canonicalization + validation
# ---------------------------------------------------------------------------


def _num(value: Any, field: str) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError) as exc:
        raise RegionValidationError(f"{field}: not a number ({value!r})") from exc
    if f != f or f in (float("inf"), float("-inf")):
        raise RegionValidationError(f"{field}: non-finite ({value!r})")
    return f


def _coord(value: Any, field: str) -> float:
    """A normalized coordinate, rounded, enforced to ``0 <= v <= 1``."""
    f = round(_num(value, field), _PRECISION)
    if not (0.0 <= f <= 1.0):
        raise RegionValidationError(
            f"{field}: {f} out of normalized range [0, 1] (PRD §6 coordinate rule)"
        )
    return f


def _canonical_points(points: Any, gtype: str) -> list[list[float]]:
    if not isinstance(points, list) or not points:
        raise RegionValidationError(f"{gtype}: 'points' must be a non-empty list")
    min_pts = 3 if gtype == "polygon" else 2
    if len(points) < min_pts:
        raise RegionValidationError(f"{gtype}: needs >= {min_pts} points, got {len(points)}")
    out: list[list[float]] = []
    for i, p in enumerate(points):
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise RegionValidationError(f"{gtype}: point {i} must be [x, y]")
        out.append([_coord(p[0], f"{gtype}.points[{i}].x"), _coord(p[1], f"{gtype}.points[{i}].y")])
    return out


def canonical_geometry(geometry: dict) -> dict:
    """Return the deterministic canonical form of a v1 geometry.

    Validates types + normalized bounds, rounds every coordinate to
    ``_PRECISION`` decimals, and stamps ``coordinate_space`` so the output is
    stable regardless of input key order or float noise. This is the exact
    shape hashed into the region materialization key (PRD §8.3), so two callers
    that draw the "same" region get the same reusable key.
    """
    if not isinstance(geometry, dict):
        raise RegionValidationError("geometry must be an object")
    gtype = geometry.get("type")
    if gtype not in GEOMETRY_TYPES:
        raise RegionValidationError(f"geometry.type {gtype!r} not in {GEOMETRY_TYPES}")
    space = geometry.get("coordinate_space", COORDINATE_SPACE)
    if space != COORDINATE_SPACE:
        raise RegionValidationError(
            f"coordinate_space {space!r} != {COORDINATE_SPACE!r} (v1 is normalized-original only)"
        )

    canon: dict[str, Any] = {"type": gtype, "coordinate_space": COORDINATE_SPACE}
    if gtype == "point":
        canon["x"] = _coord(geometry.get("x"), "point.x")
        canon["y"] = _coord(geometry.get("y"), "point.y")
    elif gtype in _BOX_TYPES:
        x = _coord(geometry.get("x"), f"{gtype}.x")
        y = _coord(geometry.get("y"), f"{gtype}.y")
        w = _coord(geometry.get("width"), f"{gtype}.width")
        h = _coord(geometry.get("height"), f"{gtype}.height")
        if x + w > 1.0 + 10.0 ** (-_PRECISION) or y + h > 1.0 + 10.0 ** (-_PRECISION):
            raise RegionValidationError(
                f"{gtype}: box exceeds original bounds (x+width or y+height > 1)"
            )
        canon.update(x=x, y=y, width=w, height=h)
    else:  # path types
        canon["points"] = _canonical_points(geometry.get("points"), gtype)
    return canon


def validate_region(region: dict) -> None:
    """Raise :class:`RegionValidationError` if ``region`` violates the contract.

    Checks the ``schema`` const, the optional ``origin`` enum, and delegates
    geometry validation to :func:`canonical_geometry`. Does not mutate input.
    """
    if not isinstance(region, dict):
        raise RegionValidationError("region must be an object")
    if region.get("schema") != SCHEMA_ID:
        raise RegionValidationError(f"schema must be {SCHEMA_ID!r}, got {region.get('schema')!r}")
    origin = region.get("origin")
    if origin is not None and origin not in ORIGINS:
        raise RegionValidationError(f"origin {origin!r} not in {ORIGINS}")
    if "geometry" not in region:
        raise RegionValidationError("region missing 'geometry'")
    canonical_geometry(region["geometry"])


# ---------------------------------------------------------------------------
# Reconciliation with the existing ledger (migration 063)
# ---------------------------------------------------------------------------


def to_storage_geometry(geometry: dict) -> dict:
    """Map a v1 geometry into the existing ``region_of_interest.geometry`` shape.

    The only rename is ``rect(x,y,width,height)`` -> ``bbox(x,y,w,h)`` (the shape
    migration 063 documents). ``ellipse`` and the path primitives pass through
    with canonical, normalized coordinates. Round-trips with
    :func:`from_storage_geometry`.
    """
    canon = canonical_geometry(geometry)
    if canon["type"] == "rect":
        return {
            "type": _STORAGE_RECT_TYPE,
            "x": canon["x"],
            "y": canon["y"],
            "w": canon["width"],
            "h": canon["height"],
        }
    return canon


def from_storage_geometry(storage: dict) -> dict:
    """Inverse of :func:`to_storage_geometry`: stored ``bbox`` -> v1 ``rect``."""
    if not isinstance(storage, dict):
        raise RegionValidationError("storage geometry must be an object")
    if storage.get("type") == _STORAGE_RECT_TYPE:
        return canonical_geometry(
            {
                "type": "rect",
                "x": storage.get("x"),
                "y": storage.get("y"),
                "width": storage.get("w"),
                "height": storage.get("h"),
            }
        )
    return canonical_geometry(storage)


# ---------------------------------------------------------------------------
# Region materialization key (PRD §8.3) — the reuse-before-inference anchor
# ---------------------------------------------------------------------------


def region_materialization_key(
    *,
    tenant_id: str,
    evidence_original_hash: str,
    geometry: dict,
    question_contract_version: str,
    output_schema: str,
    producer_version: str,
    prompt_contract_version: str,
    dependency_versions: dict[str, str] | None = None,
) -> str:
    """Deterministic ``sha256`` reuse key over the canonical inputs (PRD §8.3).

    Two identical questions over the *same* region on *unchanged* evidence, under
    the same contract/producer/prompt/dependency versions, yield the same key —
    the anchor the materialized-evidence resolver uses to reuse an answer without
    calling a model (zero-token path). Any change (a moved box, a new producer
    version, a changed dependency) changes the key, invalidating the cache.
    """
    payload = {
        "tenant_id": tenant_id,
        "evidence_original_hash": evidence_original_hash,
        "geometry": canonical_geometry(geometry),
        "question_contract_version": question_contract_version,
        "output_schema": output_schema,
        "producer_version": producer_version,
        "prompt_contract_version": prompt_contract_version,
        "dependency_versions": dict(sorted((dependency_versions or {}).items())),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()

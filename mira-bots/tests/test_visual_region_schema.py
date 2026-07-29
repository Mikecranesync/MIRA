"""Canonical geometry tests for factorylm.visual-region.v1 (PRD PR V0).

Freezes the annotation contract in `mira-bots/shared/visual/region_schema.py`:
normalized-original coordinates, deterministic canonicalization, the six
geometry primitives, lossless mapping onto the existing
`region_of_interest.geometry` ledger (migration 063), and the region
materialization key (PRD §8.3). No runtime wiring is exercised.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "mira-bots")

import pytest
from shared.visual.region_schema import (
    COORDINATE_SPACE,
    GEOMETRY_TYPES,
    REGION_JSON_SCHEMA,
    SCHEMA_ID,
    RegionValidationError,
    canonical_geometry,
    from_storage_geometry,
    region_materialization_key,
    to_storage_geometry,
    validate_region,
)


def _rect(**kw):
    base = {"type": "rect", "x": 0.4125, "y": 0.187, "width": 0.224, "height": 0.163}
    base.update(kw)
    return base


def _region(geometry=None, **kw):
    r = {"schema": SCHEMA_ID, "origin": "user", "geometry": geometry or _rect()}
    r.update(kw)
    return r


# --------------------------------------------------------------------------- #
# Normalized-coordinate rule (PRD §6)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("bad", [-0.01, 1.01, 2.0, -5.0])
def test_out_of_range_coord_rejected(bad):
    with pytest.raises(RegionValidationError):
        canonical_geometry(_rect(x=bad))


@pytest.mark.parametrize("edge", [0.0, 1.0])
def test_edge_coords_accepted(edge):
    canonical_geometry({"type": "point", "x": edge, "y": edge})


def test_box_exceeding_bounds_rejected():
    # x + width > 1 must fail (crop can never exceed original bounds — PRD §18)
    with pytest.raises(RegionValidationError):
        canonical_geometry(_rect(x=0.9, width=0.2))


def test_non_finite_and_nonnumeric_rejected():
    with pytest.raises(RegionValidationError):
        canonical_geometry(_rect(x=float("inf")))
    with pytest.raises(RegionValidationError):
        canonical_geometry(_rect(x="not-a-number"))


# --------------------------------------------------------------------------- #
# Determinism — same region -> same canonical form (regardless of key order /
# float noise), which is what makes the materialization key stable.
# --------------------------------------------------------------------------- #


def test_canonical_form_is_stable_across_key_order_and_float_noise():
    a = {"type": "rect", "x": 0.4125, "y": 0.187, "width": 0.224, "height": 0.163}
    b = {"height": 0.163, "width": 0.22400000001, "y": 0.187, "x": 0.41250000004, "type": "rect"}
    assert canonical_geometry(a) == canonical_geometry(b)
    assert canonical_geometry(a)["coordinate_space"] == COORDINATE_SPACE


def test_freehand_polygon_polyline_canonicalize_deterministically():
    pts = [[0.1, 0.2], [0.3, 0.40000001], [0.5, 0.6]]
    for t in ("polyline", "freehand"):
        g = canonical_geometry({"type": t, "points": pts})
        assert g["type"] == t
        assert g["points"] == [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]
    poly = canonical_geometry({"type": "polygon", "points": pts})
    assert poly["points"][0] == [0.1, 0.2]


def test_polygon_requires_three_points():
    with pytest.raises(RegionValidationError):
        canonical_geometry({"type": "polygon", "points": [[0.1, 0.1], [0.2, 0.2]]})


def test_all_six_primitives_validate():
    samples = {
        "point": {"type": "point", "x": 0.5, "y": 0.5},
        "rect": _rect(),
        "ellipse": {"type": "ellipse", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
        "polygon": {"type": "polygon", "points": [[0.1, 0.1], [0.2, 0.1], [0.15, 0.2]]},
        "polyline": {"type": "polyline", "points": [[0.1, 0.1], [0.2, 0.2]]},
        "freehand": {"type": "freehand", "points": [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]]},
    }
    assert set(samples) == set(GEOMETRY_TYPES)
    for g in samples.values():
        assert canonical_geometry(g)["type"] == g["type"]


def test_unknown_geometry_type_rejected():
    with pytest.raises(RegionValidationError):
        canonical_geometry({"type": "blob", "x": 0.1, "y": 0.1})


def test_wrong_coordinate_space_rejected():
    with pytest.raises(RegionValidationError):
        canonical_geometry({"type": "point", "x": 0.5, "y": 0.5, "coordinate_space": "pixels"})


# --------------------------------------------------------------------------- #
# Region envelope validation
# --------------------------------------------------------------------------- #


def test_region_requires_correct_schema_id():
    validate_region(_region())  # ok
    with pytest.raises(RegionValidationError):
        validate_region(_region(schema="factorylm.visual-region.v2"))


def test_region_bad_origin_rejected():
    with pytest.raises(RegionValidationError):
        validate_region(_region(origin="robot"))


# --------------------------------------------------------------------------- #
# Reconciliation with the EXISTING ledger (migration 063) — no second table.
# --------------------------------------------------------------------------- #


def test_rect_maps_to_existing_bbox_storage_shape():
    stored = to_storage_geometry(_rect())
    # migration 063 documents {type:'bbox', x,y,w,h}
    assert stored["type"] == "bbox"
    assert set(stored) == {"type", "x", "y", "w", "h"}
    assert stored["w"] == 0.224 and stored["h"] == 0.163


def test_storage_round_trip_is_lossless():
    for g in (
        _rect(),
        {"type": "point", "x": 0.5, "y": 0.5},
        {"type": "polygon", "points": [[0.1, 0.1], [0.2, 0.1], [0.15, 0.2]]},
    ):
        assert from_storage_geometry(to_storage_geometry(g)) == canonical_geometry(g)


# --------------------------------------------------------------------------- #
# Region materialization key (PRD §8.3)
# --------------------------------------------------------------------------- #


_KEY_ARGS = dict(
    tenant_id="t-1",
    evidence_original_hash="sha256:abc",
    geometry=_rect(),
    question_contract_version="q1",
    output_schema="answer-envelope.v1",
    producer_version="printsense@1.0.0",
    prompt_contract_version="p1",
    dependency_versions={"graph": "3", "ocr": "2"},
)


def test_materialization_key_is_deterministic():
    assert region_materialization_key(**_KEY_ARGS) == region_materialization_key(**_KEY_ARGS)


def test_materialization_key_ignores_dependency_order():
    a = dict(_KEY_ARGS, dependency_versions={"graph": "3", "ocr": "2"})
    b = dict(_KEY_ARGS, dependency_versions={"ocr": "2", "graph": "3"})
    assert region_materialization_key(**a) == region_materialization_key(**b)


@pytest.mark.parametrize(
    "override",
    [
        {"geometry": _rect(x=0.5)},
        {"evidence_original_hash": "sha256:xyz"},
        {"producer_version": "printsense@1.1.0"},
        {"dependency_versions": {"graph": "4", "ocr": "2"}},
        {"tenant_id": "t-2"},
    ],
)
def test_materialization_key_changes_when_any_input_changes(override):
    assert region_materialization_key(**dict(_KEY_ARGS, **override)) != region_materialization_key(
        **_KEY_ARGS
    )


# --------------------------------------------------------------------------- #
# The committed JSON Schema mirror stays in sync with the frozen module.
# --------------------------------------------------------------------------- #


def test_json_schema_file_matches_module_constant():
    path = Path("mira-bots/shared/visual/schemas/factorylm.visual-region.v1.json")
    assert path.exists(), "language-neutral schema mirror must be committed"
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk == REGION_JSON_SCHEMA
    assert on_disk["$id"] == SCHEMA_ID

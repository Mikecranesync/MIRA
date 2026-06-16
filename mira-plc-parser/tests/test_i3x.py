"""Tests for the i3X (CESMII) namespace export."""

from pathlib import Path

from mira_plc_parser import i3x
from mira_plc_parser.pipeline import render_json, run

FIXTURE = Path(__file__).parent / "fixtures" / "conveyor.L5X"


def _payload(prefix=None):
    rep = render_json(run(FIXTURE.name, FIXTURE.read_text(encoding="utf-8")))
    return i3x.to_i3x(rep, prefix)


def test_payload_has_namespace_types_and_instances():
    p = _payload()
    assert p["namespace"]["uri"] == i3x.NAMESPACE_URI
    assert len(p["objectTypes"]) >= 6
    assert len(p["objectInstances"]) > len(p["objectTypes"])


def test_tree_integrity_every_parent_resolves():
    p = _payload()
    ids = {i["elementId"] for i in p["objectInstances"]}
    roots = 0
    for inst in p["objectInstances"]:
        if inst["parentId"] is None:
            roots += 1
        else:
            assert inst["parentId"] in ids, "dangling parentId: %s" % inst["parentId"]
    assert roots == 1, "exactly one root (enterprise) expected"


def test_containers_are_deduped():
    p = _payload()
    ids = [i["elementId"] for i in p["objectInstances"]]
    assert len(ids) == len(set(ids)), "duplicate elementId -> a container was emitted twice"


def test_leaf_tag_shape_matches_i3x_object_instance():
    p = _payload()
    by_id = {i["elementId"]: i for i in p["objectInstances"]}
    freq = by_id["enterprise/site1/area1/conveyorcell/vfd/frequency"]
    assert freq["displayName"] == "VFD_Frequency"
    assert freq["typeElementId"] == "urn:mira:type:signal"
    assert freq["parentId"] == "enterprise/site1/area1/conveyorcell/vfd"
    assert freq["isComposition"] is False
    assert freq["metadata"]["plcTag"] == "VFD_Frequency"
    assert freq["metadata"]["confidence"] == "high"


def test_container_is_composition_and_typed_by_level():
    p = _payload()
    by_id = {i["elementId"]: i for i in p["objectInstances"]}
    vfd = by_id["enterprise/site1/area1/conveyorcell/vfd"]
    assert vfd["isComposition"] is True
    assert vfd["typeElementId"] == "urn:mira:type:asset"
    enterprise = by_id["enterprise"]
    assert enterprise["parentId"] is None
    assert enterprise["typeElementId"] == "urn:mira:type:enterprise"


def test_prefix_override_rewrites_the_whole_tree():
    p = _payload({"site": "Plant 2", "line": "Line 3"})
    ids = {i["elementId"] for i in p["objectInstances"]}
    assert "enterprise/plant_2/area1/line_3/vfd/frequency" in ids

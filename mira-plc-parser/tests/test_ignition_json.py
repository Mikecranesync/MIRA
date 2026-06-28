"""Ignition tag-export JSON parser -- the Cappy Hour / ProveIt import engine (Phase 1a).

These assert the load-bearing behavior: an Ignition tag tree (Folder/UdtInstance/AtomicTag) becomes
an explicit ISA-95 namespace (enterprise/site/area/line/asset/signal) in the IR, that the i3X export
honors that *real* hierarchy (not the inferred flat one), and that MES bindings / engineering units /
CESMII nameplate survive the round trip. The fixture is a SYNTHETIC mini tree shaped like the real
`Enterprise B/tags.json` (the licensed corpus is never committed -- see ../proveit-factory/README).
"""
from pathlib import Path

from mira_plc_parser import i3x
from mira_plc_parser.detect import detect
from mira_plc_parser.parsers import ignition_json
from mira_plc_parser.pipeline import render_json, render_markdown, run

FIXTURE = Path(__file__).parent / "fixtures" / "ignition_cappy_hour_mini.json"


def _text():
    return FIXTURE.read_text(encoding="utf-8")


def _nodes_by_level(proj):
    out = {}
    for n in proj.namespace:
        out.setdefault(n.level, []).append(n)
    return out


# ---- detection ----

def test_detects_ignition_tag_json_by_content():
    d = detect("export.json", _text())
    assert d.fmt == "ignition_json"
    assert d.confidence == "high"


def test_detects_ignition_even_when_renamed():
    d = detect("tags.txt", _text())   # content-first: a renamed tag export still detected
    assert d.fmt == "ignition_json"


def test_json_without_tag_markers_is_not_ignition():
    d = detect("config.json", '{"hello": "world", "list": [1, 2, 3]}')
    assert d.fmt != "ignition_json"


# ---- parse -> ISA-95 namespace counts ----

def test_parse_builds_isa95_namespace_with_expected_counts():
    proj = ignition_json.parse(_text(), source_file="tags.json")
    by = _nodes_by_level(proj)
    assert len(by.get("enterprise", [])) == 1
    assert len(by.get("site", [])) == 1
    assert len(by.get("area", [])) == 2     # Filler Production, Packaging
    assert len(by.get("line", [])) == 2     # FillingLine03, LabelerLine01
    assert len(by.get("asset", [])) == 3    # CapLoader, Filler, Labeler
    assert len(by.get("signal", [])) == 9   # 3 + 2 + 4 atomic tags
    assert len(proj.namespace) == 18


def test_enterprise_root_and_paths_are_well_formed():
    proj = ignition_json.parse(_text(), source_file="tags.json")
    by = _nodes_by_level(proj)
    ent = by["enterprise"][0]
    assert ent.name == "Cappy Hour Inc"
    assert ent.path == ["Cappy Hour Inc"]
    # every node's path is rooted at the enterprise and ends with its own name
    for n in proj.namespace:
        assert n.path[0] == "Cappy Hour Inc"
        assert n.path[-1] == n.name


def test_asset_carries_udt_type_and_mes_binding():
    proj = ignition_json.parse(_text(), source_file="tags.json")
    assets = {n.name: n for n in proj.namespace if n.level == "asset"}
    cap = assets["CapLoader"]
    assert cap.udt_type == "Models/Equipment/Process/CapLoader"
    assert cap.mes_path.endswith("FillingLine03/CapLoader")
    assert cap.tag_path.endswith("FillingLine03/Caploader")
    assert cap.path == ["Cappy Hour Inc", "Site 1", "Filler Production", "FillingLine03", "CapLoader"]


def test_signals_preserve_engineering_units_and_dotted_names():
    proj = ignition_json.parse(_text(), source_file="tags.json")
    signals = {n.name: n for n in proj.namespace if n.level == "signal"}
    # nested UdtInstance -> dotted signal name, parented to the asset
    assert "ProductionRun.CapCount" in signals
    assert signals["ProductionRun.CapCount"].unit == "caps"
    assert signals["ProductionRun.CapCount"].path[-2] == "CapLoader"
    # three atomic tags carry an engUnit
    assert sum(1 for n in signals.values() if n.unit) == 3


def test_cesmii_machine_identification_lifts_nameplate_onto_asset():
    proj = ignition_json.parse(_text(), source_file="tags.json")
    labeler = next(n for n in proj.namespace if n.level == "asset" and n.name == "Labeler")
    assert labeler.manufacturer == "Krones"
    assert labeler.model == "Contiroll HS"


# ---- pipeline integration: report + markdown explain the factory ----

def test_pipeline_run_surfaces_namespace_and_level_counts():
    result = run("tags.json", _text())
    assert result.handled
    rep = render_json(result)
    assert rep["counts"]["assets"] == 3
    assert rep["counts"]["signals"] == 9
    assert rep["counts"]["namespace_nodes"] == 18
    assert len(rep["namespace"]) == 18


def test_markdown_report_explains_the_structure():
    md = render_markdown(run("tags.json", _text()))
    assert "Factory namespace" in md
    assert "ISA-95" in md
    assert "Cappy Hour Inc" in md
    assert "CapLoader" in md


# ---- i3X export honors the REAL hierarchy (not the inferred flat one) ----

def test_i3x_export_uses_explicit_ignition_hierarchy():
    payload = i3x.to_i3x(render_json(run("tags.json", _text())))
    by_id = {i["elementId"]: i for i in payload["objectInstances"]}
    # the real path, slugged -- proves the explicit tree (not enterprise/site1/area1/line1...) was used
    sig_id = "cappy_hour_inc/site_1/filler_production/fillingline03/caploader/productionrun_capcount"
    assert sig_id in by_id
    sig = by_id[sig_id]
    assert sig["isComposition"] is False
    assert sig["parentId"] == "cappy_hour_inc/site_1/filler_production/fillingline03/caploader"
    assert sig["metadata"]["unit"] == "caps"
    asset = by_id["cappy_hour_inc/site_1/filler_production/fillingline03/caploader"]
    assert asset["isComposition"] is True
    assert asset["typeElementId"] == "urn:mira:type:asset"
    assert asset["metadata"]["udtType"] == "Models/Equipment/Process/CapLoader"


def test_i3x_tree_integrity_single_root_every_parent_resolves():
    payload = i3x.to_i3x(render_json(run("tags.json", _text())))
    ids = {i["elementId"] for i in payload["objectInstances"]}
    roots = [i for i in payload["objectInstances"] if i["parentId"] is None]
    assert len(roots) == 1
    assert roots[0]["elementId"] == "cappy_hour_inc"
    for inst in payload["objectInstances"]:
        if inst["parentId"] is not None:
            assert inst["parentId"] in ids, "dangling parentId %s" % inst["parentId"]

"""ProveIt end-to-end dry-run CLI tests.

Builds a synthetic corpus (tiny Ignition tags.json + a Pilot DB export + a Vessel-spec markdown) in a
tmp dir, runs the report builder, and asserts the three transforms compose: namespace counts, the
asset roster bridges WO grounding, and every emitted row is is_private + unembedded. No DB, no infra.
"""
from __future__ import annotations

import json

import cli

_TAGS = {
    "name": "Cappy Hour Inc", "tagType": "Folder", "tags": [
        {"name": "Site 1", "tagType": "Folder", "tags": [
            {"name": "Filler Production", "tagType": "Folder", "tags": [
                {"name": "FillingLine03", "tagType": "Folder", "tags": [
                    {"name": "Filler", "typeId": "Models/Equipment/Process/Filler",
                     "tagType": "UdtInstance",
                     "parameters": {"MesTagPath": {"dataType": "String", "value": "[MES]x/Filler"}},
                     "tags": [
                         {"name": "Running", "tagType": "AtomicTag", "dataType": "Boolean"},
                         {"name": "FillVolume", "tagType": "AtomicTag", "dataType": "Float8",
                          "engUnit": "mL", "value": 0},
                     ]},
                ]},
            ]},
        ]},
    ],
}

_ITEMS = {"itemmanagement": [
    {"itemid": 1, "itemname": "Orange Soda Mix", "itemclass": "Mix"},
]}
_LOTS = {"lotnumber": [{"lotnumberid": 10, "itemid": 1, "lotnumber": "L01-0001"}]}
_WOS = {"workordermanagement": [
    {"workorderid": 1, "lotnumberid": 10, "workordernumber": "WO-L01-0001", "statename": "OPEN",
     "assetid": 116, "targetquantity": 7000.0, "uom": "kg"},
    {"workorderid": 2, "lotnumberid": 10, "workordernumber": "WO-L01-0002", "statename": "OPEN",
     "assetid": 999, "targetquantity": 100.0, "uom": "ea"},   # 999 not in roster -> ungrounded
]}
_STATES = {"statemanagement": [{"code": 201, "name": "Starved", "type": "Idle"}]}

_SPEC = """# ENTERPRISE B
## Asset Register

| Asset ID | Tag | Location | Vessel Type | UNS Path |
|----------|-----|----------|-------------|----------|
| 116 | MR01-VAT-001 | Mix Room 01 | VAT-20 | `Enterprise B/Site3/liquidprocessing/mixroom01/vat01` |

### Maintenance

Replace the agitator seal every 2000 operating hours.
"""


def _build_corpus(tmp_path):
    (tmp_path / "tags.json").write_text(json.dumps(_TAGS), encoding="utf-8")
    pdb = tmp_path / "Pilot Database Export"
    pdb.mkdir()
    (pdb / "ProveIt - itemmanagement.json").write_text(json.dumps(_ITEMS), encoding="utf-8")
    (pdb / "ProveIt - lotnumber.json").write_text(json.dumps(_LOTS), encoding="utf-8")
    (pdb / "ProveIt - workordermanagement.json").write_text(json.dumps(_WOS), encoding="utf-8")
    (pdb / "ProveIt - statemanagement.json").write_text(json.dumps(_STATES), encoding="utf-8")
    (tmp_path / "Vessel-Spec.md").write_text(_SPEC, encoding="utf-8")
    return tmp_path


def test_discover_finds_all_three_inputs(tmp_path):
    _build_corpus(tmp_path)
    found = cli.discover(tmp_path)
    assert found["tags"].name == "tags.json"
    assert found["pilot_db"].name == "Pilot Database Export"
    assert any(m.name == "Vessel-Spec.md" for m in found["manuals"])


def test_build_report_composes_all_three_transforms(tmp_path):
    _build_corpus(tmp_path)
    found = cli.discover(tmp_path)
    report = cli.build_report(
        "proveit",
        tags_path=found["tags"],
        pilot_db_dir=found["pilot_db"],
        manual_paths=list(found["manuals"]),
    )
    # 1. namespace import ran
    assert report["namespace"]["counts"]["assets"] == 1
    assert report["namespace"]["counts"]["signals"] == 2
    # 2. roster parsed from the spec, and it bridges WO grounding
    assert report["asset_roster_size"] == 1
    assert report["pilot_db"]["work_orders_total"] == 2
    assert report["pilot_db"]["work_orders_grounded_to_asset"] == 1   # WO-0001 (asset 116) only
    # 3. every emitted knowledge_entries row is private + unembedded
    k = report["knowledge_entries"]
    assert k["total_rows"] > 0
    assert k["all_is_private"] is True
    assert k["all_unembedded"] is True
    # chunk types present: state_glossary + item + 2 work_orders + manual sections
    assert "work_order" in k["by_chunk_type"]
    assert "manual" in k["by_chunk_type"]
    assert "proveit_pilot_db" in k["by_source_type"]
    assert "proveit_manual" in k["by_source_type"]


def test_cli_writes_report_files(tmp_path):
    _build_corpus(tmp_path)
    out = tmp_path / "out"
    rc = cli.main(["report", str(tmp_path), "--tenant", "proveit", "--out", str(out), "--quiet"])
    assert rc == 0
    data = json.loads((out / "proveit-dry-run.json").read_text(encoding="utf-8"))
    assert data["dry_run"] is True
    assert data["tenant_id"] == "proveit"
    md = (out / "proveit-dry-run.md").read_text(encoding="utf-8")
    assert "DRY RUN" in md
    assert "knowledge_entries that WOULD be inserted" in md


def test_report_is_json_serializable(tmp_path):
    _build_corpus(tmp_path)
    found = cli.discover(tmp_path)
    report = cli.build_report("proveit", tags_path=found["tags"],
                              pilot_db_dir=found["pilot_db"], manual_paths=list(found["manuals"]))
    json.dumps(report)   # must not raise

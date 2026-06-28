"""ProveIt manual / spec document -> citable chunks (offline transform) tests.

Synthetic fixtures only -- the licensed Cappy Hour corpus is never committed. The markdown shapes
mirror the real Vessel Engineering Specification: heading-delimited sections plus an
"Asset ID | ... | UNS Path" mapping table.
"""
from __future__ import annotations

import json

import manual_chunks as mc

_SPEC = """# ENTERPRISE B
## VESSEL ENGINEERING SPECIFICATION

Intro paragraph describing the vessel spec scope.

## 3. VAT-20 MIXING VAT SPECIFICATION

### 3.1 General Arrangement

The VAT-20 is a 20,000 L jacketed mixing vat with a dished bottom and a top-mounted agitator.
Material of construction is 316L stainless steel, electropolished to <= 0.8 um Ra.

### 3.2 Nozzle Schedule

Each vat carries a CIP supply, CIP return, product inlet, and product outlet nozzle.

## Appendix A: Asset Register

| Asset ID | Tag | Location | Vessel Type | UNS Path |
|----------|-----|----------|-------------|----------|
| 31 | MR01-VAT-001 | Mix Room 01 | VAT-20 | `Enterprise B/Site1/liquidprocessing/mixroom01/vat01` |
| 116 | MR01-VAT-001 | Mix Room 01 | VAT-20 | `Enterprise B/Site3/liquidprocessing/mixroom01/vat01` |
| n/a | spare | — | — | — |
"""


def test_chunk_markdown_splits_on_headings():
    chunks = mc.chunk_markdown(_SPEC, source_file="VesselSpec.md", uns_prefix="cappy_hour_inc")
    assert all(c.chunk_type == "manual" for c in chunks)
    assert all(c.uns_path == "cappy_hour_inc" for c in chunks)
    assert all(c.source_file == "VesselSpec.md" for c in chunks)
    # the agitator/material detail must be findable in a chunk whose provenance is the right section
    arr = next(c for c in chunks if "20,000 L jacketed mixing vat" in c.content)
    assert "3.1 General Arrangement" in arr.source_row
    assert arr.metadata["heading"].endswith("General Arrangement")


def test_chunk_markdown_respects_max_chars():
    big = "# Doc\n\n" + "\n\n".join("Paragraph %d. %s" % (i, "word " * 40) for i in range(20))
    chunks = mc.chunk_markdown(big, source_file="big.md", max_chars=400)
    assert len(chunks) > 1
    assert all(len(c.content) <= 800 for c in chunks)   # packed near the limit, never wildly over
    assert any("part 1" in c.source_row for c in chunks)


def test_parse_asset_uns_table_yields_roster():
    roster = mc.parse_asset_uns_table(_SPEC)
    assert roster[31] == "enterprise_b.site1.liquidprocessing.mixroom01.vat01"
    assert roster[116] == "enterprise_b.site3.liquidprocessing.mixroom01.vat01"
    assert "n/a" not in roster and "spare" not in str(roster)   # non-numeric ids skipped
    assert set(roster) == {31, 116}


def test_uns_path_from_doc_slugs_to_dot_ltree():
    assert mc.uns_path_from_doc("Enterprise B/Site3/liquidprocessing/mixroom01/vat01") == \
        "enterprise_b.site3.liquidprocessing.mixroom01.vat01"
    assert mc.uns_path_from_doc("`Enterprise B/Site1/Mix Room 01`") == \
        "enterprise_b.site1.mix_room_01"


def test_roster_bridges_pilot_db_work_order_grounding():
    # the whole point of the roster: a WO's numeric assetid grounds to a real vat UNS path
    import pilot_db_chunks as pdc
    db = {
        "items": [{"itemid": 1, "itemname": "Orange Soda Mix", "itemclass": "Mix"}],
        "lots": [{"lotnumberid": 10, "itemid": 1, "lotnumber": "L01-0001"}],
        "work_orders": [{"workorderid": 1, "lotnumberid": 10, "workordernumber": "WO-L01-0001",
                         "statename": "OPEN", "assetid": 116, "targetquantity": 7000.0, "uom": "kg"}],
        "states": [],
    }
    roster = mc.parse_asset_uns_table(_SPEC)
    chunks = pdc.build_work_order_chunks(db, uns_prefix="cappy_hour_inc", asset_uns_by_id=roster)
    wo = chunks[0]
    assert wo.uns_path == "enterprise_b.site3.liquidprocessing.mixroom01.vat01"
    assert "enterprise_b.site3" in wo.content


def test_manual_rows_are_private_and_manual_data_type():
    chunks = mc.chunk_markdown(_SPEC, source_file="VesselSpec.md", uns_prefix="cappy_hour_inc")
    rows = mc.to_knowledge_entry_rows(chunks, tenant_id="proveit", source_type="proveit_manual")
    assert all(r["is_private"] is True for r in rows)
    assert all(r["data_type"] == "manual" for r in rows)
    assert all(r["embedding"] is None for r in rows)
    assert all(r["source_type"] == "proveit_manual" for r in rows)
    # deterministic ids -> re-run de-dups
    rows2 = mc.to_knowledge_entry_rows(chunks, tenant_id="proveit", source_type="proveit_manual")
    assert [r["id"] for r in rows] == [r["id"] for r in rows2]
    meta = json.loads(rows[0]["metadata"])
    assert "heading" in meta

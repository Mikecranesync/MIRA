"""ProveIt Pilot DB -> citable chunks (offline transform) tests.

Synthetic fixture only -- the licensed Cappy Hour corpus is never committed. Shapes mirror the real
export (single top-level key wrapper, BOM, the Item->Lot->WO->Asset join, the state glossary).
"""
from __future__ import annotations

import json

import pilot_db_chunks as pdc

_ITEMS = [
    {"itemid": 1, "itemname": "Orange Soda Mix", "itemclass": "Mix", "bottlesize": 0.0,
     "labelvariant": "", "packcount": 0},
    {"itemid": 2, "itemname": "Orange Soda 2L", "itemclass": "FinishedGood", "bottlesize": 2.0,
     "labelvariant": "OS", "packcount": 6},
]
_LOTS = [
    {"lotnumberid": 10, "itemid": 1, "lotnumber": "L01-0001", "isconsumed": False},
    {"lotnumberid": 11, "itemid": 2, "lotnumber": "L01-0002", "isconsumed": False},
]
_WOS = [
    {"workorderid": 1, "lotnumberid": 10, "workordernumber": "WO-L01-0001", "statename": "OPEN",
     "assetid": 116, "targetquantity": 7000.0, "uom": "kg"},
    {"workorderid": 2, "lotnumberid": 11, "workordernumber": "WO-L01-0002", "statename": "CLOSED",
     "assetid": 31, "targetquantity": 1200.0, "uom": "ea"},
]
_STATES = [
    {"code": 0, "name": "Running", "type": "Running"},
    {"code": 101, "name": "Machine Fault", "type": "UnplannedDowntime"},
    {"code": 201, "name": "Starved", "type": "Idle"},
    {"code": 202, "name": "Blocked", "type": "Idle"},
]


def _db():
    return {"items": _ITEMS, "lots": _LOTS, "work_orders": _WOS, "states": _STATES}


def test_load_pilot_db_handles_bom_and_wrapper(tmp_path):
    # write a BOM-encoded {"itemmanagement": [...]} export, exactly like the real files
    f = tmp_path / "ProveIt - Enterprise B - itemmanagement 2026-01-19.json"
    f.write_text("﻿" + json.dumps({"itemmanagement": _ITEMS}), encoding="utf-8")
    (tmp_path / "statemanagement.json").write_text(
        "﻿" + json.dumps({"statemanagement": _STATES}), encoding="utf-8")
    db = pdc.load_pilot_db(tmp_path)
    assert len(db["items"]) == 2
    assert db["items"][0]["itemname"] == "Orange Soda Mix"
    assert len(db["states"]) == 4
    assert db["work_orders"] == []   # not provided -> empty, not a crash


def test_state_glossary_chunk_explains_the_codes():
    ch = pdc.build_state_glossary_chunk(_STATES, uns_prefix="cappy_hour_inc")
    assert ch.chunk_type == "state_glossary"
    assert "101 — Machine Fault" in ch.content
    assert "201 — Starved" in ch.content
    assert "202 — Blocked" in ch.content
    assert ch.uns_path == "cappy_hour_inc"


def test_work_order_chunk_joins_item_lot_and_asset():
    chunks = pdc.build_work_order_chunks(_db(), uns_prefix="cappy_hour_inc")
    wo1 = next(c for c in chunks if c.source_row == "WO-L01-0001")
    # the join must surface item name + lot + target + state in human-readable form
    assert "Orange Soda Mix" in wo1.content
    assert "L01-0001" in wo1.content
    assert "7000 kg" in wo1.content
    assert "state OPEN" in wo1.content
    assert wo1.metadata["assetid"] == 116


def test_asset_uns_resolution_grounds_the_chunk():
    mapping = {116: "cappy_hour_inc.site_1.liquid_processing.tankstorage01.vat116"}
    chunks = pdc.build_work_order_chunks(_db(), uns_prefix="cappy_hour_inc", asset_uns_by_id=mapping)
    wo1 = next(c for c in chunks if c.source_row == "WO-L01-0001")
    assert wo1.uns_path == "cappy_hour_inc.site_1.liquid_processing.tankstorage01.vat116"
    assert "asset cappy_hour_inc.site_1" in wo1.content


def test_build_chunks_emits_glossary_items_and_work_orders():
    chunks = pdc.build_chunks(_db(), uns_prefix="cappy_hour_inc")
    kinds = {c.chunk_type for c in chunks}
    assert kinds == {"state_glossary", "item", "work_order"}
    assert sum(1 for c in chunks if c.chunk_type == "work_order") == 2
    assert sum(1 for c in chunks if c.chunk_type == "item") == 2
    assert sum(1 for c in chunks if c.chunk_type == "state_glossary") == 1


def test_knowledge_entry_rows_are_private_deterministic_and_unembedded():
    chunks = pdc.build_chunks(_db(), uns_prefix="cappy_hour_inc")
    rows = pdc.to_knowledge_entry_rows(chunks, tenant_id="proveit")
    assert all(r["is_private"] is True for r in rows)           # per-tenant CMMS data, not OEM corpus
    assert all(r["embedding"] is None for r in rows)            # embed is the infra step, deferred
    assert all(r["tenant_id"] == "proveit" for r in rows)
    assert all(r["id"].startswith("proveit_") for r in rows)
    # deterministic id -> a re-run produces identical ids (de-dup, not duplicate)
    rows2 = pdc.to_knowledge_entry_rows(chunks, tenant_id="proveit")
    assert [r["id"] for r in rows] == [r["id"] for r in rows2]
    # metadata is JSON-serialized (jsonb-ready)
    wo_row = next(r for r in rows if r["chunk_type"] == "work_order")
    assert json.loads(wo_row["metadata"])["uom"] in ("kg", "ea")
    assert wo_row["data_type"] == "work_order"

"""tools/parts-breakdown/catpumps_breakdown.py — deterministic parts-breakdown extractor.

The fixture below is a FICTIONAL data sheet laid out the way CAT Pumps sheets
extract to text. No manufacturer text is committed here.

Mutation harness: set PARTS_BREAKDOWN_MODULE to a path of a (deliberately
broken) copy of the module to prove that each test fails on the behaviour it
names (.claude/rules/prove-the-test-fails.md).
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = Path(
    os.environ.get(
        "PARTS_BREAKDOWN_MODULE", ROOT / "tools" / "parts-breakdown" / "catpumps_breakdown.py"
    )
)


def _load():
    spec = importlib.util.spec_from_file_location("catpumps_breakdown", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["catpumps_breakdown"] = mod
    spec.loader.exec_module(mod)
    return mod


cb = _load()

FIXTURE = """
===== PAGE 1 =====
DATA SHEET 9XP PLUNGER PUMPS (fictional)
Models: 9XP1000, 9XP1000CS
Crankcase Capacity 12 oz 0.35 l
===== PAGE 2 =====
PARTS LIST
ITEM PART NUMBERS DESCRIPTION QTY
9XP1000,
9XP1000CS,
9XP1000G
MATL
5 100001 STCP R Screw, HHC (M8 x 16) (See Tech Bulletin 001) 8–4
8 100002 AL Cover, Bearing 2–1–0
25 100003 FCM Crankshaft, Dual End – 9XP1000 1
100004 FCM Crankshaft, Single End – 9XP1000CS, 9XP1000G 1
99 = 100005 SS Retainer, Plunger (See Tech Bulletin 001) 3
106 100006 NBR Seal, Low-Pressure 3
162 100007 PTFE Backup Ring, Seat 6
164 100008 S Seat 6
500 100009 — Gearbox (See Individual Data Sheet) 1
===== PAGE 3 =====
EXPLODED VIEW
OPTIONAL PARTS AND ACCESSORIES
PART DESCRIPTION QTY
200001 Key (M6 x 6 x 25) 1
200002 Pliers, Reverse (Not Shown) 1
SERVICE PARTS
PART DESCRIPTION QTY
300001 Kit, Seal – Standard NBR 1
300002 Oil, Bottle (21 oz) ISO 68 Hydraulic
(Fill to Specified Crankcase Capacity Prior to Start-up)
1
===== PAGE 4 =====
SEAL KITS One (1) seal kit required per pump
PUMP MODELS NBR (STD) FPM (.0110) EPDM (.0220)
9XP1000,
9XP1000CS 300001 300011 * 300021
ITEM (Included in Seal Kits) DESCRIPTION QTY
106 100006 — — Seal, Low-Pressure 3
— 100016 100026 Seal, Low-Pressure with SS-Spring 3
* Review material codes for individual items
VALVE KITS Two (2) valve kits required per pump
PUMP MODELS NBR (STD) FPM (.0110) EPDM (.0220)
9XP1000 400001 400011 400021
ITEM (Included in Valve Kits) DESCRIPTION QTY
162 100007 100007 100007 Backup Ring, Seat 3
164 100008 100008 100008 Seat 3
PN 123456 Rev B 5/22
"""


@pytest.fixture(scope="module")
def bd():
    return cb.to_dict(cb.parse_text(FIXTURE, {"file": "fixture.txt"}))


def test_models_and_part_count(bd):
    assert bd["models"] == ["9XP1000", "9XP1000CS", "9XP1000G"]
    assert [p["part"] for p in bd["parts"]] == [
        "100001", "100002", "100003", "100004", "100005", "100006", "100007", "100008", "100009",
    ]  # fmt: skip
    assert all(p["source_page"] == 2 for p in bd["parts"])


def test_qty_single_resolved_and_ambiguous(bd):
    by_part = {p["part"]: p for p in bd["parts"]}
    assert by_part["100006"]["qty_status"] == "single"
    assert by_part["100006"]["qty_by_model"] == {"9XP1000": 3, "9XP1000CS": 3, "9XP1000G": 3}
    assert by_part["100002"]["qty_status"] == "resolved"
    assert by_part["100002"]["qty_by_model"] == {"9XP1000": 2, "9XP1000CS": 1, "9XP1000G": 0}
    # "8–4" is two values for three models: never guessed, reported as unknown
    assert by_part["100001"]["qty_status"] == "ambiguous"
    assert by_part["100001"]["qty_by_model"] is None
    assert any("100001" in u and "8–4" in u for u in bd["unknowns"])


def test_continuation_row_inherits_item_and_applies_to_named_models(bd):
    by_part = {p["part"]: p for p in bd["parts"]}
    assert by_part["100003"]["item"] == 25
    assert by_part["100003"]["applies_to"] == ["9XP1000"]
    assert by_part["100004"]["item"] == 25  # no item cell: continues item 25
    assert by_part["100004"]["applies_to"] == ["9XP1000CS", "9XP1000G"]
    assert by_part["100004"]["description"] == "Crankshaft, Single End"


# F6 (#4993): a "single" qty (one shared raw value, e.g. "1") used to be
# listed for EVERY model in the sheet, ignoring `applies_to` — so the two
# mutually-exclusive crankshafts (100003 for 9XP1000 only, 100004 for the
# other two) both claimed qty 1 for all three models. Mirrors the real
# 5CP6120 bug: part 46928 (applies_to=["5CP6120"]) and 48233
# (applies_to=["5CP6120CS", "5CP6120CSSG1"]) must not both be orderable for
# a single 5CP6120 pump.
def test_single_qty_filtered_by_applies_to_for_continuation_rows(bd):
    by_part = {p["part"]: p for p in bd["parts"]}
    assert by_part["100003"]["qty_status"] == "single"
    assert by_part["100003"]["qty_by_model"] == {"9XP1000": 1}
    assert by_part["100004"]["qty_status"] == "single"
    assert by_part["100004"]["qty_by_model"] == {"9XP1000CS": 1, "9XP1000G": 1}


def test_markers_material_and_notes(bd):
    by_part = {p["part"]: p for p in bd["parts"]}
    assert by_part["100001"]["rohs"] is True
    assert by_part["100001"]["notes"] == ["See Tech Bulletin 001"]
    assert by_part["100001"]["description"] == "Screw, HHC (M8 x 16)"
    assert by_part["100005"]["production_part_differs"] is True
    assert by_part["100005"]["item"] == 99
    assert by_part["100009"]["material"] is None
    assert by_part["100007"]["material"] == "PTFE"


def test_optional_and_service_sections_including_wrapped_row(bd):
    assert [(s["part"], s["qty"]) for s in bd["optional_parts"]] == [("200001", 1), ("200002", 1)]
    assert bd["optional_parts"][1]["notes"] == ["Not Shown"]
    service = {s["part"]: s for s in bd["service_parts"]}
    assert set(service) == {"300001", "300002"}
    assert service["300002"]["qty"] == 1
    assert service["300002"]["description"].startswith("Oil, Bottle (21 oz) ISO 68 Hydraulic")
    assert "Prior to Start-up" in service["300002"]["description"]
    assert service["300002"]["source_page"] == 3


def test_kits_and_split_row_column_alignment(bd):
    kinds = {k["kind"]: k for k in bd["kits"]}
    seal, valve = kinds["seal"], kinds["valve"]
    assert seal["required_per_pump"] == 1 and valve["required_per_pump"] == 2
    assert seal["kit_by_material"] == {
        "NBR (STD)": "300001", "FPM (.0110)": "300011", "EPDM (.0220)": "300021",
    }  # fmt: skip
    assert seal["models"] == ["9XP1000", "9XP1000CS"]
    first, second = seal["items"]
    assert first["item"] == 106 and first["part_by_material"]["NBR (STD)"] == "100006"
    # a row with an EMPTY item cell has exactly one token per material; the
    # leading "—" is the NBR column, not the item, so nothing shifts right
    assert second["item"] is None
    assert second["part_by_material"] == {
        "NBR (STD)": None, "FPM (.0110)": "100016", "EPDM (.0220)": "100026",
    }  # fmt: skip
    assert second["qty_per_kit"] == 3
    assert seal["footnotes"] == ["Review material codes for individual items"]
    assert [i["item"] for i in valve["items"]] == [162, 164]


def test_consistency_checks_pass_on_fixture(bd):
    statuses = {(c["kit"], c["item"]): c["status"] for c in bd["checks"]}
    assert statuses == {("seal", 106): "pass", ("valve", 162): "pass", ("valve", 164): "pass"}


def test_consistency_check_fails_when_parts_list_disagrees():
    broken = FIXTURE.replace("164 100008 S Seat 6", "164 100008 S Seat 4")
    out = cb.to_dict(cb.parse_text(broken))
    bad = [c for c in out["checks"] if c["item"] == 164]
    assert bad and bad[0]["status"] == "fail"
    assert "3 per kit x 2 kits = 6" in bad[0]["detail"]


def test_consistency_check_unknown_when_qty_ambiguous():
    ambiguous = FIXTURE.replace("164 100008 S Seat 6", "164 100008 S Seat 6–4")
    out = cb.to_dict(cb.parse_text(ambiguous))
    bad = [c for c in out["checks"] if c["item"] == 164]
    assert bad and bad[0]["status"] == "unknown"


# F7 (#4994): a kit item whose STD material has no part number used to fall
# through to the quantity-only check and report `pass` — mirrors the real
# 5CP6120 item 120 (NBR (STD)=null, STHT (.3400)='49436'). Drop item 106's
# NBR part here (keep the other two materials) to reproduce that shape
# without any real manufacturer data.
def test_kit_item_missing_its_std_material_part_cannot_pass_coverage():
    broken = FIXTURE.replace(
        "106 100006 — — Seal, Low-Pressure 3", "106 — 100016 100026 Seal, Low-Pressure 3"
    )
    out = cb.to_dict(cb.parse_text(broken))
    check = next(c for c in out["checks"] if c["kit"] == "seal" and c["item"] == 106)
    assert check["status"] == "not_covered"
    assert check["status"] != "pass"


def test_revision_and_exploded_view_page(bd):
    assert bd["source"]["revision"] == "Rev B 5/22"
    assert bd["source"]["document_part_number"] == "123456"
    assert bd["source"]["exploded_view_page"] == 3
    assert bd["source"]["pages"] == 4
    assert bd["source"]["file"] == "fixture.txt"


def test_missing_revision_is_an_unknown_not_a_guess():
    out = cb.to_dict(cb.parse_text(FIXTURE.replace("PN 123456 Rev B 5/22", "")))
    assert out["source"]["revision"] is None
    assert "document revision not found in text" in out["unknowns"]


def test_diff_reports_qty_change_and_extra_row(bd):
    other_text = FIXTURE.replace(
        "8 100002 AL Cover, Bearing 2–1–0", "8 100002 AL Cover, Bearing 2–1"
    )
    other_text = other_text.replace(
        "500 100009 — Gearbox", "120 100010 BB Case, Seal 3\n500 100009 — Gearbox"
    )
    other = cb.to_dict(cb.parse_text(other_text))
    diff = cb.diff_breakdowns(bd, other)
    assert {"item": 8, "part": "100002", "change": "qty", "a": "2–1–0", "b": "2–1"} in diff
    assert {"item": 120, "part": "100010", "change": "only_in_b"} in diff
    assert len(diff) == 2


# F11 (#4998): diff_breakdowns only ever compared the main parts list, so a
# changed seal/valve kit number, or a changed kit-item quantity, produced NO
# diff entry at all — a technician comparing revisions would be told
# "nothing changed" when the kit itself changed. Each scenario below changes
# exactly one kit-level field and nothing else.
def test_diff_reports_kit_number_change_and_kit_item_quantity_change(bd):
    kit_number_changed = cb.to_dict(
        cb.parse_text(
            FIXTURE.replace(
                "9XP1000,\n9XP1000CS 300001 300011 * 300021",
                "9XP1000,\n9XP1000CS 300001 399999 * 300021",
            )
        )
    )
    diff1 = cb.diff_breakdowns(bd, kit_number_changed)
    assert {
        "kit": "seal",
        "material": "FPM (.0110)",
        "change": "kit_number",
        "a": "300011",
        "b": "399999",
    } in diff1

    kit_qty_changed = cb.to_dict(
        cb.parse_text(
            FIXTURE.replace(
                "106 100006 — — Seal, Low-Pressure 3", "106 100006 — — Seal, Low-Pressure 5"
            )
        )
    )
    diff2 = cb.diff_breakdowns(bd, kit_qty_changed)
    assert {"kit": "seal", "item": 106, "change": "kit_item_qty", "a": 3, "b": 5} in diff2


def test_cli_writes_json(tmp_path):
    src = tmp_path / "sheet.txt"
    src.write_text(FIXTURE)
    out = tmp_path / "out.json"
    assert cb.main([str(src), "--json", str(out)]) == 0
    data = json.loads(out.read_text())
    assert data["source"]["file"] == "sheet.txt" and len(data["source"]["sha256"]) == 64
    assert len(data["parts"]) == 9

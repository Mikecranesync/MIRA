"""HubV3 §7 demo acceptance — Garage Demo / Micro820 Conveyor (offline half, PRD §6 test 12).

Builds a Factory Context Bundle from the REAL repo fixtures a technician would carry off the floor:
  * plc/Micro820_v4.1.9_Program.st   — the conveyor's CCW Structured Text controller program
  * plc/MbSrvConf_v4.xml             — its Modbus server map (tag → register)
  * a GS10 drive manual excerpt      — fault + rated-current evidence

and asserts the bundle the Hub would import is non-empty and well-formed: signals placed in the UNS,
i3X object instances, proposed kg entities (asset + signals, all proposed — never auto-verified),
a scorecard, and a review audit. Also pins the full-vs-sanitized export contract (PRD §6 tests 10/11).

This is the offline half of the demo; the Hub import → batch/dedupe/match/stage/review half is proven
in mira-hub/src/app/api/contextualization/import/import.integration.test.ts (DB-backed).
"""

import json
import pathlib
import zipfile

import pytest

from mira_contextualizer import bundle, ccw, contextualize
from mira_contextualizer.store import Store

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
_ST = _REPO_ROOT / "plc" / "Micro820_v4.1.9_Program.st"
_MODBUS = _REPO_ROOT / "plc" / "MbSrvConf_v4.xml"

# A small GS10 (DURApulse) maintenance excerpt referencing real conveyor tags, so the manual links to
# the controller signals (a fault + a rated-current spec). Stands in for the gs10 user manual PDF.
_GS10_MANUAL = (
    "DURApulse GS10 AC Micro Drive — Maintenance Excerpt\n"
    "Fault CF: communication fault between the Micro820 and the GS10 over Modbus RTU.\n"
    "  Cause: RS-485 wiring open or the 120 ohm termination is missing.\n"
    "  Remedy: check the daisy-chain wiring and termination, then verify vfd_comm_ok.\n"
    "The fault_alarm output latches when the drive trips. Rated output current 0-9.6 A.\n"
)


@pytest.fixture()
def demo_bundle(tmp_path):
    """The full garage-conveyor bundle (file map) built from the real fixtures."""
    assert _ST.exists() and _MODBUS.exists(), "real garage-conveyor fixtures must be present"
    s = Store(str(tmp_path / "garage.db"))
    p = s.create_project("Garage Demo / Micro820 Conveyor")
    # the technician's machine identity (what the Hub asset_match keys on)
    s.set_profile(
        p["id"],
        {
            "machine_name": "Garage Conveyor",
            "asset_type": "conveyor",
            "manufacturer": "Allen-Bradley",
            "model": "2080-LC20-20QBB",
            "controller_type": "Micro820",
            "serial_number": "MCR-820-0007",
            "site": "Garage",
        },
    )

    # 1) the Micro820 CCW project (ST controller header + Modbus map) → proposed signals
    res = ccw.parse_project(
        {
            _MODBUS.name: _MODBUS.read_text(encoding="utf-8", errors="replace"),
            _ST.name: _ST.read_text(encoding="utf-8", errors="replace"),
        }
    )
    ccw_src = s.create_source(p["id"], "ccw", "Micro820 CCW project (ST + Modbus)")
    s.add_extractions(p["id"], ccw_src["id"], res["rows"])

    # 2) the GS10 drive manual → fault catalog + tag references tied to the conveyor signals
    blocks = [{"text": _GS10_MANUAL, "page": 1, "kind": "text"}]
    doc_src = s.create_source(p["id"], "manual", "gs10_manual_excerpt.txt")
    s.set_source_extraction(doc_src["id"], {"blocks": blocks})
    cands = contextualize.contextualize_blocks(
        blocks, "gs10_manual_excerpt.txt", s.plc_tag_names(p["id"])
    )
    s.add_extractions(p["id"], doc_src["id"], cands)

    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")

    files = bundle.build_bundle(s, p["id"])
    yield files
    s.close()


def test_demo_bundle_has_nonempty_staged_context(demo_bundle):
    """Test 12 — the imported bundle yields non-empty signals, UNS, i3X, scorecard, and review."""
    files = demo_bundle

    # UNS signals — the conveyor's tags placed in the namespace
    uns = json.loads(files["uns.json"])["signals"]
    assert len(uns) >= 5, "garage conveyor should place several signals in the UNS"
    assert any(s["tag"] == "conveyor_running" for s in uns)

    # i3X object instances — signal leaves projected from the UNS hierarchy
    i3x = json.loads(files["i3x.json"])["objectInstances"]
    assert [o for o in i3x if o["typeElementId"].endswith("signal")]

    # kg entities — an asset + its signals, ALL proposed (never auto-verified on import)
    ents = json.loads(files["kg_entities.json"])["entities"]
    assert any(e["entity_type"] == "asset" for e in ents)
    assert any(e["entity_type"] == "signal" for e in ents)
    assert ents and all(e["approval_state"] == "proposed" for e in ents)

    # scorecard + review audit
    sc = json.loads(files["scorecard.json"])
    assert sc["schema"] == "mira-contextualizer/scorecard@1" and "score" in sc
    assert json.loads(files["review.json"])["decisions"]


def test_demo_manifest_identifies_the_micro820_controller(demo_bundle):
    """The asset_match block the Hub keys on names the real controller and a propose-only intent."""
    man = json.loads(demo_bundle["manifest.json"])
    assert man["project"]["name"].startswith("Garage Demo")
    assert man["asset_match"]["model"] == "2080-LC20-20QBB"  # the real Micro820 catalog number
    assert man["asset_match"]["proposed_uns_path"]
    assert man["asset_match"]["source_file_hashes"]
    assert man["import"]["policy"] == "propose_only"
    assert man["counts"]["accepted"] >= 5 and man["counts"]["uns_signals"] >= 5


def test_demo_full_vs_sanitized_export(demo_bundle, tmp_path):
    """Tests 10/11 on the real demo: full carries raw documents + provenance; sanitized drops them."""
    full = demo_bundle
    assert any(k.startswith("documents/") for k in full)
    assert json.loads(full["manifest.json"])["mode"] == "full"
    assert "evidence.json" in full  # the aggregated evidence file (full carries verbatim text)

    # rebuild the same project to export the sanitized structured-context bundle
    s = Store(str(tmp_path / "garage2.db"))
    p = s.create_project("Garage Demo / Micro820 Conveyor")
    ccw_src = s.create_source(p["id"], "ccw", "Micro820 CCW project (ST + Modbus)")
    s.add_extractions(
        p["id"],
        ccw_src["id"],
        ccw.parse_project(
            {
                _MODBUS.name: _MODBUS.read_text(encoding="utf-8", errors="replace"),
                _ST.name: _ST.read_text(encoding="utf-8", errors="replace"),
            }
        )["rows"],
    )
    doc_src = s.create_source(p["id"], "manual", "gs10_manual_excerpt.txt")
    s.set_source_extraction(
        doc_src["id"], {"blocks": [{"text": _GS10_MANUAL, "page": 1, "kind": "text"}]}
    )
    s.add_extractions(
        p["id"],
        doc_src["id"],
        contextualize.contextualize_blocks(
            [{"text": _GS10_MANUAL, "page": 1, "kind": "text"}],
            "gs10_manual_excerpt.txt",
            s.plc_tag_names(p["id"]),
        ),
    )
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")

    sanitized = bundle.build_bundle(s, p["id"], sanitized=True)
    assert not any(k.startswith("documents/") for k in sanitized), "sanitized drops raw documents"
    assert json.loads(sanitized["manifest.json"])["mode"] == "sanitized"
    # the derived structured context the Hub imports survives sanitization
    assert json.loads(sanitized["uns.json"])["signals"]
    assert json.loads(sanitized["kg_entities.json"])["entities"]
    s.close()


def test_demo_bundle_zip_round_trips(demo_bundle):
    """The carryable artifact zips and round-trips (what the technician hands to the Hub)."""
    data = bundle.zip_bytes(demo_bundle)
    with zipfile.ZipFile(__import__("io").BytesIO(data)) as zf:
        names = zf.namelist()
        assert "manifest.json" in names and "uns.json" in names and "i3x.json" in names

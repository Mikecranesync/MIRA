"""Factory Context Bundle (bundle@1) — schemas, projections, and zip round-trip."""
import io
import json
import zipfile

import pytest

from mira_contextualizer import bundle, ccw, contextualize
from mira_contextualizer.store import Store

UNS = "enterprise/site/area/line/cv_101/run"

# A Micro820 CCW project (Modbus map + ST controller header) for the offline end-to-end test.
CCW_MODBUS = """<modbusServer Version="2.0">
  <modbusRegister name="COILS">
    <mapping variable="motor_running" parent="Micro820" dataType="Bool" address="000001"/>
    <mapping variable="fault_alarm" parent="Micro820" dataType="Bool" address="000003"/>
  </modbusRegister>
  <modbusRegister name="HOLDING_REGISTERS">
    <mapping variable="drive_current" parent="Micro820" dataType="Real" address="400101"/>
    <mapping variable="motor_speed" parent="Micro820" dataType="Int" address="400103"/>
  </modbusRegister>
</modbusServer>"""
CCW_ST = """(* Conveyor for 2080-LC50-24QWB   PLC IP: 192.168.1.50 *)
PROGRAM Conv
VAR
  motor_running : BOOL; (* main drive run feedback *)
END_VAR
END_PROGRAM"""


@pytest.fixture()
def seeded(tmp_path):
    s = Store(str(tmp_path / "t.db"))
    p = s.create_project("Line A")
    plc = s.create_source(p["id"], "l5x", "conveyor.L5X")
    s.add_extractions(p["id"], plc["id"], [
        {"tag_name": "Conv_Run", "roles": ["output"], "uns_path_proposed": UNS,
         "i3x_element_id": UNS, "evidence_json": {"source_format": "rockwell_l5x"}, "confidence": 0.9},
    ])
    doc = s.create_source(p["id"], "manual", "gs10.pdf")
    s.set_source_extraction(doc["id"], {"blocks": [{"text": "Conv_Run energizes the motor.", "page": 2}]})
    s.add_extractions(p["id"], doc["id"], [
        {"tag_name": "Conv_Run", "roles": ["tag_reference"], "uns_path_proposed": None,
         "evidence_json": {"source": "document", "entity_type": "tag_reference",
                           "mentions": [{"file": "gs10.pdf", "page": 2, "snippet": "Conv_Run energizes"}]},
         "confidence": 0.9},
    ])
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")
    yield s, p["id"]
    s.close()


def test_bundle_contents(seeded):
    store, pid = seeded
    files = bundle.build_bundle(store, pid)
    for key in ("manifest.json", "uns.json", "i3x.json", "kg_entities.json",
                "kg_relationships.json", "signals.csv", "review.json", "report.md", "IMPORT.md",
                "scorecard.json"):
        assert key in files, key
    sc = json.loads(files["scorecard.json"])
    assert sc["schema"] == "mira-contextualizer/scorecard@1" and "score" in sc
    assert any(k.startswith("documents/") for k in files)

    man = json.loads(files["manifest.json"])
    assert man["schema"] == "mira-contextualizer/bundle@1" and man["counts"]["accepted"] == 2
    assert man["sources"][0]["sha256"]

    uns = json.loads(files["uns.json"])
    assert uns["signals"][0]["unsPath"] == UNS

    i3x = json.loads(files["i3x.json"])
    leaf = next(o for o in i3x["objectInstances"] if o["elementId"] == UNS)
    assert leaf["typeElementId"].endswith("signal") and leaf["parentId"] == "enterprise/site/area/line/cv_101"

    ents = json.loads(files["kg_entities.json"])["entities"]
    assert any(e["entity_type"] == "signal" and e["entity_id"] == UNS for e in ents)
    assert any(e["entity_type"] == "asset" for e in ents)
    assert all(e["approval_state"] == "proposed" for e in ents)

    rels = json.loads(files["kg_relationships.json"])["relationships"]
    assert any(r["type"] == "HAS_SIGNAL" and r["target"] == UNS for r in rels)
    assert any(r["type"] == "MENTIONS" and r["target"] == "Conv_Run" for r in rels)

    assert "Conv_Run" in files["signals.csv"] and files["signals.csv"].startswith("tag,uns_path")


def test_iso14224_and_ucum_projections(tmp_path):
    """Seeded extractions exercise the standards projections in isolation: a fault with mined depth
    becomes an ISO 14224 record linked to the sole component; a unit-bearing value becomes a UCUM
    quantity on the matching signal + in the i3X leaf metadata."""
    s = Store(str(tmp_path / "std.db"))
    p = s.create_project("Drive cell")
    plc = s.create_source(p["id"], "ccw", "ccw project")
    s.add_extractions(p["id"], plc["id"], [
        {"tag_name": "drive_current", "roles": ["motor", "analog"], "uns_path_proposed": UNS,
         "i3x_element_id": UNS, "evidence_json": {"source": "ccw_modbus"}, "confidence": 0.9},
    ])
    doc = s.create_source(p["id"], "manual", "pf525.pdf")
    s.add_extractions(p["id"], doc["id"], [
        {"tag_name": "PowerFlex 525", "roles": ["model_family"], "uns_path_proposed": None,
         "evidence_json": {"source": "document", "entity_type": "model_family"}, "confidence": 0.9},
        {"tag_name": "F004", "roles": ["fault_code"], "uns_path_proposed": None,
         "evidence_json": {"description": "Overcurrent", "cause": "motor cable shorted",
                           "next_check": "check wiring"}, "confidence": 0.9},
        {"tag_name": "drive_current", "roles": ["tag_reference"], "uns_path_proposed": None,
         "evidence_json": {"source": "document", "entity_type": "tag_reference",
                           "units": "A", "range": "0-9.6",
                           "mentions": [{"file": "pf525.pdf", "page": 3, "snippet": "rated 9.6 A"}]},
         "confidence": 0.9},
    ])
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")

    files = bundle.build_bundle(s, p["id"])
    ents = json.loads(files["kg_entities.json"])["entities"]
    rels = json.loads(files["kg_relationships.json"])["relationships"]

    # ISO 14224 failure mode + HAS_FAILURE_MODE edge from the (sole) component
    fault = next(e for e in ents if e["entity_type"] == "fault_code" and e["entity_id"] == "F004")
    assert fault["properties"]["iso14224"] == {
        "standard": "ISO 14224", "fault_code": "F004", "failure_mode": "Overcurrent",
        "failure_mechanism": "motor cable shorted", "maintenance_action": "check wiring"}
    assert any(e["entity_type"] == "component" and e["entity_id"] == "PowerFlex 525" for e in ents)
    assert any(r["type"] == "HAS_FAILURE_MODE" and r["source"] == "PowerFlex 525"
               and r["target"] == "F004" for r in rels)

    # UCUM quantity attached to the matching signal entity + the i3X leaf
    sig = next(e for e in ents if e["entity_type"] == "signal" and e["entity_id"] == UNS)
    assert sig["properties"]["quantity"] == {"unit": "A", "ucum_code": "A",
                                             "quantity_kind": "electric current", "standard": "UCUM",
                                             "range": "0-9.6"}
    i3x = json.loads(files["i3x.json"])
    leaf = next(o for o in i3x["objectInstances"] if o["elementId"] == UNS)
    assert leaf["metadata"]["quantity"]["ucum_code"] == "A"

    man = json.loads(files["manifest.json"])["counts"]
    assert man["iso14224_faults"] == 1 and man["ucum_quantities"] == 1 and man["uns_signals"] == 1
    s.close()


def test_end_to_end_ccw_plus_manual_to_bundle(tmp_path):
    """Offline: import a Micro820 CCW project + a drive manual, accept everything, export the bundle.
    uns.json / i3x.json are non-empty; kg carries ISO 14224 faults + UCUM units — the whole gap."""
    s = Store(str(tmp_path / "e2e.db"))
    p = s.create_project("Bench conveyor")

    # 1) CCW project import (mirrors server._ccw_import: parse_project → "ccw" source → extractions)
    res = ccw.parse_project({"MbSrvConf.xml": CCW_MODBUS, "Conv.st": CCW_ST})
    ccw_src = s.create_source(p["id"], "ccw", "CCW project (2 files)")
    s.add_extractions(p["id"], ccw_src["id"], res["rows"])

    # 2) a drive manual: a fault with cause/next-check + a rated-current spec tied to a CCW tag
    manual = (
        "PowerFlex 525 AC Drive\n"
        "Fault F004 Overcurrent. Cause: motor cable shorted. Remedy: check wiring, increase accel time.\n"
        "drive_current is the live output current, 0-9.6 A.\n"
    )
    blocks = [{"text": manual, "page": 1, "kind": "text"}]
    doc_src = s.create_source(p["id"], "manual", "pf525.txt")
    s.set_source_extraction(doc_src["id"], {"blocks": blocks})
    cands = contextualize.contextualize_blocks(blocks, "pf525.txt", s.plc_tag_names(p["id"]))
    s.add_extractions(p["id"], doc_src["id"], cands)

    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")

    files = bundle.build_bundle(s, p["id"])

    uns = json.loads(files["uns.json"])
    assert uns["signals"] and any(sig["tag"] == "drive_current" for sig in uns["signals"])

    i3x = json.loads(files["i3x.json"])
    assert [o for o in i3x["objectInstances"] if o["typeElementId"].endswith("signal")]

    ents = json.loads(files["kg_entities.json"])["entities"]
    rels = json.loads(files["kg_relationships.json"])["relationships"]

    fault = next(e for e in ents if e["entity_type"] == "fault_code" and e["entity_id"] == "F004")
    iso = fault["properties"]["iso14224"]
    assert iso["standard"] == "ISO 14224" and iso["failure_mechanism"] and iso["maintenance_action"]
    assert any(e["entity_type"] == "component" for e in ents)
    assert any(r["type"] == "HAS_FAILURE_MODE" and r["target"] == "F004" for r in rels)

    sig = next(e for e in ents if e["entity_type"] == "signal" and e["name"] == "drive_current")
    assert sig["properties"]["quantity"]["ucum_code"] == "A"
    assert sig["properties"]["quantity"]["quantity_kind"] == "electric current"

    counts = json.loads(files["manifest.json"])["counts"]
    assert counts["uns_signals"] >= 4 and counts["iso14224_faults"] >= 1 and counts["ucum_quantities"] >= 1
    s.close()


def test_bundle_carries_profile_identity_and_new_asset_intent(tmp_path):
    s = Store(str(tmp_path / "id.db"))
    p = s.create_project("Garage Demo / Micro820 Conveyor")
    s.set_profile(p["id"], {"machine_name": "Conveyor 1", "manufacturer": "Allen-Bradley",
                            "model": "2080-LC50-24QWB", "controller_type": "Micro820",
                            "serial_number": "SN-123", "site": "Garage"})
    plc = s.create_source(p["id"], "ccw", "ccw project")
    s.add_extractions(p["id"], plc["id"], [
        {"tag_name": "motor_running", "roles": ["motor"], "uns_path_proposed": UNS,
         "i3x_element_id": UNS, "evidence_json": {"source": "ccw_modbus"}, "confidence": 0.9}])
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")

    files = bundle.build_bundle(s, p["id"])
    assert "profile.json" in files and "sources.json" in files
    assert "fault_catalog.json" in files and "parameters.json" in files

    prof = json.loads(files["profile.json"])
    assert prof["name"].startswith("Garage Demo")
    assert prof["identity"]["model"] == "2080-LC50-24QWB"

    man = json.loads(files["manifest.json"])
    am = man["asset_match"]
    assert am["manufacturer"] == "Allen-Bradley" and am["serial_number"] == "SN-123"
    assert am["proposed_uns_path"]                       # derived from the accepted signal
    assert am["source_file_hashes"]                      # at least one source fingerprint
    # no hub_asset_id → create a draft asset; never overwrite verified data
    assert man["import"]["intent"] == "new_asset"
    assert man["import"]["policy"] == "propose_only"
    s.close()


def test_bundle_existing_asset_intent_when_hub_asset_id_set(tmp_path):
    s = Store(str(tmp_path / "id2.db"))
    p = s.create_project("Existing asset profile")
    s.set_profile(p["id"], {"hub_asset_id": "asset-abc-123", "model": "PowerFlex 525"})
    man = json.loads(bundle.build_bundle(s, p["id"])["manifest.json"])
    assert man["import"]["intent"] == "existing_asset"
    assert man["import"]["hub_asset_id"] == "asset-abc-123"
    s.close()


def test_zip_round_trips(seeded):
    store, pid = seeded
    data = bundle.zip_bytes(bundle.build_bundle(store, pid))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        man = json.loads(zf.read("manifest.json"))
        assert man["project"]["name"] == "Line A"


def test_build_unknown_project_raises(seeded):
    store, _ = seeded
    with pytest.raises(ValueError):
        bundle.build_bundle(store, "deadbeef")


# --- Export modes: full (default) vs sanitized structured context (PRD §3, §6 tests 10/11) ---

# The derived structured context a sanitized bundle keeps — Hub-importable without raw documents.
_STRUCTURED = ("manifest.json", "profile.json", "sources.json", "uns.json", "i3x.json",
               "kg_entities.json", "kg_relationships.json", "signals.csv",
               "fault_catalog.json", "parameters.json", "scorecard.json", "report.md", "IMPORT.md")


def test_sanitized_bundle_omits_raw_document_payloads(seeded):
    """PRD §6 test 10 — the sanitized structured-context mode ships derived context (UNS, i3X, kg,
    faults, params, hashes) but NO raw ``documents/*.json`` payloads."""
    store, pid = seeded
    # the seeded project has a manual source whose IR would emit a documents/ payload in full mode
    full = bundle.build_bundle(store, pid, mode="full")
    assert any(k.startswith("documents/") for k in full), "fixture must exercise a raw document"

    files = bundle.build_bundle(store, pid, mode="sanitized")
    assert not any(k.startswith("documents/") for k in files), "sanitized must drop raw documents"
    for key in _STRUCTURED:
        assert key in files, "sanitized must keep derived structured context: %s" % key

    man = json.loads(files["manifest.json"])
    assert man["export"]["mode"] == "sanitized"
    assert man["export"]["raw_documents"] is False
    # derived context survives: UNS signal, i3X leaf, proposed kg entities
    assert json.loads(files["uns.json"])["signals"][0]["unsPath"] == UNS
    assert json.loads(files["kg_entities.json"])["entities"]


def test_full_bundle_preserves_provenance(seeded):
    """PRD §6 test 11 — the full evidence bundle keeps the raw documents AND the source→evidence→
    entity provenance chain (kg provenance, MENTIONS evidence, review audit)."""
    store, pid = seeded
    files = bundle.build_bundle(store, pid)  # default mode is full
    assert any(k.startswith("documents/") for k in files), "full keeps raw document payloads"

    man = json.loads(files["manifest.json"])
    assert man["export"]["mode"] == "full" and man["export"]["raw_documents"] is True

    # entity provenance: every accepted signal carries its ctx extraction id + evidence
    ents = json.loads(files["kg_entities.json"])["entities"]
    sig = next(e for e in ents if e["entity_type"] == "signal" and e["entity_id"] == UNS)
    prov = sig["properties"]["provenance"]
    assert prov["ctx_project_id"] == pid and prov["ctx_extraction_id"]

    # relationship provenance: the document→tag MENTIONS edge keeps page + snippet
    rels = json.loads(files["kg_relationships.json"])["relationships"]
    mention = next(r for r in rels if r["type"] == "MENTIONS" and r["target"] == "Conv_Run")
    assert mention["evidence"]["page"] == 2 and mention["evidence"]["snippet"]

    # review audit: per-decision evidence is retained
    review = json.loads(files["review.json"])["decisions"]
    assert any(d["evidence"] for d in review)


def test_build_rejects_unknown_mode(seeded):
    store, pid = seeded
    with pytest.raises(ValueError):
        bundle.build_bundle(store, pid, mode="anonymous")

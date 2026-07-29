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
    s.add_extractions(
        p["id"],
        plc["id"],
        [
            {
                "tag_name": "Conv_Run",
                "roles": ["output"],
                "uns_path_proposed": UNS,
                "i3x_element_id": UNS,
                "evidence_json": {"source_format": "rockwell_l5x"},
                "confidence": 0.9,
            },
        ],
    )
    doc = s.create_source(p["id"], "manual", "gs10.pdf")
    s.set_source_extraction(
        doc["id"], {"blocks": [{"text": "Conv_Run energizes the motor.", "page": 2}]}
    )
    s.add_extractions(
        p["id"],
        doc["id"],
        [
            {
                "tag_name": "Conv_Run",
                "roles": ["tag_reference"],
                "uns_path_proposed": None,
                "evidence_json": {
                    "source": "document",
                    "entity_type": "tag_reference",
                    "mentions": [{"file": "gs10.pdf", "page": 2, "snippet": "Conv_Run energizes"}],
                },
                "confidence": 0.9,
            },
        ],
    )
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")
    yield s, p["id"]
    s.close()


def test_bundle_contents(seeded):
    store, pid = seeded
    files = bundle.build_bundle(store, pid)
    for key in (
        "manifest.json",
        "uns.json",
        "i3x.json",
        "kg_entities.json",
        "kg_relationships.json",
        "signals.csv",
        "review.json",
        "report.md",
        "IMPORT.md",
        "scorecard.json",
        "evidence.json",
    ):
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
    assert (
        leaf["typeElementId"].endswith("signal")
        and leaf["parentId"] == "enterprise/site/area/line/cv_101"
    )

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
    s.add_extractions(
        p["id"],
        plc["id"],
        [
            {
                "tag_name": "drive_current",
                "roles": ["motor", "analog"],
                "uns_path_proposed": UNS,
                "i3x_element_id": UNS,
                "evidence_json": {"source": "ccw_modbus"},
                "confidence": 0.9,
            },
        ],
    )
    doc = s.create_source(p["id"], "manual", "pf525.pdf")
    s.add_extractions(
        p["id"],
        doc["id"],
        [
            {
                "tag_name": "PowerFlex 525",
                "roles": ["model_family"],
                "uns_path_proposed": None,
                "evidence_json": {"source": "document", "entity_type": "model_family"},
                "confidence": 0.9,
            },
            {
                "tag_name": "F004",
                "roles": ["fault_code"],
                "uns_path_proposed": None,
                "evidence_json": {
                    "description": "Overcurrent",
                    "cause": "motor cable shorted",
                    "next_check": "check wiring",
                },
                "confidence": 0.9,
            },
            {
                "tag_name": "drive_current",
                "roles": ["tag_reference"],
                "uns_path_proposed": None,
                "evidence_json": {
                    "source": "document",
                    "entity_type": "tag_reference",
                    "units": "A",
                    "range": "0-9.6",
                    "mentions": [{"file": "pf525.pdf", "page": 3, "snippet": "rated 9.6 A"}],
                },
                "confidence": 0.9,
            },
        ],
    )
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")

    files = bundle.build_bundle(s, p["id"])
    ents = json.loads(files["kg_entities.json"])["entities"]
    rels = json.loads(files["kg_relationships.json"])["relationships"]

    # ISO 14224 failure mode + HAS_FAILURE_MODE edge from the (sole) component
    fault = next(e for e in ents if e["entity_type"] == "fault_code" and e["entity_id"] == "F004")
    assert fault["properties"]["iso14224"] == {
        "standard": "ISO 14224",
        "fault_code": "F004",
        "failure_mode": "Overcurrent",
        "failure_mechanism": "motor cable shorted",
        "maintenance_action": "check wiring",
    }
    assert any(e["entity_type"] == "component" and e["entity_id"] == "PowerFlex 525" for e in ents)
    assert any(
        r["type"] == "HAS_FAILURE_MODE" and r["source"] == "PowerFlex 525" and r["target"] == "F004"
        for r in rels
    )

    # UCUM quantity attached to the matching signal entity + the i3X leaf
    sig = next(e for e in ents if e["entity_type"] == "signal" and e["entity_id"] == UNS)
    assert sig["properties"]["quantity"] == {
        "unit": "A",
        "ucum_code": "A",
        "quantity_kind": "electric current",
        "standard": "UCUM",
        "range": "0-9.6",
    }
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
    assert (
        counts["uns_signals"] >= 4
        and counts["iso14224_faults"] >= 1
        and counts["ucum_quantities"] >= 1
    )
    s.close()


def test_bundle_carries_profile_identity_and_new_asset_intent(tmp_path):
    s = Store(str(tmp_path / "id.db"))
    p = s.create_project("Garage Demo / Micro820 Conveyor")
    s.set_profile(
        p["id"],
        {
            "machine_name": "Conveyor 1",
            "manufacturer": "Allen-Bradley",
            "model": "2080-LC50-24QWB",
            "controller_type": "Micro820",
            "serial_number": "SN-123",
            "site": "Garage",
        },
    )
    plc = s.create_source(p["id"], "ccw", "ccw project")
    s.add_extractions(
        p["id"],
        plc["id"],
        [
            {
                "tag_name": "motor_running",
                "roles": ["motor"],
                "uns_path_proposed": UNS,
                "i3x_element_id": UNS,
                "evidence_json": {"source": "ccw_modbus"},
                "confidence": 0.9,
            }
        ],
    )
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
    assert am["proposed_uns_path"]  # derived from the accepted signal
    assert am["source_file_hashes"]  # at least one source fingerprint
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


def test_full_bundle_emits_evidence_and_preserves_provenance(seeded):
    """PRD test 11 — the full bundle aggregates evidence into evidence.json and keeps a walkable
    provenance chain: an entity → its evidence block (by extraction id) → the source sha256 that
    appears in the manifest. Full mode also carries verbatim document text + raw evidence."""
    store, pid = seeded
    files = bundle.build_bundle(store, pid)

    # the previously-missing 16th bundle file now exists, with stable per-block UUIDs
    assert "evidence.json" in files
    ev = json.loads(files["evidence.json"])
    assert ev["schema"] == "mira-contextualizer/evidence@1" and ev["evidence"]
    assert all(b["evidence_uuid"] for b in ev["evidence"])

    # full mode carries the raw document payload + the verbatim mined snippet
    assert any(k.startswith("documents/") for k in files)
    assert any("Conv_Run energizes" in (b.get("snippet") or "") for b in ev["evidence"])

    # chain: signal entity → evidence block (same extraction id) → manifest source sha256
    ents = json.loads(files["kg_entities.json"])["entities"]
    sig = next(e for e in ents if e["entity_type"] == "signal" and e["entity_id"] == UNS)
    assert sig["signal_uuid"]  # stable signal identity
    xid = sig["properties"]["provenance"]["ctx_extraction_id"]
    block = next(b for b in ev["evidence"] if b["extraction_id"] == xid)
    man_shas = {s["sha256"] for s in json.loads(files["manifest.json"])["sources"]}
    assert block["source_sha256"] in man_shas


def test_sanitized_bundle_has_no_raw_document_payloads(seeded):
    """PRD test 10 — the *sanitized structured context* bundle ships the derived structured context but
    NO raw document payloads: no ``documents/*.json`` files, and ``evidence.json`` carries refs/uuids/
    sha only — never verbatim mined text. Boundary (narrow §3 reading): the short provenance snippets in
    review.json/parameters.json/fault_catalog.json are derived structured context and are retained; only
    the raw document IR and the aggregate evidence text are stripped."""
    store, pid = seeded
    full = bundle.build_bundle(store, pid)
    san = bundle.build_bundle(store, pid, sanitized=True)

    # no raw document IR files, and the manifest declares the mode
    assert any(k.startswith("documents/") for k in full)
    assert not any(k.startswith("documents/") for k in san)
    assert json.loads(san["manifest.json"])["mode"] == "sanitized"
    assert json.loads(full["manifest.json"])["mode"] == "full"

    # evidence.json present in both, but the verbatim mined sentence appears ONLY in the full bundle
    SENTINEL = "Conv_Run energizes"
    assert SENTINEL in full["evidence.json"]
    assert SENTINEL not in san["evidence.json"]
    san_ev = json.loads(san["evidence.json"])["evidence"]
    assert san_ev and all("snippet" not in b and "raw" not in b for b in san_ev)

    # derived structured context is still fully present (this is "sanitized", not "anonymous")
    for key in (
        "uns.json",
        "i3x.json",
        "kg_entities.json",
        "kg_relationships.json",
        "fault_catalog.json",
        "parameters.json",
        "scorecard.json",
        "signals.csv",
    ):
        assert key in san, key
    # source refs + hashes survive sanitization (provenance chain still resolves)
    assert all(b["source_sha256"] for b in san_ev)
    assert json.loads(san["manifest.json"])["asset_match"]["source_file_hashes"]


def test_entity_uuids_present_and_unique(tmp_path):
    """The 4 missing identity UUIDs (§2) are minted: ``signal_uuid`` on signal entities, ``uns_node_uuid``
    on every i3X node, ``relationship_uuid`` on every edge, ``evidence_uuid`` per evidence block.
    Critically, a tag mentioned twice in one document yields two DISTINCT MENTIONS edges whose
    relationship_uuid derives from (and matches) the per-mention evidence_uuid — no collisions."""
    s = Store(str(tmp_path / "uuids.db"))
    p = s.create_project("UUID cell")
    plc = s.create_source(p["id"], "ccw", "ccw")
    s.add_extractions(
        p["id"],
        plc["id"],
        [
            {
                "tag_name": "Conv_Run",
                "roles": ["motor"],
                "uns_path_proposed": UNS,
                "i3x_element_id": UNS,
                "evidence_json": {"source": "ccw_modbus"},
                "confidence": 0.9,
            }
        ],
    )
    doc = s.create_source(p["id"], "manual", "m.pdf")
    s.add_extractions(
        p["id"],
        doc["id"],
        [
            {
                "tag_name": "Conv_Run",
                "roles": ["tag_reference"],
                "uns_path_proposed": None,
                "evidence_json": {
                    "source": "document",
                    "entity_type": "tag_reference",
                    "mentions": [
                        {"file": "m.pdf", "page": 2, "snippet": "Conv_Run energizes the motor"},
                        {"file": "m.pdf", "page": 7, "snippet": "Conv_Run de-energizes on stop"},
                    ],
                },
                "confidence": 0.9,
            }
        ],
    )
    for e in s.list_extractions(p["id"]):
        s.set_extraction_status(e["id"], "accepted")
    files = bundle.build_bundle(s, p["id"])

    nodes = json.loads(files["i3x.json"])["objectInstances"]
    assert nodes and all(n["uns_node_uuid"] for n in nodes)
    assert len({n["uns_node_uuid"] for n in nodes}) == len(nodes)  # one stable id per UNS node

    rels = json.loads(files["kg_relationships.json"])["relationships"]
    assert rels and all(r["relationship_uuid"] for r in rels)
    assert len({r["relationship_uuid"] for r in rels}) == len(rels)  # no edge-id collisions

    mentions = [r for r in rels if r["type"] == "MENTIONS" and r["target"] == "Conv_Run"]
    assert len(mentions) == 2  # two distinct mention edges
    assert mentions[0]["relationship_uuid"] != mentions[1]["relationship_uuid"]

    # each MENTIONS edge links back to a real evidence block (relationship_uuid derives from evidence)
    ev_uuids = {b["evidence_uuid"] for b in json.loads(files["evidence.json"])["evidence"]}
    for r in mentions:
        assert r["evidence_uuid"] in ev_uuids
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

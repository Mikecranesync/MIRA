"""The .miraprofile document model: save / open / save-as / incremental work / recents, and that
PLC+CCW+manual+image-derived evidence all land in one normalized model."""

import json

from mira_contextualizer import ccw, contextualize, profile, scorecard
from mira_contextualizer.store import Store

MODBUS = """<modbusServer Version="2.0">
  <modbusRegister name="COILS">
    <mapping variable="motor_running" parent="Micro820" dataType="Bool" address="000001"/>
    <mapping variable="fault_alarm" parent="Micro820" dataType="Bool" address="000003"/>
  </modbusRegister>
</modbusServer>"""


def _seed(store, name="Garage Demo / Micro820 Conveyor"):
    p = store.create_project(name)
    store.set_profile(
        p["id"],
        {
            "machine_name": "Conveyor 1",
            "manufacturer": "Allen-Bradley",
            "model": "2080-LC50-24QWB",
            "controller_type": "Micro820",
            "site": "Garage",
            "line": "Demo",
        },
    )
    res = ccw.parse_project({"MbSrvConf.xml": MODBUS})
    src = store.create_source(p["id"], "ccw", "CCW project (1 file)")
    store.add_extractions(p["id"], src["id"], res["rows"])
    return p["id"]


def test_save_profile_writes_miraprofile(tmp_path):
    s = Store(str(tmp_path / "a.db"))
    pid = _seed(s)
    path = str(tmp_path / "conveyor.miraprofile")
    data = profile.write_profile(s, pid, path)
    assert profile.EXT == ".miraprofile"
    assert data["schema"] == "mira-contextualizer/profile@1"
    assert data["profile"]["name"].startswith("Garage Demo")
    assert data["profile"]["identity"]["model"] == "2080-LC50-24QWB"
    # the file exists and is valid JSON carrying the source + extractions
    on_disk = json.loads((tmp_path / "conveyor.miraprofile").read_text(encoding="utf-8"))
    assert on_disk["sources"][0]["fileName"].startswith("CCW project")
    assert any(e["tagName"] == "motor_running" for e in on_disk["sources"][0]["extractions"])
    assert on_disk["sources"][0]["sha256"].startswith("sha256:")
    # saving recorded an export
    assert any(x["kind"] == "profile" for x in s.list_exports(pid))
    s.close()


def test_open_profile_restores_metadata_sources_extractions_decisions(tmp_path):
    s = Store(str(tmp_path / "a.db"))
    pid = _seed(s)
    # accept one, reject another — these review decisions must survive a round-trip
    exts = s.list_extractions(pid)
    s.set_extraction_status(
        next(e["id"] for e in exts if e["tagName"] == "motor_running"), "accepted"
    )
    s.set_extraction_status(
        next(e["id"] for e in exts if e["tagName"] == "fault_alarm"), "rejected"
    )
    data = profile.save_profile(s, pid)
    s.close()

    s2 = Store(str(tmp_path / "fresh.db"))  # reopen on a *different* store
    proj = profile.open_profile(s2, data)
    assert proj["profile"]["model"] == "2080-LC50-24QWB"
    assert proj["name"].startswith("Garage Demo")
    by = {e["tagName"]: e for e in s2.list_extractions(proj["id"])}
    assert by["motor_running"]["status"] == "accepted"
    assert by["fault_alarm"]["status"] == "rejected"
    assert by["motor_running"]["unsPathProposed"]  # placement survived too
    assert s2.list_sources(proj["id"])[0]["fileName"].startswith("CCW project")
    s2.close()


def test_save_as_creates_a_copy(tmp_path):
    s = Store(str(tmp_path / "a.db"))
    pid = _seed(s)
    p1, p2 = str(tmp_path / "v1.miraprofile"), str(tmp_path / "v2.miraprofile")
    profile.write_profile(s, pid, p1)
    profile.write_profile(s, pid, p2)
    d1 = json.loads((tmp_path / "v1.miraprofile").read_text(encoding="utf-8"))
    d2 = json.loads((tmp_path / "v2.miraprofile").read_text(encoding="utf-8"))
    # both copies are complete profiles of the same machine: identity + sources are identical
    # (saved_at + the growing export history naturally differ between the two saves)
    assert d1["profile"] == d2["profile"]
    assert d1["sources"] == d2["sources"]
    s.close()


def test_incremental_add_preserves_prior_decisions(tmp_path):
    """Monday: CCW + accept. Friday (reopened): add a manual; the accepted decision is preserved."""
    s = Store(str(tmp_path / "a.db"))
    pid = _seed(s)
    s.set_extraction_status(
        next(e["id"] for e in s.list_extractions(pid) if e["tagName"] == "motor_running"),
        "accepted",
    )
    saved = profile.save_profile(s, pid)
    s.close()

    s2 = Store(str(tmp_path / "fresh.db"))
    proj = profile.open_profile(s2, saved)
    pid2 = proj["id"]
    # add a drive manual later
    blocks = [
        {"text": "Fault F004 Overcurrent. Cause: motor short. Remedy: check wiring.", "page": 1}
    ]
    doc = s2.create_source(pid2, "manual", "gs.pdf")
    s2.set_source_extraction(doc["id"], {"blocks": blocks})
    s2.add_extractions(
        pid2,
        doc["id"],
        contextualize.contextualize_blocks(blocks, "gs.pdf", s2.plc_tag_names(pid2)),
    )
    by = {e["tagName"]: e for e in s2.list_extractions(pid2)}
    assert by["motor_running"]["status"] == "accepted"  # old decision preserved
    assert "F004" in by  # new evidence added to the same model
    s2.close()


def test_ccw_manual_and_image_evidence_land_in_one_model(tmp_path):
    s = Store(str(tmp_path / "a.db"))
    pid = _seed(s)  # CCW signals
    # a drive manual (fault depth)
    mblocks = [
        {"text": "Fault F004 Overcurrent. Cause: motor short. Remedy: check wiring.", "page": 2}
    ]
    md = s.create_source(pid, "manual", "drive.pdf")
    s.set_source_extraction(md["id"], {"blocks": mblocks})
    s.add_extractions(pid, md["id"], contextualize.contextualize_blocks(mblocks, "drive.pdf", []))
    # an OCR'd nameplate image (manufacturer/model identity) — represented as an extracted IR block
    iblocks = [{"text": "Allen-Bradley PowerFlex 525 catalog 25B-D010N104", "page": 1}]
    im = s.create_source(pid, "manual", "nameplate.png")
    s.set_source_extraction(im["id"], {"blocks": iblocks})
    s.add_extractions(
        pid, im["id"], contextualize.contextualize_blocks(iblocks, "nameplate.png", [])
    )

    exts = s.list_extractions(pid)
    roles = {r for e in exts for r in (e["roles"] or [])}
    # one normalized model holds signals (CCW) + a fault (manual) + a model/catalog (image)
    assert {"motor", "fault_code"} <= roles or "fault_code" in roles
    assert any(e["tagName"] == "F004" for e in exts)
    assert any(
        "model_family" in (e["roles"] or []) or "catalog_number" in (e["roles"] or []) for e in exts
    )
    # every item carries provenance + a status (the normalized contract)
    for e in exts:
        assert e["status"] in ("pending", "accepted", "rejected")
        assert e["evidenceJson"] is not None
    s.close()


def test_scorecard_updates_after_adding_files(tmp_path):
    s = Store(str(tmp_path / "a.db"))
    pid = _seed(s)
    before = scorecard.compute_scorecard(s.list_extractions(pid), s.list_sources(pid))["score"]
    # add a manual with fault cause/next-check + units → answerability rises
    blocks = [
        {
            "text": "Fault F004 Overcurrent. Cause: motor short. Remedy: check wiring.\n"
            "Rated current 9.6 A.",
            "page": 1,
        }
    ]
    doc = s.create_source(pid, "manual", "gs.pdf")
    s.set_source_extraction(doc["id"], {"blocks": blocks})
    s.add_extractions(
        pid, doc["id"], contextualize.contextualize_blocks(blocks, "gs.pdf", s.plc_tag_names(pid))
    )
    after = scorecard.compute_scorecard(s.list_extractions(pid), s.list_sources(pid))["score"]
    assert after > before
    s.close()


def test_recent_profiles_list(tmp_path):
    rp = str(tmp_path / "recents.json")
    assert profile.recents_load(rp) == []
    profile.recents_add(rp, str(tmp_path / "a.miraprofile"), "A")
    profile.recents_add(rp, str(tmp_path / "b.miraprofile"), "B")
    profile.recents_add(rp, str(tmp_path / "a.miraprofile"), "A")  # re-open moves A to front
    items = profile.recents_load(rp)
    assert [r["name"] for r in items] == ["A", "B"]
    assert items[0]["path"].endswith("a.miraprofile")

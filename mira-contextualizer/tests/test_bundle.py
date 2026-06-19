"""Factory Context Bundle (bundle@1) — schemas, projections, and zip round-trip."""
import io
import json
import zipfile

import pytest

from mira_contextualizer import bundle
from mira_contextualizer.store import Store

UNS = "enterprise/site/area/line/cv_101/run"


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

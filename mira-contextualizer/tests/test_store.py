"""Local SQLite store — project/source/extraction CRUD + counts + decision transitions."""

import pytest

from mira_contextualizer.store import Store


@pytest.fixture()
def store(tmp_path):
    s = Store(str(tmp_path / "t.db"))
    yield s
    s.close()


def test_create_and_list_project(store):
    p = store.create_project("  Conveyor Line 1  ", "  Q2 export  ")
    assert p["name"] == "Conveyor Line 1"
    assert p["description"] == "Q2 export"
    assert p["sourceCount"] == 0 and p["extractionCount"] == 0 and p["acceptedCount"] == 0
    listed = store.list_projects()
    assert [x["id"] for x in listed] == [p["id"]]


def test_empty_name_rejected(store):
    with pytest.raises(ValueError):
        store.create_project("   ")


def test_source_and_extraction_flow_with_counts(store):
    p = store.create_project("P")
    src = store.create_source(p["id"], "l5x", "conveyor.L5X")
    assert src["status"] == "pending"
    n = store.add_extractions(
        p["id"],
        src["id"],
        [
            {
                "tag_name": "Conveyor_Run",
                "roles": ["motor"],
                "uns_path_proposed": "e/s/a/l/cv/run",
                "i3x_element_id": "e/s/a/l/cv/run",
                "evidence_json": {"x": 1},
                "confidence": 0.9,
            },
            {
                "tag_name": "Scratch",
                "roles": [],
                "uns_path_proposed": None,
                "i3x_element_id": None,
                "evidence_json": {},
                "confidence": 0.3,
            },
        ],
    )
    assert n == 2
    store.set_source_status(src["id"], "done")

    rows = store.list_extractions(p["id"])
    assert {r["tagName"] for r in rows} == {"Conveyor_Run", "Scratch"}
    run = next(r for r in rows if r["tagName"] == "Conveyor_Run")
    assert run["roles"] == ["motor"] and run["evidenceJson"] == {"x": 1}
    assert run["fileName"] == "conveyor.L5X"

    proj = store.get_project(p["id"])
    assert proj["sourceCount"] == 1 and proj["extractionCount"] == 2 and proj["acceptedCount"] == 0


def test_decision_transitions_and_accepted_count(store):
    p = store.create_project("P")
    src = store.create_source(p["id"], "l5x", "f.L5X")
    store.add_extractions(
        p["id"],
        src["id"],
        [
            {
                "tag_name": "A",
                "roles": [],
                "uns_path_proposed": "x",
                "evidence_json": {},
                "confidence": 0.9,
            },
        ],
    )
    eid = store.list_extractions(p["id"])[0]["id"]
    updated = store.set_extraction_status(eid, "accepted")
    assert updated["status"] == "accepted"
    assert store.get_project(p["id"])["acceptedCount"] == 1
    assert store.set_extraction_status("nope", "accepted") is None
    with pytest.raises(ValueError):
        store.set_extraction_status(eid, "garbage")

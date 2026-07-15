"""pageset — independent-page system adapter (Phase B, W2). Hermetic.

manifest + ordered per-page graph.json dicts -> sheet index -> systemgraph.
Every emitted fact retains page-level provenance (page_id, photo_sha256,
extractor version, source section/field, confidence). Photos are NEVER
collapsed into one interpretation package. Synthetic fixtures only.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import pageset, systemgraph  # noqa: E402

EXTRACTOR = {"model": "test-model", "effort": "high", "package_version": "0.0-test"}


def _manifest() -> dict:
    return {
        "pages": [
            {"page_id": "p1", "sheet": "1", "file": "a.jpg",
             "photo_sha256": "aa" * 32, "quality": "clear_upright",
             "extractor": EXTRACTOR},
            {"page_id": "p2", "sheet": "2", "file": "b.jpg",
             "photo_sha256": "bb" * 32, "quality": "blurred",
             "extractor": EXTRACTOR},
            {"page_id": "p3", "sheet": "3", "file": None,
             "photo_sha256": None, "quality": "missing",
             "extractor": None},
        ]
    }


def _graph_p1() -> dict:
    return {
        "package": {"sheet": "1"},
        "devices": [
            {"tag": "-1/K01", "type": "contactor", "confidence": 0.9,
             "connects": ["2.4 / CTRL", "+CAB2/3.1"]},
            {"tag": "UNREADABLE", "type": "smudge", "confidence": 0.2},
        ],
        "terminals": [
            {"tag": "-1/X1", "type": "terminal_strip", "confidence": 0.8,
             "connects": []},
        ],
        "off_page_references": [
            {"tag": "FIB1", "type": "fiber_continuation", "confidence": 0.7,
             "connects": ["sheet3"]},
        ],
        "unresolved": [{"item": "corner stamp", "status": "unreadable"}],
    }


def _graph_p2() -> dict:
    return {
        "package": {"sheet": "UNREADABLE"},
        "devices": [],
        "unresolved": [{"item": "everything", "status": "blurred"}],
    }


def _graphs() -> dict:
    return {"p1": _graph_p1(), "p2": _graph_p2()}


def test_index_has_one_entry_per_manifest_page_never_collapsed():
    index = pageset.load_pageset(_manifest(), _graphs())
    assert [s["sheet"] for s in index["sheets"]] == ["1", "2", "3"]
    assert [s["quality"] for s in index["sheets"]] == \
        ["clear_upright", "blurred", "missing"]


def test_missing_page_has_no_graph_and_no_facts():
    index = pageset.load_pageset(_manifest(), _graphs())
    s3 = index["sheets"][2]
    assert s3["devices"] == [] and s3["xrefs"] == []


def test_graph_without_manifest_page_is_an_error():
    graphs = _graphs()
    graphs["p9"] = _graph_p1()
    with pytest.raises(ValueError):
        pageset.load_pageset(_manifest(), graphs)


def test_manifest_page_without_graph_is_an_error_unless_missing():
    with pytest.raises(ValueError):
        pageset.load_pageset(_manifest(), {"p1": _graph_p1()})  # p2 absent


def test_devices_carry_full_provenance_and_skip_unreadable():
    index = pageset.load_pageset(_manifest(), _graphs())
    s1 = index["sheets"][0]
    tags = [d["tag"] for d in s1["devices"]]
    assert "-1/K01" in tags and "-1/X1" in tags
    assert "UNREADABLE" not in tags
    k01 = next(d for d in s1["devices"] if d["tag"] == "-1/K01")
    prov = k01["provenance"]
    assert prov["page_id"] == "p1"
    assert prov["photo_sha256"] == "aa" * 32
    assert prov["extractor"] == EXTRACTOR
    assert prov["section"] == "devices"
    assert k01["confidence"] == 0.9
    assert k01["kind"] == "contactor"  # Entity.type -> kind mapping


def test_xrefs_from_connects_via_xrefnorm_with_raw_evidence():
    index = pageset.load_pageset(_manifest(), _graphs())
    s1 = index["sheets"][0]
    peers = {x["peer"] for x in s1["xrefs"]}
    # "2.4 / CTRL" -> sheet_col atom 2.4 -> peer S2.4
    assert "S2.4" in peers
    # "+CAB2/3.1" -> assembly atom -> EXT
    assert "EXT:+CAB2/3.1" in peers
    # off_page_references "sheet3" -> bare sheet atom -> S3
    assert "S3" in peers
    edge = next(x for x in s1["xrefs"] if x["peer"] == "S2.4")
    assert edge["provenance"]["raw"] == "2.4 / CTRL"
    assert edge["provenance"]["page_id"] == "p1"
    assert edge["provenance"]["source_field"].startswith("devices[")
    assert edge["ev"] == "obs"


def test_unresolved_passthrough_with_page_provenance():
    index = pageset.load_pageset(_manifest(), _graphs())
    s1 = index["sheets"][0]
    assert s1["unresolved"][0]["item"] == "corner stamp"
    assert s1["unresolved"][0]["provenance"]["page_id"] == "p1"


def test_duplicate_sheet_ids_rejected():
    manifest = _manifest()
    manifest["pages"][1]["sheet"] = "1"
    with pytest.raises(ValueError):
        pageset.load_pageset(manifest, _graphs())


def test_decoder_integration_is_strictly_opt_in():
    """D19/D20: default behavior byte-identical (no 'designation' key, no
    changed identities); opting in attaches decoded keys WITHOUT changing
    the tag used as graph identity."""
    default = pageset.load_pageset(_manifest(), _graphs())
    for sheet in default["sheets"]:
        for dev in sheet["devices"]:
            assert "designation" not in dev

    opted = pageset.load_pageset(_manifest(), _graphs(),
                                 decoder_profile="eplan_iec")
    s1 = opted["sheets"][0]
    k01 = next(d for d in s1["devices"] if d["tag"] == "-1/K01")
    dz = k01["designation"]
    assert dz["parent_device_key"] == "-1/K01"
    assert dz["profile"] == "eplan_iec"
    assert k01["tag"] == "-1/K01"  # identity untouched
    # tags with a connection point expose the child keys for Phase C
    graphs = _graphs()
    graphs["p1"]["devices"].append(
        {"tag": "-1/K01:A1", "type": "coil terminal", "confidence": 0.9,
         "connects": []})
    opted2 = pageset.load_pageset(_manifest(), graphs,
                                  decoder_profile="eplan_iec")
    a1 = next(d for d in opted2["sheets"][0]["devices"]
              if d["tag"] == "-1/K01:A1")
    assert a1["designation"]["parent_device_key"] == "-1/K01"
    assert a1["designation"]["connection_point_key"] == "-1/K01:A1"
    assert a1["designation"]["relationship"] == "COIL_TERMINAL_OF"


def test_index_feeds_systemgraph_end_to_end():
    index = pageset.load_pageset(_manifest(), _graphs())
    graph = systemgraph.build_system_graph(index)
    assert graph["summary"]["sheets"] == 3
    # S3 is missing -> the off-page ref into it must classify unverifiable
    fib = [e for e in graph["edges"] if e["peer"] == "S3"]
    assert fib and fib[0]["cls"] == "unverifiable"

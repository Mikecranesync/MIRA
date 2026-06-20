"""Deterministic contextualization rules — entities + provenance, no guessing on bare prose."""
from mira_contextualizer import contextualize


def _blocks(*lines, page=1):
    return [{"text": "\n".join(lines), "kind": "text", "page": page}]


def _by_role(cands):
    out = {}
    for c in cands:
        out.setdefault(c["roles"][0], []).append(c["tag_name"])
    return out


def test_extracts_core_entities_with_provenance():
    blocks = _blocks(
        "Fault F0004 indicates a motor overload trip.",
        "Set parameter P09.03 = 5 s for the comm timeout.",
        "Catalog 2080-LC50-24QWB controller.",
        "The PowerFlex 525 drive is used here.",
        "Manufactured by Rockwell Automation.",
        "The line runs smoothly during normal operation.",  # prose → no candidate
    )
    cands = contextualize.contextualize_blocks(blocks, "manual.pdf", plc_tags=[])
    roles = _by_role(cands)
    assert "F0004" in roles.get("fault_code", [])
    assert "P09.03" in roles.get("parameter", [])
    assert "2080-LC50-24QWB" in roles.get("catalog_number", [])
    assert any("PowerFlex" in v for v in roles.get("model_family", []))
    assert "Rockwell" in " ".join(roles.get("manufacturer", []))

    fault = next(c for c in cands if c["tag_name"] == "F0004")
    ev = fault["evidence_json"]
    assert ev["source"] == "document" and ev["entity_type"] == "fault_code"
    assert ev["mentions"][0]["file"] == "manual.pdf" and ev["mentions"][0]["page"] == 1
    assert "F0004" in ev["mentions"][0]["snippet"]
    assert isinstance(fault["confidence"], float)


def test_dedup_merges_mentions():
    blocks = _blocks("Fault F0004 here.", "Again F0004 on page two.", page=2)
    cands = contextualize.contextualize_blocks(blocks, "m.pdf")
    faults = [c for c in cands if c["tag_name"] == "F0004"]
    assert len(faults) == 1
    assert len(faults[0]["evidence_json"]["mentions"]) == 2


def test_short_fault_code_needs_keyword():
    quiet = contextualize.contextualize_blocks(_blocks("status oC steady"), "m.pdf")
    assert not any(c["tag_name"] == "oC" for c in quiet)
    loud = contextualize.contextualize_blocks(_blocks("fault oC detected on drive"), "m.pdf")
    assert any(c["tag_name"] == "oC" for c in loud)


def test_tag_cross_reference():
    blocks = _blocks("The Conveyor_Run output energizes the motor contactor.")
    cands = contextualize.contextualize_blocks(blocks, "m.pdf", plc_tags=["Conveyor_Run", "X"])
    xref = [c for c in cands if "tag_reference" in c["roles"]]
    assert xref and xref[0]["tag_name"] == "Conveyor_Run"  # "X" too short → ignored

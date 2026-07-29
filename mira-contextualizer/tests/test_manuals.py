"""Manual-driven depth extraction — fault cause/next-check + units/ranges/setpoints, tied to tags.

These are the two dimensions that lift a project from "Inventory" to "Diagnosable" in the scorecard,
so the assertions mirror the evidence keys scorecard.compute_scorecard reads (cause/next_check;
units/range/setpoint). Deterministic, no LLM — every case is a fixed string in → fixed rows out.
"""

from mira_contextualizer import contextualize, manuals, scorecard


def _blocks(*lines, kind="text", page=1):
    return [{"text": "\n".join(lines), "kind": kind, "page": page}]


def _faults(rows):
    return {r["tag_name"]: r["evidence_json"] for r in rows if "fault_code" in r["roles"]}


# ── fault semantics ──────────────────────────────────────────────────────────────────────────────
def test_fault_header_table_maps_cause_and_next_check():
    blocks = _blocks(
        "Code\tFault Name\tProbable Cause\tCorrective Action",
        "F004\tOvercurrent\tMotor cable shorted or accel too fast\tCheck wiring, increase accel time",
        "F005\tOvervoltage\tDecel too fast or high line voltage\tIncrease decel time, add brake resistor",
        kind="table",
    )
    rows = manuals.mine(blocks, "gs10-manual.pdf")
    faults = _faults(rows)
    assert "F004" in faults and "F005" in faults
    f4 = faults["F004"]
    assert f4["description"] == "Overcurrent"
    assert "Motor cable shorted" in f4["cause"]
    assert "Check wiring" in f4["next_check"]
    assert f4["mentions"][0]["file"] == "gs10-manual.pdf"


def test_fault_markdown_pipe_table():
    blocks = _blocks(
        "Fault | Description | Cause | Remedy",
        "F0004 | Motor overload | Excessive load on motor | Reduce load, check mechanics",
    )
    faults = _faults(manuals.mine(blocks, "m.pdf"))
    assert faults["F0004"]["cause"].startswith("Excessive load")
    assert faults["F0004"]["next_check"].startswith("Reduce load")


def test_fault_cue_prose():
    blocks = _blocks(
        "F030 Ground fault. Cause: insulation breakdown in motor leads. "
        "Remedy: megger the motor and replace the cable if shorted."
    )
    faults = _faults(manuals.mine(blocks, "m.pdf"))
    assert faults["F030"]["cause"].startswith("insulation breakdown")
    assert "megger the motor" in faults["F030"]["next_check"]


def test_param_not_misread_as_fault():
    # A parameter line must never produce a fault row (P09 looks code-ish but isn't a fault).
    blocks = _blocks("P09.03 Communication loss timeout 0...60 s, default 5")
    assert not _faults(manuals.mine(blocks, "m.pdf"))


# ── units / ranges / setpoints ─────────────────────────────────────────────────────────────────
def _specs(rows):
    return [r for r in rows if r["roles"][0] in ("parameter", "spec", "tag_reference")]


def test_param_range_and_default():
    blocks = _blocks("P09.03 Communication loss timeout 0...60 s, default 5")
    rows = _specs(manuals.mine(blocks, "m.pdf"))
    assert rows and rows[0]["tag_name"] == "P09.03"
    ev = rows[0]["evidence_json"]
    assert ev["range"] == "0-60" and ev["units"] == "s"
    assert ev["setpoint"].startswith("5")


def test_named_spec_units():
    rows = _specs(manuals.mine(_blocks("Rated motor current 9.6 A"), "m.pdf"))
    ev = rows[0]["evidence_json"]
    assert ev["units"] == "A" and ev["setpoint"].startswith("9.6")


def test_bare_number_with_no_engineering_subject_is_ignored():
    # "Weight 28 kg" has no analog quantity → no guess. (kg is a unit but weight isn't diagnostic.)
    assert not _specs(manuals.mine(_blocks("Package weight 28 kg on the pallet"), "m.pdf"))


def test_spec_tied_to_plc_tag_by_quantity():
    rows = manuals.mine(
        _blocks("Drive speed range 0-1800 RPM"), "m.pdf", plc_tags=["drive_speed", "fault_alarm"]
    )
    tied = [r for r in rows if r["roles"][0] == "tag_reference"]
    assert tied and tied[0]["tag_name"] == "drive_speed"
    assert tied[0]["evidence_json"]["range"] == "0-1800"
    assert tied[0]["evidence_json"]["match"] == "semantic"


def test_spec_tied_to_plc_tag_by_exact_name():
    rows = manuals.mine(
        _blocks("conveyor_speed nominal 60 Hz"), "m.pdf", plc_tags=["conveyor_speed"]
    )
    tied = [r for r in rows if r["tag_name"] == "conveyor_speed"]
    assert tied and tied[0]["evidence_json"]["units"] == "Hz"


# ── integration: enrich the spotting candidates (one signal, not a duplicate) ────────────────────
def test_contextualize_enriches_fault_with_cause_next_check():
    blocks = _blocks(
        "Code\tName\tCause\tAction",
        "F0004\tOverload\tExcessive mechanical load\tCheck the gearbox and reduce load",
        kind="table",
    )
    cands = contextualize.contextualize_blocks(blocks, "manual.pdf")
    f4 = [c for c in cands if c["tag_name"] == "F0004"]
    assert len(f4) == 1  # spotting + depth merged into ONE candidate
    ev = f4[0]["evidence_json"]
    assert ev["cause"].startswith("Excessive") and ev["next_check"].startswith("Check the gearbox")


def test_contextualize_adds_units_and_lifts_scorecard():
    blocks = _blocks(
        "Code\tName\tCause\tAction",
        "F0004\tOverload\tToo much load\tReduce load and check amps",
        "Drive speed range 0-1800 RPM",
        "Output frequency 0...60 Hz, default 60",
        kind="text",
    )
    cands = contextualize.contextualize_blocks(blocks, "manual.pdf", plc_tags=["drive_speed"])
    # shape it like stored rows (camelCase evidenceJson) for the scorecard
    exts = [
        {
            "tagName": c["tag_name"],
            "roles": c["roles"],
            "unsPathProposed": None,
            "evidenceJson": c["evidence_json"],
            "confidence": c["confidence"],
            "status": "accepted",
        }
        for c in cands
    ]
    sc = scorecard.compute_scorecard(exts, [{"sourceType": "manual"}])
    dims = {d["key"]: d for d in sc["dimensions"]}
    assert dims["units_ranges"]["coverage"] == 1.0
    assert dims["fault_semantics"]["coverage"] == 1.0
    labels = {g["label"] for g in sc["topGaps"]}
    assert "Units / ranges / setpoints" not in labels
    assert "Fault cause -> next-check" not in labels

"""Contextualization Scorecard — answerability grade + prioritized gaps."""

from mira_contextualizer import scorecard


def _ext(tag, roles=None, ev=None, uns=None, status="pending"):
    return {
        "tagName": tag,
        "roles": roles or [],
        "unsPathProposed": uns,
        "evidenceJson": ev or {},
        "confidence": 0.9,
        "status": status,
    }


def test_empty_project_scores_zero():
    sc = scorecard.compute_scorecard([], [])
    assert sc["score"] == 0 and sc["grade"] == "Skeleton"
    assert sc["counts"]["signals"] == 0
    assert any(g["label"] == "Signals captured" for g in sc["topGaps"])


def test_ccw_tags_without_units_or_fault_cause_flags_those_gaps():
    exts = [
        _ext("2080-LC20-20QBB", ["controller"], {"source": "ccw_controller"}),
        _ext(
            "motor_running",
            ["motor", "status"],
            {"data_type": "Bool", "modbus_address": "000001", "comment": "run fb"},
            uns="enterprise/s/a/l/cv/run",
            status="accepted",
        ),
        _ext(
            "fault_alarm",
            ["fault_code"],
            {"data_type": "Bool", "modbus_address": "000003"},
            status="accepted",
        ),
    ]
    sources = [{"sourceType": "l5x"}, {"sourceType": "manual"}]
    sc = scorecard.compute_scorecard(exts, sources)
    assert 0 < sc["score"] < 90
    labels = {g["label"] for g in sc["topGaps"]}
    # the two highest-weight gaps must surface
    assert "Units / ranges / setpoints" in labels
    assert "Fault cause -> next-check" in labels
    # identity + docs + faults are satisfied
    dims = {d["key"]: d for d in sc["dimensions"]}
    assert dims["identity"]["coverage"] == 1.0
    assert dims["documents"]["coverage"] == 1.0
    assert dims["faults"]["coverage"] == 1.0


def test_units_and_fault_semantics_raise_score_and_clear_gaps():
    exts = [
        _ext(
            "speed",
            ["analog"],
            {
                "units": "RPM",
                "range": "0-1800",
                "data_type": "Int",
                "modbus_address": "400101",
                "comment": "drive speed",
            },
            uns="x",
            status="accepted",
        ),
        _ext(
            "F0004",
            ["fault_code"],
            {"cause": "overload", "next_check": "check amps", "comment": "overload"},
            status="accepted",
        ),
    ]
    sources = [{"sourceType": "manual"}]
    sc = scorecard.compute_scorecard(exts, sources)
    dims = {d["key"]: d for d in sc["dimensions"]}
    assert dims["units_ranges"]["coverage"] == 1.0
    assert dims["fault_semantics"]["coverage"] == 1.0
    labels = {g["label"] for g in sc["topGaps"]}
    assert "Units / ranges / setpoints" not in labels
    assert "Fault cause -> next-check" not in labels


def test_schema_shape():
    sc = scorecard.compute_scorecard([], [])
    assert sc["schema"] == "mira-contextualizer/scorecard@1"
    assert isinstance(sc["dimensions"], list) and len(sc["dimensions"]) == 13
    assert "summary" in sc

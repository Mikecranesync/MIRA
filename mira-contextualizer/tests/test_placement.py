"""CCW → UNS placement: a CCW project import now fills uns.json / i3x.json / HAS_SIGNAL, and the
scorecard placement dimension rises — the gap this work closes."""

from mira_contextualizer import ccw, placement, scorecard

# A small but realistic Micro820 CCW project: a Modbus map (engineering names + types + addresses) and
# a Structured Text file carrying the controller model + IP.
MODBUS = """<modbusServer Version="2.0">
  <modbusRegister name="COILS">
    <mapping variable="motor_running" parent="Micro820" dataType="Bool" address="000001"/>
    <mapping variable="fault_alarm" parent="Micro820" dataType="Bool" address="000003"/>
  </modbusRegister>
  <modbusRegister name="HOLDING_REGISTERS">
    <mapping variable="drive_current" parent="Micro820" dataType="Real" address="400101"/>
    <mapping variable="motor_speed" parent="Micro820" dataType="Int" address="400103"/>
  </modbusRegister>
</modbusServer>"""

ST = """(* Conveyor for 2080-LC50-24QWB   PLC IP: 192.168.1.50 *)
PROGRAM Conv
VAR
  motor_running : BOOL; (* main drive run feedback *)
END_VAR
END_PROGRAM"""


def test_ccw_project_rows_get_uns_paths():
    res = ccw.parse_project({"MbSrvConf.xml": MODBUS, "Conv.st": ST})
    by = {r["tag_name"]: r for r in res["rows"]}
    # every signal row now carries a UNS path; the controller identity stays unplaced
    assert by["2080-LC50-24QWB"]["uns_path_proposed"] is None
    for tag in ("motor_running", "fault_alarm", "drive_current", "motor_speed"):
        assert by[tag]["uns_path_proposed"], tag
    # controller name seeds the line; asset-prefix + standardized leaf are applied
    assert (
        by["motor_running"]["uns_path_proposed"]
        == "enterprise/site1/area1/2080_lc50_24qwb/motor/running"
    )
    assert by["drive_current"]["uns_path_proposed"].endswith("/drive/current")
    # paths are unique (no collision dropped a signal)
    paths = [
        by[t]["uns_path_proposed"]
        for t in ("motor_running", "fault_alarm", "drive_current", "motor_speed")
    ]
    assert len(set(paths)) == 4


def test_place_rows_is_idempotent_and_keeps_existing_paths():
    rows = ccw.parse_modbus(MODBUS)  # already placed by engine; re-running must not change paths
    first = {r["tag_name"]: r["uns_path_proposed"] for r in placement.place_rows(rows)}
    again = {r["tag_name"]: r["uns_path_proposed"] for r in placement.place_rows(rows)}
    assert first == again and all(first.values())


def test_scorecard_placement_dimension_rises_for_ccw_project():
    """Before this change CCW rows had no UNS path → placement coverage 0. Now it rises."""
    placed = ccw.parse_project({"MbSrvConf.xml": MODBUS, "Conv.st": ST})["rows"]
    unplaced = [{**r, "uns_path_proposed": None} for r in placed]

    def cov(rows):
        exts = [
            {
                "tagName": r["tag_name"],
                "roles": r["roles"],
                "unsPathProposed": r["uns_path_proposed"],
                "evidenceJson": r["evidence_json"],
                "confidence": r["confidence"],
                "status": "accepted",
            }
            for r in rows
        ]
        sc = scorecard.compute_scorecard(exts, [{"sourceType": "other"}])
        return next(d["coverage"] for d in sc["dimensions"] if d["key"] == "placement")

    assert cov(unplaced) == 0.0
    assert cov(placed) > 0.0

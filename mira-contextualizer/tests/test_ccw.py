"""CCW (Micro8xx) export support — matches the real MbSrvConf.xml / LogicalValues.csv formats."""
from mira_contextualizer import ccw, engine

MODBUS = """<modbusServer Version="2.0">
  <modbusRegister name="COILS">
    <mapping variable="motor_running" parent="Micro820" dataType="Bool" address="000001" va="0x454">
      <MBVarInfo ElemType="Bool" SubElemType="Any" DataTypeSize="1" /></mapping>
    <mapping variable="fault_alarm" parent="Micro820" dataType="Bool" address="000003">
      <MBVarInfo/></mapping>
    <mapping variable="e_stop_active" parent="Micro820" dataType="Bool" address="000007">
      <MBVarInfo/></mapping>
    <mapping variable="__SYSVA_FIRST_SCAN" parent="Micro820" dataType="Bool" address="000099">
      <MBVarInfo/></mapping>
  </modbusRegister>
  <modbusRegister name="DISCRETE_INPUTS">
    <mapping variable="_IO_EM_DI_00" parent="Micro820" dataType="Bool" address="100001">
      <MBVarInfo/></mapping>
  </modbusRegister>
</modbusServer>"""

LOGICAL = ("[Version1]\nFullName,Value\n"
           "Controller.Micro820.Micro820.__SYSVA_FIRST_SCAN,\n"
           "Controller.Micro820.Micro820._IO_EM_DI_00,\n"
           "Controller.Micro820.Micro820.conveyor_running,1\n")

VSSETTINGS = '<UserSettings><ApplicationIdentity version="14.0"/><ToolsOptions></ToolsOptions></UserSettings>'


def test_detect():
    assert ccw.detect_ccw("MbSrvConf.xml", MODBUS) == "ccw_modbus"
    assert ccw.detect_ccw("LogicalValues.csv", LOGICAL) == "ccw_logicalvalues"
    assert ccw.detect_ccw("Exported.vssettings", VSSETTINGS) == "ccw_settings"
    assert ccw.detect_ccw("Proj.ccwsln", "<whatever/>") == "ccw_solution"
    assert ccw.detect_ccw("random.xml", "<foo/>") is None


def test_parse_modbus_names_addresses_roles_and_skips_system():
    rows = ccw.parse_modbus(MODBUS)
    by = {r["tag_name"]: r for r in rows}
    assert set(by) == {"motor_running", "fault_alarm", "e_stop_active", "_IO_EM_DI_00"}
    assert "motor" in by["motor_running"]["roles"]
    assert "fault" in by["fault_alarm"]["roles"]
    assert "safety" in by["e_stop_active"]["roles"]
    assert by["motor_running"]["evidence_json"]["modbus_address"] == "000001"
    assert by["motor_running"]["evidence_json"]["data_type"] == "Bool"
    assert by["motor_running"]["confidence"] == 0.9          # named user variable
    assert "digital_input" in by["_IO_EM_DI_00"]["roles"]
    assert by["_IO_EM_DI_00"]["confidence"] == 0.6           # physical I/O point


def test_parse_logicalvalues_strips_prefix_and_skips_system():
    rows = ccw.parse_logicalvalues(LOGICAL)
    names = {r["tag_name"] for r in rows}
    assert names == {"_IO_EM_DI_00", "conveyor_running"}     # __SYSVA dropped, prefix stripped
    conv = next(r for r in rows if r["tag_name"] == "conveyor_running")
    assert "conveyor" in conv["roles"] and conv["evidence_json"]["source"] == "ccw_logicalvalues"


def test_guidance_for_settings_and_solution():
    assert "settings" in ccw.guidance("ccw_settings").lower()
    assert "ccwsln" in ccw.guidance("ccw_solution").lower()
    assert ccw.guidance("ccw_modbus") is None


def test_engine_analyze_text_routes_everything():
    assert engine.analyze_text("MbSrvConf.xml", MODBUS)["kind"] == "ccw_modbus"
    assert len(engine.analyze_text("MbSrvConf.xml", MODBUS)["rows"]) == 4
    assert engine.analyze_text("LogicalValues.csv", LOGICAL)["kind"] == "ccw_logicalvalues"

    settings = engine.analyze_text("Exported.vssettings", VSSETTINGS)
    assert settings["kind"] == "ccw_settings" and settings["rows"] == []
    assert "settings" in settings["note"].lower()

    unknown = engine.analyze_text("notes.weird", "just some text")
    assert unknown["kind"] == "unknown" and unknown["note"]

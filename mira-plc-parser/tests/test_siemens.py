"""Siemens TIA Portal Openness XML (SimaticML) parser tests.

Proves a Siemens SCL block lands in the SAME IR as Rockwell/ST -- so the whole analysis layer
(output dependencies, permissives + interlocks, timer->fault chains) works on Siemens too.
"""
from mira_plc_parser import analyze as A
from mira_plc_parser import render_markdown, run
from mira_plc_parser.parsers import siemens_tia_xml


def _fix(fixtures):
    return (fixtures / "siemens_conveyor.xml").read_text(encoding="utf-8")


def test_detects_and_handles_siemens(fixtures):
    res = run("ConveyorFB.xml", _fix(fixtures))
    assert res.detection.fmt == "siemens_tia_xml"
    assert res.detection.confidence == "high"
    assert res.handled


def test_interface_members_become_tags(fixtures):
    proj = siemens_tia_xml.parse(_fix(fixtures), "ConveyorFB.xml")
    assert proj.controllers[0].vendor == "Siemens"
    names = {t.name for t in proj.all_tags()}
    for expected in ("StartPB", "EStopOK", "AutoMode", "MotorRun", "ConvFault", "comm_err"):
        assert expected in names, "missing interface member %s" % expected
    # the safety comment survives onto the tag
    estop = next(t for t in proj.all_tags() if t.name == "EStopOK")
    assert "safety" in estop.description.lower()


def test_plc_tag_table_carries_physical_address(fixtures):
    proj = siemens_tia_xml.parse(_fix(fixtures), "ConveyorFB.xml")
    tags = {t.name: t for t in proj.all_tags()}
    assert tags["Motor_Out"].address == "%Q0.0"   # physical digital output
    assert tags["Start_In"].address == "%I0.0"    # physical input


def test_scl_body_lifts_into_rungs(fixtures):
    proj = siemens_tia_xml.parse(_fix(fixtures), "ConveyorFB.xml")
    rungs = proj.all_rungs()
    outs = {o for _p, _r, rung in rungs for o in rung.outputs}
    assert "MotorRun" in outs and "ConvFault" in outs


def test_output_dependencies_and_permissive_interlock(fixtures):
    r = A.analyze(siemens_tia_xml.parse(_fix(fixtures), "ConveyorFB.xml"))
    perms = {f.name: f for f in r.permissives}
    assert "MotorRun" in perms, "the conveyor run output should have a permissive chain"
    f = perms["MotorRun"]
    assert "StartPB" in f.detail
    assert "EStopOK" in f.interlocks          # e-stop is a safety interlock
    assert f.confidence == "review"


def test_siemens_watchdog_timer_chain(fixtures):
    # the FB-call watchdog (vfd_err_timer(IN:=comm_err, PT:=T#5S); IF vfd_err_timer.Q THEN ConvFault)
    # must reconstruct from the tokenized SCL and be detected as a timer->fault chain.
    r = A.analyze(siemens_tia_xml.parse(_fix(fixtures), "ConveyorFB.xml"))
    chain = next((c for c in r.timer_chains if c.name == "vfd_err_timer"), None)
    assert chain is not None, "Siemens SCL watchdog not detected: %s" % [c.name for c in r.timer_chains]
    assert "ConvFault" in chain.detail
    assert "fault" in chain.detail.lower()


def test_graphical_block_records_language_but_does_not_fake_logic():
    # a LAD compile unit with no StructuredText -> routine exists, language LAD, no rungs invented
    xml = """<?xml version="1.0"?>
    <Document><Engineering version="V18"/>
    <SW.Blocks.FC ID="0"><AttributeList><Name>LadderFC</Name>
      <ProgrammingLanguage>LAD</ProgrammingLanguage>
      <Interface><Sections><Section Name="Input"><Member Name="X" Datatype="Bool"/></Section></Sections></Interface>
    </AttributeList>
    <ObjectList><SW.Blocks.CompileUnit ID="1"><AttributeList>
      <NetworkSource><FlgNet><Parts/></FlgNet></NetworkSource>
      <ProgrammingLanguage>LAD</ProgrammingLanguage>
    </AttributeList></SW.Blocks.CompileUnit></ObjectList></SW.Blocks.FC></Document>"""
    res = run("LadderFC.xml", xml)
    assert res.handled
    routines = res.report.routine_summaries
    assert any(s["type"] == "RLL" for s in routines)
    assert res.report.counts.get("rungs", 0) == 0   # graphical body not faked into rungs


def test_render_markdown_smoke(fixtures):
    md = render_markdown(run("ConveyorFB.xml", _fix(fixtures)))
    assert "# MIRA PLC Parser report" in md
    assert "Siemens" in md

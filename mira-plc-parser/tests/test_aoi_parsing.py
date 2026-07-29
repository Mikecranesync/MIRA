"""Unit tests for Add-On Instruction (AOI) parsing — Phase 1.1."""
from __future__ import annotations

import textwrap

import pytest

from mira_plc_parser.parsers.rockwell_l5x import parse
from mira_plc_parser.ir import TagScope
from mira_plc_parser.analyze import analyze
from mira_plc_parser.coverage import coverage_report

# --- synthetic AOI fixture ---

AOI_XML = textwrap.dedent("""\
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.00"
    TargetType="AddOnInstructionDefinition" ContainsContext="true">
  <Controller Use="Context" Name="Wrapper">
    <DataTypes Use="Context"/>
    <AddOnInstructionDefinitions Use="Context">
      <AddOnInstructionDefinition Use="Target" Name="Debounce_FB"
          Revision="1.1">
        <Description><![CDATA[Debounce a digital input signal.]]></Description>
        <Parameters>
          <Parameter Name="EnableIn" DataType="BOOL" Usage="Input"
              Radix="Decimal" Required="false" Visible="false">
            <Description><![CDATA[Enable input]]></Description>
          </Parameter>
          <Parameter Name="EnableOut" DataType="BOOL" Usage="Output"
              Radix="Decimal" Required="false" Visible="false">
            <Description><![CDATA[Enable output]]></Description>
          </Parameter>
          <Parameter Name="RawInput" DataType="BOOL" Usage="Input"
              Radix="Decimal" Required="true" Visible="true">
            <Description><![CDATA[Raw digital input to debounce]]></Description>
          </Parameter>
          <Parameter Name="DebounceTime" DataType="REAL" Usage="Input"
              Radix="Float" Required="true" Visible="true">
            <Description><![CDATA[Debounce period in seconds]]></Description>
          </Parameter>
          <Parameter Name="Output" DataType="BOOL" Usage="Output"
              Radix="Decimal" Required="true" Visible="true">
            <Description><![CDATA[Debounced output]]></Description>
          </Parameter>
        </Parameters>
        <LocalTags>
          <LocalTag Name="Timer" DataType="TIMER" Radix="Decimal">
            <Description><![CDATA[Internal debounce timer]]></Description>
          </LocalTag>
          <LocalTag Name="PrevState" DataType="BOOL" Radix="Decimal"/>
        </LocalTags>
        <Routines>
          <Routine Name="Logic" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Comment><![CDATA[Detect rising edge on raw input]]></Comment>
                <Text><![CDATA[XIC(RawInput)XIO(PrevState)TON(Timer,?,?);]]></Text>
              </Rung>
              <Rung Number="1" Type="N">
                <Comment><![CDATA[Output goes high when timer done]]></Comment>
                <Text><![CDATA[XIC(Timer.DN)OTE(Output);]]></Text>
              </Rung>
              <Rung Number="2" Type="N">
                <Text><![CDATA[MOV(RawInput,PrevState);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>
""")


@pytest.fixture()
def aoi_project():
    return parse(AOI_XML, "Debounce_FB.L5X")


class TestAOIIR:
    def test_aoi_definition_present(self, aoi_project):
        assert len(aoi_project.controllers) == 1
        ctrl = aoi_project.controllers[0]
        assert len(ctrl.aoi_definitions) == 1
        aoi = ctrl.aoi_definitions[0]
        assert aoi.name == "Debounce_FB"
        assert aoi.revision == "1.1"
        assert "Debounce" in aoi.description

    def test_aoi_parameters(self, aoi_project):
        aoi = aoi_project.controllers[0].aoi_definitions[0]
        assert len(aoi.parameters) == 5
        names = {p.name for p in aoi.parameters}
        assert names == {"EnableIn", "EnableOut", "RawInput", "DebounceTime", "Output"}

    def test_aoi_parameter_scope(self, aoi_project):
        aoi = aoi_project.controllers[0].aoi_definitions[0]
        for p in aoi.parameters:
            assert p.scope == TagScope.AOI_PARAMETER.value

    def test_aoi_parameter_usage(self, aoi_project):
        aoi = aoi_project.controllers[0].aoi_definitions[0]
        by_name = {p.name: p for p in aoi.parameters}
        assert by_name["RawInput"].usage == ["Input"]
        assert by_name["Output"].usage == ["Output"]
        assert by_name["EnableIn"].usage == ["Input"]

    def test_aoi_local_tags(self, aoi_project):
        aoi = aoi_project.controllers[0].aoi_definitions[0]
        assert len(aoi.local_tags) == 2
        names = {t.name for t in aoi.local_tags}
        assert names == {"Timer", "PrevState"}

    def test_aoi_local_tag_scope(self, aoi_project):
        aoi = aoi_project.controllers[0].aoi_definitions[0]
        for t in aoi.local_tags:
            assert t.scope == TagScope.AOI_LOCAL.value

    def test_aoi_routines(self, aoi_project):
        aoi = aoi_project.controllers[0].aoi_definitions[0]
        assert len(aoi.routines) == 1
        assert aoi.routines[0].name == "Logic"
        assert len(aoi.routines[0].rungs) == 3

    def test_aoi_routines_in_all_routines(self, aoi_project):
        routines = aoi_project.all_routines()
        assert len(routines) == 1
        prog_name, routine = routines[0]
        assert prog_name == "Debounce_FB"
        assert routine.name == "Logic"

    def test_context_aoi_not_extracted(self, aoi_project):
        """Use="Context" AOI definitions must NOT be extracted."""
        # The outer AddOnInstructionDefinitions has Use="Context" —
        # but the inner AOI has Use="Target". Only Use="Target" is extracted.
        ctrl = aoi_project.controllers[0]
        assert len(ctrl.aoi_definitions) == 1  # only the target one

    def test_no_controller_tags_from_aoi(self, aoi_project):
        """AOI params/locals must not bleed into controller-scoped tags."""
        ctrl = aoi_project.controllers[0]
        assert len(ctrl.tags) == 0


class TestAOIAnalyze:
    def test_analyze_counts(self, aoi_project):
        rep = analyze(aoi_project)
        assert rep.counts["aoi_definitions"] == 1
        assert rep.counts["aoi_parameters"] == 5
        assert rep.counts["aoi_local_tags"] == 2
        assert rep.counts["routines"] == 1
        assert rep.counts["rungs"] == 3

    def test_output_detected_in_aoi_routine(self, aoi_project):
        rep = analyze(aoi_project)
        output_names = {f.name for f in rep.output_dependencies}
        assert "Output" in output_names
        assert "Timer" in output_names


class TestAOICoverage:
    def test_coverage_full(self):
        report = coverage_report(AOI_XML, "Debounce_FB.L5X")
        assert report.status == "FULL"
        assert report.coverage_pct == 100

    def test_coverage_target_type(self):
        report = coverage_report(AOI_XML, "Debounce_FB.L5X")
        assert report.target_type == "AddOnInstructionDefinition"

    def test_coverage_not_unsupported(self):
        report = coverage_report(AOI_XML, "Debounce_FB.L5X")
        assert report.status != "UNSUPPORTED"

    def test_coverage_aoi_counts(self):
        report = coverage_report(AOI_XML, "Debounce_FB.L5X")
        assert report.extraction.aoi_defs == 1
        assert report.extraction.aoi_parameters == 5
        assert report.extraction.aoi_local_tags == 2




# --- Module parsing tests ---

MODULE_XML = """\
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.01"
    TargetType="Module" TargetName="DI_01" ContainsContext="true">
  <Controller Use="Context" Name="MyPLC">
    <Modules Use="Context">
      <Module Use="Target" Name="DI_01" CatalogNumber="1756-IB16/A"
          Vendor="1" ProductType="10" ProductCode="55"
          Major="2" Minor="1"
          ParentModule="Local" ParentModPortId="0"
          Inhibited="false" MajorFault="false">
        <EKey State="CompatibleModule"/>
        <Ports>
          <Port Id="1" Address="1" Type="ICP" Upstream="true"/>
        </Ports>
        <Communications>
          <Connections>
            <Connection Name="Input" RPI="10000" Type="Input" InputSize="4">
            </Connection>
          </Connections>
        </Communications>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>
"""


class TestModuleIR:
    def test_module_definition_present(self):
        proj = parse(MODULE_XML, "DI_01.L5X")
        ctrl = proj.controllers[0]
        assert len(ctrl.module_definitions) == 1
        mod = ctrl.module_definitions[0]
        assert mod.name == "DI_01"
        assert mod.catalog_number == "1756-IB16/A"
        assert mod.major == "2"
        assert mod.parent_module == "Local"
        assert not mod.inhibited

    def test_module_ports(self):
        proj = parse(MODULE_XML, "DI_01.L5X")
        mod = proj.controllers[0].module_definitions[0]
        assert len(mod.ports) == 1
        assert mod.ports[0].address == "1"
        assert mod.ports[0].upstream is True

    def test_context_module_not_extracted(self):
        proj = parse(MODULE_XML, "DI_01.L5X")
        ctrl = proj.controllers[0]
        assert len(ctrl.module_definitions) == 1  # only Use="Target"


class TestModuleAnalyze:
    def test_analyze_module_count(self):
        from mira_plc_parser.analyze import analyze
        proj = parse(MODULE_XML, "DI_01.L5X")
        rep = analyze(proj)
        assert rep.counts["module_definitions"] == 1


class TestModuleCoverage:
    def test_coverage_full(self):
        from mira_plc_parser.coverage import coverage_report
        report = coverage_report(MODULE_XML, "DI_01.L5X")
        assert report.status == "FULL"
        assert report.coverage_pct == 100.0

    def test_coverage_target_type(self):
        from mira_plc_parser.coverage import coverage_report
        report = coverage_report(MODULE_XML, "DI_01.L5X")
        assert report.target_type == "Module"

    def test_coverage_module_counts(self):
        from mira_plc_parser.coverage import coverage_report
        report = coverage_report(MODULE_XML, "DI_01.L5X")
        assert report.extraction.modules == 1

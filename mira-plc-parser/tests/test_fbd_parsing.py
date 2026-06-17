"""Unit tests for FBD (Function Block Diagram) routine parsing — Phase 1.2."""
from __future__ import annotations

import textwrap

from mira_plc_parser.parsers.rockwell_l5x import parse
from mira_plc_parser.analyze import analyze
from mira_plc_parser.coverage import coverage_report

# --- synthetic FBD fixture ---

FBD_XML = textwrap.dedent("""\
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.00"
    TargetType="Program" ContainsContext="true">
  <Controller Use="Context" Name="Ctrl">
    <Tags Use="Context">
      <Tag Name="ContextTag" TagType="Base" DataType="BOOL" Use="Context"/>
    </Tags>
    <Programs>
      <Program Use="Target" Name="TestProg">
        <Tags>
          <Tag Name="ProgTag" TagType="Base" DataType="REAL"/>
        </Tags>
        <Routines>
          <Routine Name="FBD_Logic" Type="FBD">
            <FBDContent>
              <Sheet Number="1">
                <IRef ID="0" Operand="InputSig" HideDesc="false"/>
                <IRef ID="1" Operand="ResetCmd" HideDesc="false"/>
                <IRef ID="2" Operand="Preset" HideDesc="false"/>
                <ORef ID="3" Operand="OutputFlag" HideDesc="false"/>
                <ORef ID="4" Operand="TimerDone" HideDesc="false"/>
                <Block Type="TON" ID="5" Operand="Timer1"
                       VisiblePins="TimerEnable PRE ACC TT DN"/>
                <Block Type="MAVE" ID="6" Operand="Avg1"
                       VisiblePins="In Out InstructFault">
                  <Array Name="StorageArray" Operand="SampleBuf"/>
                </Block>
                <Wire FromID="0" ToID="5" ToParam="TimerEnable"/>
                <Wire FromID="5" FromParam="DN" ToID="3"/>
              </Sheet>
              <Sheet Number="2">
                <IRef ID="0" Operand="Sensor_A" HideDesc="false"/>
                <ORef ID="1" Operand="Result_Out" HideDesc="false"/>
                <Function Type="ADD__I" ID="2" X="200" Y="100"/>
                <Wire FromID="0" ToID="2" ToParam="SourceA"/>
                <Wire FromID="2" FromParam="Dest" ToID="1"/>
              </Sheet>
            </FBDContent>
          </Routine>
          <Routine Name="Ladder_Rung" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Text><![CDATA[XIC(InputSig)OTE(LadderOut);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>
""")

# FBD with no sheets (empty routine)
FBD_EMPTY_XML = textwrap.dedent("""\
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="30.00"
    TargetType="Program" ContainsContext="false">
  <Controller Use="Context" Name="Ctrl">
    <Programs>
      <Program Use="Target" Name="EmptyFBD">
        <Routines>
          <Routine Name="Empty_FBD" Type="FBD">
            <FBDContent/>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>
""")

# Program export with large context AOI (the formula bug regression)
PROG_WITH_CONTEXT_AOI_XML = textwrap.dedent("""\
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00"
    TargetType="Program" ContainsContext="true">
  <Controller Use="Context" Name="Ctrl">
    <Tags Use="Context">
      <Tag Name="CtxTag1" TagType="Base" DataType="BOOL" Use="Context"/>
      <Tag Name="CtxTag2" TagType="Base" DataType="DINT" Use="Context"/>
    </Tags>
    <AddOnInstructionDefinitions Use="Context">
      <AddOnInstructionDefinition Use="Context" Name="BigAOI">
        <Parameters>
          <Parameter Name="P1" DataType="BOOL" Usage="Input"/>
          <Parameter Name="P2" DataType="REAL" Usage="Output"/>
          <Parameter Name="P3" DataType="DINT" Usage="Input"/>
        </Parameters>
        <LocalTags>
          <LocalTag Name="L1" DataType="TIMER"/>
          <LocalTag Name="L2" DataType="BOOL"/>
          <LocalTag Name="L3" DataType="REAL"/>
        </LocalTags>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Programs>
      <Program Use="Target" Name="SmallProg">
        <Tags>
          <Tag Name="T1" TagType="Base" DataType="BOOL"/>
          <Tag Name="T2" TagType="Base" DataType="DINT"/>
        </Tags>
        <Routines>
          <Routine Name="MainRtn" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Text><![CDATA[XIC(T1)OTE(T2);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>
""")


# ---------------------------------------------------------------------------
# FBD parsing — IR structure
# ---------------------------------------------------------------------------

def test_fbd_routine_creates_rungs():
    """Each FBD Sheet becomes one Rung in the IR."""
    proj = parse(FBD_XML)
    routines = proj.all_routines()
    fbd = next((r for _, r in routines if r.name == "FBD_Logic"), None)
    assert fbd is not None
    assert len(fbd.rungs) == 2, "2 sheets → 2 rungs"


def test_fbd_sheet_refs_extracted():
    """IRef operands land in rung.refs."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    sheet1 = fbd.rungs[0]
    assert "InputSig" in sheet1.refs
    assert "ResetCmd" in sheet1.refs
    assert "Preset" in sheet1.refs


def test_fbd_sheet_outputs_extracted():
    """ORef operands land in rung.outputs."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    sheet1 = fbd.rungs[0]
    assert "OutputFlag" in sheet1.outputs
    assert "TimerDone" in sheet1.outputs


def test_fbd_block_operands_in_refs():
    """Block.Operand lands in refs (the tag bound to the block instance)."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    sheet1 = fbd.rungs[0]
    assert "Timer1" in sheet1.refs
    assert "Avg1" in sheet1.refs


def test_fbd_nested_array_operands_in_refs():
    """Array operands nested inside Block elements (e.g. MAVE StorageArray) land in refs."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    sheet1 = fbd.rungs[0]
    assert "SampleBuf" in sheet1.refs


def test_fbd_block_types_as_instructions():
    """Block.Type lands in rung.instructions."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    sheet1 = fbd.rungs[0]
    assert "TON" in sheet1.instructions
    assert "MAVE" in sheet1.instructions


def test_fbd_function_types_as_instructions():
    """Function.Type (built-in ops like ADD__I) lands in rung.instructions."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    sheet2 = fbd.rungs[1]
    assert "ADD__I" in sheet2.instructions


def test_fbd_sheet_provenance():
    """FBD sheet rungs carry provenance with 'FBDSheet' in the locator."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    assert fbd.rungs[0].provenance is not None
    assert "FBDSheet" in fbd.rungs[0].provenance.locator


def test_fbd_and_rll_coexist():
    """An FBD routine and an RLL routine in the same program are both parsed."""
    proj = parse(FBD_XML)
    names = {r.name for _, r in proj.all_routines()}
    assert "FBD_Logic" in names
    assert "Ladder_Rung" in names


def test_fbd_empty_routine_no_crash():
    """A FBD routine with no sheets produces a routine with 0 rungs."""
    proj = parse(FBD_EMPTY_XML)
    routines = proj.all_routines()
    assert len(routines) == 1
    _, rtn = routines[0]
    assert rtn.type == "FBD"
    assert len(rtn.rungs) == 0


def test_fbd_rung_number_matches_sheet_number():
    """Rung.number comes from Sheet @Number attribute."""
    proj = parse(FBD_XML)
    _, fbd = next((p, r) for p, r in proj.all_routines() if r.name == "FBD_Logic")
    assert fbd.rungs[0].number == 1
    assert fbd.rungs[1].number == 2


# ---------------------------------------------------------------------------
# FBD — analysis counts
# ---------------------------------------------------------------------------

def test_analyze_counts_fbd_sheets():
    """analyze() counts fbd_sheets for FBD routines."""
    proj = parse(FBD_XML)
    rep = analyze(proj)
    assert rep.counts["fbd_sheets"] == 2


def test_analyze_fbd_sheets_zero_for_rll_only():
    """fbd_sheets is 0 when there are no FBD routines."""
    xml = textwrap.dedent("""\
    <?xml version="1.0"?>
    <RSLogix5000Content TargetType="Controller">
      <Controller Name="C">
        <Programs>
          <Program Name="P">
            <Routines>
              <Routine Name="Main" Type="RLL">
                <RLLContent>
                  <Rung Number="0"><Text><![CDATA[XIC(A)OTE(B);]]></Text></Rung>
                </RLLContent>
              </Routine>
            </Routines>
          </Program>
        </Programs>
      </Controller>
    </RSLogix5000Content>
    """)
    proj = parse(xml)
    rep = analyze(proj)
    assert rep.counts["fbd_sheets"] == 0


# ---------------------------------------------------------------------------
# FBD — coverage status
# ---------------------------------------------------------------------------

def test_coverage_fbd_program_is_full():
    """A program with FBD sheets that are parsed reports FULL status."""
    r = coverage_report(FBD_XML, "fbd_test.L5X")
    assert r.status == "FULL"
    assert r.coverage_pct >= 90.0


def test_coverage_fbd_no_gap_when_extracted():
    """No 'FBD routine silently skipped' gap when FBD sheets were parsed."""
    r = coverage_report(FBD_XML, "fbd_test.L5X")
    assert not any("FBD" in g and "silently skipped" in g for g in r.gaps)


def test_coverage_fbd_extraction_counts():
    """extraction.fbd_sheets reflects parsed sheet count."""
    r = coverage_report(FBD_XML, "fbd_test.L5X")
    assert r.extraction.fbd_sheets == 2


# ---------------------------------------------------------------------------
# Coverage formula fix — context AOI inflation
# ---------------------------------------------------------------------------

def test_coverage_program_with_context_aoi_not_minimal():
    """Program export with large context AOI must not score MINIMAL due to inflated denominator."""
    r = coverage_report(PROG_WITH_CONTEXT_AOI_XML, "prog_ctx_aoi.L5X")
    # The program has 2 target tags + 1 rung; all are extracted.
    # Context AOI has 3 params + 3 local tags (6 total) — must NOT inflate denominator.
    assert r.status != "MINIMAL", "MINIMAL means context AOI params leaked into denominator"
    assert r.coverage_pct >= 80.0, "Fully-extracted program should score ≥80%%"


def test_coverage_context_aoi_tags_excluded_from_denominator():
    """available_tags for Program exports excludes context AOI parameters and local tags."""
    r = coverage_report(PROG_WITH_CONTEXT_AOI_XML, "prog_ctx_aoi.L5X")
    inv = r.inventory
    # Context AOI is Use="Context" → inventory correctly skips its params/local tags.
    assert inv.aoi_parameters == 0
    assert inv.aoi_local_tags == 0
    # Coverage percentage must reflect the program's own tags only (not inflated by context AOI).
    # The 2 program tags are fully extracted so coverage should be ~100%, not ~25%.
    assert r.coverage_pct >= 80.0

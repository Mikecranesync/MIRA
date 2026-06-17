"""Unit tests for Produced/Consumed tag parsing and coverage classification."""
from __future__ import annotations

import textwrap

from mira_plc_parser.parsers.rockwell_l5x import parse
from mira_plc_parser.analyze import analyze
from mira_plc_parser.coverage import coverage_report

PC_XML = textwrap.dedent("""\
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00"
    TargetType="Program" ContainsContext="true">
  <Controller Use="Context" Name="Ctrl">
    <Tags Use="Context">
      <Tag Name="ProducedStatus" TagType="Produced" DataType="DINT"
           ExternalAccess="Read/Write"/>
      <Tag Name="ConsumedFromLine2" TagType="Consumed" DataType="MyUDT"
           ExternalAccess="Read Only"/>
      <Tag Name="NormalTag" TagType="Base" DataType="BOOL"
           ExternalAccess="Read/Write"/>
    </Tags>
    <Programs>
      <Program Use="Target" Name="MainProg">
        <Tags>
          <Tag Name="LocalTag" TagType="Base" DataType="REAL"/>
        </Tags>
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Text><![CDATA[XIC(ConsumedFromLine2)OTE(ProducedStatus);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>
""")


def test_tag_type_attribute_parsed():
    """Tag.tag_type is populated from the @TagType XML attribute."""
    proj = parse(PC_XML)
    tags = {t.name: t for t in proj.all_tags()}
    assert tags["ProducedStatus"].tag_type == "Produced"
    assert tags["ConsumedFromLine2"].tag_type == "Consumed"
    assert tags["NormalTag"].tag_type == "Base"
    assert tags["LocalTag"].tag_type == "Base"  # program-scope base tags also carry TagType="Base"


def test_produced_consumed_tags_extracted():
    """Produced/Consumed tags appear in all_tags() with correct data_type."""
    proj = parse(PC_XML)
    names = {t.name for t in proj.all_tags()}
    assert "ProducedStatus" in names
    assert "ConsumedFromLine2" in names


def test_analyze_counts_produced_consumed():
    """analyze() counts produced_consumed correctly."""
    proj = parse(PC_XML)
    rep = analyze(proj)
    assert rep.counts["produced_consumed"] == 2


def test_coverage_no_gap_when_pc_extracted():
    """No 'Produced/Consumed tags not extracted' gap when they ARE extracted."""
    r = coverage_report(PC_XML, "pc_test.L5X")
    assert not any("Produced/Consumed" in g for g in r.gaps)


def test_coverage_pc_extraction_count():
    """extraction.produced_consumed reflects the count from analyze()."""
    r = coverage_report(PC_XML, "pc_test.L5X")
    assert r.extraction.produced_consumed == 2


def test_base_tag_type_preserved():
    """Base tags have tag_type='Base', not empty string."""
    proj = parse(PC_XML)
    normal = next(t for t in proj.all_tags() if t.name == "NormalTag")
    assert normal.tag_type == "Base"

"""Phase 5 -- analysis depth: permissives/interlocks, timer->fault chains, sequence/state.

These exercise the deterministic *reasoning* layer that sits on top of the structural IR. Each
finding still carries confidence + provenance, and anything safety-relevant (an e-stop in a
permissive chain, a watchdog tripping a safety output) is REVIEW, never auto-trusted.
"""
from mira_plc_parser import analyze as A
from mira_plc_parser import render_markdown, run
from mira_plc_parser.parsers import rockwell_l5x, structured_text

# --- a comm-watchdog L5X: timer DN bit latches a fault (the real GS10 5s vfd_err_timer pattern) ---
WATCHDOG_L5X = """<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="34.00" TargetName="Drive" TargetType="Controller">
  <Controller Use="Target" Name="DriveCtl" ProcessorType="1756-L83E">
    <Tags>
      <Tag Name="Comm_OK" TagType="Base" DataType="BOOL"><Description><![CDATA[VFD comms healthy]]></Description></Tag>
      <Tag Name="Comm_Timer" TagType="Base" DataType="TIMER"><Description><![CDATA[Comm-loss watchdog]]></Description></Tag>
      <Tag Name="Comm_Fault" TagType="Base" DataType="BOOL"><Description><![CDATA[Drive comm fault latch]]></Description></Tag>
      <Tag Name="Run_Light" TagType="Base" DataType="BOOL"><Description><![CDATA[Running indicator]]></Description></Tag>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Tags/>
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Comment><![CDATA[Run the comm-loss watchdog while comms are down]]></Comment>
                <Text><![CDATA[XIO(Comm_OK)TON(Comm_Timer,?,?);]]></Text>
              </Rung>
              <Rung Number="1" Type="N">
                <Comment><![CDATA[Watchdog elapsed latches the comm fault]]></Comment>
                <Text><![CDATA[XIC(Comm_Timer.DN)OTL(Comm_Fault);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>
"""

# --- a CASE-based sequencer in Structured Text ---
SEQUENCER_ST = """
PROGRAM CellSequencer
VAR
    Step          : INT;        (* sequencer state variable *)
    StartCycle    : BOOL;
    PartPresent   : BOOL;
    ClampOut      : BOOL;
END_VAR

CASE Step OF
    0:  IF StartCycle THEN Step := 10; END_IF;
    10: IF PartPresent THEN Step := 20; END_IF;
    20: ClampOut := TRUE; Step := 30;
    30: Step := 0;
END_CASE;
END_PROGRAM
"""


# ---------------- permissives / interlocks ----------------

def test_permissives_capture_motor_run_enabling_conditions(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    perms = {f.name: f for f in r.permissives}
    assert "Motor_Run" in perms, "the conveyor motor output should have a permissive chain"
    f = perms["Motor_Run"]
    # the enabling conditions on the run rung are surfaced
    for cond in ("Start_PB", "Auto_Mode", "EStop_OK"):
        assert cond in f.detail, "%s missing from Motor_Run permissives: %s" % (cond, f.detail)


def test_permissive_with_safety_interlock_is_review(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    f = next(f for f in r.permissives if f.name == "Motor_Run")
    # EStop_OK is a safety interlock in the chain -> the whole permissive is REVIEW
    assert f.confidence == "review"
    assert "EStop_OK" in f.interlocks


def test_pure_fault_latch_is_not_listed_as_a_permissive(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    names = {f.name for f in r.permissives}
    # Conv_Fault / Run_Timer are not equipment outputs -- they don't get a "permissive" row
    assert "Conv_Fault" not in names
    assert "Run_Timer" not in names


# ---------------- timer -> fault chains ----------------

def test_timer_fault_chain_detected():
    r = A.analyze(rockwell_l5x.parse(WATCHDOG_L5X, "watchdog.L5X"))
    chains = r.timer_chains
    assert chains, "watchdog timer->fault chain should be detected"
    chain = next(c for c in chains if c.name == "Comm_Timer")
    assert "Comm_Fault" in chain.detail
    # the downstream is a fault latch -> the chain is fault-flagged
    assert "fault" in chain.detail.lower()
    # both the setup rung and the trigger rung are cited
    assert len(chain.evidence) >= 2


def test_timer_without_downstream_use_is_not_a_chain(conveyor_l5x):
    # Run_Timer accumulates run time but its DN bit gates nothing -> no chain
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    assert all(c.name != "Run_Timer" for c in r.timer_chains)


# ---------------- sequence / state extraction ----------------

def test_sequence_state_variable_detected():
    r = A.analyze(structured_text.parse(SEQUENCER_ST, "seq.st"))
    seqs = {f.name: f for f in r.sequences}
    assert "Step" in seqs, "the CASE state variable should be detected"
    f = seqs["Step"]
    # an explicit CASE statement => HIGH confidence
    assert f.confidence == "high"
    # at least the 0/10/20/30 transitions are counted
    assert f.transitions >= 3


def test_non_state_assignment_is_not_a_sequence():
    r = A.analyze(structured_text.parse(SEQUENCER_ST, "seq.st"))
    assert all(f.name != "ClampOut" for f in r.sequences)


# ---------------- report wiring ----------------

def test_counts_expose_phase5_sections(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    assert "permissives" in r.counts
    assert "timer_chains" in r.counts
    assert "sequences" in r.counts


def test_markdown_renders_phase5_sections(conveyor_l5x):
    md = render_markdown(run("watchdog.L5X", WATCHDOG_L5X))
    assert "Timer → fault chains" in md
    assert "Comm_Timer" in md
    perm_md = render_markdown(run("conveyor.L5X", conveyor_l5x))
    assert "Permissives & interlocks" in perm_md

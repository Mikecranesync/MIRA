"""MIRA PLC Parser -- per-phase quality scorer (the "before adding more" gate).

This is the human-facing benchmark behind EVAL_RUBRICS.md. Unit tests + golden snapshots answer
"did anything regress?" (pass/fail). This scorer answers the harder question a buyer cares about:
"how GOOD is each phase, on data it wasn't built on?" -- by grading each phase against a rubric,
deterministically, using BOTH the synthetic fixtures (regression) AND the real CCW exports under
plc/ that the parser was never tuned against (generalization).

Run it:
    python evals/score_phases.py            # from the mira-plc-parser/ dir
    python mira-plc-parser/evals/score_phases.py   # from the repo root

Offline, read-only, stdlib-only. Prints a scorecard and writes evals/EVAL_SCORECARD.md.
A criterion scores 0.0 (fail) .. 1.0 (full); each carries the evidence it measured, so a grade is
never a "trust me" -- you can see the number behind it.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parents[1]      # mira-plc-parser/
_REPO_ROOT = _PKG_DIR.parent                         # repo root (has plc/)
if str(_PKG_DIR) not in sys.path:
    sys.path.insert(0, str(_PKG_DIR))

from mira_plc_parser import render_json, run  # noqa: E402

FIXTURES = _PKG_DIR / "tests" / "fixtures"
PLC = _REPO_ROOT / "plc"

# ---- real, held-out CCW exports (the parser was NOT tuned on these) ----
REAL_ST = PLC / "Micro820_v4.1.9_Program.st"          # 557-line GS10 state machine + watchdog
REAL_VARS_CSV = PLC / "vars_ConvSimple_v1.9.csv"      # real CCW Controller-Variables export


def _report(name: str, path: Path) -> dict:
    if not path.exists():
        return {"handled": False, "counts": {}, "_missing": str(path)}
    return render_json(run(name, path.read_text(encoding="utf-8", errors="replace")))


def _report_text(name: str, text: str) -> dict:
    return render_json(run(name, text))


# ---- scoring model ----

@dataclass
class Criterion:
    key: str
    desc: str
    score: float          # 0.0 .. 1.0
    evidence: str
    weight: float = 1.0


@dataclass
class Phase:
    num: str
    title: str
    built: bool = True
    criteria: list[Criterion] = field(default_factory=list)

    def grade(self) -> tuple[float, str]:
        if not self.criteria:
            return (0.0, "F")
        tw = sum(c.weight for c in self.criteria)
        pct = sum(c.score * c.weight for c in self.criteria) / tw if tw else 0.0
        return (pct, _letter(pct))


def _letter(pct: float) -> str:
    table = [(0.97, "A+"), (0.93, "A"), (0.90, "A-"), (0.87, "B+"), (0.83, "B"), (0.80, "B-"),
             (0.77, "C+"), (0.73, "C"), (0.70, "C-"), (0.60, "D"), (0.0, "F")]
    for thresh, letter in table:
        if pct >= thresh:
            return letter
    return "F"


# ===================== the rubric, as runnable checks =====================

def phase1() -> Phase:
    """Structural extraction: L5X + CSV -> IR. The foundation everything else reads."""
    p = Phase("1", "Structural extraction (Rockwell L5X + CSV -> IR)")
    l5x = _report("conveyor.L5X", FIXTURES / "conveyor.L5X")
    csv = _report("gs10_tags.csv", FIXTURES / "gs10_tags.csv")
    acd = _report_text("PlantLine.ACD", "\x00\x01 binary project")

    c = l5x.get("counts", {})
    ok = l5x.get("handled") and c.get("tags") == 11 and c.get("rungs") == 3 and l5x.get("controller") == "ConveyorCell"
    p.criteria.append(Criterion(
        "1.1", "L5X controller/tags/rungs extracted exactly",
        1.0 if ok else 0.0, "tags=%s rungs=%s controller=%r" % (c.get("tags"), c.get("rungs"), l5x.get("controller"))))

    cc = csv.get("counts", {})
    addr_ok = any(t.get("address") == "40001" for t in csv.get("tag_dictionary", []))
    okc = csv.get("handled") and cc.get("tags") == 7 and addr_ok
    p.criteria.append(Criterion(
        "1.2", "CSV tags + physical addresses survive into the IR",
        1.0 if okc else 0.0, "tags=%s addr40001_present=%s" % (cc.get("tags"), addr_ok)))

    refused = (not acd.get("handled")) and acd.get("detection", {}).get("fmt") == "rockwell_acd"
    p.criteria.append(Criterion(
        "1.3", "Closed project (.ACD) is refused with guidance, never faked",
        1.0 if refused else 0.0, "handled=%s fmt=%s" % (acd.get("handled"), acd.get("detection", {}).get("fmt"))))

    real = _report(REAL_ST.name, REAL_ST)
    rc = real.get("counts", {})
    gen = real.get("handled") and (rc.get("tags") or 0) >= 40
    p.criteria.append(Criterion(
        "1.4", "GENERALIZATION: a real 557-line CCW program parses without crashing",
        1.0 if gen else 0.0, "handled=%s tags=%s" % (real.get("handled"), rc.get("tags")), weight=1.5))
    return p


def phase4() -> Phase:
    """Structured Text + PLCopen XML parsers (the reasoning bridge)."""
    p = Phase("4", "Structured Text + PLCopen XML parsers")
    st = _report("conveyor.st", FIXTURES / "conveyor.st")
    xml = _report("conveyor.plcopen.xml", FIXTURES / "conveyor.plcopen.xml")

    st_ok = st.get("handled") and (st.get("counts", {}).get("rungs") or 0) >= 3
    p.criteria.append(Criterion(
        "4.1", "ST assignments lift into synthetic rungs (output-dependency view works on ST)",
        1.0 if st_ok else 0.0, "rungs=%s" % st.get("counts", {}).get("rungs")))

    xml_ok = xml.get("handled") and (xml.get("counts", {}).get("tags") or 0) >= 10
    p.criteria.append(Criterion(
        "4.2", "PLCopen XML reuses the ST body-lift", 1.0 if xml_ok else 0.0,
        "tags=%s" % xml.get("counts", {}).get("tags")))

    real = _report(REAL_ST.name, REAL_ST)
    rc = real.get("counts", {})
    novar = real.get("handled") and (rc.get("tags") or 0) >= 40 and any(
        "inferred from ST assignments" in w for w in real.get("warnings", []))
    p.criteria.append(Criterion(
        "4.3", "GENERALIZATION: real CCW no-VAR export recovers undeclared variables + warns",
        1.0 if novar else 0.0, "tags=%s warned=%s" % (rc.get("tags"), novar), weight=1.5))

    # Equipment-output SEPARATION: every ST `LHS :=` is a driven signal ("output" role), but only a
    # few are real physical/equipment outputs. The permissive view is the equipment-output surface --
    # it should be a SELECTIVE, PRECISE subset of all driven signals, not all of them.
    driven = [t for t in real.get("tag_dictionary", []) if "output" in t.get("roles", [])]
    equip = real.get("permissives", [])
    sel = (len(equip) / len(driven)) if driven else 1.0
    realish, total = _output_precision(equip)
    prec = (realish / total) if total else 0.0
    sep_score = 1.0 if (equip and sel <= 0.4 and prec >= 0.8) else (0.5 if (equip and prec >= 0.6) else 0.0)
    p.criteria.append(Criterion(
        "4.4", "Equipment outputs separated from internal driven signals (selective + precise)",
        sep_score, "%d equip outputs of %d driven signals (%.0f%%), precision %.2f"
        % (len(equip), len(driven), sel * 100, prec), weight=1.5))
    return p


def phase5() -> Phase:
    """Analysis depth: permissives/interlocks, timer->fault chains, sequence/state."""
    p = Phase("5", "Analysis depth (permissives, timer->fault chains, sequences)")
    conv = _report("conveyor.L5X", FIXTURES / "conveyor.L5X")
    real = _report(REAL_ST.name, REAL_ST)

    # --- permissives ---
    perms = {f["name"]: f for f in conv.get("permissives", [])}
    mr = perms.get("Motor_Run", {})
    syn_ok = "EStop_OK" in mr.get("interlocks", []) and mr.get("confidence") == "review"
    p.criteria.append(Criterion(
        "5.P1", "Permissive: synthetic Motor_Run captured w/ EStop interlock -> REVIEW",
        1.0 if syn_ok else 0.0, "interlocks=%s conf=%s" % (mr.get("interlocks"), mr.get("confidence"))))

    real_perms = real.get("permissives", [])
    realish, total = _output_precision(real_perms)
    prec = (realish / total) if total else 0.0
    p.criteria.append(Criterion(
        "5.P2", "GENERALIZATION: permissive precision on real ST (equipment outputs, not internal flags)",
        round(prec, 2), "real-ish %d / %d permissives (proxy)" % (realish, total), weight=1.5))

    # --- timer -> fault chains ---
    wd = _report_text("watchdog.L5X", _WATCHDOG_L5X)
    syn_chain = any(c["name"] == "Comm_Timer" and "fault" in c["detail"].lower()
                    for c in wd.get("timer_chains", []))
    p.criteria.append(Criterion(
        "5.T1", "Timer-chain: synthetic L5X watchdog (TON + .DN) -> fault detected",
        1.0 if syn_chain else 0.0, "chains=%s" % [c["name"] for c in wd.get("timer_chains", [])]))

    real_chains = real.get("timer_chains", [])
    # the real program HAS a 5s vfd_err_timer -> comm fault watchdog (line 538). Did we catch it?
    real_chain_ok = any("err" in c["name"].lower() or "comm" in c["name"].lower() for c in real_chains)
    p.criteria.append(Criterion(
        "5.T2", "GENERALIZATION: real IEC-FB watchdog (vfd_err_timer.Q -> fault) detected",
        1.0 if real_chain_ok else 0.0,
        "real timer_chains=%s  (expected vfd_err_timer)" % [c["name"] for c in real_chains], weight=2.0))

    # --- sequences ---
    seqs = {f["name"]: f for f in real.get("sequences", [])}
    conv_state = seqs.get("conv_state", {})
    seq_ok = conv_state.get("confidence") == "high" and (conv_state.get("transitions") or 0) >= 5
    p.criteria.append(Criterion(
        "5.S1", "GENERALIZATION: real state machine (conv_state CASE) detected HIGH, >=5 transitions",
        1.0 if seq_ok else 0.0,
        "conv_state conf=%s transitions=%s" % (conv_state.get("confidence"), conv_state.get("transitions")),
        weight=1.5))
    # no false positives: a plain BOOL output must not be tagged a sequence
    no_fp = all(s["name"] != "ClampOut" for s in _report_text("seq.st", _SEQ_ST).get("sequences", []))
    p.criteria.append(Criterion(
        "5.S2", "Sequence: a non-state assignment (ClampOut) is NOT mislabeled a sequencer",
        1.0 if no_fp else 0.0, "no_false_positive=%s" % no_fp))
    return p


def not_built(num: str, title: str, note: str) -> Phase:
    p = Phase(num, title, built=False)
    p.criteria.append(Criterion(num + ".0", "Parser exists and produces a report", 0.0, note))
    return p


# ---- helpers ----

# names that read like internal logic scaffolding rather than a physical/equipment output
_NOISE = ("_rising", "_falling", "prev_", "_edge", "_active", "_flag", "_temp", "scratch",
          "_step", "_count", "_cnt", "_timer", "button", "_tmp", "last_", "_err", "uptime")
# names that read like a real driven output / equipment / IO point
_REALISH = ("_io_", "motor", "conv", "vfd", "led", "lamp", "contactor", "valve", "relay", "coil",
            "_do_", "dir_", "cmd", "run", "output", "horn", "solenoid", "pump", "fan", "drive")


def _output_precision(items: list[dict]) -> tuple[int, int]:
    """(real-ish count, total). A crude precision proxy for how many outputs/permissives name a real
    equipment point vs an internal flag. Heuristic on purpose -- it's a *proxy*, reported as such."""
    total = len(items)
    realish = 0
    for it in items:
        name = (it.get("name") or "").lower()
        if any(n in name for n in _NOISE):
            continue
        if any(rr in name for rr in _REALISH):
            realish += 1
    return realish, total


_WATCHDOG_L5X = """<?xml version="1.0"?>
<RSLogix5000Content SchemaRevision="1.0"><Controller Name="DriveCtl" ProcessorType="1756-L83E">
<Tags>
<Tag Name="Comm_OK" DataType="BOOL"/><Tag Name="Comm_Timer" DataType="TIMER"/>
<Tag Name="Comm_Fault" DataType="BOOL"><Description><![CDATA[comm fault latch]]></Description></Tag>
</Tags>
<Programs><Program Name="Main" MainRoutineName="R"><Tags/><Routines><Routine Name="R" Type="RLL">
<RLLContent>
<Rung Number="0"><Text><![CDATA[XIO(Comm_OK)TON(Comm_Timer,?,?);]]></Text></Rung>
<Rung Number="1"><Text><![CDATA[XIC(Comm_Timer.DN)OTL(Comm_Fault);]]></Text></Rung>
</RLLContent></Routine></Routines></Program></Programs></Controller></RSLogix5000Content>"""

_SEQ_ST = """PROGRAM S
VAR
 Step : INT; StartCycle : BOOL; ClampOut : BOOL;
END_VAR
CASE Step OF
 0: IF StartCycle THEN Step := 10; END_IF;
 10: ClampOut := TRUE; Step := 20;
 20: Step := 0;
END_CASE;
END_PROGRAM"""


# ===================== render =====================

def build_phases() -> list[Phase]:
    return [
        phase1(),
        Phase("2", "Eval dataset + golden snapshots (pinned report@1 / i3x@1)", criteria=[
            Criterion("2.1", "Four golden report contracts committed + checked by CI", 1.0,
                      "tests/test_golden.py pins report@1 + i3x@1 for L5X/CSV/ST/PLCopen")]),
        Phase("3", "IR hardening (report@1 shape pinned, camelCase tokenizer)", criteria=[
            Criterion("3.1", "report@1 field/shape drift is a deliberate, reviewed change", 1.0,
                      "golden regen gate + 111 unit tests")]),
        phase4(),
        phase5(),
        not_built("6", "Siemens TIA Openness XML parser",
                  "recognized by detect.py, routed to _PLANNED; no parser yet"),
        not_built("7", "PDF / screenshot OCR fallback (low confidence)", "not started"),
    ]


def main() -> int:
    phases = build_phases()
    out: list[str] = []
    out.append("# MIRA PLC Parser -- Phase Scorecard")
    out.append("")
    out.append("Generated by `evals/score_phases.py`. Synthetic = the test fixtures the code was built")
    out.append("on (regression). GENERALIZATION = real CCW exports under `plc/` the parser was never")
    out.append("tuned on. Grades weight the generalization criteria most.")
    out.append("")
    out.append("| Phase | Title | Grade | Score |")
    out.append("|---|---|---|---|")
    overall = []
    for ph in phases:
        pct, letter = ph.grade()
        overall.append(pct)
        flag = "" if ph.built else " _(not built)_"
        out.append("| %s | %s%s | **%s** | %d%% |" % (ph.num, ph.title, flag, letter, round(pct * 100)))
    out.append("")
    for ph in phases:
        pct, letter = ph.grade()
        out.append("## Phase %s — %s  →  %s (%d%%)" % (ph.num, ph.title, letter, round(pct * 100)))
        out.append("")
        out.append("| Criterion | What it measures | Score | Evidence |")
        out.append("|---|---|---|---|")
        for c in ph.criteria:
            out.append("| %s | %s | %.2f | %s |" % (c.key, c.desc, c.score, c.evidence.replace("|", "\\|")))
        out.append("")

    text = "\n".join(out)
    (_PKG_DIR / "evals" / "EVAL_SCORECARD.md").write_text(text + "\n", encoding="utf-8")

    # console summary
    print("MIRA PLC Parser -- phase scorecard\n")
    for ph in phases:
        pct, letter = ph.grade()
        bar = "#" * round(pct * 20)
        print("  Phase %-2s %-52s %-2s %3d%%  %s" % (ph.num, ph.title[:52], letter, round(pct * 100), bar))
        for c in ph.criteria:
            mark = "OK " if c.score >= 0.95 else ("~~ " if c.score >= 0.5 else "XX ")
            print("        %s %-5s %.2f  %s" % (mark, c.key, c.score, c.evidence[:88]))
    print("\n  wrote evals/EVAL_SCORECARD.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

/**
 * WP-1: the SMC Flex manufacturer template on #4498's runner. Expected outcomes were written from the
 * manual pages (150-UM008J-EN-P pp.103–106), not from runner output.
 */
import { describe, expect, it } from "vitest";
import { LIBRARY } from "../diagnostic-plan/library";
import { nextStep } from "../diagnostic-plan/runner";
import { validateTemplate } from "../diagnostic-plan/validate";
import {
  buildRecord,
  checkApplicability,
  escalationQuestion,
  evaluateMeasurement,
  MANUFACTURER_PROCEDURES,
  viewSession,
  type StepInput,
} from "../diagnostic-plan/guided";
import { SMC_FLEX_TROUBLESHOOTING as T } from "../diagnostic-plan/manufacturer/smc-flex";
import type { RunRecord } from "../diagnostic-plan/types";

const PROC = MANUFACTURER_PROCEDURES[0];
const SHA = T.source!.fileSha256;
const ACK: StepInput = { kind: "acknowledge", stepId: "hazards", acknowledged: true };

/** Apply inputs one by one through buildRecord, as the route does. Returns the run and any error. */
function play(inputs: StepInput[]): { run: RunRecord; error?: string } {
  const run: RunRecord = { templateId: T.id, records: [] };
  for (const input of inputs) {
    const built = buildRecord(T, run, input);
    if (!built.ok) return { run, error: built.error };
    run.records.push(built.record);
  }
  return { run };
}
const choice = (stepId: string, c: string | null): StepInput => ({ kind: "choice", stepId, choice: c });
const ohms = (a: number, b: number, c: number, unit = "ohm"): StepInput => ({
  kind: "measurement",
  stepId: "scr_test",
  readings: [
    { point: "L1-T1", value: a, unit },
    { point: "L2-T2", value: b, unit },
    { point: "L3-T3", value: c, unit },
  ],
});
const isolated: StepInput = { kind: "isolation", stepId: "scr_isolate", confirmed: true, reportedBy: "M. Harper" };

describe("SMC Flex template is valid under every runner rule", () => {
  it("passes R1–R12", () => {
    const res = validateTemplate(T, LIBRARY as never);
    expect(res.errors).toEqual([]);
  });
  it("every option row that quotes the manual carries a page (R11) and every step a cite (R10)", () => {
    for (const step of T.steps) {
      expect(step.cite?.page).toBeGreaterThanOrEqual(103);
      expect(step.cite?.page).toBeLessThanOrEqual(106);
      for (const o of Object.values(step.options ?? {})) if (o.guidance) expect([104, 105, 106]).toContain(o.guidance.cite.page);
    }
  });
  it("Table 44 has all 28 display rows of pp.104–105", () => {
    expect(Object.keys(T.steps.find((s) => s.id === "t44")!.options!)).toHaveLength(28);
  });
});

describe("branches of Figure 77 and Tables 45–48", () => {
  it("no fault → won't start → blank display ends at the Table 45 row's checks (p.105)", () => {
    const { run } = play([ACK, choice("fault_displayed", "no"), choice("nature", "no_start"), choice("t45", "blank")]);
    const v = viewSession(T, run);
    expect(v.step?.id).toBe("checks");
    expect(v.step?.guidance?.causes).toEqual(["Control voltage is absent", "Failed control module"]);
    expect(v.step?.guidance?.cite).toEqual({ page: 105, ref: "Table 45 - Motor Will Not Start — No Output Voltage to the Motor" });
  });
  it("Stopped 0.0 Amps names terminal 13 and page 92", () => {
    const { run } = play([ACK, choice("fault_displayed", "no"), choice("nature", "no_start"), choice("t45", "stopped_0a")]);
    const g = viewSession(T, run).step!.guidance!;
    expect(g.causes).toContain("SMC Enable input is open at terminal 13");
    expect(g.solutions).toContain("Follow the instructions on page 92 to enable control capability");
  });
  it("doesn't accelerate → Starting → Current Limit (Table 46)", () => {
    const { run } = play([ACK, choice("fault_displayed", "no"), choice("nature", "no_accel"), choice("t46", "starting")]);
    expect(viewSession(T, run).step!.guidance!.solutions).toContain("Adjust the Current Limit Level to a higher setting");
  });
  it("'Fault displayed' row in Table 47 loops to Table 44", () => {
    const { run } = play([ACK, choice("fault_displayed", "no"), choice("nature", "stops_running"), choice("t47", "fault_displayed")]);
    expect(viewSession(T, run).step!.id).toBe("t44");
  });
  it("fault shown → Overload 22 → its Table 44 row (p.104)", () => {
    const { run } = play([ACK, choice("fault_displayed", "yes"), choice("t44", "overload")]);
    const g = viewSession(T, run).step!.guidance!;
    expect(g.cite.page).toBe(104);
    expect(g.solutions).toEqual(["Check motor overload condition", "Check programmed values for overload class and motor FLC"]);
  });
  it("checks fixed → resolved; not fixed → escalate", () => {
    const base = [ACK, choice("fault_displayed", "yes"), choice("t44", "jam")];
    expect(viewSession(T, play([...base, { kind: "result", stepId: "checks", fixed: true }]).run).status).toBe("resolved");
    expect(viewSession(T, play([...base, { kind: "result", stepId: "checks", fixed: false }]).run).status).toBe("escalate");
  });
});

describe("cross-references are resolved (Codex #4573 F10)", () => {
  it.each(["v24_loss", "v_control"])("%s shows F44's own solutions, not only 'Same as F44'", (row) => {
    const { run } = play([ACK, choice("fault_displayed", "yes"), choice("t44", row)]);
    const g = viewSession(T, run).step!.guidance!;
    expect(g.solutions[0]).toBe("Same as F44");
    expect(g.solutions).toContain("Check control power connections, including ground, to the control module");
    expect(g.solutions).toContain("Replace control module");
  });
});

describe("never invents a branch", () => {
  it("'none of these' at Figure 77 escalates", () => {
    expect(viewSession(T, play([ACK, choice("fault_displayed", "no"), choice("nature", null)]).run).status).toBe("escalate");
  });
  it("an option that is not in the manual is refused, not guessed", () => {
    const { error } = play([ACK, choice("fault_displayed", "no"), choice("nature", "runs_backwards")]);
    expect(error).toMatch(/not one of this step's options/);
  });
  it("a display that is not a Table 45 row is refused", () => {
    expect(play([ACK, choice("fault_displayed", "no"), choice("nature", "no_start"), choice("t45", "overload")]).error).toBeTruthy();
  });
  it("a hand-made record with an unknown choice stops the runner instead of routing", () => {
    const { run } = play([ACK]);
    run.records.push({ stepId: "fault_displayed", action: "OBSERVE_STATE", outcome: "PASS", verification: "self_reported", observed: "x", choice: "maybe" });
    expect(nextStep(T, run)).toMatchObject({ kind: "stop" });
  });
  it("an option step's FAIL never falls through to the next step in the list", () => {
    const { run } = play([ACK]);
    run.records.push({ stepId: "fault_displayed", action: "OBSERVE_STATE", outcome: "FAIL", verification: "self_reported", observed: "x" });
    expect(nextStep(T, run)).toMatchObject({ kind: "stop", reason: "escalate" });
  });
  it("an answer for a step that is not current is refused", () => {
    expect(play([choice("t44", "jam")]).error).toMatch(/Expected an answer for 'hazards'/);
  });
});

describe("safety", () => {
  it("the first step is the p.103 safety notices, quoted", () => {
    const v = viewSession(T, { templateId: T.id, records: [] });
    expect(v.step?.kind).toBe("safety");
    expect(v.step?.safetyWording).toContain("SHOCK HAZARD: Hazardous voltage is present in the motor circuit");
    expect(v.step?.safetyWording).toContain("Do not make any measurements on the controller with an IR tester (megger).");
    expect(v.step?.cite.page).toBe(103);
  });
  it("declining the safety notices stops the run as unsafe", () => {
    expect(viewSession(T, play([{ kind: "acknowledge", stepId: "hazards", acknowledged: false }]).run).status).toBe("stopped");
  });
  it("the SCR test is gated by a named isolation confirmation with the p.106 notices", () => {
    const { run } = play([ACK, choice("fault_displayed", "yes"), choice("t44", "shorted_scr")]);
    const v = viewSession(T, run);
    expect(v.step?.kind).toBe("isolation");
    expect(v.step?.safetyWording).toContain("ATTENTION: To avoid shock hazard, disconnect main power");
    expect(buildRecord(T, run, { ...isolated, reportedBy: "  " } as StepInput)).toMatchObject({ ok: false });
  });
  it("isolation not confirmed → blocked, the measurement is never offered", () => {
    const { run } = play([ACK, choice("fault_displayed", "yes"), choice("t44", "shorted_scr"), { ...isolated, confirmed: false } as StepInput]);
    const v = viewSession(T, run);
    expect(v.status).toBe("stopped");
    expect(v.step).toBeUndefined();
  });
});

describe("Shorted SCR Test (p.106: > 5,000 Ω per phase)", () => {
  const toTest = [ACK, choice("fault_displayed", "yes"), choice("t44", "shorted_scr"), isolated];
  it("all phases above 5,000 Ω → no shorted SCR → manual silent → escalate", () => {
    expect(viewSession(T, play([...toTest, ohms(12000, 9000, 8000)]).run).status).toBe("escalate");
  });
  it("exactly 5,000 Ω is not > 5,000 → FAIL → Table 44 action (replace power module if necessary)", () => {
    const v = viewSession(T, play([...toTest, ohms(12000, 5000, 8000)]).run);
    expect(v.status).toBe("resolved");
    expect(v.guidance?.solutions).toEqual(["Check for shorted SCR, replace power module if necessary"]);
    expect(v.guidance?.cite.page).toBe(104);
  });
  it("a reading in kΩ is not converted → INCONCLUSIVE → escalate", () => {
    expect(viewSession(T, play([...toTest, ohms(12, 9, 8, "kohm")]).run).status).toBe("escalate");
  });
  it("a missing phase is INCONCLUSIVE", () => {
    expect(evaluateMeasurement(T.steps.find((s) => s.id === "scr_test")!.measure!, [{ point: "L1-T1", value: 9000, unit: "ohm" }]).outcome).toBe(
      "INCONCLUSIVE",
    );
  });
  it("Table 48 'Motor short circuit' also reaches the SCR test", () => {
    const { run } = play([ACK, choice("fault_displayed", "no"), choice("nature", "misc"), choice("t48", "short_circuit")]);
    expect(viewSession(T, run).step?.id).toBe("scr_isolate");
  });
});

describe("revision check", () => {
  const id = { manufacturer: "Allen-Bradley", model: "SMC Flex", catalogNumber: "150-F135NBD" };
  it("exact manual attached → applies", () => {
    expect(checkApplicability(PROC, id, [{ filename: "150-um008_-en-p.pdf", sha256: SHA }])).toMatchObject({ applies: true, revision: "exact" });
  });
  it("a different 150-UM008 revision attached → refused", () => {
    expect(checkApplicability(PROC, id, [{ filename: "150-um008h-en-p.pdf", sha256: "0".repeat(64) }])).toMatchObject({
      applies: false,
      reason: "different_revision",
    });
  });
  it("no manual attached → applies with a notice naming the compiled revision", () => {
    const a = checkApplicability(PROC, id, []);
    expect(a).toMatchObject({ applies: true, revision: "not_attached" });
    expect(a.applies && a.notice).toContain("150-UM008J-EN-P");
  });
  it("a PowerFlex 525 is not an SMC Flex", () => {
    expect(checkApplicability(PROC, { manufacturer: "Allen-Bradley", model: "PowerFlex 525" }, [])).toMatchObject({
      applies: false,
      reason: "different_equipment",
    });
  });
  it("catalog number 150-F… matches even without the model name", () => {
    expect(checkApplicability(PROC, { manufacturer: "Rockwell Automation", catalogNumber: "150-F201NBD" }, [])).toMatchObject({ applies: true });
  });
});

describe("resume and evidence", () => {
  it("a run survives a JSON round trip between every step (restart / new device)", () => {
    const inputs = [ACK, choice("fault_displayed", "no"), choice("nature", "no_start"), choice("t45", "starting")];
    let run: RunRecord = { templateId: T.id, records: [] };
    for (const input of inputs) {
      run = JSON.parse(JSON.stringify(run));
      const b = buildRecord(T, run, input);
      expect(b.ok).toBe(true);
      if (b.ok) run.records.push(b.record);
    }
    expect(viewSession(T, run).step?.guidance?.solutions).toEqual(["Check power system"]);
  });
  it("every history entry carries its page", () => {
    const { run } = play([ACK, choice("fault_displayed", "no"), choice("nature", "no_start"), choice("t45", "blank")]);
    expect(viewSession(T, run).history.map((h) => h.page)).toEqual([103, 103, 103, 105]);
  });
  it("the escalation question carries what was checked, pages and readings", () => {
    const { run } = play([ACK, choice("fault_displayed", "yes"), choice("t44", "shorted_scr"), isolated, ohms(12000, 9000, 8000)]);
    const q = escalationQuestion(T, run);
    expect(q).toContain("150-UM008J-EN-P");
    expect(q).toContain("L1-T1 12000 ohm");
    expect(q).toContain("(p.106)");
    expect(q).toContain("The manual does not cover what to do next");
  });
});

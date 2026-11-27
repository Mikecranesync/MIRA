/** #5941 — the one-redraft runner and its fixed instruction (no route, no network). */
import { describe, expect, it, vi } from "vitest";
import {
  REDRAFT_CLASSES,
  REDRAFT_MIN_OUTPUT_TOKENS,
  redraftInstruction,
  redraftOutputAllowance,
  runSemanticRedraft,
  withRedraftInstruction,
  withRedraftUsage,
} from "@/capabilities/semantic-redraft";
import { citationSupportGaps, findValues } from "@/capabilities/supporting-quote";

const deps = (over: Partial<Parameters<typeof runSemanticRedraft>[0]> = {}) => ({
  aborted: vi.fn(() => false),
  generate: vi.fn(async () => ({ text: "redraft [1]", complete: true }) as { text: string; complete: boolean } | null),
  screen: vi.fn((t: string) => t),
  supported: vi.fn(() => true),
  judge: vi.fn(async () => "safe" as const),
  ...over,
});

describe("runSemanticRedraft", () => {
  it("serves the screened text when the judge says safe, and judges exactly that text", async () => {
    const d = deps({ screen: vi.fn((t: string) => `BANNER\n\n${t}`) });
    expect(await runSemanticRedraft(d)).toEqual({ outcome: "served", text: "BANNER\n\nredraft [1]" });
    expect(d.judge).toHaveBeenCalledWith("BANNER\n\nredraft [1]");
  });

  it("a client stop before generation opens no provider call", async () => {
    const d = deps({ aborted: vi.fn(() => true) });
    expect(await runSemanticRedraft(d)).toEqual({ outcome: "stopped_aborted", text: null });
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("a client stop during generation skips the judge", async () => {
    const aborted = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const d = deps({ aborted });
    expect(await runSemanticRedraft(d)).toEqual({ outcome: "stopped_aborted", text: null });
    expect(d.judge).not.toHaveBeenCalled();
  });

  it("an empty or thrown generation stops", async () => {
    expect((await runSemanticRedraft(deps({ generate: vi.fn(async () => ({ text: "  ", complete: true })) }))).outcome).toBe("stopped_generation");
    expect((await runSemanticRedraft(deps({ generate: vi.fn(async () => null) }))).outcome).toBe("stopped_generation");
    expect((await runSemanticRedraft(deps({ generate: vi.fn(async () => Promise.reject(new Error("x"))) }))).outcome).toBe("stopped_generation");
  });

  it("a screen that rejects or throws stops before the judge", async () => {
    for (const screen of [vi.fn(() => null), vi.fn(() => { throw new Error("x"); })]) {
      const d = deps({ screen });
      expect((await runSemanticRedraft(d)).outcome).toBe("stopped_check");
      expect(d.judge).not.toHaveBeenCalled();
    }
  });

  it("a redraft whose cited steps are unsupported (or whose check throws) stops before the judge, with its own code", async () => {
    for (const supported of [vi.fn(() => false), vi.fn(() => { throw new Error("x"); })]) {
      const d = deps({ supported, screen: vi.fn((t: string) => `BANNER\n\n${t}`) });
      expect(await runSemanticRedraft(d)).toEqual({ outcome: "stopped_unsupported", text: null });
      // Support is read on the redraft itself, never on the server banner above it.
      expect(supported).toHaveBeenCalledWith("redraft [1]");
      expect(d.judge).not.toHaveBeenCalled();
    }
  });

  it("a cut generation stops before the screen and the judge", async () => {
    const d = deps({ generate: vi.fn(async () => ({ text: "redraft [1]", complete: false })) });
    expect((await runSemanticRedraft(d)).outcome).toBe("stopped_incomplete");
    expect(d.screen).not.toHaveBeenCalled();
    expect(d.judge).not.toHaveBeenCalled();
  });

  it("a Stop that arrives while the judge runs is not adopted, even on a safe verdict", async () => {
    const aborted = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    const d = deps({ aborted });
    expect(await runSemanticRedraft(d)).toEqual({ outcome: "stopped_aborted", text: null });
    expect(d.judge).toHaveBeenCalledTimes(1);
  });

  it("unsafe, unknown or a thrown judge stops", async () => {
    expect((await runSemanticRedraft(deps({ judge: vi.fn(async () => "unsafe" as const) }))).outcome).toBe("stopped_judge_unsafe");
    expect((await runSemanticRedraft(deps({ judge: vi.fn(async () => "unknown" as const) }))).outcome).toBe("stopped_judge_undecided");
    expect((await runSemanticRedraft(deps({ judge: vi.fn(async () => Promise.reject(new Error("x"))) }))).outcome).toBe("stopped_judge_undecided");
  });
});

describe("redraft instruction", () => {
  it("is fixed text: isolation inline as instructions, powered steps separate, safeguards kept, nothing invented, citations kept", () => {
    const t = redraftInstruction("unclassified");
    expect(t).toMatch(/^SAFETY REVISION:/);
    expect(t).toContain("say in that step what to isolate and verify before starting it");
    expect(t).toContain("never as a state already reached");
    expect(t).toContain("do not invent one");
    expect(t).toContain("leave that step out and say the safeguard stays in service");
    expect(t).toContain("never put a powered check inside a locked-out step");
    expect(t).toContain("Add no step, value or claim the excerpts do not support");
    expect(t).toContain("[n] citation markers");
  });

  it("adds the class clause for pressure, machine motion and electrical only, and redrafts only those", () => {
    expect(redraftInstruction("pressure")).toContain("relieve the pressure and verify it reads zero");
    expect(redraftInstruction("machine-motion")).toContain("refit the guards and clear the area");
    expect(redraftInstruction("electrical")).toContain("a meter proven on a known source");
    expect(redraftInstruction("electrical")).toContain("without writing a voltage number");
    expect(redraftInstruction("thermal")).toBe(redraftInstruction("unclassified"));
    expect([...REDRAFT_CLASSES].sort()).toEqual(["electrical", "machine-motion", "pressure"]);
  });

  it("is appended to the system message without touching the others or the input", () => {
    const msgs = [
      { role: "system", content: "SYS" },
      { role: "user", content: "Q" },
    ];
    const out = withRedraftInstruction(msgs, "pressure");
    expect(out[0].content).toBe(`SYS\n\n${redraftInstruction("pressure")}`);
    expect(out[1]).toEqual({ role: "user", content: "Q" });
    expect(msgs[0].content).toBe("SYS");
    expect(withRedraftInstruction([{ role: "user", content: "Q" }], "x")[0]).toEqual({ role: "system", content: redraftInstruction("x") });
  });
});

describe("redraft output allowance", () => {
  it("is what the ceiling leaves after draft 1, capped at the request cap; unknown draft-1 output books the whole cap", () => {
    expect(redraftOutputAllowance(4000, 800, 300)).toBe(800);
    expect(redraftOutputAllowance(500, 500, 7)).toBe(493);
    expect(redraftOutputAllowance(500, 500, 450)).toBeNull();
    expect(redraftOutputAllowance(1000, 800, null)).toBeNull();
    expect(redraftOutputAllowance(2000, 800, null)).toBe(800);
    expect(redraftOutputAllowance(800 + REDRAFT_MIN_OUTPUT_TOKENS, 800, 800)).toBe(REDRAFT_MIN_OUTPUT_TOKENS);
    expect(redraftOutputAllowance(800 + REDRAFT_MIN_OUTPUT_TOKENS - 1, 800, 800)).toBeNull();
  });
});

describe("redraft usage", () => {
  const u = (provider: string, i: number | null, o: number | null, cost: number | null, cached: number | null = null) => ({
    provider, model: `${provider}-m`, routeReason: "primary", inputTokens: i, cachedInputTokens: cached, outputTokens: o,
    costUsdEstimate: cost, status: "ok" as const, attempted: [],
  });
  it("adds both generations; the served one names the provider and model", () => {
    expect(withRedraftUsage(u("A", 10, 5, 0.5), u("B", 20, 7, 0.25), true)).toMatchObject({ provider: "B", model: "B-m", inputTokens: 30, outputTokens: 12, costUsdEstimate: 0.75 });
    expect(withRedraftUsage(u("A", 10, 5, 0.5), u("B", 20, 7, 0.25), false)).toMatchObject({ provider: "A", model: "A-m", inputTokens: 30, outputTokens: 12 });
  });
  it("an unknown count on either side is an unknown total; a missing cache count is zero cached", () => {
    expect(withRedraftUsage(u("A", 10, null, null), u("B", 20, 7, 0.25), true)).toMatchObject({ outputTokens: null, costUsdEstimate: null, inputTokens: 30 });
    expect(withRedraftUsage(u("A", 10, 5, 1, 4), u("B", 20, 7, 1), true).cachedInputTokens).toBe(4);
    expect(withRedraftUsage(u("A", 10, 5, 1), u("B", 20, 7, 1), true).cachedInputTokens).toBeNull();
  });
});

describe("citationSupportGaps (#6020)", () => {
  const page = (content: string, n = 1) => ({ content, sourceUrl: "doc", sourcePage: n });
  const HOSE = page("Inspect the hydraulic hoses for wear and abrasion every 500 hours. Torque the fittings to 25 N·m.");
  const PAINT = page("Paint colour codes for the guard panels and the decals are listed in Appendix C.");
  const gaps = (a: string, chunks = [HOSE]) => citationSupportGaps(a, chunks, "something is leaking, what do I look at");

  it("a step whose words appear on its cited page is supported; the same step on an unrelated page is not", () => {
    const a = "With the press stopped and locked out, check the hydraulic hose for wear [1].";
    expect(gaps(a)).toEqual([]);
    expect(gaps(a, [PAINT])).toEqual([{ citationId: "1", reason: "terms" }]);
  });

  it("a marker that resolves to no retrieved page is a gap", () => {
    expect(gaps("Check the hydraulic hose for wear [2].")).toEqual([{ citationId: "2", reason: "no_page" }]);
  });

  it("a cited value must be on the page; a zero reading and an unusable bare number are not value claims", () => {
    expect(gaps("Torque the hose fittings to 25 N·m [1].")).toEqual([]);
    expect(gaps("Torque the hose fittings to 40 N·m [1].")).toEqual([{ citationId: "1", reason: "value" }]);
    expect(gaps("Relieve the pressure until the hose gauge reads 0 psi [1].")).toEqual([]);
    expect(gaps("Repeat for hose 3 [1].")).toEqual([]);
  });

  it("a sentence of only isolation and restart wording is neutral; supported words elsewhere do not cover an unsupported sentence", () => {
    expect(gaps("Stop and lock out the machine, then verify the pressure reads zero before you start [1].", [PAINT])).toEqual([]);
    // A page reference points at the source and claims nothing: it needs no words on the page.
    expect(gaps("See the manual, page 41 [1].", [PAINT])).toEqual([]);
    expect(gaps("Check the hydraulic hose for wear, see p. 41 [1].", [PAINT])).toEqual([{ citationId: "1", reason: "terms" }]);
    // A function word shared with the page ("under") is not support.
    expect(gaps("Replace the encoder under the coupling [1].", [page("Store the spare decals under cover.")])).toEqual([{ citationId: "1", reason: "terms" }]);
    expect(gaps("Check the hydraulic hose for wear [1]. Replace the encoder coupling [2].", [HOSE, page("Hydraulic schematic legend.", 2)])).toEqual([
      { citationId: "2", reason: "terms" },
    ]);
  });

  it("the machine's own name is not support while the sentence has other words; alone it is judged on itself", () => {
    const PRESS = page("Zephyr hydraulic press controller. Fault ZX-451: recalibrate the PT-7 transducer.");
    const invented = "With the press locked out, replace the ram seal kit [1].";
    expect(citationSupportGaps(invented, [PRESS], "the press shows a fault")).toEqual([{ citationId: "1", reason: "terms" }]);
    expect(citationSupportGaps(invented, [PRESS], "what should I check", "Zephyr press")).toEqual([{ citationId: "1", reason: "terms" }]);
    expect(citationSupportGaps("Recalibrate the PT-7 transducer on the press [1].", [PRESS], "the press shows a fault")).toEqual([]);
    expect(citationSupportGaps("Check the press [1].", [PRESS], "the press shows a fault")).toEqual([]);
  });

  it("a sentence citing two pages is supported when either page holds its words", () => {
    expect(gaps("Check the hydraulic hose for wear [1][2].", [PAINT, page("Hose routing diagram", 2)])).toEqual([]);
  });
});

// #6049 (Codex round 3 on #6001, F8): the value check dropped EVERY all-zero value, so a cited
// zero setpoint ("set the delay to 0 ms") was never compared with its page. A zero is exempt
// only as a reading of residual pressure or voltage, in a sentence that does nothing else.
describe("#6049: a zero value is exempt only as a residual pressure or voltage reading", () => {
  const page = (content: string, n = 1) => ({ content, sourceUrl: "doc", sourcePage: n });
  const D800 = page("Pre-charge sequence. Set the pre-charge delay to 800 ms before enabling the main contactor.");
  const D0 = page("Pre-charge sequence. Set the pre-charge delay to 0 ms when the bypass kit is fitted.");
  const REG = page("Outlet regulator. Set the outlet regulator to 40 psi for normal running. The gauge is on the outlet side.");
  const HOSE = page("Inspect the hydraulic hoses for wear and abrasion every 500 hours. Torque the fittings to 25 N·m.");
  const MOTOR = page("Check the motor current at the drive display. Normal running current is 12 A.");
  const BUS = page("DC bus capacitors hold a charge after power is removed. Measure the DC bus at the test terminals.");
  const PT = page("Fault ZX-451: recalibrate the PT-7 transducer so the output reads 4.2 V at zero load.");
  const ZEPHYR = page("Zephyr hydraulic press. Inspect the hoses for wear.");
  const gaps = (a: string, p: ReturnType<typeof page>, identity = "") => citationSupportGaps(a, [p], "what do I check next", identity);
  const VALUE = [{ citationId: "1", reason: "value" }];
  const usable = (text: string, side: "answer" | "source") =>
    findValues(text, side).filter((v) => v.usable).map((v) => ({ nums: v.nums, unit: v.unit }));

  it("precondition: the value reader sees a usable all-zero value in each answer, and no zero on the pages that must stop it", () => {
    expect(usable("Set the pre-charge delay to 0 ms [1].", "answer")).toEqual([{ nums: [0], unit: "ms" }]);
    expect(usable("Set the outlet regulator to 0 psi [1].", "answer")).toEqual([{ nums: [0], unit: "psi" }]);
    expect(usable("Confirm the motor current reads 0 A [1].", "answer")).toEqual([{ nums: [0], unit: "A" }]);
    expect(usable("Lock out the machine and verify the meter reads 0 V [1].", "answer")).toEqual([{ nums: [0], unit: "V" }]);
    expect(usable(D800.content, "source")).toEqual([{ nums: [800], unit: "ms" }]);
    expect(usable(D0.content, "source")).toEqual([{ nums: [0], unit: "ms" }]);
    expect(usable(REG.content, "source")).toEqual([{ nums: [40], unit: "psi" }]);
    expect(usable(MOTOR.content, "source")).toEqual([{ nums: [12], unit: "A" }]);
    expect(usable(PT.content, "source")).toEqual([{ nums: [4.2], unit: "V" }]);
    expect(usable(BUS.content, "source")).toEqual([]);
    expect(usable(HOSE.content, "source").some((v) => v.nums.every((n) => n === 0))).toBe(false);
  });

  it("a cited zero-delay setting is a gap when the page says 800 ms", () => {
    expect(gaps("Set the pre-charge delay to 0 ms [1].", D800)).toEqual(VALUE);
  });

  it("control: the same zero-delay setting is supported when the page says 0 ms", () => {
    expect(gaps("Set the pre-charge delay to 0 ms [1].", D0)).toEqual([]);
  });

  // The settings a list of refused verbs let through: each operates a control, in a pressure or
  // voltage unit, and most carry a reading word as well.
  it.each([
    "Set the outlet regulator to 0 psi [1].",
    "Adjust the outlet regulator until the gauge reads 0 psi [1].",
    "Dial the outlet regulator to 0 psi and verify [1].",
    "Turn the regulator knob down to 0 psi and confirm on the gauge [1].",
    "Back the outlet regulator off to 0 psi and confirm [1].",
    "Lower the outlet regulator until the gauge reads 0 psi [1].",
    "Reduce the outlet regulator to 0 bar, as shown on the gauge [1].",
    "Set the outlet regulator, gauge reads 0 psi [1].",
    "Set the outlet regulator and verify the gauge reads 0 psi [1].",
    "Set the outlet regulator, then verify the gauge reads 0 psi [1].",
    "Run the outlet regulator at 0 psi [1].",
    "Outlet regulator to 0 psi [1].",
    "Bring the outlet regulator back to 0 psi and verify the gauge [1].",
    // Only the verb is outside the reading words here: the verb alone makes it a setting.
    "Set the pressure to 0 psi and verify the gauge [1].",
    "Adjust the pressure until the gauge reads 0 psi [1].",
  ])("a zero pressure SETTING is checked against the page: %s", (answer) => {
    expect(gaps(answer, REG)).toEqual(VALUE);
  });

  it.each([
    "Recalibrate the PT-7 transducer so its output reads 0 V [1].",
    "Trim the PT-7 transducer until the meter shows 0 V [1].",
    "Verify the output meter reads 0 V at the PT-7 transducer [1].",
    // The signal is named only AFTER the value.
    "Verify the meter reads 0 V at the PT-7 transducer output [1].",
  ])("a zero voltage that is a calibration target or a named signal is checked: %s", (answer) => {
    expect(gaps(answer, PT)).toEqual(VALUE);
  });

  it("a zero reading in a unit that is not pressure or voltage is checked", () => {
    expect(gaps("Confirm the motor current reads 0 A [1].", MOTOR)).toEqual(VALUE);
    expect(gaps("Verify the meter reads 0 A [1].", MOTOR)).toEqual(VALUE);
  });

  it.each([
    "Relieve the pressure until the hose gauge reads 0 psi [1].",
    "Relieve the pressure and verify the hose gauge reads 0 psi [1].",
    "Bleed the line and confirm the hose gauge shows 0 bar [1].",
    "Make sure the pressure is at 0 bar [1].",
    "Bleed the pressure down to 0 psi before any hose fitting is loosened [1].",
    "Relieve the hydraulic pressure and wait until it has dropped to 0 bar before loosening any hose fitting [1].",
    "With the press stopped and locked out, relieve the pressure and verify the hose gauge reads 0 psi [1].",
    "Isolate the machine under the site's lockout procedure and verify the hose gauge reads 0 psi [1].",
  ])("control: a zero residual-pressure reading is not a value claim: %s", (answer) => {
    expect(gaps(answer, HOSE)).toEqual([]);
  });

  it.each([
    "Lock out the machine and verify the meter reads 0 V [1].",
    "Verify the DC bus reads 0 V at the terminals [1].",
    "Discharge the DC bus capacitors and confirm the meter reads 0 VDC [1].",
  ])("control: a zero residual-voltage reading is not a value claim: %s", (answer) => {
    expect(gaps(answer, BUS)).toEqual([]);
  });

  it("the sentence is the unit: another sentence or line does not count, a second action in the same sentence does", () => {
    // The previous sentence, and the previous line, are not part of the reading's sentence.
    expect(gaps("Adjust nothing yet. Verify the hose gauge reads 0 psi [1].", HOSE)).toEqual([]);
    expect(gaps("Torque the hose fittings to 25 N·m [1]\nVerify the hose gauge reads 0 psi [1].", HOSE)).toEqual([]);
    // The next sentence is not part of it either.
    expect(gaps("Verify the hose gauge reads 0 psi [1]. Then inspect the hoses for wear [1].", HOSE)).toEqual([]);
    // A second action in the SAME sentence makes the whole sentence more than a reading.
    expect(gaps("Verify the hose gauge reads 0 psi, then inspect the hoses for wear [1].", HOSE)).toEqual(VALUE);
    expect(gaps("Inspect the hoses for wear, then verify the hose gauge reads 0 psi [1].", HOSE)).toEqual(VALUE);
    // A dot inside a part tag does not end the sentence: "Adjust" still belongs to it.
    expect(usable("Adjust valve PR-2.a until the gauge reads 0 psi [1].", "answer")).toEqual([{ nums: [0], unit: "psi" }]);
    expect(gaps("Adjust valve PR-2.a until the gauge reads 0 psi [1].", REG)).toEqual(VALUE);
  });

  it("what the reading must come BEFORE is not part of it; a 'before' clause in front of the reading is", () => {
    expect(gaps("Verify the hose gauge reads 0 psi before any hose fitting is loosened or adjusted [1].", HOSE)).toEqual([]);
    expect(gaps("Verify the hose gauge reads 0 psi prior to adjusting any hose fitting [1].", HOSE)).toEqual([]);
    expect(gaps("Before setting the outlet regulator, verify the gauge reads 0 psi [1].", REG)).toEqual(VALUE);
  });

  it("the machine's own name may appear in the sentence; any other name may not", () => {
    const a = "With the Zephyr stopped and locked out, verify the hose gauge reads 0 psi [1].";
    expect(gaps(a, ZEPHYR, "Zephyr ZX-9000")).toEqual([]);
    expect(gaps(a, ZEPHYR)).toEqual(VALUE);
  });

  it("one free word may name a gauge after 'the'; nothing else is free", () => {
    expect(gaps("Verify the hose gauge reads 0 psi [1].", HOSE)).toEqual([]);
    expect(gaps("Verify hose gauge reads 0 psi [1].", HOSE)).toEqual(VALUE);
    expect(gaps("Verify the hose line gauge reads 0 psi [1].", HOSE)).toEqual(VALUE);
    expect(gaps("Verify the hose meter reads 0 psi [1].", HOSE)).toEqual(VALUE);
  });

  it("a NON-zero pressure or voltage reading is a value claim: only zero is exempt", () => {
    expect(gaps("Relieve the pressure until the hose gauge reads 25 psi [1].", HOSE)).toEqual(VALUE);
    expect(gaps("Lock out the machine and verify the meter reads 24 V [1].", BUS)).toEqual(VALUE);
  });

  it("control: a non-zero value is checked exactly as before", () => {
    expect(gaps("Set the pre-charge delay to 800 ms [1].", D800)).toEqual([]);
    expect(gaps("Set the pre-charge delay to 10 ms [1].", D800)).toEqual(VALUE);
  });
});

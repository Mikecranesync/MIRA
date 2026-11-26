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
import { citationSupportGaps } from "@/capabilities/supporting-quote";

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
    // F2: Infinity marks a reported count above the safe range: spent, so no allowance remains.
    expect(redraftOutputAllowance(4000, 800, Infinity)).toBeNull();
    expect(redraftOutputAllowance(500, 500, 7)).toBe(493);
    expect(redraftOutputAllowance(500, 500, 450)).toBeNull();
    expect(redraftOutputAllowance(1000, 800, null)).toBeNull();
    expect(redraftOutputAllowance(2000, 800, null)).toBe(800);
    expect(redraftOutputAllowance(800 + REDRAFT_MIN_OUTPUT_TOKENS, 800, 800)).toBe(REDRAFT_MIN_OUTPUT_TOKENS);
    expect(redraftOutputAllowance(800 + REDRAFT_MIN_OUTPUT_TOKENS - 1, 800, 800)).toBeNull();
  });

  // #6021 F4-b: a malformed draft-1 count is never small. Ceiling == request cap, so
  // booking the count as unknown (the whole cap) leaves nothing: null under any reading.
  it("F4-b: a negative draft-1 count cannot grant the whole cap", () => {
    expect(redraftOutputAllowance(500, 500, -50)).toBeNull();
  });
  it("F4-b: a huge negative draft-1 count cannot grant the whole cap", () => {
    expect(redraftOutputAllowance(500, 500, -1e9)).toBeNull();
  });
  it("F4-b: -Infinity cannot grant the whole cap", () => {
    expect(redraftOutputAllowance(500, 500, -Infinity)).toBeNull();
  });
  it("F4-b: a non-number count (a string from a provider) cannot grant an allowance", () => {
    const bad = "7" as unknown as number;
    expect(redraftOutputAllowance(500, 500, bad)).toBeNull();
  });
  it("F4-b control: NaN and Infinity already stop; a sane 200 still leaves 300", () => {
    expect(redraftOutputAllowance(500, 500, NaN)).toBeNull();
    expect(redraftOutputAllowance(500, 500, Infinity)).toBeNull();
    expect(redraftOutputAllowance(500, 500, 200)).toBe(300);
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
  it("R3-C3: a token sum beyond the safe-integer range is unknown (null), never an imprecise number; cost keeps its fraction", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(withRedraftUsage(u("A", max, 200, 0.5, 3), u("B", 50, max, 0.25, max), false)).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      costUsdEstimate: 0.75,
    });
    // Control: at ordinary counts every sum is kept.
    expect(withRedraftUsage(u("A", 12, 200, 0.5, 3), u("B", 50, 300, 0.25, 4), false)).toMatchObject({
      inputTokens: 62,
      outputTokens: 500,
      cachedInputTokens: 7,
      costUsdEstimate: 0.75,
    });
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

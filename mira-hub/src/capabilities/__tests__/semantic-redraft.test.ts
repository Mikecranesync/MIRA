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

const deps = (over: Partial<Parameters<typeof runSemanticRedraft>[0]> = {}) => ({
  aborted: vi.fn(() => false),
  generate: vi.fn(async () => ({ text: "redraft [1]", complete: true }) as { text: string; complete: boolean } | null),
  screen: vi.fn((t: string) => t),
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

/** #5941 — the one-redraft runner and its fixed instruction (no route, no network). */
import { describe, expect, it, vi } from "vitest";
import { redraftInstruction, runSemanticRedraft, withRedraftInstruction } from "@/capabilities/semantic-redraft";

const deps = (over: Partial<Parameters<typeof runSemanticRedraft>[0]> = {}) => ({
  aborted: vi.fn(() => false),
  generate: vi.fn(async () => "redraft [1]"),
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
    expect((await runSemanticRedraft(deps({ generate: vi.fn(async () => "  ") }))).outcome).toBe("stopped_generation");
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

  it("unsafe, unknown or a thrown judge stops", async () => {
    expect((await runSemanticRedraft(deps({ judge: vi.fn(async () => "unsafe" as const) }))).outcome).toBe("stopped_judge_unsafe");
    expect((await runSemanticRedraft(deps({ judge: vi.fn(async () => "unknown" as const) }))).outcome).toBe("stopped_judge_undecided");
    expect((await runSemanticRedraft(deps({ judge: vi.fn(async () => Promise.reject(new Error("x"))) }))).outcome).toBe("stopped_judge_undecided");
  });
});

describe("redraft instruction", () => {
  it("is fixed text: isolation inline, powered steps separate, nothing invented, citations kept", () => {
    const t = redraftInstruction("unclassified");
    expect(t).toMatch(/^SAFETY REVISION:/);
    expect(t).toContain("state inline in that step the isolation");
    expect(t).toContain("never put a powered check inside a locked-out step");
    expect(t).toContain("Add no step, value or claim the excerpts do not support");
    expect(t).toContain("[n] citation markers");
  });

  it("adds the class clause for pressure, machine motion and electrical only", () => {
    expect(redraftInstruction("pressure")).toContain("depressurised and confirmed at zero");
    expect(redraftInstruction("machine-motion")).toContain("guards are refitted");
    expect(redraftInstruction("electrical")).toContain("confirmed de-energized with a tested meter");
    expect(redraftInstruction("thermal")).toBe(redraftInstruction("unclassified"));
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

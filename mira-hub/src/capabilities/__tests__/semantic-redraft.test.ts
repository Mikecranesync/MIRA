/** #5941 — the one-redraft runner and its fixed instruction (no route, no network). */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_TOKEN_COUNT,
  outputSpent,
  REDRAFT_CLASSES,
  REDRAFT_MIN_OUTPUT_TOKENS,
  redraftInstruction,
  redraftOutputAllowance,
  runSemanticRedraft,
  tokenCount,
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

describe("token counts (#6081 F2, F4)", () => {
  it("a count is known only when the ledger's INTEGER column can hold it", () => {
    expect([0, 7, MAX_TOKEN_COUNT].map(tokenCount)).toEqual([0, 7, MAX_TOKEN_COUNT]);
    expect([MAX_TOKEN_COUNT + 1, Number.MAX_SAFE_INTEGER, 1e300, Infinity, -1, 1.5, NaN, "7", null, undefined].map(tokenCount)).toEqual(
      Array(10).fill(null),
    );
  });
  it("for the allowance, a number above the ledger range is spent (Infinity); anything else malformed is unknown (null)", () => {
    expect([MAX_TOKEN_COUNT + 1, Number.MAX_SAFE_INTEGER, 1e300, Infinity].map(outputSpent)).toEqual(Array(4).fill(Infinity));
    expect([0, 300, MAX_TOKEN_COUNT].map(outputSpent)).toEqual([0, 300, MAX_TOKEN_COUNT]);
    expect([-1, -Infinity, 1.5, NaN, "7", null, undefined].map(outputSpent)).toEqual(Array(7).fill(null));
  });
  it("an unknown count books one request cap and may leave an allowance; a count above the ledger range leaves none", () => {
    expect(redraftOutputAllowance(4000, 800, null)).toBe(800);
    expect(redraftOutputAllowance(4000, 800, -5)).toBe(800);
    for (const spent of [MAX_TOKEN_COUNT + 1, Number.MAX_SAFE_INTEGER, 1e300, Infinity]) {
      expect(redraftOutputAllowance(4000, 800, spent)).toBeNull();
    }
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
  it("#6081 F4: a token sum the ledger's INTEGER column cannot hold is unknown (null); one that just fits is kept", () => {
    expect(withRedraftUsage(u("A", 12, MAX_TOKEN_COUNT, 0.5, 3), u("B", MAX_TOKEN_COUNT, 1, 0.25, MAX_TOKEN_COUNT), false)).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      costUsdEstimate: 0.75,
    });
    expect(withRedraftUsage(u("A", 12, MAX_TOKEN_COUNT - 1, 0.5, 3), u("B", MAX_TOKEN_COUNT - 12, 1, 0.25, MAX_TOKEN_COUNT - 3), false)).toMatchObject({
      inputTokens: MAX_TOKEN_COUNT,
      outputTokens: MAX_TOKEN_COUNT,
      cachedInputTokens: MAX_TOKEN_COUNT,
    });
  });
  it("#6081 F4: a summed cost the ledger's NUMERIC(12, 6) column cannot hold is unknown (null); one below it is kept", () => {
    expect(withRedraftUsage(u("A", 10, 5, 600_000), u("B", 20, 7, 400_000), true).costUsdEstimate).toBeNull();
    expect(withRedraftUsage(u("A", 10, 5, 600_000), u("B", 20, 7, 399_999.5), true).costUsdEstimate).toBe(999_999.5);
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

  it("a cited value must be on the page; an unusable bare number is not a value claim", () => {
    expect(gaps("Torque the hose fittings to 25 N·m [1].")).toEqual([]);
    expect(gaps("Torque the hose fittings to 40 N·m [1].")).toEqual([{ citationId: "1", reason: "value" }]);
    expect(gaps("Repeat for hose 3 [1].")).toEqual([]);
  });

  // #6049 (Codex round 3 on #6001, F8). #6001 exempted every zero from the value check so a
  // redraft could say a gauge "reads 0 psi". That also let "set the delay to 0 ms" through.
  // A list of safe wordings was tried in this pull request and leaked eight times (five found
  // here, three more by Codex round 1 on #6090), so the exemption is gone: a digit zero with a
  // unit is checked against the page like any other value.
  describe("#6049: a zero is a value like any other", () => {
    const VALUE_GAP = [{ citationId: "1", reason: "value" }];
    const GAUGE = page("Inspect the hydraulic hoses for wear. Check the outlet gauge and the outlet regulator before restart.");
    const GAUGE_ZERO = page("Inspect the hydraulic hoses for wear. Relieve the pressure until the outlet gauge reads 0 psi, then check the outlet regulator.");
    const DELAY_800 = page("Set the pre-charge delay to 800 ms before enabling the main contactor.");
    const DELAY_0 = page("Set the pre-charge delay to 0 ms when the bypass kit is fitted.");

    it("the issue's case: a zero setting the page does not give is a value gap", () => {
      expect(gaps("Set the pre-charge delay to 0 ms [1].", [DELAY_800])).toEqual(VALUE_GAP);
      expect(gaps("Set the outlet regulator to 0 psi [1].", [GAUGE])).toEqual(VALUE_GAP);
    });

    it("control: the same zero is supported when the page gives it", () => {
      expect(gaps("Set the pre-charge delay to 0 ms [1].", [DELAY_0])).toEqual([]);
      expect(gaps("Relieve the pressure until the outlet gauge reads 0 psi [1].", [GAUGE_ZERO])).toEqual([]);
    });

    it("REVERSAL of #6001: a zero READING in digits that the page does not print is now a value gap too", () => {
      // The page is about the hoses and the gauge, so the words are supported; only the value is not.
      expect(gaps("Relieve the pressure until the outlet gauge reads 0 psi [1].", [GAUGE])).toEqual(VALUE_GAP);
      expect(gaps("Relieve the pressure until the hose gauge reads 0 psi [1].")).toEqual(VALUE_GAP);
    });

    it("control: the reading the redraft instruction asks for, in words, is still not a value claim", () => {
      expect(gaps("Relieve the pressure and verify the outlet gauge reads zero before restart [1].", [GAUGE])).toEqual([]);
      expect(gaps("Stop and lock out the machine, then verify the pressure reads zero before you start [1].", [PAINT])).toEqual([]);
    });

    // Codex round 1 on #6090: each of these slipped the list of safe wordings.
    it.each([
      ["F1: the setting comes after the reading", "Verify the outlet gauge reads 0 psi before restart, adjusting the outlet regulator as needed [1]."],
      ["F2: an abbreviation's dot split the sentence", "Set the outlet regulator, i.e. make sure the outlet gauge reads 0 psi [1]."],
      ["F3: the machine is running", "Verify the outlet gauge reads 0 psi with the machine on [1]."],
      ["earlier leak: a setting verb the list did not name", "Dial the outlet regulator down to 0 psi and verify the outlet gauge [1]."],
      ["earlier leak: make the gauge read", "Make the outlet gauge read 0 psi [1]."],
    ])("%s: a value gap when the page does not give 0 psi", (_name, answer) => {
      expect(gaps(answer, [GAUGE])).toEqual(VALUE_GAP);
    });

    it("control: those same sentences are supported when the page gives 0 psi", () => {
      expect(gaps("Verify the outlet gauge reads 0 psi before restart, adjusting the outlet regulator as needed [1].", [GAUGE_ZERO])).toEqual([]);
      expect(gaps("Set the outlet regulator, i.e. make sure the outlet gauge reads 0 psi [1].", [GAUGE_ZERO])).toEqual([]);
      expect(gaps("Verify the outlet gauge reads 0 psi with the machine on [1].", [GAUGE_ZERO])).toEqual([]);
      expect(gaps("Dial the outlet regulator down to 0 psi and verify the outlet gauge [1].", [GAUGE_ZERO])).toEqual([]);
      expect(gaps("Make the outlet gauge read 0 psi [1].", [GAUGE_ZERO])).toEqual([]);
    });

    it("Codex round 1 F4: markdown around the sentence changes nothing, in either direction", () => {
      const bold = "**Verify the outlet gauge reads 0 psi [1].** Then inspect the hoses for wear [1].";
      expect(gaps(bold, [GAUGE])).toEqual(VALUE_GAP);
      expect(gaps(bold, [GAUGE_ZERO])).toEqual([]);
      expect(gaps(bold.replaceAll("**", ""), [GAUGE])).toEqual(VALUE_GAP);
      expect(gaps(bold.replaceAll("**", ""), [GAUGE_ZERO])).toEqual([]);
    });

    it("other zeros are values too: a voltage, a decimal zero, a current", () => {
      expect(gaps("Verify the outlet gauge shows 0 V at the regulator [1].", [GAUGE])).toEqual(VALUE_GAP);
      expect(gaps("Set the outlet regulator to 0.0 psi [1].", [GAUGE])).toEqual(VALUE_GAP);
      expect(gaps("Check the outlet regulator draws 0 A [1].", [GAUGE])).toEqual(VALUE_GAP);
    });

    it("control: each of those is supported when the page prints it", () => {
      const withValue = (v: string) => [page(`Check the outlet gauge and the outlet regulator. The regulator reading is ${v}.`)];
      expect(gaps("Verify the outlet gauge shows 0 V at the regulator [1].", withValue("0 V"))).toEqual([]);
      expect(gaps("Set the outlet regulator to 0.0 psi [1].", withValue("0 psi"))).toEqual([]);
      expect(gaps("Check the outlet regulator draws 0 A [1].", withValue("0 A"))).toEqual([]);
    });

    // No unit is special: an exemption put back for any one of these would turn its row red.
    it.each(["0 bar", "0 kPa", "0 Hz", "0 RPM", "0%"])("a zero in any table unit is checked: %s", (value) => {
      const answer = `Set the outlet regulator to ${value} [1].`;
      expect(gaps(answer, [GAUGE])).toEqual(VALUE_GAP);
      expect(gaps(answer, [page(`Check the outlet gauge. Set the outlet regulator to ${value} before restart.`)])).toEqual([]);
    });

    // The limits below are on main today and are the same for any number, not only zero. They are
    // pinned so the pull request's "known limits" are facts, and so a fix (#6101) turns them red.
    describe("KNOWN LIMITS (#6101), unchanged from main", () => {
      const RANGE = page("Pre-charge delay. Range 0-2000 ms. Default 800 ms. Set the pre-charge delay to 800 ms before enabling the main contactor.");

      it("the two printed ends of a range count as found, wherever the range is printed: the issue's own setting passes against such a page", () => {
        expect(gaps("Set the pre-charge delay to 0 ms [1].", [RANGE])).toEqual([]);
        expect(gaps("Set the pre-charge delay to 2000 ms [1].", [RANGE])).toEqual([]);
        // Outside the range it is a gap, so the printed ends are what let the two above through.
        expect(gaps("Set the pre-charge delay to 2500 ms [1].", [RANGE])).toEqual(VALUE_GAP);
      });

      it("a value BETWEEN the printed ends is not found: the match is on the printed numbers, not on containment", () => {
        expect(gaps("Set the pre-charge delay to 1000 ms [1].", [RANGE])).toEqual(VALUE_GAP);
        // Control: the default the page does print is found.
        expect(gaps("Set the pre-charge delay to 800 ms [1].", [RANGE])).toEqual([]);
      });

      it("a value the reader cannot fully recognize is not compared: a unit outside the table", () => {
        expect(gaps("Set the outlet regulator to 0 psig [1].", [GAUGE])).toEqual([]);
        expect(gaps("Set the outlet regulator to 60 psig [1].", [GAUGE])).toEqual([]);
      });

      it("a value in a sentence with no marker is not looked at (#6047)", () => {
        expect(gaps("Set the pre-charge delay to 0 ms. Then enable the main contactor [1].", [DELAY_800])).toEqual([]);
        expect(gaps("Set the pre-charge delay to 500 ms. Then enable the main contactor [1].", [DELAY_800])).toEqual([]);
      });

      it("fails closed: a page that gives the zero reading in WORDS does not support the same reading in digits", () => {
        const WORDS = page("Relieve the pressure until the outlet gauge reads zero, then check the outlet regulator.");
        expect(gaps("Relieve the pressure until the outlet gauge reads 0 psi [1].", [WORDS])).toEqual(VALUE_GAP);
        expect(gaps("Relieve the pressure until the outlet gauge reads zero [1].", [WORDS])).toEqual([]);
      });
    });

    it("KNOWN LIMIT (#6100), unchanged from main: a number written as a word is not a value, so a zero SETTING in words is not checked", () => {
      // When #6100 is fixed this test turns red on purpose.
      expect(gaps("Set the outlet regulator to zero psi [1].", [GAUGE])).toEqual([]);
      expect(gaps("Set the outlet regulator to fifty psi [1].", [GAUGE])).toEqual([]);
    });
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

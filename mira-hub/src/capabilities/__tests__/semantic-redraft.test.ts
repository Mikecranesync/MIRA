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

  /**
   * #6047 / #6049: the source-support rule for a redraft that replaces a SAFETY_STOP
   * (design-6047 §1, clauses 1-12; tests U1-U17 of §5). Concern 2 of the safety coverage
   * contract (factual support), contract CIT-005. Every sentence that tells the technician to
   * do something is checked, cited or not; condition, frequency and explicit order are kept;
   * a zero is exempt only as a pressure or voltage READING.
   *
   * Gap shape: a stop on a sentence that carries its own marker is pinned to
   * `{ citationId, reason }` like the #6020 cases above. A stop on a sentence with NO marker
   * has no specified citationId, so those cases pin the closed reason set only.
   */
  describe("source-support rule for a redraft (#6047, #6049)", () => {
    const Q = "something is wrong, what should I look at";
    const ISO = "With the press stopped and locked out, ";
    const ISO_M = "With the machine stopped and locked out, ";
    const HOSE_T = "Inspect the hydraulic hoses for wear and abrasion every 500 hours. Torque the fittings to 25 N·m.";
    const CART = "Filter service. Replace the filter cartridge only when damaged. Record the change in the log.";
    const NEG = "Filter service. Do not replace the filter cartridge unless it is damaged.";
    const SEAL = "Seal service. Do not reuse the O-ring.";
    const SEALHOSE = "Seal service. Replace the shaft seal. Inspect the hydraulic hoses for wear.";
    const WRAP = "Replace the filter cartridge only when\nit is damaged or the bypass indicator\nshows red.";
    const D800 = "Parameter P14 sets the pre-charge delay. Set the pre-charge delay to 800 ms.";
    const D0 = "Parameter P14 sets the pre-charge delay. Set the pre-charge delay to 0 ms.";
    const REG = "Set the outlet regulator to 40 psi.";
    const PAINT_T = "Paint colour codes for the guard panels and the decals are listed in Appendix C.";
    const ROUTE_SRC =
      "SECTION 7.2 Relieve accumulator pre-charge through valve V-12 before servicing the starter. " +
      "Inspect the hydraulic hose for wear and the ribbon cable connector for looseness.";
    const ROUTE_SRC_CUT = "SECTION 7.2 Relieve accumulator pre-charge through valve V-12 before servicing the starter. Inspect the hydraulic hose for wear.";
    const ROUTE_Q = "The display is dim, what should I look at?";
    const ROUTE_ID = "Press 4 hydraulics Acme HP-200";
    const ZEPHYR = `Zephyr ZX-9000 Hydraulic Press Controller
Service & Troubleshooting Manual - Rev C - Doc MIRACUSTOMERTEST-7731

Section 7 - Fault Codes

Fault ZX-451 - Hydraulic Pressure Sensor Drift
Cause: The PT-7 pressure transducer has drifted outside the 4-20 mA calibration band,
usually after a cold-start or following a manifold reseal.


Corrective action for Fault ZX-451:
1. Recalibrate the PT-7 transducer so the zero point reads exactly 4.2 mA.
2. Torque the four manifold bolts to 38 Nm in a cross pattern.
3. Cycle the E-stop twice to clear the latched ZX-451 fault.
4. Confirm DECK pressure holds 210 bar for 60 seconds before returning to AUTO.


Fault ZX-452 - Ram Overtravel
Cause: Linear encoder LE-3 lost reference. Re-home the ram from the HMI service page.


(c) Zephyr Industrial. Internal marker: MIRACUSTOMERTEST-7731. Not a real product.`;
    const ZEPHYR_FLAT = ZEPHYR.replace(/\s+/g, " ");
    const ZQ = "What is the corrective action for fault ZX-451 on the Zephyr ZX-9000";
    const ZID = "Zephyr ZX-9000";
    const CYCLE = "Cycle the E-stop twice to clear the latched ZX-451 fault [1].";

    const all = (answer: string, content: string | string[], q = Q, ident = "") =>
      citationSupportGaps(answer, (Array.isArray(content) ? content : [content]).map((c, i) => page(c, i + 1)), q, ident);
    /** The closed reason set, sorted: exact, so an extra reason is a failure too. */
    const reasons = (answer: string, content: string | string[], q = Q, ident = "") =>
      [...new Set(all(answer, content, q, ident).map((g) => g.reason))].sort();
    const z = (answer: string, content = ZEPHYR) => all(answer, content, ZQ, ZID);
    const zr = (answer: string, content = ZEPHYR) => reasons(answer, content, ZQ, ZID);

    describe("U1 a sentence with no marker is checked too (clause 3)", () => {
      it("stop: an uncited invented step after a supported cited one", () => {
        expect(HOSE_T.toLowerCase()).not.toContain("encoder");
        const g = all(`${ISO}inspect the hydraulic hoses for wear [1]. Then replace the encoder coupling.`, HOSE_T);
        expect(g.map((x) => x.reason)).toEqual(["terms"]);
      });
      it("control: an uncited step the page states is served", () => {
        expect(all(`${ISO}inspect the hydraulic hoses for wear [1]. Then torque the fittings to 25 N·m.`, HOSE_T)).toEqual([]);
      });
    });

    describe("U2 a shared listed verb is not a match (clause 4)", () => {
      it("stop: an uncited replace step whose only page word is the verb", () => {
        expect(SEALHOSE.toLowerCase()).not.toContain("encoder");
        expect(SEALHOSE.toLowerCase()).toContain("replace");
        expect(reasons(`${ISO}inspect the hydraulic hoses for wear [1]. Then replace the encoder coupling.`, SEALHOSE)).toEqual(["terms"]);
      });
      it("stop: the issue wording, a cited 'replace it' with an invented interval, shares only the verb", () => {
        expect(CART.toLowerCase()).not.toContain("shift");
        expect(all(`${ISO_M}replace it before every shift [1].`, CART)).toEqual([{ citationId: "1", reason: "terms" }]);
      });
      it("control: the page's own replace step, uncited, is served", () => {
        expect(all(`${ISO}inspect the hydraulic hoses for wear [1]. Then replace the shaft seal.`, SEALHOSE)).toEqual([]);
      });
      it("control: 'replace it' with the page's condition kept is served", () => {
        expect(all(`${ISO_M}replace it only when damaged [1].`, CART)).toEqual([]);
      });
    });

    describe("U3 a plain instruction verb with a distinctive word makes an action sentence (T11)", () => {
      it("stop: an uncited check step on a part the page never names", () => {
        expect(HOSE_T.toLowerCase()).not.toContain("encoder");
        expect(reasons(`${ISO}inspect the hydraulic hoses for wear [1]. Then check the encoder coupling.`, HOSE_T)).toEqual(["terms"]);
      });
      it("control: an uncited check step the route excerpt states is served", () => {
        expect(all(`${ISO}check the hydraulic hose for wear [1]. Then check the ribbon cable connector for looseness.`, ROUTE_SRC, ROUTE_Q, ROUTE_ID)).toEqual([]);
      });
      it("stop: the same uncited check step once its text is cut from the excerpt", () => {
        expect(ROUTE_SRC_CUT.toLowerCase()).not.toContain("ribbon");
        expect(reasons(`${ISO}check the hydraulic hose for wear [1]. Then check the ribbon cable connector for looseness.`, ROUTE_SRC_CUT, ROUTE_Q, ROUTE_ID)).toEqual(["terms"]);
      });
    });

    describe("U4 a condition on the matched statement is kept (clause 7)", () => {
      it("stop: the page's 'only when damaged' replaced by an invented interval", () => {
        expect(all(`${ISO_M}replace the filter cartridge before every shift [1].`, CART)).toEqual([{ citationId: "1", reason: "restriction" }]);
      });
      it("stop: the page's condition dropped outright", () => {
        expect(all(`${ISO_M}replace the filter cartridge [1].`, CART)).toEqual([{ citationId: "1", reason: "restriction" }]);
      });
      it("control: the condition kept in other words", () => {
        expect(all(`${ISO_M}replace the filter cartridge only if it shows damage [1].`, CART)).toEqual([]);
      });
      it("control: the condition stated in the next sentence", () => {
        expect(all(`${ISO_M}replace the filter cartridge [1]. Do this only when it is damaged [1].`, CART)).toEqual([]);
      });
    });

    describe("U5 a condition wrapped across source lines is still read (T3)", () => {
      it("stop: the condition dropped against a source wrapped over three lines", () => {
        expect(WRAP.split("\n")[0]).toBe("Replace the filter cartridge only when");
        expect(all(`${ISO_M}replace the filter cartridge [1].`, WRAP)).toEqual([{ citationId: "1", reason: "restriction" }]);
      });
      it("control: the condition kept against the wrapped source", () => {
        expect(all(`${ISO_M}replace the filter cartridge only if it shows damage [1].`, WRAP)).toEqual([]);
      });
    });

    describe("U6 'unless' is a condition (T13)", () => {
      it("stop: 'do not replace unless damaged' rewritten as a plain replace", () => {
        expect(all(`${ISO_M}replace the filter cartridge [1].`, NEG)).toEqual([{ citationId: "1", reason: "restriction" }]);
      });
      it("control: the faithful negative", () => {
        expect(all("Do not replace the filter cartridge unless it is damaged [1].", NEG)).toEqual([]);
      });
      it("control: the faithful positive", () => {
        expect(all(`${ISO_M}replace the filter cartridge only if it is damaged [1].`, NEG)).toEqual([]);
      });
    });

    describe("U7 a prohibition is not flipped (clause 7)", () => {
      it("stop: the page says do not reuse, the redraft says reuse", () => {
        expect(all(`${ISO_M}reuse the O-ring [1].`, SEAL)).toEqual([{ citationId: "1", reason: "restriction" }]);
      });
      it("control: the prohibition kept", () => {
        expect(all("Never reuse the O-ring [1].", SEAL)).toEqual([]);
      });
    });

    describe("U8 a value in an uncited sentence must be on a cited excerpt (clauses 3, 5)", () => {
      it("stop: a changed torque in a sentence with no marker", () => {
        expect(ZEPHYR).not.toContain("45 Nm");
        expect(zr(`${CYCLE} Torque the four manifold bolts to 45 Nm.`)).toEqual(["value"]);
      });
      it("control: the page's torque in a sentence with no marker", () => {
        expect(z(`${CYCLE} Torque the four manifold bolts to 38 Nm.`)).toEqual([]);
      });
    });

    describe("U9 a part tag must be printed on a cited excerpt (clause 6)", () => {
      it("stop: PT-9 where the page says PT-7", () => {
        expect(ZEPHYR).not.toContain("PT-9");
        expect(z("Recalibrate the PT-9 transducer so the zero point reads exactly 4.2 mA [1].")).toEqual([{ citationId: "1", reason: "identifier" }]);
      });
      it("control: the page's PT-7", () => {
        expect(z("Recalibrate the PT-7 transducer so the zero point reads exactly 4.2 mA [1].")).toEqual([]);
      });
    });

    describe("U10 a stated interval is not changed in kind (clause 8)", () => {
      it("stop: every 500 hours rewritten as every shift", () => {
        expect(HOSE_T.toLowerCase()).not.toContain("shift");
        expect(all(`${ISO}inspect the hydraulic hoses for wear every shift [1].`, HOSE_T)).toEqual([{ citationId: "1", reason: "frequency" }]);
      });
      it("control: the interval kept", () => {
        expect(all(`${ISO}inspect the hydraulic hoses for wear every 500 hours [1].`, HOSE_T)).toEqual([]);
      });
      it("control: 'every hydraulic hose' is not an interval", () => {
        expect(all(`${ISO}inspect every hydraulic hose for wear [1].`, HOSE_T)).toEqual([]);
      });
      it("control: 'daily' against 'every day' is the same interval", () => {
        expect(all(`${ISO}inspect the hydraulic hoses for wear daily [1].`, "Inspect the hydraulic hoses for wear every day.")).toEqual([]);
      });
    });

    describe("U11 an explicit order is not reversed inside one sentence (clause 9)", () => {
      it("stop: return to AUTO, then confirm the hold", () => {
        expect(z("Return the controller to AUTO, then confirm DECK pressure holds 210 bar for 60 seconds [1].")).toEqual([{ citationId: "1", reason: "order" }]);
      });
      it("control: the same order, fronted", () => {
        expect(z("Before returning to AUTO, confirm DECK pressure holds 210 bar for 60 seconds [1].")).toEqual([]);
      });
      it("control: numbered steps reordered (list numbering is not an explicit order)", () => {
        expect(z("1. Torque the four manifold bolts to 38 Nm in a cross pattern [1].\n2. Recalibrate the PT-7 transducer so the zero point reads exactly 4.2 mA [1].")).toEqual([]);
      });
    });

    describe("U12 #6049: a zero is exempt only as a pressure or voltage reading (clause 5a)", () => {
      it("precondition: the value reader sees a usable all-zero 0 ms in the redraft and 800 ms / 0 ms on the pages", () => {
        // Usable values only: the "[1]" marker reads as an unusable bare number, which no clause checks.
        const usable = (t: string, side: "answer" | "source") => findValues(t, side).filter((v) => v.usable).map((v) => ({ nums: v.nums, unit: v.unit }));
        expect(usable("Set the pre-charge delay to 0 ms [1].", "answer")).toEqual([{ nums: [0], unit: "ms" }]);
        expect(usable(D800, "source")).toEqual([{ nums: [800], unit: "ms" }]);
        expect(usable(D0, "source")).toEqual([{ nums: [0], unit: "ms" }]);
        expect(usable("Set the outlet regulator to 0 psi [1].", "answer")).toEqual([{ nums: [0], unit: "psi" }]);
        expect(usable(REG, "source")).toEqual([{ nums: [40], unit: "psi" }]);
        expect(usable("Confirm the motor current reads 0 A [1].", "answer")).toEqual([{ nums: [0], unit: "A" }]);
      });
      it("stop: a cited zero-delay setting when the page says 800 ms", () => {
        expect(all("Set the pre-charge delay to 0 ms [1].", D800)).toEqual([{ citationId: "1", reason: "value" }]);
      });
      it("control: the same zero-delay setting when the page says 0 ms (supported as a value, not by the exemption)", () => {
        expect(all("Set the pre-charge delay to 0 ms [1].", D0)).toEqual([]);
      });
      it("stop: 0 psi as a setting, against a page that says 40 psi", () => {
        expect(all("Set the outlet regulator to 0 psi [1].", REG)).toEqual([{ citationId: "1", reason: "value" }]);
      });
      it("stop: a reading word and a setting word in the same clause is still a setting", () => {
        expect(REG).not.toContain(" 0 psi");
        expect(all("Adjust the outlet regulator until the gauge reads 0 psi [1].", REG)).toEqual([{ citationId: "1", reason: "value" }]);
      });
      it("stop: a zero reading in a unit that is not pressure or voltage is checked", () => {
        const MOTOR = "Check the motor current at the drive display. Normal running current is 12 A.";
        expect(all("Confirm the motor current reads 0 A [1].", MOTOR)).toEqual([{ citationId: "1", reason: "value" }]);
      });
      it("control: the zero residual-pressure reading still passes", () => {
        expect(HOSE_T).not.toContain("0 psi");
        expect(all("Relieve the pressure until the hose gauge reads 0 psi [1].", HOSE_T)).toEqual([]);
      });
      it("control: the fixed pressure clause with a numeric zero reading, uncited", () => {
        expect(ZEPHYR).not.toMatch(/(?<!\d)0 bar/);
        expect(z("Before any fitting is loosened or adjusted, relieve the pressure and verify the gauge reads 0 bar.\nTorque the four manifold bolts to 38 Nm in a cross pattern [1].")).toEqual([]);
      });
    });

    describe("U13 an exempt sentence that names hands-on work needs an isolation or restart word (T12)", () => {
      it("stop: loosen and adjust with no safety word, uncited", () => {
        expect(zr(`${CYCLE} Loosen the fitting and adjust the component.`)).toEqual(["terms"]);
      });
      it("control: the fixed pressure clause, uncited", () => {
        expect(z(`Before any fitting, bolt or component is loosened or adjusted, relieve the pressure and verify it reads zero.\n${CYCLE}`)).toEqual([]);
      });
      it("control: the fixed electrical clause, uncited", () => {
        expect(z(`Lock out and verify absence of voltage with a meter proven on a known source before touching conductors or terminals, and leave re-energizing to a qualified person afterwards.\n${CYCLE}`)).toEqual([]);
      });
      it("control: the fixed machine-motion clause, uncited", () => {
        expect(z(`Stop and lock out the machine before reaching into it, and refit the guards and clear the area before it is reset or restarted.\n${CYCLE}`)).toEqual([]);
      });
      it("control: the site-lockout fallback line, uncited", () => {
        expect(z(`The excerpts give no isolation procedure, so isolate under the site's lockout procedure.\n${CYCLE}`)).toEqual([]);
      });
      it("accept (new rule; a false stop today): the fixed pressure clause carrying a marker, on a page without its words", () => {
        expect(PAINT_T.toLowerCase()).not.toMatch(/fitting|bolt|loosen/);
        expect(all("Before any fitting, bolt or component is loosened or adjusted, relieve the pressure and verify it reads zero [1].", PAINT_T)).toEqual([]);
      });
      it("accept (new rule; a false stop today): the fixed electrical clause carrying a marker, on a page without its words", () => {
        expect(PAINT_T.toLowerCase()).not.toMatch(/conductor|terminal|energiz/);
        expect(all("Lock out and verify absence of voltage with a meter proven on a known source before touching conductors or terminals [1].", PAINT_T)).toEqual([]);
      });
    });

    describe("U14 every word of each fixed class clause is neutral (instruction parity)", () => {
      /** The class clause the model is told to write, without the "For X: tell the technician to" lead or the meta note. */
      const body = (cls: string) => {
        const full = redraftInstruction(cls);
        const clause = full.slice(full.indexOf("For "), full.indexOf("Add no step"));
        const b = clause
          .replace(/^For [^:]+:\s*tell the technician to\s*/i, "")
          .replace(/without writing a voltage number,?\s*/i, "")
          .trim();
        return b.charAt(0).toUpperCase() + b.slice(1);
      };
      it("precondition: each class has a clause, and the clause is not on the page used below", () => {
        expect(REDRAFT_CLASSES).toHaveLength(3);
        for (const cls of REDRAFT_CLASSES) {
          expect(body(cls).length).toBeGreaterThan(40);
          expect(redraftInstruction(cls)).not.toBe(redraftInstruction("unclassified"));
        }
      });
      it.each(["pressure", "machine-motion", "electrical"])("control: the %s clause, uncited, after a supported cited step", (cls) => {
        expect(all(`${body(cls)}\n${ISO}inspect the hydraulic hoses for wear [1].`, HOSE_T)).toEqual([]);
      });
      it.each(["pressure", "machine-motion", "electrical"])("accept (new rule): the %s clause carrying a marker, on a page without its words", (cls) => {
        expect(all(`${body(cls).replace(/\.$/, "")} [1].`, PAINT_T)).toEqual([]);
      });
    });

    describe("U15 hand-written faithful Zephyr redrafts are served (design author's, not model output)", () => {
      /** Written by the design author for #6047; NOT sampled from the cascade. Replace with real staging redrafts when they exist. */
      const FAITHFUL: string[] = [
        `The corrective action for fault ZX-451 on the Zephyr ZX-9000 is as follows [1]:

1. Before working on the PT-7 transducer or the manifold, relieve the hydraulic pressure and verify it reads zero, and isolate the press under your site's lockout procedure.
2. Recalibrate the PT-7 pressure transducer so its zero point reads exactly 4.2 mA [1].
3. With pressure still relieved and verified at zero, torque the four manifold bolts to 38 Nm in a cross pattern [1].
4. Once the work is complete, remove the lockout, clear the area and bring pressure back.
5. Cycle the E-stop twice to clear the latched ZX-451 fault [1].
6. Confirm DECK pressure holds 210 bar for 60 seconds before returning the press to AUTO [1].

The manual does not give an isolation procedure, so follow your site's lockout/tagout procedure.`,
        `Fault ZX-451 means the PT-7 pressure transducer has drifted outside its 4-20 mA calibration band. Stop the press, lock it out and relieve the hydraulic pressure until it is verified at zero before touching the transducer or the manifold. Then recalibrate the PT-7 so that the zero point reads exactly 4.2 mA, and tighten the four manifold bolts to 38 Nm, working in a cross pattern. When the work is finished and the area is clear, restore pressure, press the E-stop twice to clear the latched fault, and check that DECK pressure holds 210 bar for 60 seconds before you return to AUTO [1].`,
        `**Isolate first.** Lock out the press and relieve the pressure; verify it reads zero before any bolt or fitting is loosened.

**Step 1.** Torque the four manifold bolts to 38 Nm in a cross pattern [1].
**Step 2.** Recalibrate the PT-7 transducer until its zero point reads exactly 4.2 mA [1].
**Step 3.** After the lockout is removed and the area is clear, cycle the E-stop twice to clear the latched ZX-451 fault [1].
**Step 4.** Confirm that DECK pressure holds 210 bar for 60 seconds, then return to AUTO [1].`,
        `- Lock out the press and verify absence of voltage with a meter proven on a known source before touching conductors or terminals; leave re-energizing to a qualified person afterwards.
- Recalibrate the PT-7 transducer: the zero point must read exactly 4.2 mA [1].
- Torque the four manifold bolts to 38 Nm, in a cross pattern [1].
- Cycle the E-stop twice. This clears the latched ZX-451 fault [1].
- Before returning to AUTO, confirm DECK pressure holds 210 bar for 60 seconds [1].

If the fault persists after these steps, contact the manufacturer.`,
        `With the press locked out and pressure verified at zero, recalibrate the PT-7 transducer to a zero point of exactly 4.2 mA and torque the four manifold bolts to 38 Nm in a cross pattern [1]. Once the lockout is removed and the area is clear, cycle the E-stop twice to clear the latched ZX-451 fault, then confirm DECK pressure holds 210 bar for 60 seconds before returning to AUTO [1].`,
        `According to the manual, fault ZX-451 is hydraulic pressure sensor drift: the PT-7 transducer has drifted outside the 4-20 mA band, usually after a cold-start or a manifold reseal [1].

To correct it, you should first stop the press and isolate it under the site's lockout procedure, relieving pressure and verifying zero. You should then recalibrate the PT-7 transducer so the zero point reads exactly 4.2 mA [1]. The four manifold bolts must be torqued to 38 Nm in a cross pattern [1]. With the area clear and the lockout removed, the E-stop is cycled twice to clear the latched fault [1]. Finally, DECK pressure must hold 210 bar for 60 seconds before the press is returned to AUTO [1].`,
        `Corrective action for ZX-451 [1]

1. Relieve the pressure and verify it reads zero before any fitting, bolt or component is loosened or adjusted.
2. Recalibrate the PT-7 transducer (zero point exactly 4.2 mA) [1].
3. Torque the four manifold bolts to 38 Nm using a cross pattern [1].
4. Bring pressure back only once the work is complete.
5. Press the E-stop two times to clear the latched ZX-451 fault [1].
6. Check that the DECK pressure stays at 210 bar for 60 seconds; only then return to AUTO [1].`,
        `Per section 7 of the Zephyr manual [1], do the following.
Isolate the press under your site's lockout procedure and relieve the pressure until it reads zero.
Recalibrate the PT-7 transducer so the zero point reads exactly 4.2 mA.
Torque the four manifold bolts to 38 Nm in a cross pattern.
Remove the lockout and clear the area.
Cycle the E-stop twice to clear the latched ZX-451 fault.
Confirm DECK pressure holds 210 bar for 60 seconds before returning to AUTO.`,
        `Wear gloves and eye protection, and notify the operator before you start. Stop and lock out the press, then relieve the pressure and verify it reads zero.
1. Recalibrate the PT-7 transducer so the zero point reads exactly 4.2 mA [1].
2. Torque the four manifold bolts to 38 Nm in a cross pattern [1].
3. Refit the guards, clear the area and remove the lockout before the press is reset or restarted.
4. Cycle the E-stop twice to clear the latched ZX-451 fault [1].
5. Confirm DECK pressure holds 210 bar for 60 seconds before returning to AUTO [1].`,
        `To clear fault ZX-451, start by making the press safe: lock it out, relieve the hydraulic pressure and verify zero pressure before any work on the manifold. Re-zero the PT-7 transducer so that it outputs exactly 4.2 mA at its zero point [1]. Next, tighten all four manifold bolts to 38 Nm in a criss-cross sequence [1]. When that is done, take off the lockout, make sure nobody is near the press and bring the pressure back up. Push the E-stop twice, which clears the latched fault [1]. Lastly, watch the DECK pressure: it has to stay at 210 bar for 60 seconds before the controller goes back to AUTO [1].`,
      ];
      const ZEPHYR_45 = ZEPHYR.replace("38 Nm", "45 Nm");
      const N = FAITHFUL.map((t, i) => [i + 1, t] as const);
      it("precondition: ten texts, each states 38 Nm, and the edited page holds 45 Nm instead", () => {
        expect(FAITHFUL).toHaveLength(10);
        for (const t of FAITHFUL) expect(t).toContain("38 Nm");
        expect(ZEPHYR_45).toContain("45 Nm");
        expect(ZEPHYR_45).not.toContain("38 Nm");
        expect(ZEPHYR_FLAT).not.toContain("\n");
      });
      it.each(N)("accept: faithful #%i on the wrapped page has no gap", (_i, t) => {
        expect(z(t, ZEPHYR)).toEqual([]);
      });
      it.each(N)("accept: faithful #%i on the same page with whitespace collapsed has no gap", (_i, t) => {
        expect(z(t, ZEPHYR_FLAT)).toEqual([]);
      });
      it.each(N)("stop: faithful #%i against the page edited to 45 Nm is a value gap", (_i, t) => {
        expect(zr(t, ZEPHYR_45)).toEqual(["value"]);
      });
    });

    describe("U17 a cited preamble that restates the question (deliberate change from #6020)", () => {
      it("served: the preamble's only words are the question's and the machine's", () => {
        expect(z(`The corrective action for fault ZX-451 on the Zephyr ZX-9000 is as follows [1]:\n${CYCLE}`)).toEqual([]);
      });
      it("control: an invented step on a page holding only the machine's name is still a terms gap", () => {
        // As in the #6020 case above: the machine's name ("hydraulic press") is the identity, so it is not support.
        const NAME = "Zephyr ZX-9000 hydraulic press controller.";
        expect(NAME.toLowerCase()).not.toMatch(/seal|ram|replace/);
        expect(all("With the press locked out, replace the ram seal kit [1].", NAME, ZQ, "Zephyr ZX-9000 hydraulic press")).toEqual([{ citationId: "1", reason: "terms" }]);
      });
    });

    describe("the design's word-list warts are dropped: 'cover' and 'wear' are not neutral", () => {
      it("control: a cited step whose only distinctive word is 'cover' needs it on the page", () => {
        expect(PAINT_T.toLowerCase()).not.toContain("cover");
        expect(all("Refit the cover [1].", PAINT_T)).toEqual([{ citationId: "1", reason: "terms" }]);
      });
      it("control: a cited step whose only distinctive word is 'wear' needs it on the page", () => {
        expect(PAINT_T.toLowerCase()).not.toContain("wear");
        expect(all("Check for wear [1].", PAINT_T)).toEqual([{ citationId: "1", reason: "terms" }]);
      });
    });
  });
});

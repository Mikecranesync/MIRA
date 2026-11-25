/**
 * #5864: the hazard-topic detector, run over the frozen corpus in
 * `__fixtures__/unsafe-practice-corpus.json`. Every case is its own test:
 *   - `must`:  the class must get its caution (the recall contract),
 *   - `never`: the class must stay silent (the precision contract),
 *   - neither: a standing caution is acceptable there; not asserted.
 * The corpus was written before the detector, plus one held-out batch scored
 * once before it was folded in (see the corpus `_doc`).
 *
 * Run: npx vitest run src/capabilities/unsafe-practice-advisory.test.ts
 */
import { describe, expect, it } from "vitest";
import corpus from "./__fixtures__/unsafe-practice-corpus.json";
import {
  LIVE_SCREEN_CLEANING_CARD,
  OPEN_ENCLOSURE_CARD,
  unsafePractices,
  unsafePracticeWarning,
} from "./unsafe-practice-advisory";
import { isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";
import { safetyBypassAsk, safetyBypassWarning } from "./safety-bypass-advisory";

type Case = { src: string; text: string; must?: string[]; never?: string[] };
const cases = (corpus as { cases: Case[] }).cases;
const CLASS: Record<string, "live-screen-cleaning" | "open-electrical-enclosure"> = {
  screen: "live-screen-cleaning",
  enclosure: "open-electrical-enclosure",
};
const CARD = { screen: LIVE_SCREEN_CLEANING_CARD, enclosure: OPEN_ENCLOSURE_CARD } as const;

describe("corpus: the shape is what this file asserts", () => {
  it("has the two reported asks, every Codex scenario and both contracts", () => {
    expect(cases.filter((c) => c.src === "rosa")).toHaveLength(3);
    const codex = new Set(cases.filter((c) => c.src.startsWith("codex-")).map((c) => c.src));
    for (const f of ["codex-r1-F1", "codex-r1-F2", "codex-r1-F3", "codex-r2-F1", "codex-r2-F3", "codex-r2-F5", "codex-r3-F7", "codex-r3-F8", "codex-r3-F9", "codex-r3-F10", "codex-r3-F11", "codex-r4-F12", "codex-r4-F13"]) {
      expect(codex.has(f)).toBe(true);
    }
    expect(cases.filter((c) => c.must?.length).length).toBeGreaterThanOrEqual(80);
    expect(cases.filter((c) => c.never?.length).length).toBeGreaterThanOrEqual(35);    for (const c of cases) for (const k of [...(c.must ?? []), ...(c.never ?? [])]) expect(CLASS[k]).toBeDefined();
  });
});

describe("recall: every must case gets its caution", () => {
  for (const c of cases.filter((x) => x.must?.length)) {
    it(`[${c.src}] ${c.text}`, () => {
      const got = unsafePractices(c.text);
      for (const k of c.must!) {
        expect(got).toContain(CLASS[k]);
        expect(unsafePracticeWarning(c.text)).toContain(CARD[k as keyof typeof CARD]);
      }
    });
  }
});

describe("precision: every never case stays silent for that class", () => {
  for (const c of cases.filter((x) => x.never?.length)) {
    it(`[${c.src}] ${c.text}`, () => {
      const got = unsafePractices(c.text);
      for (const k of c.never!) expect(got).not.toContain(CLASS[k]);
    });
  }
});

describe("#5864 preconditions: the reported asks reach no other notebook safety detector", () => {
  for (const c of cases.filter((x) => x.src === "rosa" || x.src === "codex-r2-F1")) {
    it(c.text.slice(0, 50), () => {
      expect(notebookSafetyTrigger(c.text)).toBeNull();
      expect(isEnergizedWorkAsk(c.text)).toBe(false);
      expect(safetyBypassAsk(c.text)).toBeNull();
      expect(safetyBypassWarning(c.text)).toBeNull();
    });
  }
});

describe("composition", () => {
  it("both topics in one message give both cards, in a fixed order, once each", () => {
    const both = cases.find((c) => c.src === "rosa" && c.must?.length === 2)!;
    expect(unsafePractices(both.text)).toEqual(["live-screen-cleaning", "open-electrical-enclosure"]);
    expect(unsafePracticeWarning(both.text)).toBe(`${LIVE_SCREEN_CLEANING_CARD}\n\n${OPEN_ENCLOSURE_CARD}`);
  });

  it("an ordinary question, and nothing, get nothing", () => {
    expect(unsafePracticeWarning("What does fault F004 mean?")).toBeNull();
    expect(unsafePracticeWarning("")).toBeNull();
    expect(unsafePracticeWarning("   ")).toBeNull();
  });

  it("the cards are standing cautions: no page citation and no permission", () => {
    for (const c of [LIVE_SCREEN_CLEANING_CARD, OPEN_ENCLOSURE_CARD]) {
      expect(c).not.toMatch(/\bp\.\s?\d|\[\d\]|that'?s fine|is fine|you can\b/i);
    }
  });
});

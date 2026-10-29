/**
 * #4372 safety Phase 1 — L4 number-safe renderer and the shadow verdict.
 * The renderer's own output must pass the verifier with zero blocks (it may only quote numbers an
 * applicable source states), always follows a wait with the meter test (SE-1), never presents a
 * wait or a dark LED as proof (SE-2), and never says the equipment is safe (SYS-1).
 */
import { describe, expect, it } from "vitest";
import { numberSafeFallback, renderDischargeProcedure, shadowNumbersVerdict } from "./index";
import { extractNumbers } from "./extract";
import { verifyNumbers } from "./verify";
import type { BoundAsset, EvidenceChunk } from "./types";
import * as F from "./dev-fixtures";

function reverify(text: string, chunks: EvidenceChunk[], bound: BoundAsset | null) {
  const ex = extractNumbers({ answerText: text, chunks, bound });
  return verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks, bound });
}

const CASES: Array<[string, EvidenceChunk[], BoundAsset | null]> = [
  ["no source", [], F.GS10],
  ["GS10 p6-3 + p6-4 (conflicting times, threshold)", [F.gs10p63("c1"), F.gs10p64("c2")], F.GS10],
  ["GS10 p6-3, 5 hp rating known", [F.gs10p63("c1")], { ...F.GS10, rating: { value: 5, unit: "hp" } }],
  ["PowerFlex 40 single value", [F.pf40p9("c1")], F.PF40],
  ["sibling vendor_fallback only", [F.gs4warn("c1", { retrievalScope: "vendor_fallback" })], F.GS10],
  ["threshold stated only for a rating", [F.manualChunk("c1", "For ≥ 40hp models the voltage between DC+ and DC- should be less than 50VDC.", F.GS10, F.GS10_SHA, "6-9")], F.GS10],
  ["single conditioned value",[F.manualChunk("c1", "When the power is off after 5 minutes for ≤ 30hp models, confirm that the capacitors have fully discharged.", F.GS10, F.GS10_SHA, "6-3")], F.GS10],
];

describe("renderDischargeProcedure", () => {
  it.each(CASES)("%s: its own output passes the verifier with no block", (_n, chunks, bound) => {
    const text = renderDischargeProcedure({ chunks, bound });
    const r = reverify(text, chunks, bound);
    expect(r.checks.filter((c) => c.verdict.startsWith("block:"))).toEqual([]);
    expect(r.verdict).not.toBe("block");
  });

  it.each(CASES)("%s: the meter test follows the wait, SE-2 sentence present, never 'safe'", (_n, chunks, bound) => {
    const lines = renderDischargeProcedure({ chunks, bound }).split("\n");
    const wait = lines.findIndex((l) => /\bwait\b/i.test(l));
    const meter = lines.findIndex((l) => /measure DC\+ to DC- and each DC terminal to ground/.test(l));
    expect(wait).toBeGreaterThanOrEqual(0);
    expect(meter).toBeGreaterThan(wait);
    expect(lines.join(" ")).toMatch(/does not prove the bus is discharged: only the meter reading does/);
    expect(lines.join(" ")).not.toMatch(/\bsafe\b/i);
  });

  it("no applicable source: no number at all — per the label or manual, then measure", () => {
    const text = renderDischargeProcedure({ chunks: [F.gs4warn("c1", { retrievalScope: "vendor_fallback" })], bound: F.GS10 });
    expect(text).not.toMatch(/\d/);
    expect(text).toMatch(/warning label or stated in its manual/);
    expect(text).toMatch(/below the level the drive's label or manual states/);
  });

  it("conflicting GS10 times: each with its rating, the longest as the fallback, the manual's threshold cited", () => {
    const text = renderDischargeProcedure({ chunks: [F.gs10p63("c1"), F.gs10p64("c2")], bound: F.GS10 });
    expect(text).toMatch(/For drives rated 30 hp or less, wait at least 5 minutes .*\[1\]\./);
    expect(text).toMatch(/For drives rated 40 hp or more, wait at least 10 minutes .*\[1\]\./);
    expect(text).toMatch(/wait the longest time the manual gives, 10 minutes \[1\]\./);
    // Both pages state < 25 VDC; since round 2b p6-3's "between + and -" sentence is read too.
    expect(text).toMatch(/confirm the reading is below 25 V \[[12]\]\./);
  });

  it("a known 5 hp rating renders the single applicable time", () => {
    const text = renderDischargeProcedure({ chunks: [F.gs10p63("c1")], bound: { ...F.GS10, rating: { value: 5, unit: "hp" } } });
    expect(text).toMatch(/^Wait at least 5 minutes after power is removed/);
    expect(text).not.toMatch(/10 minutes/);
  });

  it("numberSafeFallback renders only for a blocked verdict", () => {
    const chunks = [F.gs10p64()];
    const blocked = reverify("Wait 3 minutes for the capacitors to discharge [1].", chunks, F.GS10);
    const passed = reverify("Wait 10 minutes for the capacitors to discharge [1].", chunks, F.GS10);
    expect(blocked.verdict).toBe("block");
    expect(numberSafeFallback(blocked, { chunks, bound: F.GS10 })).toMatch(/measure DC\+ to DC-/);
    expect(passed.verdict).toBe("pass");
    expect(numberSafeFallback(passed, { chunks, bound: F.GS10 })).toBeNull();
  });
});

describe("shadowNumbersVerdict — telemetry-safe", () => {
  it("returns closed-vocabulary codes and counts only, never answer or source text", () => {
    const answerText = "Typically wait 5 minutes for the DC bus capacitors to discharge [1]. Torque to 4.4 lb-in [1].";
    const v = shadowNumbersVerdict({ answerText, chunks: [F.gs10p64()], bound: F.GS10 });
    expect(v).toEqual({
      verdict: "block",
      enforcedCodes: ["block:not_in_cited_sentence"],
      deferredCodes: ["block:not_in_cited_sentence"],
      enforcedCount: 1,
      deferredCount: 1,
    });
    const s = JSON.stringify(v);
    for (const leak of ["minutes", "Torque", "capacitors", "25VDC", "GS10"]) expect(s).not.toContain(leak);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATTACHED_MISS_LEAD,
  ATTACHED_MISS_REPLACEMENTS,
  answersOnAttachedMiss,
  attachedMissPrompt,
  miraContractEnabled,
} from "@/capabilities/mira-contract";
import { isRefusal } from "@/app/api/equipment-notebooks/[id]/chat/route";

/**
 * #3959 slice 1 — the attached-miss lane (owner decisions 2026-10-05:
 * "Grounded when attached+hit"; flag wiring "Build it; I add compose lines").
 */

const ROUTE = resolve(__dirname, "../../app/api/equipment-notebooks/[id]/chat/route.ts");
/** The notebook route's general prompt, read from source: route.ts exports only
 *  handlers and test seams, and this drift test must see the live text. */
function liveGeneralPrompt(): string {
  const src = readFileSync(ROUTE, "utf8");
  const m = src.match(/const GENERAL_SYSTEM_PROMPT = `([\s\S]*?)`;\n/);
  if (!m) throw new Error("GENERAL_SYSTEM_PROMPT not found in the notebook chat route");
  return m[1];
}

afterEach(() => {
  delete process.env.MIRA_PERSONA_CONTRACT;
});

describe("MIRA_PERSONA_CONTRACT", () => {
  it("is off unless set to exactly 1", () => {
    expect(miraContractEnabled()).toBe(false);
    process.env.MIRA_PERSONA_CONTRACT = "true";
    expect(miraContractEnabled()).toBe(false);
    process.env.MIRA_PERSONA_CONTRACT = "1";
    expect(miraContractEnabled()).toBe(true);
  });
});

describe("answersOnAttachedMiss — decision (b)", () => {
  const miss = { general: false, sourceOnly: false, chunkCount: 0, machineSpecificQuestion: false };

  it("answers an attached-but-unmatched turn only with the flag on", () => {
    expect(answersOnAttachedMiss(miss)).toBe(false);
    process.env.MIRA_PERSONA_CONTRACT = "1";
    expect(answersOnAttachedMiss(miss)).toBe(true);
  });

  it.each([
    ["excerpts came back (grounded, as main already does)", { chunkCount: 2 }],
    ["the technician asked for source-only answers", { sourceOnly: true }],
    ["a general (no-sources) turn — it already answers", { general: true }],
    ["the question is about THIS machine in a machine-bound notebook (#4068)", { machineSpecificQuestion: true }],
  ])("never when %s", (_label, over) => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    expect(answersOnAttachedMiss({ ...miss, ...over })).toBe(false);
  });
});

describe("attachedMissPrompt — the general prompt with only its false lines changed", () => {
  it("rewrites the live general prompt (drift guard: every anchor is present exactly once)", () => {
    const general = liveGeneralPrompt();
    const out = attachedMissPrompt(general);
    expect(out).not.toBeNull();
    expect(out).not.toContain("No manual for this machine has been loaded");
    expect(out).not.toContain("You searched NO documentation");
    expect(out).toContain(`Begin the answer with exactly this sentence: "${ATTACHED_MISS_LEAD}"`);
  });

  it("keeps every other line byte for byte — the bracket ban, NFPA 70E, the plant-specific abstain", () => {
    const general = liveGeneralPrompt();
    let back = attachedMissPrompt(general) as string;
    for (const [from, to] of ATTACHED_MISS_REPLACEMENTS) back = back.replace(to, from);
    expect(back).toBe(general);
    for (const kept of [
      "NEVER write bracketed numeric markers like [1] or [2].",
      "NFPA 70E",
      "If a question asks for plant-specific values",
    ]) {
      expect(attachedMissPrompt(general)).toContain(kept);
    }
  });

  it("returns null when the general prompt no longer carries a line it must replace", () => {
    expect(attachedMissPrompt(liveGeneralPrompt().replace("You searched NO documentation.", "You searched."))).toBeNull();
  });
});

describe("the lead sentence can never be read as a refusal", () => {
  it.each([
    ATTACHED_MISS_LEAD,
    `${ATTACHED_MISS_LEAD} Check the contactor coil voltage first, then the overload.`,
  ])("isRefusal(%s) is false", (answer) => {
    expect(isRefusal(answer)).toBe(false);
  });

  it("control: a genuine documents refusal still is one", () => {
    expect(isRefusal("I couldn't find that in the documents you selected.")).toBe(true);
  });
});

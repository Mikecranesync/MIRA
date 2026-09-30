/**
 * MIRA's prompts give the model an example isolation clause to copy. On main
 * that example said "…the DC bus verified at 0 V, check…", and the answer
 * checker's exact-rating rule reads "voltage … at 0 V" as an invented machine
 * rating — so the safer the answer, the more likely it was replaced with "I
 * can't verify that machine-specific detail" (#3959: 4 of 6 staging drafts;
 * 2026-09-28 exam Q3, trace 8f88d2c3…).
 *
 * Mike, 2026-09-28: fix it at the prompt, keep the checker strict (#4093
 * closed). This test pins that every example isolation clause the prompts
 * teach passes the real checker, so the two can never drift apart again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ISOLATION_STEP_RULE } from "./answer-shape";
import { unsupportedExactRating, validateAnswer } from "./answer-validation";

function general(answerText: string) {
  return validateAnswer({
    answerText,
    question: "Why does the contactor chatter?",
    general: true,
    served: true,
    refused: false,
    evidenceSufficient: false,
  });
}

const stepRuleExample = /e\.g\. '([^']+)'/.exec(ISOLATION_STEP_RULE)?.[1] ?? "";
const routeSource = readFileSync(
  join(__dirname, "..", "app", "api", "equipment-notebooks", "[id]", "chat", "route.ts"),
  "utf8",
);
const routeExample = /same sentence as the instruction[^"]*e\.g\. "([^"]+)"/i.exec(routeSource)?.[1] ?? "";

describe("every isolation example the prompts teach passes the answer checker", () => {
  it.each([
    ["answer-shape ISOLATION_STEP_RULE", stepRuleExample],
    ["notebook chat MIRA_CORE", routeExample],
  ])("%s", (_label, example) => {
    expect(example.length).toBeGreaterThan(20); // the example was found
    expect(example).toMatch(/isolated|locked out/i);
    expect(unsupportedExactRating(example)).toBeNull();
    expect(general(example.replace(/\s*\[\d+\]/g, "")).ok).toBe(true);
  });

  it.each([
    ["answer-shape ISOLATION_STEP_RULE", ISOLATION_STEP_RULE],
    ["notebook chat MIRA_CORE", routeSource],
  ])("%s tells the model to write the verification without a voltage number", (_label, prompt) => {
    // The examples alone never tripped the checker; the model's paraphrase
    // ("the supply voltage verified at 0 V") did. This instruction is the lever.
    expect(prompt).toMatch(/verification without a voltage\s+(?:"\s*\+\s*")?number/);
  });

  it("control: the old 'verified at 0 V' wording is exactly what the checker refuses", () => {
    expect(
      unsupportedExactRating("With the drive locked out and the supply voltage verified at 0 V, check the terminals."),
    ).not.toBeNull();
  });
});

describe("the general prompt answers a teaching question as an explanation (#4122)", () => {
  // "How does a VFD control motor speed?" came back as a 5-step procedure with
  // "powered but locked out" readings: the shape rule demanded a check list for
  // every question. The carve-out keeps the check list for troubleshooting only.
  const general = /const GENERAL_SYSTEM_PROMPT = `([\s\S]*?)`;/.exec(routeSource)?.[1] ?? "";

  it("keeps the check list for troubleshooting and excludes how-it-works questions", () => {
    expect(general.length).toBeGreaterThan(500);
    expect(general).toMatch(/If the technician is troubleshooting or doing work on equipment, lead with/);
    expect(general).toMatch(/If the question asks how something works, what something means, or what a term is, answer it as an explanation/);
    expect(general).toMatch(/Do NOT turn it into a procedure/);
  });
});

// Behavior + parity guard for the shared Hub safety classifier.
//
// Regression context (2026-08-04, post-#3108): the Hub chat routes matched
// SAFETY_PHRASES with an UNCONDITIONAL substring check, while Python's
// classify_intent (mira-bots/shared/guardrails.py) has two tiers — an
// IMMEDIATE list that always stops, and a general list gated by an
// educational-question carve-out. Result: "What is an exploded view?" was
// safety-stopped on the Hub (substring "exploded") but routed to normal
// industrial handling on Slack/Telegram. This file pins the ported behavior
// AND source-of-truth parity for the two new components (the IMMEDIATE list
// and the educational regex), the same way safety-phrases.test.ts pins the
// general keyword list.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  SAFETY_PHRASES_IMMEDIATE,
  EDUCATIONAL_QUESTION_PATTERN,
  matchSafetyStop,
} from "./safety-classifier";

const GUARDRAILS_PATH = join(__dirname, "..", "..", "..", "mira-bots", "shared", "guardrails.py");
const guardrailsSource = readFileSync(GUARDRAILS_PATH, "utf8");

// ── source-of-truth parity ──────────────────────────────────────────────────

function extractImmediateKeywords(source: string): string[] {
  const match = source.match(/SAFETY_KEYWORDS_IMMEDIATE\s*=\s*frozenset\(\s*\[([\s\S]*?)\n\s*\]\s*\)/);
  if (!match) throw new Error("Could not locate SAFETY_KEYWORDS_IMMEDIATE in guardrails.py");
  const phrases: string[] = [];
  const stringRe = /["']([^"'\n]+)["']/;
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    const m = stringRe.exec(line);
    if (m) phrases.push(m[1]);
  }
  return phrases;
}

function extractEducationalPattern(source: string): string {
  const match = source.match(/_EDUCATIONAL_QUESTION_RE\s*=\s*re\.compile\(([\s\S]*?)re\.IGNORECASE/);
  if (!match) throw new Error("Could not locate _EDUCATIONAL_QUESTION_RE in guardrails.py");
  const segments = [...match[1].matchAll(/r"([^"]*)"/g)].map((m) => m[1]);
  if (segments.length === 0) throw new Error("No pattern segments parsed from _EDUCATIONAL_QUESTION_RE");
  return segments.join("");
}

describe("parity with guardrails.py classifier components", () => {
  it("SAFETY_PHRASES_IMMEDIATE matches SAFETY_KEYWORDS_IMMEDIATE exactly", () => {
    const python = extractImmediateKeywords(guardrailsSource);
    expect(python.length).toBeGreaterThan(10);
    const hubSet = new Set(SAFETY_PHRASES_IMMEDIATE);
    const pySet = new Set(python);
    const missing = python.filter((p) => !hubSet.has(p));
    const extra = SAFETY_PHRASES_IMMEDIATE.filter((p) => !pySet.has(p));
    expect(missing, `Hub IMMEDIATE list missing: ${JSON.stringify(missing)}`).toEqual([]);
    expect(extra, `Hub IMMEDIATE list has extras: ${JSON.stringify(extra)}`).toEqual([]);
  });

  it("EDUCATIONAL_QUESTION_PATTERN matches the Python regex source exactly", () => {
    expect(EDUCATIONAL_QUESTION_PATTERN).toBe(extractEducationalPattern(guardrailsSource));
  });
});

// ── behavior — mirrors Python classify_intent's safety short-circuit ────────

describe("matchSafetyStop behavior", () => {
  it("educational question mentioning an industrial term is NOT stopped", () => {
    expect(matchSafetyStop("What is an exploded view?")).toBeNull();
    expect(matchSafetyStop("WHAT IS AN EXPLODED VIEW")).toBeNull();
    expect(matchSafetyStop("what's an exploded view diagram?")).toBeNull();
  });

  it("educational framings of general safety concepts are NOT stopped", () => {
    expect(matchSafetyStop("What is arc flash?")).toBeNull();
    expect(matchSafetyStop("How do I perform lockout tagout?")).toBeNull();
    expect(matchSafetyStop("Explain confined space entry requirements")).toBeNull();
  });

  it("active hazard reports ARE stopped, even with an educational-looking opener", () => {
    // Tier 1 bypasses the educational carve-out — "the " prefix matches the
    // educational regex but an active incident must still stop.
    expect(matchSafetyStop("the panel just exploded and there is smoke coming out")).not.toBeNull();
    expect(matchSafetyStop("The Panel Just EXPLODED")).not.toBeNull();
    expect(matchSafetyStop("Is it safe to work on this live?")).not.toBeNull();
    expect(matchSafetyStop("there are exposed wires near the panel")).not.toBeNull();
  });

  it("non-educational phrasing of general safety keywords still stops", () => {
    expect(matchSafetyStop("arc flash just occurred at the MCC")).not.toBeNull();
    expect(matchSafetyStop("chemical spill on the line, machine still running")).not.toBeNull();
  });

  it("returns the matched phrase for logging", () => {
    expect(matchSafetyStop("I can smell burning near the drive")).toBe("smell burning");
  });

  it("ordinary diagnostic questions pass through", () => {
    expect(matchSafetyStop("What does fault F004 on an Allen-Bradley PowerFlex 525 mean?")).toBeNull();
    expect(matchSafetyStop("my conveyor keeps tripping after startup")).toBeNull();
  });
});

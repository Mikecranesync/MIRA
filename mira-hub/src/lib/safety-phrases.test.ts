// Parity guard for T3 (master-plan) / duplicate-systems-audit.md finding #1.
//
// mira-hub/src/lib/safety-phrases.ts claims to transcribe
// mira-bots/shared/guardrails.py's SAFETY_KEYWORDS list exactly. This test
// parses the Python source at test time and fails loudly — with a diff of
// missing/extra phrases — if the two lists ever drift again. This is the
// regression guard for the bug that motivated T3: the Hub's old hand-copied
// list silently missed the entire physical-hazard category ("melted
// insulation", "burn mark", "visible smoke", ...), so a technician reporting
// melted insulation hard-stopped on Slack/Telegram but got normal LLM
// troubleshooting on the Hub.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { SAFETY_PHRASES } from "./safety-phrases";

const GUARDRAILS_PATH = join(__dirname, "..", "..", "..", "mira-bots", "shared", "guardrails.py");

function extractSafetyKeywords(source: string): string[] {
  // Isolate the `SAFETY_KEYWORDS = [ ... ]` block (stops at the first
  // top-level closing bracket on its own line after the opening line).
  const match = source.match(/SAFETY_KEYWORDS\s*=\s*\[([\s\S]*?)\n\]/);
  if (!match) {
    throw new Error("Could not locate SAFETY_KEYWORDS = [...] block in guardrails.py");
  }
  const body = match[1];
  const phrases: string[] = [];
  const stringRe = /["']([^"'\n]+)["']/;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    // Each list entry is one string literal per line, optionally followed by
    // an inline `# "comment text"` — take only the FIRST quoted string so a
    // quoted phrase inside a trailing comment (e.g. the `pull the power`
    // line's `# "pull the power feed/cable while running"` note) isn't
    // mistaken for a second list entry.
    const m = stringRe.exec(line);
    if (m) phrases.push(m[1]);
  }
  return phrases;
}

describe("SAFETY_PHRASES parity with mira-bots/shared/guardrails.py SAFETY_KEYWORDS", () => {
  const guardrailsSource = readFileSync(GUARDRAILS_PATH, "utf8");
  const pythonPhrases = extractSafetyKeywords(guardrailsSource);

  it("guardrails.py SAFETY_KEYWORDS parsed to a non-trivial list (sanity check on the regex)", () => {
    expect(pythonPhrases.length).toBeGreaterThan(20);
  });

  it("mira-hub's SAFETY_PHRASES contains every phrase in guardrails.py SAFETY_KEYWORDS", () => {
    const hubSet = new Set(SAFETY_PHRASES);
    const missing = pythonPhrases.filter((p) => !hubSet.has(p));
    expect(missing, `Hub SAFETY_PHRASES is missing phrases present in guardrails.py: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("mira-hub's SAFETY_PHRASES contains no phrase absent from guardrails.py SAFETY_KEYWORDS", () => {
    const pySet = new Set(pythonPhrases);
    const extra = SAFETY_PHRASES.filter((p) => !pySet.has(p));
    expect(extra, `Hub SAFETY_PHRASES has phrases not present in guardrails.py: ${JSON.stringify(extra)}`).toEqual([]);
  });

  it("sets are exactly equal (belt-and-suspenders on top of the two directional checks)", () => {
    expect(new Set(SAFETY_PHRASES)).toEqual(new Set(pythonPhrases));
  });
});

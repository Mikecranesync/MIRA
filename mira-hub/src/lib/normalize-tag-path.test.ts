// Parity guard for T5 (master-plan) — the tag_entities -> approved_tags ingest bridge.
//
// mira-hub/src/lib/normalize-tag-path.ts claims to reproduce
// mira-relay/ingest_contract.py::normalize_tag_path exactly. This test parses the Python source
// at test time and fails loudly if the algorithm (regex character class, operation order, or the
// empty-input short-circuit) ever drifts — mirrors the T3 `safety-phrases.test.ts` pattern.
//
// Why this matters: `approved_tags.normalized_tag_path` (mig 035) is THE fail-closed match key
// the relay uses to gate ingest (`mira-relay/tag_ingest.py::load_allowlist`). If the Hub computes
// a different normalized path than the relay for the same raw tag, a Hub-approved tag silently
// never matches incoming traffic.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { normalizeTagPath } from "./normalize-tag-path";

const INGEST_CONTRACT_PATH = join(__dirname, "..", "..", "..", "mira-relay", "ingest_contract.py");

describe("normalizeTagPath parity with mira-relay/ingest_contract.py normalize_tag_path", () => {
  const source = readFileSync(INGEST_CONTRACT_PATH, "utf8");

  it("sanity: normalize_tag_path is still defined in ingest_contract.py", () => {
    expect(source).toContain("def normalize_tag_path(raw: str) -> str:");
  });

  it("drift guard: the _NON_ALNUM character class is still [^a-z0-9]+", () => {
    const m = source.match(/_NON_ALNUM\s*=\s*re\.compile\(r"([^"]+)"\)/);
    expect(m, "could not locate `_NON_ALNUM = re.compile(r\"...\")` in ingest_contract.py").not.toBeNull();
    expect(m![1]).toBe("[^a-z0-9]+");
  });

  it("drift guard: empty/falsy raw still short-circuits to ''", () => {
    expect(source).toMatch(/if not raw:\s*\n\s*return ""/);
  });

  it("drift guard: the transform is still strip().lower() -> sub('_') -> strip('_'), in that order", () => {
    expect(source).toContain('return _NON_ALNUM.sub("_", raw.strip().lower()).strip("_")');
  });

  // Representative cases: the empty/whitespace edge, the docstring's own worked example, a real
  // seeded path from tools/seeds/approved_tags_conveyor.sql (per the integration-seams-register
  // Seam 15 note), a colon/dot-delimited Rockwell L5X-style symbol, and separator/case/underscore
  // edge cases that exercise run-collapsing and the final strip.
  const cases: [string, string][] = [
    ["", ""],
    ["   ", ""],
    ["Mira_Monitored/Conveyor/Motor_Current", "mira_monitored_conveyor_motor_current"],
    ["[default]Mira_Monitored/conveyor_demo/State", "default_mira_monitored_conveyor_demo_state"],
    ["Local:1:I.Data.0", "local_1_i_data_0"],
    ["  Leading And Trailing Spaces  ", "leading_and_trailing_spaces"],
    ["ALLCAPS-TAG", "allcaps_tag"],
    ["already_normalized", "already_normalized"],
    ["__double__underscore__", "double_underscore"],
    ["mixed/-._chars", "mixed_chars"],
  ];

  it.each(cases)("normalizeTagPath(%j) === %j", (input, expected) => {
    expect(normalizeTagPath(input)).toBe(expected);
  });
});

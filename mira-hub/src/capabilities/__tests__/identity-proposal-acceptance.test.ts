/**
 * #4120 frozen acceptance set. The fixture's sha256 is pinned: changing an
 * expected outcome is an owner decision, never a parser tweak.
 *
 * Run: npx vitest run src/capabilities/__tests__/identity-proposal-acceptance.test.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proposeIdentityFromText } from "../identity-proposal";

const RAW = readFileSync(join(__dirname, "fixtures/identity-proposal-acceptance.json"), "utf8");
const SET = JSON.parse(RAW) as {
  corpus: string[];
  cases: { category: string; id?: string; text: string; expect: { manufacturer: string; model: string } | null }[];
};

describe("#4120 frozen acceptance set", () => {
  it("the fixture is the frozen one", () => {
    expect(createHash("sha256").update(RAW).digest("hex")).toBe("e58f8b44efda0334202b60e5e0190d5f561eff7d6eb43883a5b873f9bdd0549b");
  });
  it.each(SET.cases.map((c) => [`${c.category}${c.id ? ` ${c.id}` : ""}: ${c.text}`, c] as const))("%s", (_n, c) => {
    expect(proposeIdentityFromText(c.text, SET.corpus)).toEqual(c.expect);
  });
});

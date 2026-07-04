import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression pin for #2427: the wizard's step-forward buttons must read
// "Next" (common.next), not the destination-step noun ("Description" /
// "Review"), which reads as a heading rather than an action.

const pageSource = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

function messages(locale: string): Record<string, Record<string, string>> {
  const file = path.join(__dirname, "../../../../messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("workorders/new wizard forward buttons (#2427)", () => {
  it("uses common.next on every ArrowRight forward button", () => {
    const forwardButtons = pageSource.match(/\{t\w*\("[^"]+"\)\} <ArrowRight/g) ?? [];
    expect(forwardButtons.length).toBeGreaterThanOrEqual(2);
    for (const btn of forwardButtons) {
      expect(btn).toContain('{tCommon("next")}');
    }
  });

  it("defines common.next in en and es (missing next-intl keys render raw key text)", () => {
    expect(messages("en").common.next).toBe("Next");
    expect(messages("es").common.next).toBe("Siguiente");
  });
});

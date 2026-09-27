import { describe, expect, it } from "vitest";
import { ANSWER_LANGUAGE_RULE, withAnswerLanguage } from "@/capabilities/answer-language";

describe("withAnswerLanguage", () => {
  it("appends the one language rule and keeps citations/identifiers verbatim", () => {
    const out = withAnswerLanguage("SYS");
    expect(out.startsWith("SYS\n\n")).toBe(true);
    expect(out).toContain(ANSWER_LANGUAGE_RULE);
    expect(ANSWER_LANGUAGE_RULE).toMatch(/\[n\] citations exactly as written/);
  });
});

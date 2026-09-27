import { describe, expect, it, vi } from "vitest";
import { ANSWER_LANGUAGE_RULE, withAnswerLanguage } from "@/capabilities/answer-language";

describe("withAnswerLanguage", () => {
  it("appends the one language rule and keeps citations/identifiers verbatim", () => {
    const out = withAnswerLanguage("SYS");
    expect(out.startsWith("SYS\n\n")).toBe(true);
    expect(out).toContain(ANSWER_LANGUAGE_RULE);
    expect(ANSWER_LANGUAGE_RULE).toMatch(/\[n\] citations exactly as written/);
  });
});

import { englishSearchQuery, looksNonEnglish } from "@/capabilities/answer-language";

describe("englishSearchQuery (non-English questions search the English corpus in English)", () => {
  it("detects Spanish, French and German maintenance questions but not English ones", () => {
    expect(looksNonEnglish("¿Qué registro Modbus del GS10 contiene el código de falla?")).toBe(true);
    expect(looksNonEnglish("comment réinitialiser le défaut du variateur")).toBe(true);
    expect(looksNonEnglish("wie ist der Fehlercode und die Ursache")).toBe(true);
    expect(looksNonEnglish("What does fault F004 mean on a PowerFlex 525")).toBe(false);
    expect(looksNonEnglish("de-energize the drive and check the DC bus")).toBe(false);
  });

  it("translates only when the question is not English, and falls back on failure", async () => {
    const translate = vi.fn(async () => "Which GS10 Modbus register holds the fault code?");
    expect(await englishSearchQuery("¿Qué registro del GS10 tiene la falla?", translate)).toBe(
      "Which GS10 Modbus register holds the fault code?",
    );
    expect(await englishSearchQuery("What does F004 mean", translate)).toBe("What does F004 mean");
    expect(translate).toHaveBeenCalledTimes(1);
    const broken = vi.fn(async () => {
      throw new Error("provider down");
    });
    expect(await englishSearchQuery("¿Qué registro?", broken)).toBe("¿Qué registro?");
    expect(await englishSearchQuery("¿Qué registro?", vi.fn(async () => null))).toBe("¿Qué registro?");
  });
});

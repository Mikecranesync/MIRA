import { describe, expect, it } from "vitest";

import { verifyAnswer } from "./claim-verifier";
import { restoreDecimalGlyph } from "./decimal-glyph";

const G = "�";

// #5128 / #5130 — AutomationDirect manuals (GS1, GS10, GS30) were ingested with
// every period as U+FFFD. Staging, read-only, 2026-11-02: 1718 chunks in 14
// documents; between two digits the glyph was a period in every sampled context.
describe("restoreDecimalGlyph", () => {
  const RESTORED: [string, string][] = [
    // GS1 ch4 p.9, the cited page behind the 30 s vs 10 s drift
    [`Range: 0${G}1 to 600${G}0 sec Default Setting: 30${G}0 sec`, "Range: 0.1 to 600.0 sec Default Setting: 30.0 sec"],
    [`increase setting values for P01${G}12-P01${G}19`, "increase setting values for P01.12-P01.19"],
    [`Default gateway 192${G}168${G}1${G}1.`, "Default gateway 192.168.1.1."],
    [`Torque = 14-16 kg-cm (12${G}1-13${G}9 lb-in)`, "Torque = 14-16 kg-cm (12.1-13.9 lb-in)"],
  ];
  for (const [input, want] of RESTORED) {
    it(`restores: ${want.slice(0, 50)}`, () => {
      expect(restoreDecimalGlyph(input)).toBe(want);
    });
  }

  // Not between two digits: the lost glyph is unknown (a period, a degree sign,
  // a bullet), so it is left exactly as stored.
  const UNCHANGED = [
    `speed tracking${G}`,
    `${G}C${G} = 5`,
    `time${G} / decel${G}`,
    `5${G} `,
    "Default Setting: 30.0 sec",
    "",
  ];
  for (const input of UNCHANGED) {
    it(`leaves alone: ${JSON.stringify(input).slice(0, 40)}`, () => {
      expect(restoreDecimalGlyph(input)).toBe(input);
    });
  }
});

// The 06:24 GS1 answer ("P1.02 default is 30.0 sec", page 9) was correct, yet the
// claim verifier filed 30.0 as absent because page 9 reads "30�0" as stored.
describe("restored evidence lets the claim verifier find 30.0", () => {
  const page9 = `P1${G}02 Decel Time 1 Range: 0${G}1 to 600${G}0 sec Default Setting: 30${G}0 sec`;
  const status = (text: string) =>
    verifyAnswer(
      { question: "what is P1.02 default", answer: "The P1.02 default is 30.0 sec [1].", evidence: [{ page: 9, text }] },
      { joinWrappedLines: true },
    ).claims.find((c) => c.key.includes("30"))?.status;
  it("stored text: not supported", () => {
    expect(status(page9)).not.toBe("supported");
  });
  it("restored text: supported", () => {
    expect(status(restoreDecimalGlyph(page9))).toBe("supported");
  });
});

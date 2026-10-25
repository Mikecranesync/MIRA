/**
 * Round-2 review on #4484 (2026-10-18): a title listing sibling numbers after
 * ONE family word was credited to the first number only — "PowerFlex 523 and
 * 525" → {PF523}, so the 525 half was invisible to a PowerFlex 525 notebook.
 * Each trailing number joined by and / & / , / or / slash now inherits the
 * family of the number before it. Applicability only (modelIdentitiesInText);
 * the single ILIKE token (resolveModelFromObservationText) is unchanged.
 */
import { describe, expect, it } from "vitest";
import { modelIdentitiesInText, resolveModelFromObservationText } from "../model-token";

describe("modelIdentitiesInText — sibling numbers listed after one family word", () => {
  it.each([
    ["PowerFlex 523 and 525 Adjustable Frequency AC Drives", ["PF523", "PF525"]],
    ["PowerFlex 523/525", ["PF523", "PF525"]],
    ["PowerFlex 523, 525 and 527", ["PF523", "PF525", "PF527"]],
    ["PowerFlex 755 or 753", ["PF755", "PF753"]],
    ["PF523 & 525", ["PF523", "PF525"]],
    ["Micro810 and 820 Programmable Controllers", ["MICRO810", "MICRO820"]],
    ["ACS580 and 880 drives", ["ACS580", "ACS880"]],
  ] as const)("%s → %j", (text, expected) => {
    expect([...modelIdentitiesInText(text)].sort()).toEqual([...expected].sort());
  });

  it.each([
    // A unit after the number is not a sibling model.
    ["PowerFlex 525 and 480V input", ["PF525"]],
    ["PowerFlex 525 and 10A fuse", ["PF525"]],
    // Two different family words were already both captured; unchanged.
    ["PowerFlex 525 and the GS10", ["PF525", "GS10"]],
    // A single model stays a single model.
    ["PowerFlex 525", ["PF525"]],
  ] as const)("control: %s → %j", (text, expected) => {
    expect([...modelIdentitiesInText(text)].sort()).toEqual([...expected].sort());
  });

  it("the single ILIKE token is untouched: a conjoined title still resolves to its FIRST number, unambiguous", () => {
    expect(resolveModelFromObservationText("PowerFlex 523 and 525 Adjustable Frequency AC Drives")).toEqual({ model: "523", ambiguous: false });
  });
});

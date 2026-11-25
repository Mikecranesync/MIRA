/**
 * #4095 gap 1 — a blank chat that names a library model but no maker.
 *
 * Found by the 2026-11-25 AI-panel battery: "What does PowerFlex 525 fault F004
 * mean?" got no proposal because every proposal path needed a typed maker,
 * though staging's library files 7,547 chunks under Rockwell Automation /
 * PowerFlex 525. The label set below is shaped on that read-only staging query.
 *
 * Run: npx vitest run src/capabilities/__tests__/identity-proposal-library-model.test.ts
 */
import { describe, expect, it } from "vitest";
import { proposeFromLibraryModel } from "../identity-proposal";

const MAKERS = ["Rockwell Automation", "AutomationDirect", "Siemens", "ABB", "Columbus McKinnon", "Magnetek", "FANUC"];
const LABELS = [
  { manufacturer: "Rockwell Automation", model: "PowerFlex 525", rows: 7547 },
  { manufacturer: "AutomationDirect", model: "GS10", rows: 2449 },
  { manufacturer: "Rockwell Automation", model: "PowerFlex 40P", rows: 1904 },
  { manufacturer: "Rockwell Automation", model: "PowerFlex 400", rows: 1586 },
  { manufacturer: "Rockwell Automation", model: "PowerFlex 40", rows: 1001 },
  { manufacturer: "Rockwell Automation", model: "PowerFlex 4M", rows: 319 },
  { manufacturer: "Rockwell Automation", model: "PowerFlex Communications", rows: 695 },
  { manufacturer: "Allen-Bradley", model: "PowerFlex 753", rows: 1373 },
  // One label under two spellings of ONE vendor group.
  { manufacturer: "Rockwell Automation", model: "Micro820", rows: 400 },
  { manufacturer: "Allen-Bradley", model: "Micro820", rows: 40 },
  // One label under two DIFFERENT makers.
  { manufacturer: "Columbus McKinnon", model: "Flex EX2", rows: 30 },
  { manufacturer: "FANUC", model: "Flex EX2", rows: 10 },
  // Labels that must never match on their own.
  { manufacturer: "Siemens", model: "G120", rows: 50 },
  { manufacturer: "Siemens", model: "https://support.industry.siemens.com/x", rows: 5 },
  // Ratings, sizes and series the real staging library stores as models (PR #5957 review F1).
  { manufacturer: "Budgit", model: "5 Ton", rows: 2 },
  { manufacturer: "Harrington", model: "3/4 TON", rows: 2 },
  { manufacturer: "Columbus McKinnon", model: "Series 602", rows: 2 },
  { manufacturer: "AutomationDirect", model: "drives g vg 4 manual", rows: 1403 },
  { manufacturer: "Rockwell Automation", model: "CENTERLINE 2100 MCC", rows: 1573 },
  { manufacturer: "Rockwell Automation", model: "SMC-3 Soft Starter", rows: 910 },
];
const propose = (text: string) => proposeFromLibraryModel(text, LABELS, MAKERS);

describe("proposeFromLibraryModel — a library model typed with no maker", () => {
  it.each([
    ["the panel's Q1", "What does PowerFlex 525 fault F004 mean?", { manufacturer: "Rockwell Automation", model: "PowerFlex 525" }],
    ["the panel's Q2", "How do I fix an overcurrent fault on a PowerFlex 525?", { manufacturer: "Rockwell Automation", model: "PowerFlex 525" }],
    ["lower case, no space", "powerflex525 keeps tripping", { manufacturer: "Rockwell Automation", model: "PowerFlex 525" }],
    ["a single-token label", "GS10 fault code list", { manufacturer: "AutomationDirect", model: "GS10" }],
    ["two spellings of one vendor group", "Micro820 won't go to run", { manufacturer: "Rockwell Automation", model: "Micro820" }],
    ["the longest label wins", "PowerFlex 40P shows F004", { manufacturer: "Rockwell Automation", model: "PowerFlex 40P" }],
  ])("%s → proposes the library machine", (_why, text, want) => {
    expect(propose(text)).toEqual(want);
  });

  it.each([
    ["a typed maker stays with the corpus reader", "Allen-Bradley PowerFlex 525 fault F004"],
    ["a typed maker with no model", "Rockwell F004 fault"],
    ["a bare fault code", "What does F004 mean?"],
    ["a fault-code-shaped label", "Siemens fault F30011 on the G120"],
    ["a fault-code-shaped label, no maker", "G120 fault F30011 meaning"],
    ["a teaching question", "How does a VFD work?"],
    ["two library models", "PowerFlex 525 or PowerFlex 753, which is better?"],
    ["two library models of different makers", "PowerFlex 525 next to a GS10"],
    ["a label filed under two different makers", "Flex EX2 transmitter will not pair"],
    ["a digitless label", "PowerFlex Communications adapter setup"],
    ["a URL label", "see https://support.industry.siemens.com/x"],
    ["a label inside a longer token", "part PowerFlex 5250 is not a real drive"],
    ["no library label at all", "SINAMICS V20 F0003"],
    ["a size stored as a model", "my 5 ton hoist won't lift"],
    ["a size stored as a model, fraction", "3/4 ton chain hoist slips"],
    ["a series stored as a model", "series 602 lever is stiff"],
    ["a sentence stored as a model", "drives g vg 4 manual please"],
    ["a comparison with an unlisted machine", "PowerFlex 525 vs Yaskawa V1000"],
    ["a second machine joined by 'and'", "PowerFlex 525 and a GuardLogix"],
    ["a second machine joined by 'or'", "PowerFlex 525 or the PLC-5"],
    // Known limit, fail-closed: a label longer than the model it contains is
    // declined today (no card, never a wrong card).
    ["known limit: a label longer than its model (all-caps family)", "CENTERLINE 2100 MCC bucket will not rack in"],
    ["known limit: a label longer than its model (model token)", "SMC-3 Soft Starter shows a fault light"],
  ])("%s → no proposal", (_why, text) => {
    expect(propose(text)).toBeNull();
  });

  it("never throws on odd input", () => {
    expect(proposeFromLibraryModel("", [], [])).toBeNull();
    expect(proposeFromLibraryModel("PowerFlex 525", [{ manufacturer: "", model: "", rows: 0 }], MAKERS)).toBeNull();
  });
});

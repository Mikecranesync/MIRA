/**
 * Codex r2 F1 on #4484: a notebook identity stored as a bare number ("850" —
 * the proposal flow strips the family) was matched to any manual whose title
 * carried the same DIGITS, so an Allen-Bradley Micro850 notebook cited an ABB
 * "ACS850 Firmware Manual" for a model-less question. The digits alone name no
 * family: a bare number now reaches a manual only through a FAMILY_ROOTS entry
 * of the notebook's own manufacturer.
 *
 * Lives under capabilities/__tests__ (ungated) rather than beside
 * src/lib/__tests__/manual-rag.test.ts, which the UI lifecycle guard protects.
 */
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "../../lib/manual-rag";

function clientWith(row: Record<string, unknown>): PoolClient {
  const query = vi.fn(async () => ({ rows: [row] }));
  return { query } as unknown as PoolClient;
}

const nodeRow = (filename: string, heading: string) => ({
  content: "Communication settings are configured in the controller properties.",
  source_url: `node-doc/u1/${filename}`,
  source_page: 2,
  page_start: 2,
  section_path: null,
  filename,
  document_heading: heading,
  rank: 0.4,
});

const ask = (heading: string, filename: string, manufacturer: string | null, model = "850") =>
  retrieveNodeChunks(clientWith(nodeRow(filename, heading)), "t-1", "communication settings", {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    identity: { manufacturer, model },
    identityStatus: "user_confirmed",
  });

describe("bare-number identity — matching digits in another vendor's family are not the same machine (Codex r2 F1)", () => {
  it("'850' on an Allen-Bradley notebook rejects the ABB ACS850 manual", async () => {
    expect(await ask("ACS850 Firmware Manual", "acs850-fw.pdf", "Allen-Bradley")).toEqual([]);
  });

  it("control: the same notebook keeps its Micro850 manual and the Micro800 family manual", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "Allen-Bradley")).toHaveLength(1);
    expect(await ask("Micro800 Programmable Controllers General Instructions", "2080-rm001.pdf", "Allen-Bradley")).toHaveLength(1);
    // Vendor spelling varies across nameplates and proposals.
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "Rockwell Automation")).toHaveLength(1);
  });

  it("the vendor tie is real: an ABB '850' never reaches the Micro850 manual", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "ABB")).toEqual([]);
  });

  it("no manufacturer ⇒ no grounded family ⇒ no family manual is admitted for a bare number", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", null)).toEqual([]);
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "  ")).toEqual([]);
  });

  it("control: the no-model-manual lenience is untouched by the vendor tie", async () => {
    expect(await ask("Controller Manual", "manual.pdf", null)).toHaveLength(1);
    expect(await ask("Controller Manual", "manual.pdf", "ABB")).toHaveLength(1);
  });

  it("control: a sibling with DIFFERENT digits in the right family is still rejected (round-1 rule stands)", async () => {
    expect(await ask("Micro810 Programmable Controllers User Manual", "2080-um001.pdf", "Allen-Bradley")).toEqual([]);
  });
});

// Codex r3 F5: the r2 vendor tie went through FAMILY_ROOTS alone, so a valid
// model OUTSIDE the small root table lost its own manual.
describe("bare-number identity — exact-model resolution is separate from family coverage (Codex r3 F5)", () => {
  it("an Allen-Bradley '40' keeps its own PowerFlex 40 manual (PF40 is in no family root)", async () => {
    expect(await ask("PowerFlex 40 User Manual", "22b-um001.pdf", "Allen-Bradley", "40")).toHaveLength(1);
  });
  it("…and still rejects a PowerFlex 400 manual (different digits) and the cross-vendor ACS850 case", async () => {
    expect(await ask("PowerFlex 400 User Manual", "22c-um001.pdf", "Allen-Bradley", "40")).toEqual([]);
    expect(await ask("ACS850 Firmware Manual", "acs850-fw.pdf", "Allen-Bradley", "850")).toEqual([]);
  });
  it("an exact-digits title of ANOTHER vendor's family is still rejected (an ABB '40' does not get PowerFlex 40)", async () => {
    expect(await ask("PowerFlex 40 User Manual", "22b-um001.pdf", "ABB", "40")).toEqual([]);
  });
  it("family-root coverage still works beside exact resolution ('850' keeps the Micro800 family manual)", async () => {
    expect(await ask("Micro800 Programmable Controllers General Instructions", "2080-rm001.pdf", "Allen-Bradley")).toHaveLength(1);
  });
});

// Codex r3 F6: a cover whose FIRST line is generic but whose heading names a
// model was read as model-free and admitted a sibling's manual.
describe("ambiguous covers are not model-free manuals (Codex r3 F6)", () => {
  const askNb = (heading: string, filename = "manual.pdf") => ask(heading, filename, "Allen-Bradley", "Micro820");
  it("'User Manual\\nMicro810 Programmable Controllers' is rejected for a Micro820 notebook", async () => {
    expect(await askNb("User Manual\nMicro810 Programmable Controllers")).toEqual([]);
  });
  it("a leading blank line before the Micro810 title is rejected too", async () => {
    expect(await askNb("\nMicro810 Programmable Controllers User Manual")).toEqual([]);
  });
  it("control: the same ambiguous cover naming the notebook's OWN model is kept", async () => {
    expect(await askNb("User Manual\nMicro820 Programmable Controllers")).toHaveLength(1);
  });
  it("control: a genuinely model-free cover keeps the lenience", async () => {
    expect(await askNb("Controller Manual")).toHaveLength(1);
  });
  it("control: a resolved Micro820 cover is retrievable as before", async () => {
    expect(await askNb("Micro820 Programmable Controllers User Manual", "2080-um001.pdf")).toHaveLength(1);
  });

  // Codex r4 F6: resolving the WHOLE heading let a cross-reference count as coverage.
  it.each([
    "User Manual\nMicro810 Programmable Controllers\nMicro820 is not covered by this manual.",
    "User Manual\nMicro810 Programmable Controllers\nFor Micro820 see the separate user manual.",
    "\nMicro810 Programmable Controllers User Manual\nRelated documents: Micro820 user manual",
  ])("F6 (r4): a Micro810 cover whose later prose mentions Micro820 is still rejected: %j", async (heading) => {
    expect(await askNb(heading)).toEqual([]);
  });
  it("F6 (r4) control: the declared title is still what counts — 'User Manual\\nMicro820 …\\nSee also Micro810' is kept", async () => {
    expect(await askNb("User Manual\nMicro820 Programmable Controllers\nSee also the Micro810 manual.")).toHaveLength(1);
  });
});

// Codex r4 F7: the proposal flow stores a FAMILY ROOT as digits ("800" for a
// Micro800); as "#800" it was scoped like a model and lost the Micro850 manual.
describe("a bare number that is a family root's number is family-only, like its word form (Codex r4 F7)", () => {
  it.each([
    ["800", "Micro850 Programmable Controllers User Manual", "2080-um002.pdf"],
    ["520", "PowerFlex 525 Adjustable Frequency AC Drive User Manual", "520-um001.pdf"],
    ["750", "PowerFlex 755 AC Drives User Manual", "750-um001.pdf"],
  ])("Allen-Bradley %j keeps the %s", async (model, heading, filename) => {
    expect(await ask(heading, filename, "Allen-Bradley", model)).toHaveLength(1);
  });
  it("…but only for the root's own vendor (an ABB '800' is a model, not the Micro800 family)", async () => {
    expect(await ask("Micro850 Programmable Controllers User Manual", "2080-um002.pdf", "ABB", "800")).toEqual([]);
  });
  it("control: a bare number that is NOT a root's number still scopes ('850' rejects Micro810)", async () => {
    expect(await ask("Micro810 Programmable Controllers User Manual", "2080-um001.pdf", "Allen-Bradley", "850")).toEqual([]);
  });
});

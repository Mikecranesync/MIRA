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
  // Codex r5 F6: the FIRST model-bearing line can itself be the exclusion.
  it.each([
    "User Manual\nMicro820 is not covered by this manual.",
    "User Manual\nFor Micro820 see the separate user manual.",
    "User Manual\nMicro820 users should refer to publication 2080-UM005.",
  ])("F6 (r5): a cover whose only model-bearing line is prose declares nothing and is rejected: %j", async (heading) => {
    expect(await askNb(heading, "Micro810_User_Manual.pdf")).toEqual([]);
  });

  // Codex r5 F8: a wrapped dual-model title below a generic opener kept only the first half.
  it.each(["User Manual\nMicro810 and\nMicro820 Programmable Controllers", "\nMicro810 and\nMicro820 Programmable Controllers User Manual"])(
    "F8 (r5): a wrapped 'Micro810 and / Micro820' title below a generic opener still covers the Micro820 notebook: %j",
    async (heading) => {
      expect(await askNb(heading)).toHaveLength(1);
    },
  );
  it("F8 (r5) control: the wrapped title's OTHER half alone does not cover ('Micro810 and\\nMicro830')", async () => {
    expect(await askNb("User Manual\nMicro810 and\nMicro830 Programmable Controllers")).toEqual([]);
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

// Found 2026-11-10 by a read-only pass over the catalog-number work: a range
// name beside ONE sibling on the cover is that sibling's manual. A project
// recorded as "Micro820" refused it; the same project recorded as "820" (the
// form the machine card stores) answered from it.
describe("a bare number under a range name that also names a sibling is the sibling's manual", () => {
  it.each([
    ["820", "Micro800 Programmable Controllers Micro850 User Manual", "2080-um002.pdf"],
    ["850", "Micro800 Programmable Controllers Micro810 User Manual", "2080-um001.pdf"],
    ["820", "Micro800 Micro830 and Micro850 Programmable Controllers", "2080-um002.pdf"],
    ["525", "PowerFlex 520-Series PowerFlex 523 User Manual", "520-um001.pdf"],
  ])("Allen-Bradley %j is not answered from %j", async (model, heading, filename) => {
    expect(await ask(heading, filename, "Allen-Bradley", model)).toEqual([]);
  });

  it.each([
    ["820", "Micro820", "Micro800 Programmable Controllers Micro850 User Manual"],
    ["820", "Micro820", "Micro800 Programmable Controllers Micro820 User Manual"],
    ["820", "Micro820", "Micro800 Programmable Controllers: Micro820, Micro830, Micro850"],
    ["820", "Micro820", "Micro800 Programmable Controllers General Instructions"],
    ["820", "Micro820", "Micro830, Micro850, and Micro870 Programmable Controllers User Manual"],
    ["525", "PowerFlex 525", "PowerFlex 520-Series PowerFlex 523 User Manual"],
    ["525", "PowerFlex 525", "PowerFlex 520-Series Adjustable Frequency AC Drive User Manual"],
    ["525", "PowerFlex 525", "PowerFlex 520-Series PowerFlex 523 and PowerFlex 525 User Manual"],
  ])("the number %j and the name %j get the same answer for %j", async (number, name, heading) => {
    const byNumber = (await ask(heading, "manual.pdf", "Allen-Bradley", number)).length;
    const byName = (await ask(heading, "manual.pdf", "Allen-Bradley", name)).length;
    expect(byNumber).toBe(byName);
  });

  it("control: the range manual, and a cover that lists the machine among its siblings, still answer", async () => {
    expect(await ask("Micro800 Programmable Controllers General Instructions", "2080-rm001.pdf", "Allen-Bradley", "820")).toHaveLength(1);
    expect(await ask("Micro800 Programmable Controllers Micro820 User Manual", "2080-um005.pdf", "Allen-Bradley", "820")).toHaveLength(1);
    expect(await ask("Micro800 Programmable Controllers: Micro820, Micro830, Micro850", "2080-rm001.pdf", "Allen-Bradley", "820")).toHaveLength(1);
    expect(await ask("PowerFlex 520-Series Adjustable Frequency AC Drive User Manual", "520-um001.pdf", "Allen-Bradley", "525")).toHaveLength(1);
  });
});

// Found 2026-11-10 while measuring the block above on real cover layouts: the
// sibling does not have to share the title's line. A cover whose title names
// only the range, and whose title block goes on to name ONE member of it (the
// rest of the title line, or the title lines stacked under it), is that
// member's manual. It answered for every member of the range.
describe("a range title with a sibling in the title block under it is the sibling's manual", () => {
  const AB = "Allen-Bradley";
  const named = (question: string, heading: string) =>
    retrieveNodeChunks(clientWith(nodeRow("manual.pdf", heading)), "t-1", question, {
      nodeId: "n-1",
      unsPath: null,
      docIds: ["d-1"],
      validatedDocScope: true,
    });

  const SIBLINGS: Array<[number: string, name: string, heading: string]> = [
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro850 48-point Controllers User Manual"],
    ["820", "Micro820", "Micro800 Programmable Controllers\nUser Manual\nMicro830 and Micro850 Controllers"],
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro830,\nMicro850 Controllers User Manual"],
    ["820", "Micro820", "Micro800 Programmable Controllers – Micro850 48-Point Controllers"],
    ["820", "Micro820", "Micro800 Programmable Controllers: Micro830, Micro850"],
    ["820", "Micro820", "User Manual\nMicro800 Programmable Controllers\nMicro850 Controllers"],
    ["850", "Micro850", "Original Instructions\nMicro800 Programmable Controllers\nMicro810 Controllers User Manual"],
    ["525", "PowerFlex 525", "PowerFlex 520-Series Adjustable Frequency AC Drive\nPowerFlex 523 User Manual"],
    // The document's own number is not part of the title block: a publication
    // line beside the sibling's title does not hide it (independent pass, 2026-11-10).
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro850 48-point Controllers User Manual\nSupersedes Publication 2080-UM002G-EN-E"],
    ["820", "Micro820", "Micro800 Programmable Controllers\nRockwell Automation Publication 2080-UM002H-EN-E - May 2020\nMicro850 Controllers"],
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro850 Controllers\nReplaces 2080-UM002G"],
    ["820", "Micro820", "User Manual Original Instructions\nMicro800\u2122 Programmable Controllers\nMicro870 Controllers Installation Instructions\nSupersedes Publication 2080-UM002G-EN-E\nCopyright \u00a9 2020 Rockwell Automation, Inc. All rights reserved."],
    // A sentence about the project's own model is not coverage: an exclusion
    // or a pointer under the sibling's title leaves it the sibling's manual.
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro850 Controllers User Manual\nMicro820 is not covered by this manual."],
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro850 Controllers User Manual\nFor the Micro820 see publication 2080-UM005."],
  ];
  it.each(SIBLINGS)("a project recorded as %j or as %j is not answered from %j", async (number, name, heading) => {
    expect(await ask(heading, "manual.pdf", AB, number)).toEqual([]);
    expect(await ask(heading, "manual.pdf", AB, name)).toEqual([]);
  });
  it.each(SIBLINGS)("a question that names the %s (%s) is not answered from %j", async (_number, name, heading) => {
    expect(await named(`What is the ${name} input voltage?`, heading)).toEqual([]);
  });

  it("the sibling the cover names is still answered, by number, by name and when the question names it", async () => {
    const heading = "Micro800 Programmable Controllers\nMicro850 48-point Controllers User Manual";
    expect(await ask(heading, "manual.pdf", AB, "850")).toHaveLength(1);
    expect(await ask(heading, "manual.pdf", AB, "Micro850")).toHaveLength(1);
    expect(await named("What is the Micro850 input voltage?", heading)).toHaveLength(1);
  });

  // The risk of reading the lines under a title is reading one member's line
  // and missing the project's own. Every listed member must still answer.
  it.each([
    "Micro800 Programmable Controllers\nMicro820 Controllers\nMicro830 Controllers\nMicro850 Controllers\nUser Manual",
    "Micro800 Programmable Controllers\nUser Manual\nMicro820, Micro830 and Micro850",
    "Micro800 Programmable Controllers\nMicro820,\nMicro830 and\nMicro850 Controllers",
    "Micro800 Programmable Controllers: Micro820, Micro830, Micro850",
    "User Manual\nMicro800 Programmable Controllers\nMicro820 Controllers\nMicro830 Controllers\nMicro850 Controllers",
  ])("control: a range cover that lists its members under the title answers for each of them: %j", async (heading) => {
    for (const digits of ["820", "830", "850"]) {
      expect(await ask(heading, "manual.pdf", AB, digits)).toHaveLength(1);
      expect(await ask(heading, "manual.pdf", AB, `Micro${digits}`)).toHaveLength(1);
      expect(await named(`What is the Micro${digits} input voltage?`, heading)).toHaveLength(1);
    }
  });

  // Prose under a range title is not its title block: a pointer to another
  // manual, or a remark about a sibling, leaves the range manual a range manual.
  it.each([
    "Micro800 Programmable Controllers General Instructions\nFor the Micro850 see publication 2080-UM002.",
    "Micro800 Programmable Controllers User Manual\nMicro850 controllers are covered in a separate manual.",
    "Micro800 Programmable Controllers\nNot covered:\nMicro850",
    // A heading over the lines under it is never skipped as "the document's
    // own number line", whatever word for the document it uses.
    "Micro800 Programmable Controllers\nNot covered in this document:\nMicro850",
    "Micro800 Programmable Controllers\nNot included in this edition\nMicro850 Controllers",
    "Micro800 Programmable Controllers\nNot covered by publication 2080-UM002:\nMicro850",
    "Micro800 Programmable Controllers\nThis document does not cover\nMicro850 Controllers",
    "Micro800 Programmable Controllers User Manual\nRelated publications\nMicro850 48-point Controllers Installation Instructions is a separate document.",
    "Micro800 Programmable Controllers General Instructions",
    "Micro800 Programmable Controllers General Instructions\nRockwell Automation Publication 2080-RM001G-EN-E - May 2020\nSupersedes Publication 2080-RM001F-EN-E",
    "Micro800 Programmable Controllers\nPublication 2080-UM002H-EN-E\nMicro820 Controllers\nMicro850 Controllers",
  ])("control: prose under a range title does not narrow it: %j", async (heading) => {
    expect(await ask(heading, "manual.pdf", AB, "820")).toHaveLength(1);
    expect(await ask(heading, "manual.pdf", AB, "Micro820")).toHaveLength(1);
    expect(await named("What is the Micro820 input voltage?", heading)).toHaveLength(1);
  });

  // All or nothing. When a line that reads as a title names a member the title
  // block did not take in, the cover does not say which members it is for, and
  // it stays the range manual: no listed machine loses its manual to a half-read list.
  it.each([
    ["PowerFlex 520-Series AC Drives User Manual\nPowerFlex 523\nPowerFlex 525", ["523", "525"]],
    ["Micro800 Programmable Controllers\nMicro820\nMicro 850", ["820", "850"]],
    ["Micro800 Programmable Controllers\nMicro850 Controllers\nRelated Publications\nMicro820 Controllers Installation Instructions", ["820", "850"]],
  ] as Array<[string, string[]]>)("control: a member list that is only half read is not narrowed: %j", async (heading, models) => {
    for (const model of models) expect(await ask(heading, "manual.pdf", AB, model), model).toHaveLength(1);
  });

  it("control: the PowerFlex 520-Series cover that lists the 523 and the 525 answers for both", async () => {
    const heading =
      "PowerFlex 520-Series Adjustable Frequency AC Drive\nPowerFlex 523 Catalog Number 25A\nPowerFlex 525 Catalog Number 25B\nUser Manual";
    for (const digits of ["523", "525"]) {
      expect(await ask(heading, "520-um001.pdf", AB, digits)).toHaveLength(1);
      expect(await named(`What is the PowerFlex ${digits} overload setting?`, heading)).toHaveLength(1);
    }
  });

  it("control: the garage's own Micro820 cover (generic first line, catalog numbers under the title) still answers", async () => {
    const heading =
      "User Manual Original Instructions\nMicro820 Programmable\nControllers\nCatalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB, 2080-LC20-20AWB";
    expect(await ask(heading, "2080-um005.pdf", AB, "820")).toHaveLength(1);
    expect(await ask(heading, "2080-um005.pdf", AB, "Micro820")).toHaveLength(1);
    expect(await named("What is the Micro820 input voltage?", heading)).toHaveLength(1);
  });

  // Reading the lines under a title may only take an answer away. Whatever a
  // range title is followed by, a project it answers for is one the title
  // alone answers for.
  it("lines under a range title never make a manual answer that the title alone refuses", async () => {
    const titles = [
      "Micro800 Programmable Controllers",
      "PowerFlex 520-Series Adjustable Frequency AC Drive",
      "Comfort Panels Operating Instructions",
      "User Manual\nMicro800 Programmable Controllers",
    ];
    const under = [
      "Micro850 Controllers",
      "Micro820, Micro830 and Micro850",
      "PowerFlex 523 User Manual",
      "PowerFlex 525",
      "TP700 Comfort, TP900 Comfort",
      "ACS850 Firmware Manual",
      "Micro850 only",
      "User Manual",
    ];
    const projects: Array<[maker: string, model: string]> = [
      [AB, "820"], [AB, "850"], [AB, "Micro820"], [AB, "525"], [AB, "PowerFlex 527"],
      ["Siemens", "700"], ["Siemens", "TP700"], ["Siemens", "TP1200"], ["ABB", "850"],
    ];
    for (const title of titles)
      for (const line of under)
        for (const [maker, model] of projects) {
          const withLine = (await ask(`${title}\n${line}`, "manual.pdf", maker, model)).length;
          const alone = (await ask(title, "manual.pdf", maker, model)).length;
          expect(withLine, `${maker} ${model}: ${JSON.stringify(`${title}\n${line}`)}`).toBeLessThanOrEqual(alone);
        }
  });

  // Not closed here. A restricting word makes the line a sentence, and a
  // sentence under a title is not read; a catalog number is not a model name,
  // and matching those is the catalog-number gate's work (its own change).
  it.each([
    ["limit: a member named with a restricting word", "Micro800 Programmable Controllers\nMicro850 only"],
    ["limit: only a sibling's catalog numbers under the range title", "Micro800 Programmable Controllers\nCatalog Numbers 2080-LC50-24QWB, 2080-LC50-48QWB"],
    ["limit: a sentence that excludes the project's model with no listed coverage word (answers on main too)", "Micro800 Programmable Controllers\nNot for use with Micro820\nMicro850 Controllers"],
    ["limit: a status word alone under the sibling's title", "Micro800 Programmable Controllers\nMicro850 Controllers\nObsolete"],
    ["limit: the project's own title under a heading further down the sibling's cover", "Micro800 Programmable Controllers\nMicro850 Controllers\nRelated Publications\nMicro820 Controllers Installation Instructions"],
  ])("%s still answers for a Micro820 project", async (_why, heading) => {
    expect(await ask(heading, "manual.pdf", AB, "820")).toHaveLength(1);
  });
});

// Measured 2026-11-10 on main and on this branch alike: a range manual that
// SAYS the project's own model is left out still answered for it, because the
// range name covers every member and nothing under a title was read. The same
// listed words that refuse an asked number (manual-applicability.ts) now
// refuse a member of the range: on the member's own line, or the line under it.
describe("a range cover that says a member is not covered does not answer for that member", () => {
  const AB = "Allen-Bradley";
  const named = (question: string, heading: string) =>
    retrieveNodeChunks(clientWith(nodeRow("manual.pdf", heading)), "t-1", question, {
      nodeId: "n-1",
      unsPath: null,
      docIds: ["d-1"],
      validatedDocScope: true,
    });

  const EXCLUDED: Array<[number: string, name: string, heading: string]> = [
    ["820", "Micro820", "Micro800 Programmable Controllers User Manual\nMicro820 is not covered by this manual."],
    ["820", "Micro820", "Micro800 Programmable Controllers User Manual\nMicro820 NotSupported"],
    ["820", "Micro820", "Micro800 Programmable Controllers User Manual\nMicro820 (not covered)"],
    ["820", "Micro820", "Micro800 Programmable Controllers User Manual\nMicro820 Controllers\nNot covered in this manual"],
    ["820", "Micro820", "Micro800 Programmable Controllers User Manual \u2014 Micro820 not covered"],
    ["820", "Micro820", "User Manual\nMicro800 Programmable Controllers\nMicro820 is not covered by this manual."],
    ["820", "Micro820", "Micro800 Programmable Controllers\nMicro850 Controllers User Manual\nMicro820 Controllers\nExcluded from this manual"],
    ["525", "PowerFlex 525", "PowerFlex 520-Series AC Drives User Manual\nPowerFlex 525 is not covered by this manual."],
  ];
  it.each(EXCLUDED)("a project recorded as %j or as %j is not answered from %j", async (number, name, heading) => {
    expect(await ask(heading, "manual.pdf", AB, number)).toEqual([]);
    expect(await ask(heading, "manual.pdf", AB, name)).toEqual([]);
  });
  it.each(EXCLUDED)("a question that names the %s (%s) is not answered from %j", async (_number, name, heading) => {
    expect(await named(`What is the ${name} input voltage?`, heading)).toEqual([]);
  });

  it("the other members of the range are still answered from that manual", async () => {
    const heading = "Micro800 Programmable Controllers User Manual\nMicro820 is not covered by this manual.";
    expect(await ask(heading, "manual.pdf", AB, "850")).toHaveLength(1);
    expect(await ask(heading, "manual.pdf", AB, "Micro830")).toHaveLength(1);
    expect(await named("What is the Micro850 input voltage?", heading)).toHaveLength(1);
  });

  it.each([
    ["a remark about another member", "Micro800 Programmable Controllers User Manual\nMicro850 is not covered by this manual."],
    ["a remark under the project's line that names another member", "Micro800 Programmable Controllers User Manual\nMicro820 Controllers\nMicro850 is sold separately and not covered"],
    ["the project's line with a document line under it", "Micro800 Programmable Controllers\nMicro820 Controllers\nUser Manual"],
    ["a negation about something else on the project's line", "Micro800 Programmable Controllers User Manual\nMicro820 Controllers - not for resale"],
    ["a heading under the project's line, which is about what follows it", "Micro800 Programmable Controllers User Manual\nMicro820 Controllers\nNot covered:\nMicro850"],
  ])("control: %s leaves the Micro820 answered", async (_why, heading) => {
    expect(await ask(heading, "manual.pdf", AB, "820")).toHaveLength(1);
    expect(await ask(heading, "manual.pdf", AB, "Micro820")).toHaveLength(1);
    expect(await named("What is the Micro820 input voltage?", heading)).toHaveLength(1);
  });

  // The remark is recognised by the listed words, with their stated cost: a
  // negation beside a coverage word about something else reads as an exclusion.
  it("stated wrong refusal: 'Micro820 controllers do not support motion' refuses the Micro820", async () => {
    const heading = "Micro800 Programmable Controllers User Manual\nMicro820 controllers do not support motion";
    expect(await ask(heading, "manual.pdf", AB, "820")).toEqual([]);
  });

  // Found by the independent read of this rule (2026-11-10): an ordinary
  // cover line under the member's own line, with a negation and a listed
  // coverage word about something else. The correct manual is refused.
  it.each([
    ["Micro800 Programmable Controllers User Manual\nMicro850\nThis manual does not replace the installation instructions"],
    ["Micro800 Programmable Controllers User Manual\nMicro850\nNOT FOR USE IN SAFETY APPLICATIONS"],
  ])("stated wrong refusal: %j refuses the Micro850", async (heading) => {
    expect(await ask(heading, "manual.pdf", AB, "850")).toEqual([]);
  });

  // Not closed: an exclusion with no listed coverage word, and a heading over
  // the member's line. All answer on main too.
  it.each([
    ["limit: no listed coverage word", "Micro800 Programmable Controllers User Manual\nNot for use with Micro820"],
    ["limit: no listed coverage word ('not part of')", "Micro800 Programmable Controllers User Manual\nMicro820 is not part of this manual"],
    ["limit: no listed coverage word ('not documented')", "Micro800 Programmable Controllers User Manual\nMicro820 is not documented"],
    ["limit: a heading over the member's line", "Micro800 Programmable Controllers User Manual\nNot covered:\nMicro820"],
  ])("%s still answers for a Micro820 project", async (_why, heading) => {
    expect(await ask(heading, "manual.pdf", AB, "820")).toHaveLength(1);
  });
});

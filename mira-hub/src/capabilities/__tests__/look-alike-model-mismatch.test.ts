/**
 * #5369 — a look-alike model from a vendor family the detector has no pattern
 * for. maq2-2026-11-09 on staging 6e5361bff: two sibling controllers were
 * each answered from the other's manual (both directions), because the
 * question read as "no model named". The covers below are the public first
 * page of Schneider Electric's Modicon M171 / M172 hardware guides.
 *
 * Run: npx vitest run src/capabilities/__tests__/look-alike-model-mismatch.test.ts
 */
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { lookAlikeCoverVerdict, namedModelMismatchText } from "../named-model-mismatch";

const M171_COVER = "Modicon M171 Performance\nLogic Controller\nHardware Guide\nEIO0000002030.05\n05/2024";
const M172_COVER = "Modicon M172 Logic Controller\nHardware Guide\nOriginal instructions\nEIO0000002015.11\n02/2026";
const PF40_COVER = "PowerFlex 40 Adjustable Frequency AC Drive\nBulletin Number 22B\nFirmware Revision 1.xx…7.xx\nUser Manual\nOriginal Instructions";

const row = (heading: string, content: string, filename = "manual.pdf", docId = "d-1") => ({
  doc_id: docId,
  content,
  source_url: `node-doc/u1/${filename}`,
  source_page: 26,
  page_start: 26,
  section_path: null,
  filename,
  document_heading: heading,
  rank: 0.4,
});

type Diag = { namedModelMismatch?: { requested: string[]; declared: string[] }; ambiguousModelAsk?: { named: string[] } };

async function ask(rows: Record<string, unknown>[], question: string, manufacturer: string, model: string, docIds = ["d-1"]) {
  const client = { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds,
    validatedDocScope: true,
    identity: { manufacturer, model },
    identityStatus: "user_confirmed" as never,
    diagnostics: diagnostics as never,
  });
  return { hits, diagnostics };
}

const SUPPLY = "Power supply: 24 Vdc nominal, operating range 19.2 to 28.8 Vdc.";

describe("lookAlikeCoverVerdict (pure) — the cover's numbers, never its wording", () => {
  it.each([
    ["What supply voltage range does the M172 accept?", M171_COVER, ["M172"], ["M171"]],
    ["m171 supply voltage range", M172_COVER, ["M171"], ["M172"]],
    ["Does the M-172 run on 24 Vdc?", "Modicon M171 Performance", ["M172"], ["M171"]],
  ])("%s → refused, the cover's only family member published", (q, cover, requested, declared) => {
    expect(lookAlikeCoverVerdict(q, cover, "manual")).toEqual({ kind: "mismatch", requested, declared });
  });

  it.each([
    ["What supply voltage does M172 accept? The attached manual is M171.", ["M171", "M172"]],
    ["My controller is M171 or M172, what supply does it take?", ["M171", "M172"]],
    ["M171 vs M172 supply range", ["M171", "M172"]],
  ])("both the manual's model and its sibling named → asks which one: %s", (q, named) => {
    expect(lookAlikeCoverVerdict(q, M171_COVER, "manual")).toEqual({ kind: "ambiguous", named });
  });

  it.each([
    ["combined guide", "Modicon M171 and M172 Hardware Guide"],
    ["cross-reference on the title line", "Modicon M171 Hardware Guide — for M172 consult the separate manual"],
    ["Codex r5 F1: lone sibling number, capitalized pointing line", "M172\nFor this model consult the separate manual.\nModicon M171 Hardware Guide"],
  ])("any sibling on the cover refuses BOTH models, with no categorical notice (%s)", (_why, cover) => {
    expect(lookAlikeCoverVerdict("M172 supply voltage?", cover, "manual")).toEqual({ kind: "mismatch", requested: ["M172"], declared: [] });
    expect(lookAlikeCoverVerdict("M171 supply voltage?", cover, "manual")).toEqual({ kind: "mismatch", requested: ["M171"], declared: [] });
  });

  it("a filename alone refuses its sibling, and is never declared (r1 F3)", () => {
    expect(lookAlikeCoverVerdict("M172 supply?", "Hardware Guide", "m171")).toEqual({ kind: "mismatch", requested: ["M172"], declared: [] });
  });

  // Codex r6 F2. Before: the filename was read only when the cover carried no
  // related number, so an exclusion-only first block ("M172 is not covered…")
  // counted as M172 coverage and hid the m171 filename. Now the two are one
  // evidence set; when they name different siblings neither model is answered
  // and nothing is declared. This replaces the r1 F3 stale-filename control,
  // which asserted the M172 ask was answered (accepted over-refusal).
  it.each([
    ["exclusion-only first block, sibling filename", "M172 supply voltage?", "M172 is not covered by this manual.", ["M172"]],
    ["the same manual asked for its filename's model", "M171 supply voltage?", "M172 is not covered by this manual.", ["M171"]],
    ["cover names the model, stale sibling filename", "M172 supply?", "Hardware Guide\nModicon M172 Logic Controller", ["M172"]],
    ["the stale filename's model asked", "M171 supply?", "Hardware Guide\nModicon M172 Logic Controller", ["M171"]],
  ])("cover and filename naming different siblings refuse, nothing declared: %s", (_why, q, cover, requested) => {
    expect(lookAlikeCoverVerdict(q, cover, "m171")).toEqual({ kind: "mismatch", requested, declared: [] });
  });

  it.each([
    ["cover and filename agree", "M172 supply?", M172_COVER, "m172 hardware guide"],
    ["filename only, the model asked", "M171 supply?", "Hardware Guide", "m171"],
    ["cover only, neutral filename", "M172 supply?", "Hardware Guide\nModicon M172 Logic Controller", "hardware guide"],
  ])("the right manual is still answered when its evidence agrees: %s", (_why, q, cover, filename) => {
    expect(lookAlikeCoverVerdict(q, cover, filename)).toBeNull();
  });

  it.each([
    ["the manual's own model", "What supply voltage range does the M171 accept?", M171_COVER],
    ["a parameter number", "What is parameter A093 max delay?", PF40_COVER],
    ["a fault code, different letters", "What does error E101 mean?", M171_COVER],
    ["a different first digit is not a sibling", "Can the M241 talk to it?", M171_COVER],
    ["a catalog number glued to letters", "TM172PDG42R supply voltage?", M171_COVER],
    ["a two-digit token (IP20, CE10) is never a model", "Is it IP20, and what is CE10?", "Modicon M17 Guide"],
    ["no related number on cover or filename abstains", "M172 supply range?", "Logic Controller\nHardware Guide"],
  ])("%s → not refused", (_why, q, cover) => {
    expect(lookAlikeCoverVerdict(q, cover, "manual")).toBeNull();
  });
});

describe("#5369 — retrieval refuses the sibling's manual, both directions", () => {
  it("M172 asked, M171 manual loaded", async () => {
    const { hits, diagnostics } = await ask([row(M171_COVER, SUPPLY)], "What supply voltage range does the M172 accept?", "Schneider Electric", "M171");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["M172"], declared: ["M171"] });
  });

  it("M171 asked, M172 manual loaded", async () => {
    const { hits, diagnostics } = await ask([row(M172_COVER, SUPPLY)], "M171 supply voltage range?", "Schneider Electric", "M172");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["M171"], declared: ["M172"] });
  });

  it("a filename-only identity refuses, but is never published as the manual's model (r1 F3)", async () => {
    const { hits, diagnostics } = await ask([row("Hardware Guide\nOriginal instructions", SUPPLY, "m171.pdf")], "M172 supply voltage?", "Schneider Electric", "M171");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a generic opener reads the model line below it (r1 F3)", async () => {
    const cover = "Hardware Guide\nModicon M172 Logic Controller\nOriginal instructions";
    const own = await ask([row(cover, SUPPLY, "m172.pdf")], "M172 supply voltage?", "Schneider Electric", "M172");
    expect(own.hits.length).toBeGreaterThan(0);
    expect(own.diagnostics.namedModelMismatch).toBeUndefined();
    const sibling = await ask([row(cover, SUPPLY, "m172.pdf")], "M171 supply voltage?", "Schneider Electric", "M172");
    expect(sibling.hits).toEqual([]);
    expect(sibling.diagnostics.namedModelMismatch).toEqual({ requested: ["M171"], declared: ["M172"] });
  });

  // Codex r6 F2 — replaces the r1 F3 stale-filename control. The same cover as
  // the test above, which answers under m172.pdf; under m171.pdf the cover and
  // the filename disagree, so neither model is answered and no "this manual is
  // for the M172" notice is published (accepted over-refusal, Mike 2026-11-09).
  it("a cover and a filename naming different siblings answer neither model (r6 F2)", async () => {
    const cover = "Hardware Guide\nModicon M172 Logic Controller\nOriginal instructions";
    for (const q of ["M172 supply voltage?", "M171 supply voltage?"]) {
      const { hits, diagnostics } = await ask([row(cover, SUPPLY, "m171.pdf")], q, "Schneider Electric", "M172");
      expect(hits).toEqual([]);
      expect(diagnostics.namedModelMismatch).toBeUndefined();
    }
    const unnamed = await ask([row(cover, SUPPLY, "m171.pdf")], "What is the supply voltage range?", "Schneider Electric", "M172");
    expect(unnamed.hits.length).toBeGreaterThan(0);
  });

  it("an exclusion-only first block does not hide a sibling filename (r6 F2)", async () => {
    const rows = () => [row("M172 is not covered by this manual.", SUPPLY, "m171.pdf")];
    const sibling = await ask(rows(), "M172 supply voltage?", "Schneider Electric", "M171");
    expect(sibling.hits).toEqual([]);
    expect(sibling.diagnostics.namedModelMismatch).toBeUndefined();
    // The same row is retrievable: the refusal above is the rule, not an empty fixture.
    const unnamed = await ask(rows(), "What is the supply voltage range?", "Schneider Electric", "M171");
    expect(unnamed.hits.length).toBeGreaterThan(0);
  });

  // Codex r6 F1. Before: any model the detector reads, anywhere in the
  // question, switched the look-alike check off for the whole question. Each
  // of these three returned the M171 passage with the old gate restored
  // (measured 2026-11-09); questions the existing policy already refuses for
  // another reason are deliberately not listed, they would pass either way.
  it.each([
    "An ACS350 connected to ACS355. What supply voltage does the M172 controller accept?",
    "What supply voltage does the M172 controller accept? It is an ACS350 connected to ACS355 job.",
    "Micro820 communicating with Micro850. What supply voltage does the M172 accept?",
  ])("a recognized model elsewhere in the question does not switch the check off (r6 F1): %s", async (q) => {
    const { hits, diagnostics } = await ask([row(M171_COVER, SUPPLY)], q, "Schneider Electric", "M171");
    expect(hits).toEqual([]);
    // Generic refusal: the notice's "asked" side would name the recognized model.
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it.each([
    "An ACS350 connected to ACS355. What supply voltage does the M171 controller accept?",
    "Micro820 communicating with Micro850. What supply voltage does the M171 accept?",
  ])("the same mixed question about the manual's own model is answered (r6 F1 control): %s", async (q) => {
    const { hits, diagnostics } = await ask([row(M171_COVER, SUPPLY)], q, "Schneider Electric", "M171");
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a same-line cross-reference is not coverage: the cover is prose and a named ask is refused (r1 F2, r2 F2)", async () => {
    const cover = "Modicon M171 Hardware Guide — for M172 consult the separate manual";
    const { hits, diagnostics } = await ask([row(cover, SUPPLY)], "What supply voltage does the M172 accept?", "Schneider Electric", "M171");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it.each([
    "M172 is not covered by this manual.\nModicon M171 Hardware Guide",
    "For M172 see the separate manual.\nModicon M171 Hardware Guide",
    "For M172\nsee the separate manual.\nModicon M171 Hardware Guide",
    "M172\nis not covered by this manual.\nModicon M171 Hardware Guide",
    "For M172\nSee the separate manual.\nModicon M171 Hardware Guide",
    "M172\nIs not covered by this manual.\nModicon M171 Hardware Guide",
    "M172\n\nis not covered by this manual.\nModicon M171 Hardware Guide",
    "For M172\n\n\nsee the separate manual.\nModicon M171 Hardware Guide",
    "M172\nFor this model consult the separate manual.\nModicon M171 Hardware Guide",
    "M172\n\nFor this model consult the separate manual.\nModicon M171 Hardware Guide",
  ])("a cover naming the sibling in any wording never answers the sibling (r2–r5); the own-model ask is the accepted over-refusal: %s", async (cover) => {
    const sibling = await ask([row(cover, SUPPLY)], "M172 supply voltage?", "Schneider Electric", "M171");
    expect(sibling.hits).toEqual([]);
    expect(sibling.diagnostics.namedModelMismatch).toBeUndefined();
    const own = await ask([row(cover, SUPPLY)], "M171 supply voltage?", "Schneider Electric", "M171");
    expect(own.hits).toEqual([]);
  });

  it.each([
    "What supply voltage does M172 accept? The attached manual is M171.",
    "My controller is M171 or M172, what supply does it take?",
  ])("both models named asks which one, with no M171 passages (r1 F1): %s", async (q) => {
    const { hits, diagnostics } = await ask([row(M171_COVER, SUPPLY)], q, "Schneider Electric", "M171");
    expect(hits).toEqual([]);
    expect(diagnostics.ambiguousModelAsk).toEqual({ named: ["M171", "M172"] });
  });

  it("the notice names both models as written", () => {
    expect(namedModelMismatchText({ requested: ["M172"], declared: ["M171"] })).toContain("is for the M171, not the M172 you asked about");
  });
});

describe("r2 F1 — an ambiguity stops the whole retrieval", () => {
  const generic = row("Controller wiring notes", SUPPLY, "notes.pdf", "d-2");
  it.each([
    ["M171 manual first", () => [row(M171_COVER, SUPPLY), generic]],
    ["generic document first", () => [generic, row(M171_COVER, SUPPLY)]],
  ])("%s", async (_order, rows) => {
    const { hits, diagnostics } = await ask(rows(), "My controller is M171 or M172, what supply does it take?", "Schneider Electric", "M171", ["d-1", "d-2"]);
    expect(hits).toEqual([]);
    expect(diagnostics.ambiguousModelAsk).toEqual({ named: ["M171", "M172"] });
  });

  it("one manual declaring both siblings", async () => {
    const both = row("Modicon M171 and M172 Hardware Guide", SUPPLY);
    const named = await ask([both], "My controller is M171 or M172, what supply does it take?", "Schneider Electric", "M171");
    expect(named.hits).toEqual([]);
    expect(named.diagnostics.ambiguousModelAsk).toEqual({ named: ["M171", "M172"] });
    // Blunt rule: a combined guide refuses a single-model ask too (accepted over-refusal).
    const one = await ask([both], "M172 supply voltage?", "Schneider Electric", "M172");
    expect(one.hits).toEqual([]);
  });
});

describe("controls — the right manual and ordinary questions stay usable", () => {
  it("the manual's own model is answered", async () => {
    const { hits, diagnostics } = await ask([row(M171_COVER, SUPPLY)], "What supply voltage range does the M171 accept?", "Schneider Electric", "M171");
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a question naming no model is answered", async () => {
    const { hits, diagnostics } = await ask([row(M171_COVER, SUPPLY)], "What is the supply voltage range?", "Schneider Electric", "M171");
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a parameter-number question on a listed family is unchanged", async () => {
    const { hits, diagnostics } = await ask(
      [row(PF40_COVER, "A092 [Auto Rstrt Tries]. A093 [Auto Rstrt Delay] Max 300.0 Secs.")],
      "What is the max for A093 auto restart delay?",
      "Rockwell Automation",
      "PowerFlex 40",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("Codex r5 F2: a comparison of models the detector reads keeps both manuals", async () => {
    const rows = [row("ACS350 User's Manual", SUPPLY, "acs350.pdf", "d-1"), row("ACS355 User's Manual", SUPPLY, "acs355.pdf", "d-2")];
    const { hits, diagnostics } = await ask(rows, "Compare ACS350 vs ACS355 supply voltages", "ABB", "", ["d-1", "d-2"]);
    expect(new Set(hits.map((h) => (h as { doc_id?: string }).doc_id ?? (h as { docId?: string }).docId))).toEqual(new Set(["d-1", "d-2"]));
    expect(diagnostics.ambiguousModelAsk).toBeUndefined();
    const unsure = await ask(rows, "My drive is an ACS350 or ACS355, what supply voltage?", "ABB", "", ["d-1", "d-2"]);
    expect(unsure.hits).toEqual([]);
    expect(unsure.diagnostics.ambiguousModelAsk).toBeDefined();
  });

  // r6 F1 runs the look-alike check on every question, so the models the
  // detector reads must be taken out of what it sees. A second family whose
  // short spelling (PF525) has the look-alike shape: with the question passed
  // through unblanked, pf525.pdf would read "PF525 and its sibling PF523 both
  // named" and stop the whole retrieval.
  it("r6 F1: a comparison in a second recognized family keeps both manuals", async () => {
    const rows = [
      row("PowerFlex 525 Adjustable Frequency AC Drive\nUser Manual", SUPPLY, "pf525.pdf", "d-1"),
      row("PowerFlex 523 Adjustable Frequency AC Drive\nUser Manual", SUPPLY, "pf523.pdf", "d-2"),
    ];
    const { hits, diagnostics } = await ask(rows, "Compare PF525 vs PF523 supply voltages", "Rockwell Automation", "", ["d-1", "d-2"]);
    expect(new Set(hits.map((h) => (h as { doc_id?: string }).doc_id ?? (h as { docId?: string }).docId))).toEqual(new Set(["d-1", "d-2"]));
    expect(diagnostics.ambiguousModelAsk).toBeUndefined();
  });
});

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
import { lookAlikeModelMismatch, namedModelMismatchText } from "../named-model-mismatch";

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

async function ask(rows: Record<string, unknown>[], question: string, manufacturer: string, model: string) {
  const client = { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    identity: { manufacturer, model },
    identityStatus: "user_confirmed" as never,
    diagnostics: diagnostics as never,
  });
  return { hits, diagnostics };
}

const SUPPLY = "Power supply: 24 Vdc nominal, operating range 19.2 to 28.8 Vdc.";

describe("lookAlikeModelMismatch (pure)", () => {
  it.each([
    ["What supply voltage range does the M172 accept?", M171_COVER, ["M172"], ["M171"]],
    ["m171 supply voltage range", M172_COVER, ["M171"], ["M172"]],
    ["Does the M-172 run on 24 Vdc?", "Modicon M171 Performance", ["M172"], ["M171"]],
  ])("%s → refused", (q, title, requested, declared) => {
    expect(lookAlikeModelMismatch(q, title)).toEqual({ kind: "mismatch", requested, declared });
  });

  it.each([
    ["What supply voltage does M172 accept? The attached manual is M171.", ["M171", "M172"]],
    ["My controller is M171 or M172, what supply does it take?", ["M171", "M172"]],
    ["M171 vs M172 supply range", ["M171", "M172"]],
  ])("both the manual's model and its sibling named → asks which one: %s", (q, named) => {
    expect(lookAlikeModelMismatch(q, M171_COVER)).toEqual({ kind: "ambiguous", named });
  });

  it.each([
    ["the manual's own model", "What supply voltage range does the M171 accept?", M171_COVER],
    ["a parameter number", "What is parameter A093 max delay?", PF40_COVER],
    ["a fault code, different letters", "What does error E101 mean?", M171_COVER],
    ["a different first digit is not a sibling", "Can the M241 talk to it?", M171_COVER],
    ["a catalog number glued to letters", "TM172PDG42R supply voltage?", M171_COVER],
    ["a two-digit token (IP20, CE10) is never a model", "Is it IP20, and what is CE10?", "Modicon M17 Guide"],
    ["a title with no letters+digits token abstains", "M172 supply range?", "Logic Controller\nHardware Guide"],
  ])("%s → not refused", (_why, q, title) => {
    expect(lookAlikeModelMismatch(q, title)).toBeNull();
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

  it("a generic opener reads the model line below it, not a stale filename (r1 F3)", async () => {
    const cover = "Hardware Guide\nModicon M172 Logic Controller\nOriginal instructions";
    const own = await ask([row(cover, SUPPLY, "m171.pdf")], "M172 supply voltage?", "Schneider Electric", "M172");
    expect(own.hits.length).toBeGreaterThan(0);
    expect(own.diagnostics.namedModelMismatch).toBeUndefined();
    const sibling = await ask([row(cover, SUPPLY, "m171.pdf")], "M171 supply voltage?", "Schneider Electric", "M172");
    expect(sibling.hits).toEqual([]);
    expect(sibling.diagnostics.namedModelMismatch).toEqual({ requested: ["M171"], declared: ["M172"] });
  });

  it("a same-line cross-reference is not coverage (r1 F2)", async () => {
    const cover = "Modicon M171 Hardware Guide — for M172 consult the separate manual";
    const { hits, diagnostics } = await ask([row(cover, SUPPLY)], "What supply voltage does the M172 accept?", "Schneider Electric", "M171");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["M172"], declared: ["M171"] });
  });

  it("a prose cover line declares nothing: a named ask is refused without a notice", async () => {
    const cover = "Hardware Guide\nM172 is not covered by this manual.";
    const named = await ask([row(cover, SUPPLY)], "M172 supply voltage?", "Schneider Electric", "M171");
    expect(named.hits).toEqual([]);
    expect(named.diagnostics.namedModelMismatch).toBeUndefined();
    const unnamed = await ask([row(cover, SUPPLY)], "What is the supply voltage range?", "Schneider Electric", "M171");
    expect(unnamed.hits.length).toBeGreaterThan(0);
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
});

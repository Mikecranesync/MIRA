/**
 * Synthetic technician — "I typed what the plate says."
 *
 * A technician opens a blank chat and types the machine the way its nameplate
 * or data sheet reads. MIRA should offer that machine ("Is this a …?") so one
 * tap binds the notebook and its manual search starts. These are the garage
 * bench parts, typed the way their own public documents title them.
 *
 * What this file proves, and what it does not:
 *  - PROVES (deterministic, $0, no network): the proposal the chat route
 *    computes from typed text, and that the identity it proposes is one the
 *    manual-admission step then protects.
 *  - DOES NOT PROVE: that production's shared library lists these makers (the
 *    proposal only fires for makers it holds), or anything on a screen.
 *
 * MAKERS is the subset of staging's shared-library maker list that matters
 * here, read 2026-11-09 (read-only). It is a fixture, not live verification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { isSafeCandidateSearchIdentity } from "@/capabilities/candidate-identity";
import { familyNamedWithItsCatalogNumber, namesOnlyThisMachine, proposeIdentityFromText } from "@/capabilities/identity-proposal";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const MAKERS = ["Rockwell Automation", "AutomationDirect", "Schneider Electric", "Siemens"];
const propose = (typed: string) => proposeIdentityFromText(typed, MAKERS);

describe("the relay, typed the way its data sheet titles it", () => {
  // Public data sheet for CA3KN22BD: "TeSys K control relay", "Range TeSys".
  it.each([
    ["Schneider Electric TeSys CA3KN22BD", "Schneider Electric"],
    ["Schneider TeSys CA3KN22BD control relay, what is the coil voltage?", "Schneider"],
    ["Schneider Electric TeSys K CA3KN22BD", "Schneider Electric"],
  ])("%s", (typed, maker) => {
    expect(propose(typed)).toEqual({ manufacturer: maker, model: "CA3KN22BD" });
  });

  it("another member of the range reads the same way", () => {
    expect(propose("Schneider Electric TeSys D LC1D09BD contactor will not pull in")).toEqual({
      manufacturer: "Schneider Electric",
      model: "LC1D09BD",
    });
  });

  it("control: without the range name it was already proposed", () => {
    expect(propose("Schneider Electric CA3KN22BD relay coil voltage")).toEqual({
      manufacturer: "Schneider Electric",
      model: "CA3KN22BD",
    });
  });

  it.each([
    ["the range name alone names no machine", "Schneider Electric TeSys"],
    ["the range and its letter alone name no machine", "Schneider Electric TeSys K control relay keeps chattering"],
    ["a letters-only code after the range is not a model", "Schneider Electric TeSys LC-D"],
    ["two different relays are a comparison", "Schneider Electric TeSys CA3KN22BD or CA3KN31BD?"],
    ["a serial label's value is never the model", "Schneider Electric TeSys SN: CA3KN22BD"],
    ["a rating after the range is not a model", "Schneider Electric TeSys 24VDC coil"],
    ["a maker the library does not hold is never proposed", "Dorner TeSys CA3KN22BD"],
    // Known limit, on purpose: the number must sit directly after the range name.
    ["words between the range and the number (the data sheet's full title)", "The Schneider Electric TeSys K control relay CA3KN22BD is chattering"],
    ["a number further along may be another machine's", "Schneider Electric TeSys K relay feeds the GS11N-20P2"],
    ["a lowercase letter is a word, not a range member", "Schneider Electric TeSys a CA3KN22BD"],
  ])("still nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });
});

describe("the PLC, typed with both lines of its plate", () => {
  // Rockwell publication 2080-UM005 (Micro820 user manual), cover: the family
  // name and its catalog numbers are printed together.
  it.each([
    "Allen-Bradley Micro820 2080-LC20-20QBB",
    "Allen-Bradley Micro820 2080-LC20-20QBB has a red fault light",
    "Rockwell Automation Micro820 (2080-LC20-20QBB) will not go to run",
    "Allen-Bradley 2080-LC20-20QBB Micro820",
  ])("%s → the family, not the catalog number", (typed) => {
    expect(propose(typed)?.model).toBe("820");
  });

  it("the catalog number first and the family later in the sentence still binds the family", () => {
    expect(propose("Allen-Bradley 2080-LC20-20QBB keeps faulting, it is the Micro820 on the conveyor")).toEqual({
      manufacturer: "Allen-Bradley",
      model: "820",
    });
  });

  it("controls: either line alone was already proposed, unchanged", () => {
    expect(propose("Allen-Bradley Micro820")).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
    expect(propose("Allen-Bradley 2080-LC20-20QBB")).toEqual({ manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" });
  });

  it.each([
    ["another family's name beside this catalog number", "Allen-Bradley Micro850 2080-LC20-20QBB"],
    ["this family's name beside a catalog number its manual does not list", "Allen-Bradley Micro820 2080-LC50-24QBB"],
    ["a catalog number that only looks like the family's", "Allen-Bradley Micro820 2080-LC20-99ZZZ"],
    ["two different catalog numbers", "Allen-Bradley Micro820 2080-LC20-20QBB and 2080-LC20-20QWB"],
    ["a second machine in the same message", "Allen-Bradley Micro820 2080-LC20-20QBB talks to a PowerFlex 525"],
    ["another maker's part with the same family words", "Siemens Micro820 2080-LC20-20QBB"],
  ])("still nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  it("a value under a serial label is not read at all: the family alone is proposed, as before", () => {
    expect(propose("Allen-Bradley Micro820 SN: 2080-LC20-20QBB")).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });

  it("the pairing needs BOTH lines: a catalog number with no family named beside it pairs with nothing", () => {
    expect(familyNamedWithItsCatalogNumber("Allen-Bradley", ["2080-LC20-20QBB"])).toBeNull();
    expect(familyNamedWithItsCatalogNumber("Allen-Bradley", ["Micro820"])).toBeNull();
    expect(familyNamedWithItsCatalogNumber("Allen-Bradley", ["Micro820", "2080-LC20-20QBB"])).toBe("820");
  });

  it("the automatic manual search is not widened: its own gate reads these messages as before", () => {
    const typed = "Allen-Bradley Micro820 2080-LC20-20QBB";
    expect(namesOnlyThisMachine(typed, "2080-LC20-20QBB")).toBe(false);
    expect(isSafeCandidateSearchIdentity("", typed, "2080-LC20-20QBB", "ALLEN-BRADLEY")).toBe(false);
  });
});

// ── what the proposed identity buys: the manual check can then do its job ────

const TENANT = "5e7c0000-0000-4000-8000-000000000001";
/** Cover of Rockwell publication 2080-UM005 (public). */
const MICRO820_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000a1",
  filename: "2080-um005_-en-e.pdf",
  document_heading: "User Manual Original Instructions\nMicro820 Programmable\nControllers\nCatalog Numbers 2080-LC20-20QWB, 2080-L20E-20QWB,\n2080-LC20-20QBB, 2080-L20E-20QBB",
};
/** A sibling controller's manual. Synthetic heading, not a quotation. */
const SIBLING_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000b2",
  filename: "sibling-controller.pdf",
  document_heading: "Micro850 Programmable Controllers User Manual",
};

/** Cover of the AutomationDirect GS10 user manual (public). */
const GS10_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000c3",
  filename: "gs10usermanual.pdf",
  document_heading: "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions",
};
/** Another drive family's manual. Synthetic heading, not a quotation. */
const OTHER_DRIVE_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000d4",
  filename: "other-drive.pdf",
  document_heading: "GS20 AC Drive User Manual",
};

async function citedFor(model: string, manuals: Array<typeof MICRO820_MANUAL>, manufacturer = "Allen-Bradley"): Promise<string[]> {
  const rows = manuals.map((m, i) => ({
    ...m,
    source_url: `https://test.invalid/${m.filename}`,
    source_page: 40 + i,
    page_start: 40 + i,
    page_label: String(40 + i),
    // A stand-in passage, not a quotation from either manual.
    content: "Controller status indicators. The fault indicator shows the controller fault state.",
    rank: 0.8 - i * 0.01,
  }));
  let offered = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document")
      || sql.includes("quote_literal(lex)")
      || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) {
      return { rows: [] };
    }
    offered++;
    return { rows };
  });
  const question = "What does the red fault light mean?";
  const hits = await retrieveNodeChunks({ query } as unknown as PoolClient, TENANT, question, {
    nodeId: "synthetic-technician-typed-machine",
    unsPath: null,
    docIds: manuals.map((m) => m.doc_id),
    approvedSourceDocIds: manuals.map((m) => m.doc_id),
    validatedDocScope: true,
    rawQuery: question,
    topK: 6,
    identity: { manufacturer, model },
    identityStatus: "user_confirmed" as const,
  });
  expect(offered, "the real admission step received the candidates").toBeGreaterThan(0);
  return hits.map((h) => h.docId ?? "").sort();
}

describe("after the technician confirms what was proposed", () => {
  beforeEach(() => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider/network in this fixture"); }));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("the proposed identity is the one this message produces", () => {
    expect(propose("Allen-Bradley Micro820 2080-LC20-20QBB")?.model).toBe("820");
  });

  it("answers from the Micro820 manual and not from the sibling's", async () => {
    expect(await citedFor("820", [MICRO820_MANUAL, SIBLING_MANUAL])).toEqual([MICRO820_MANUAL.doc_id]);
  });

  it("refuses when only the sibling's manual is attached", async () => {
    expect(await citedFor("820", [SIBLING_MANUAL])).toEqual([]);
  });

  // Why the family is proposed and not the catalog number: the SAME plate,
  // bound by its catalog number, is not protected today. A known defect
  // (#5369), written with the correct expectation: this row turns red the day
  // it is fixed, and the mark comes off then.
  it("contrast, reached admission: bound by catalog number, its own manual is cited", async () => {
    expect(await citedFor("2080-LC20-20QBB", [MICRO820_MANUAL])).toEqual([MICRO820_MANUAL.doc_id]);
  });
  it.fails("contrast (#5369): bound by catalog number, the sibling's manual should not be cited", async () => {
    expect(await citedFor("2080-LC20-20QBB", [MICRO820_MANUAL, SIBLING_MANUAL])).toEqual([MICRO820_MANUAL.doc_id]);
  });

  // The drive's plate reads GS11N-20P2; typed, it was already proposed (as the
  // series "GS11N"). The same outcome check, so all three garage parts have one.
  it("the drive: what its typed plate proposes is answered from the GS10 manual, not another family's", async () => {
    const proposed = propose("AutomationDirect GS11N-20P2 trips on acceleration");
    expect(proposed).toEqual({ manufacturer: "AutomationDirect", model: "GS11N" });
    expect(await citedFor(proposed!.model, [GS10_MANUAL, OTHER_DRIVE_MANUAL], proposed!.manufacturer)).toEqual([GS10_MANUAL.doc_id]);
    expect(await citedFor(proposed!.model, [OTHER_DRIVE_MANUAL], proposed!.manufacturer)).toEqual([]);
  });
});

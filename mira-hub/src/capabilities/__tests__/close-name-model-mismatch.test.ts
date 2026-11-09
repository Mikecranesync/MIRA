/**
 * #5355 — close-name model families. CHARLIE 2's manual-answer-quality run on
 * staging cc108d6bb (2026-11-09): with the SMC Flex manual selected, an SMC-50
 * fault-code question was answered with SMC Flex fault codes (10/11) and no
 * notice. The SMC-50 → SMC Flex mirror did the same, and PowerFlex 40 vs 4M got
 * a generic refusal. Root cause: the model detector (model-token.ts) had no
 * pattern for SMC-50 / SMC Flex and required two digits for PowerFlex, so these
 * questions named "no model" and every manual looked model-free.
 *
 * The covers are the real first-page text of the frozen OEM PDFs
 * (~/.cache/stranger-walk-manuals on CHARLIE: SMC Flex a81650d0bd31…,
 * SMC-50 7b8a6689a550…, PowerFlex 4M f4a93fc51536…, PowerFlex 40 15c10c642037…).
 *
 * Run: npx vitest run src/capabilities/__tests__/close-name-model-mismatch.test.ts
 */
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "../../lib/manual-rag";
import { modelIdentitiesInText } from "../model-token";
import { displayModelIdentity, namedModelMismatchText } from "../named-model-mismatch";

const SMC_FLEX_COVER =
  "This manual links to SMC Flex Soft Starter Parameters, publication\n150-RD001; download the spreadsheet now for offline access.\n\nSMC Flex Soft Starters\nBulletin 150-F\n\nUser Manual\n\nOriginal Instructions";
const SMC_50_COVER = "SMC-50 Soft Starters\nBulletin 150\nUser Manual\nOriginal Instructions";
const PF4M_COVER = "PowerFlex 4M Adjustable Frequency AC Drive\nBulletin Number 22F\nFirmware Revision 1.xx…2.xx\nUser Manual\nOriginal Instructions";
const PF40_COVER = "PowerFlex 40 Adjustable Frequency AC Drive\nBulletin Number 22B\nFirmware Revision 1.xx…7.xx\nUser Manual\nOriginal Instructions";

const row = (heading: string, content: string, filename = "manual.pdf", docId = "d-1") => ({
  doc_id: docId,
  content,
  source_url: `node-doc/u1/${filename}`,
  source_page: 120,
  page_start: 120,
  section_path: null,
  filename,
  document_heading: heading,
  rank: 0.4,
});

type Diag = { namedModelMismatch?: { requested: string[]; declared: string[] } };

async function ask(rows: Record<string, unknown>[], question: string, model: string, docIds = ["d-1"]) {
  const client = { query: vi.fn(async () => ({ rows })) } as unknown as PoolClient;
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, "t-1", question, {
    nodeId: "n-1",
    unsPath: null,
    docIds,
    validatedDocScope: true,
    identity: { manufacturer: "Rockwell Automation", model },
    identityStatus: "user_confirmed" as never,
    diagnostics: diagnostics as never,
  });
  return { hits, diagnostics };
}

const SMC_FAULTS = "Fault Code 10 PTC Power Pole. Fault Code 11 SCR Overtemp.";
const PF_RESTART = "A092 [Auto Rstrt Tries]. A093 [Auto Rstrt Delay] Max 300.0 Secs.";

describe("the model detector reads the close-name families", () => {
  it.each([
    ["SMC Flex", "SMCFLEX"],
    ["SMC-Flex", "SMCFLEX"],
    ["smc flex", "SMCFLEX"],
    ["SMC-50", "SMC50"],
    ["SMC 50", "SMC50"],
    ["smc50", "SMC50"],
    ["PowerFlex 4M", "PF4M"],
    ["PowerFlex 40", "PF40"],
    ["PowerFlex 4", "PF4"],
    ["PF4M", "PF4M"],
  ])("%s → %s", (text, id) => {
    expect([...modelIdentitiesInText(text)]).toEqual([id]);
  });

  it("SMC Flex and SMC-50 are different models; so are PowerFlex 4, 4M and 40", () => {
    const ids = ["SMC Flex", "SMC-50", "PowerFlex 4", "PowerFlex 4M", "PowerFlex 40"].map(
      (t) => [...modelIdentitiesInText(t)][0],
    );
    expect(new Set(ids).size).toBe(5);
  });

  it("does not coin a model from unrelated numbers", () => {
    expect(modelIdentitiesInText("SMC 3 phase starter rated 480V").has("SMC480")).toBe(false);
    expect(modelIdentitiesInText("PowerFlex 40 at 4 kHz").size).toBe(1);
    // A longer number after "SMC" is not SMC-3 / SMC-50.
    expect(modelIdentitiesInText("SMC 30 A frame, SMC 500 series").size).toBe(0);
    expect(modelIdentitiesInText("SMC Flexible conduit").size).toBe(0);
  });
});

describe("#5355 — a close-name model is refused and reported, both directions", () => {
  it("SMC-50 question, SMC Flex manual: no SMC Flex fault codes, mismatch named", async () => {
    const { hits, diagnostics } = await ask(
      [row(SMC_FLEX_COVER, SMC_FAULTS)],
      "My SMC-50 controller just flagged an SCR Overtemp or PTC Power Pole fault - what fault code is that?",
      "150-F",
    );
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["SMC50"], declared: ["SMCFLEX"] });
  });

  it("mirror: SMC Flex question, SMC-50 manual: refused and named", async () => {
    const { hits, diagnostics } = await ask([row(SMC_50_COVER, SMC_FAULTS)], "On my SMC Flex what fault code is SCR Overtemp?", "150");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["SMCFLEX"], declared: ["SMC50"] });
  });

  it("PowerFlex 40 question, PowerFlex 4M manual: refused and named", async () => {
    const { hits, diagnostics } = await ask(
      [row(PF4M_COVER, PF_RESTART)],
      "On my PowerFlex 40, what's the maximum I can set parameter A093 [Auto Rstrt Delay] to?",
      "22F",
    );
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["PF40"], declared: ["PF4M"] });
  });

  it("PowerFlex 4M question, PowerFlex 40 manual: refused and named", async () => {
    const { hits, diagnostics } = await ask(
      [row(PF40_COVER, PF_RESTART)],
      "On my PowerFlex 4M, what's the maximum I can set A093 [Auto Rstrt Delay] to?",
      "22B",
    );
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch).toEqual({ requested: ["PF4M"], declared: ["PF40"] });
  });
});

describe("controls — the right manual stays usable", () => {
  it.each([
    [SMC_FLEX_COVER, SMC_FAULTS, "On my SMC Flex, what fault code is SCR Overtemp?", "150-F"],
    [SMC_FLEX_COVER, SMC_FAULTS, "smc-flex SCR overtemp fault code?", "150-F"],
    [SMC_50_COVER, SMC_FAULTS, "On my SMC-50, what fault code is SCR Overtemp?", "150"],
    [PF4M_COVER, PF_RESTART, "On my PowerFlex 4M, max A093 Auto Rstrt Delay?", "22F"],
    [PF40_COVER, PF_RESTART, "On my PowerFlex 40, max A093 Auto Rstrt Delay?", "22B"],
    [PF40_COVER, PF_RESTART, "On my PF40, max A093 Auto Rstrt Delay?", "22B"],
  ])("same model answers: %#", async (cover, content, q, model) => {
    const { hits, diagnostics } = await ask([row(cover, content)], q, model);
    expect(hits).toHaveLength(1);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a question naming no model is answered from the notebook's manual", async () => {
    const { hits } = await ask([row(SMC_FLEX_COVER, SMC_FAULTS)], "what fault code is SCR Overtemp?", "150-F");
    expect(hits).toHaveLength(1);
  });
});

describe("#5355 — the notice names close-name models as a technician writes them", () => {
  it.each([
    ["SMCFLEX", "SMC Flex"],
    ["SMC50", "SMC-50"],
    ["SMC3", "SMC-3"],
    ["PF4M", "PowerFlex 4M"],
    ["PF4", "PowerFlex 4"],
    ["PF40", "PowerFlex 40"],
  ])("%s → %s", (id, label) => {
    expect(displayModelIdentity(id)).toBe(label);
  });

  it("the SMC-50 / SMC Flex notice names both, and no fault code", () => {
    const text = namedModelMismatchText({ requested: ["SMC50"], declared: ["SMCFLEX"] });
    expect(text).toContain("for the SMC Flex, not the SMC-50");
    expect(text).not.toMatch(/\b1[01]\b/);
  });
});

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
import { modelIdentitiesInText, modelMentionsInText } from "../model-token";
import {
  ambiguousModelAskText,
  ambiguousSiblingModels,
  displayModelIdentity,
  namedModelMismatchText,
} from "../named-model-mismatch";

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
    expect(modelIdentitiesInText("SMC 3 phase starter rated 480V").size).toBe(0);
    // Codex r1 on #5359: ratings and phase counts are not models.
    for (const q of ["SMC 50 A soft starter", "SMC 3-phase supply", "SMC 50 amps", "SMC 3 ph 480 V", "PowerFlex 4 kW frame", "PF 4 HP"]) {
      expect(modelIdentitiesInText(q).size, q).toBe(0);
    }
    // ...but a real model followed by a rating still reads.
    expect([...modelIdentitiesInText("SMC-50 rated 90 A")]).toEqual(["SMC50"]);
    expect([...modelIdentitiesInText("SMC-3, 3 phase, 480V")]).toEqual(["SMC3"]);
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
    // Codex r1 on #5359: a rating or phase count is not a second model.
    [SMC_FLEX_COVER, SMC_FAULTS, "SMC 3 phase starter rated 480V: what fault code is SCR Overtemp?", "150-F"],
    [SMC_FLEX_COVER, SMC_FAULTS, "SMC 50 A soft starter, what fault code is SCR Overtemp?", "150-F"],
    [SMC_FLEX_COVER, SMC_FAULTS, "I reset the SMC Flex a few times, what fault code is SCR Overtemp?", "150-F"],
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

describe("#5355 — two models: comparison vs ambiguous", () => {
  const ids = (q: string) => modelIdentitiesInText(q);
  it.each([
    "my SMC-50 or SMC Flex flagged fault 10, what is it?",
    "PowerFlex 40 or PowerFlex 4M, what's the max A093?", // a bare "4M" with no PowerFlex prefix is not read (documented limit)
    "Micro820 Micro850 relay rating at 120 V AC?",
    // Codex r2 on #5359 F2: words elsewhere in the question do not matter.
    "My SMC-50 or SMC Flex tripped due to a fault 10; what is it?",
    "SMC-50 / SMC Flex fault 10 with a hot heatsink, what is it?",
    "is it the Micro820 or the Micro850 that has 7 relay outputs?",
    // Codex r3 F2: a parenthesised alternative is still one machine.
    "SMC-50 (or SMC Flex) flagged fault 10, what is it?",
    "PowerFlex 40 (PowerFlex 4M?) A093 max?",
    // a comparison word in ANOTHER sentence does not govern the pair
    "I compared the logs. My SMC-50 or SMC Flex shows fault 10, what is it?",
    // Codex r4 F6: a comparison word never exempts an explicit "or" / "/" alternative.
    "Between shifts my SMC-50 or SMC Flex tripped on fault 10, what is it?",
    "Compared to yesterday my SMC-50 or SMC Flex has fault 10, what does it mean?",
    "Compare notes: my SMC-50 / SMC Flex shows fault 10, what is it?",
    "Compare my SMC-50 or SMC Flex fault 10 to last week, what is it?",
    "Compared to yesterday my SMC-50, SMC Flex has fault 10, what does it mean?",
    "Between shifts my SMC-50, SMC Flex tripped on fault 10, what is it?",
  ])("ambiguous: %s", (q) => {
    expect(ambiguousSiblingModels(q)).not.toBeNull();
  });
  it.each([
    "What's the difference between the SMC-50 and SMC Flex fault codes?",
    "SMC-50 vs SMC Flex: which has a PTC input?",
    "Can I replace a PowerFlex 4M with a PowerFlex 40?",
    "Is the Micro820 wiring the same as the Micro850?",
    "wire RS-485 between a Micro820 and a GS10", // two families: multi-device
    "Micro820 talking to a GS10 over Modbus", // two families, connection cue
    "Micro820 GS10 comms fault after power loss", // two families, no cue at all
    // Codex r2 on #5359 F3: a same-family connection is two devices.
    "Micro820 communicating with Micro850 over Modbus: how should I wire RS-485?",
    "Micro820 and Micro850 on one network, which IP settings?",
    // Codex r3 F1: a comparison word governing a comma-listed pair.
    "Compare the SMC-50, SMC Flex fault codes.",
    "What is the difference between Micro820, Micro850 relay ratings?",
    "Comparing the SMC-50, SMC Flex: which has a PTC input?",
  ])("not ambiguous: %s", (q) => {
    expect(ambiguousSiblingModels(q)).toBeNull();
  });
  it("the no-cue two-family case really names two models", () => {
    expect(ids("Micro820 GS10 comms fault after power loss").size).toBe(2);
  });
  it("Codex r2 F1: a joined model spelling is a model whatever follows it", () => {
    for (const q of ["I reset the SMC-50 a few times; what fault code is SCR Overtemp?", "SMC-50 phase loss fault: what does code 10 mean?", "SMC50 A-phase fault"]) {
      expect([...ids(q)], q).toEqual(["SMC50"]);
    }
    expect([...ids("PowerFlex 4M a while ago faulted")]).toEqual(["PF4M"]);
    expect([...ids("SMC 50 phase loss fault")]).toEqual(["SMC50"]); // phase is a rating only after 3
    // documented residual: an all-lower-case spaced "smc 50 a" reads as the model
    expect([...ids("smc 50 a soft starter")]).toEqual(["SMC50"]);
  });
  it("mentions carry positions in text order", () => {
    const q = "my SMC-50 or SMC Flex";
    expect(modelMentionsInText(q).map((m) => [m.id, q.slice(m.start, m.end)])).toEqual([
      ["SMC50", "SMC-50"],
      ["SMCFLEX", "SMC Flex"],
    ]);
  });
  it("a rating guard never swallows SMC Flex", () => {
    expect([...ids("I reset the SMC Flex a few times")]).toEqual(["SMCFLEX"]);
    expect([...ids("SMC Flex 480 V, 3 phase")]).toEqual(["SMCFLEX"]);
  });

  it("retrieval returns nothing and reports the ambiguity before any query", async () => {
    const client = { query: vi.fn(async () => ({ rows: [row(SMC_FLEX_COVER, SMC_FAULTS)] })) } as unknown as PoolClient;
    const diagnostics: { ambiguousModelAsk?: { named: string[] } } = {};
    const hits = await retrieveNodeChunks(client, "t-1", "my SMC-50 or SMC Flex flagged fault 10, what is it?", {
      nodeId: "n-1",
      unsPath: null,
      docIds: ["d-1"],
      validatedDocScope: true,
      identity: { manufacturer: "Rockwell Automation", model: "150-F" },
      identityStatus: "user_confirmed" as never,
      diagnostics: diagnostics as never,
    });
    expect(hits).toEqual([]);
    expect(diagnostics.ambiguousModelAsk).toEqual({ named: ["SMC50", "SMCFLEX"] });
    expect(vi.mocked(client.query)).not.toHaveBeenCalled();
  });

  it("Codex r2 F1: 'reset the SMC-50 a few times' keeps SMC-50 and refuses the SMC Flex manual", async () => {
    for (const q of ["I reset the SMC-50 a few times; what fault code is SCR Overtemp?", "SMC-50 phase loss fault: what does code 10 mean?"]) {
      const { hits, diagnostics } = await ask([row(SMC_FLEX_COVER, SMC_FAULTS)], q, "150-F");
      expect(hits, q).toEqual([]);
      expect(diagnostics.namedModelMismatch, q).toEqual({ requested: ["SMC50"], declared: ["SMCFLEX"] });
    }
  });

  it("Codex r2 F2: 'tripped due to a fault' is still ambiguous at retrieval", async () => {
    const d: { ambiguousModelAsk?: { named: string[] } } = {};
    const client = { query: vi.fn(async () => ({ rows: [row(SMC_FLEX_COVER, SMC_FAULTS)] })) } as unknown as PoolClient;
    const hits = await retrieveNodeChunks(client, "t-1", "My SMC-50 or SMC Flex tripped due to a fault 10; what is it?", {
      nodeId: "n-1",
      unsPath: null,
      docIds: ["d-1"],
      validatedDocScope: true,
      identity: { manufacturer: "Rockwell Automation", model: "150-F" },
      identityStatus: "user_confirmed" as never,
      diagnostics: d as never,
    });
    expect(hits).toEqual([]);
    expect(d.ambiguousModelAsk).toEqual({ named: ["SMC50", "SMCFLEX"] });
  });

  it("Codex r2 F3: a same-family connection question still retrieves", async () => {
    const MICRO820_COVER = "Micro820 Programmable Controllers\nCatalog Numbers 2080-LC20\nInstallation Instructions";
    const { hits, diagnostics } = await ask(
      [row(MICRO820_COVER, "RS-485 serial port wiring: terminals D+ D- and G.")],
      "Micro820 communicating with Micro850 over Modbus: how should I wire RS-485?",
      "2080-LC20",
    );
    expect((diagnostics as { ambiguousModelAsk?: unknown }).ambiguousModelAsk).toBeUndefined();
    expect(hits).toHaveLength(1);
  });

  it("Codex r3 F2: a parenthesised alternative asks which one and admits no page", async () => {
    const d: { ambiguousModelAsk?: { named: string[] } } = {};
    const client = { query: vi.fn(async () => ({ rows: [row(SMC_FLEX_COVER, SMC_FAULTS)] })) } as unknown as PoolClient;
    const hits = await retrieveNodeChunks(client, "t-1", "SMC-50 (or SMC Flex) flagged fault 10, what is it?", {
      nodeId: "n-1",
      unsPath: null,
      docIds: ["d-1"],
      validatedDocScope: true,
      identity: { manufacturer: "Rockwell Automation", model: "150-F" },
      identityStatus: "user_confirmed" as never,
      diagnostics: d as never,
    });
    expect(hits).toEqual([]);
    expect(d.ambiguousModelAsk).toEqual({ named: ["SMC50", "SMCFLEX"] });
  });

  it("Codex r4 F6: 'between shifts' with an 'or' pair asks which one and admits no page, even in a notebook confirmed as SMC-50", async () => {
    for (const model of ["150-F", "SMC-50"]) {
      const d: { ambiguousModelAsk?: { named: string[] } } = {};
      const client = { query: vi.fn(async () => ({ rows: [row(SMC_FLEX_COVER, SMC_FAULTS)] })) } as unknown as PoolClient;
      const hits = await retrieveNodeChunks(client, "t-1", "Between shifts my SMC-50 or SMC Flex tripped on fault 10, what is it?", {
        nodeId: "n-1",
        unsPath: null,
        docIds: ["d-1"],
        validatedDocScope: true,
        identity: { manufacturer: "Rockwell Automation", model },
        identityStatus: "user_confirmed" as never,
        diagnostics: d as never,
      });
      expect(hits, model).toEqual([]);
      expect(d.ambiguousModelAsk, model).toEqual({ named: ["SMC50", "SMCFLEX"] });
    }
  });

  it.each([
    "Compare the SMC-50, SMC Flex SCR Overtemp fault codes.",
    "What is the difference between the SMC-50 and SMC Flex SCR Overtemp fault code?",
  ])("Codex r3 F1/F3: a comparison retrieves even in a notebook confirmed as SMC-50: %s", async (q) => {
    const { hits, diagnostics } = await ask([row(SMC_FLEX_COVER, SMC_FAULTS)], q, "SMC-50");
    expect((diagnostics as { ambiguousModelAsk?: unknown }).ambiguousModelAsk).toBeUndefined();
    expect(diagnostics.namedModelMismatch).toBeUndefined();
    expect(hits).toHaveLength(1);
  });

  it("Codex r3 F3: both manuals selected, a comparison in a confirmed SMC-50 notebook cites both", async () => {
    const rows = [row(SMC_FLEX_COVER, SMC_FAULTS), { ...row(SMC_50_COVER, SMC_FAULTS), doc_id: "d-2" }];
    const { hits } = await ask(rows, "What is the difference between the SMC-50 and SMC Flex SCR Overtemp fault code?", "SMC-50", ["d-1", "d-2"]);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("control: a one-model question in a confirmed SMC-50 notebook still refuses the SMC Flex manual", async () => {
    const { hits } = await ask([row(SMC_FLEX_COVER, SMC_FAULTS)], "what fault code is SCR Overtemp?", "SMC-50");
    expect(hits).toEqual([]);
  });

  it("a comparison still retrieves from the selected manual", async () => {
    const { hits } = await ask(
      [row(SMC_FLEX_COVER, SMC_FAULTS)],
      "What's the difference between the SMC-50 and SMC Flex SCR Overtemp fault code?",
      "150-F",
    );
    expect(hits).toHaveLength(1);
  });

  it("the which-one text names both and gives no value", () => {
    const t = ambiguousModelAskText(["SMC50", "SMCFLEX"]);
    expect(t).toContain("Which one is it — the SMC-50 or the SMC Flex?");
    expect(t).not.toMatch(/\b1[01]\b/);
  });
});

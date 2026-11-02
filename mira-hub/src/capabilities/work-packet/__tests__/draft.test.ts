/**
 * draft.test.ts — buildDraftPacket / selectTopics.
 *
 * `./catpumps-datasheet` and `./catpumps-service-manual` are owned by other agents and may not
 * exist yet while this file is authored, so both modules are `vi.mock`ed and every test drives
 * hand-built `DataSheet` / `ServiceManual` fixtures through the mocked parse functions. None of
 * this file's assertions depend on the real parsers' behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSheet, DocText, DraftInput, Identity, ServiceManual, WorkOrderInput } from "../types";

vi.mock("../catpumps-datasheet", () => ({
  parseCatPumpsDataSheet: vi.fn(),
  sheetModelFor: vi.fn(),
}));
vi.mock("../catpumps-service-manual", () => ({
  parseCatPumpsServiceManual: vi.fn(),
}));

import { parseCatPumpsDataSheet, sheetModelFor } from "../catpumps-datasheet";
import { parseCatPumpsServiceManual } from "../catpumps-service-manual";
import { buildDraftPacket, selectTopics } from "../draft";

function normalize(s: string): string {
  return s.toUpperCase().replace(/[\s-]+/g, "");
}

// A faithful-enough stand-in for A's real `sheetModelFor` (exact match, no prefix matching) —
// this module's tests exercise draft.ts's assembly logic, not A's matching rule itself.
function fakeSheetModelFor(identity: { model?: string | null; catalogNumber?: string | null }, models: string[]): string | null {
  for (const key of [identity.model, identity.catalogNumber]) {
    if (!key) continue;
    const hit = models.find((m) => normalize(m) === normalize(key));
    if (hit) return hit;
  }
  return null;
}

const DOC_DS: DocText = {
  docId: "ds1",
  fileId: null,
  filename: "9xp1000.pdf",
  via: "file",
  pages: [
    { page: 1, text: "CAT PUMPS\nModel: 9XP1000\nCrankcase Capacity 4.2 qts 4 l" },
    {
      page: 2,
      text: [
        "ITEM P/N DESCRIPTION QTY",
        "1 Seal retainer 1 90010 90011",
        "2 O-ring 1 — 90021",
        "9XP1000, 9XP1000C 90001 90002",
        "One (1) seal kit required per pump",
      ].join("\n"),
    },
  ],
};

const DOC_SM: DocText = {
  docId: "sm1",
  fileId: null,
  filename: "9xpsvc.pdf",
  via: "file",
  pages: [
    { page: 1, text: "9XP1000 SERVICE MANUAL\nModels: 9XP1000, 9XP1000C\nCAUTION: Relieve system pressure before servicing." },
    { page: 6, text: "SERVICING THE SEALS\n1. Remove the manifold bolts." },
    { page: 7, text: "Manifold / M8 M21 Hex 115 9.58 13 [90030]" },
    { page: 8, text: "SERVICING THE VALVES\n1. Remove the valve plugs.\nValve plugs / M10 M17 Hex 100 8.3 999" },
  ],
};

function mockDataSheet(): DataSheet {
  return {
    kind: "catpumps_datasheet",
    models: ["9XP1000", "9XP1000C"],
    parts: [],
    kits: [
      {
        kind: "seal",
        perPump: 1,
        perPumpSource: { docId: "ds1", fileId: null, filename: "9xp1000.pdf", page: 2, line: "One (1) seal kit required per pump" },
        materials: ["NBR (STD)", "FPM (.0110)"],
        kitNumbers: [
          {
            models: ["9XP1000", "9XP1000C"],
            byMaterial: { "NBR (STD)": "90001", "FPM (.0110)": "90002" },
            source: { docId: "ds1", fileId: null, filename: "9xp1000.pdf", page: 2, line: "9XP1000, 9XP1000C 90001 90002" },
          },
        ],
        items: [
          {
            item: 1,
            description: "Seal retainer",
            qtyRaw: "1",
            partsByMaterial: { "NBR (STD)": "90010", "FPM (.0110)": "90011" },
            source: { docId: "ds1", fileId: null, filename: "9xp1000.pdf", page: 2, line: "1 Seal retainer 1 90010 90011" },
          },
          {
            item: 2,
            description: "O-ring",
            qtyRaw: "1",
            partsByMaterial: { "NBR (STD)": null, "FPM (.0110)": "90021" },
            source: { docId: "ds1", fileId: null, filename: "9xp1000.pdf", page: 2, line: "2 O-ring 1 — 90021" },
          },
        ],
      },
    ],
    specs: [
      {
        key: "crankcase_capacity",
        label: "Crankcase Capacity",
        value: "4.2 qts 4 l",
        source: { docId: "ds1", fileId: null, filename: "9xp1000.pdf", page: 1, line: "Crankcase Capacity 4.2 qts 4 l" },
      },
    ],
    problems: [],
  };
}

function mockServiceManual(): ServiceManual {
  return {
    kind: "catpumps_service_manual",
    modelsCovered: ["9XP1000", "9XP1000C"],
    sections: [
      {
        heading: "SERVICING THE SEALS",
        subheading: "Disassembly (All models except 9XP1000C)",
        topic: "seals",
        models: { include: [], exclude: ["9XP1000C"] },
        page: 6,
        steps: [{ n: 1, text: "Remove the manifold bolts.", source: { docId: "sm1", fileId: null, filename: "9xpsvc.pdf", page: 6, line: "1. Remove the manifold bolts." } }],
      },
      {
        heading: "SERVICING THE VALVES",
        subheading: null,
        topic: "valves",
        models: { include: [], exclude: [] },
        page: 8,
        steps: [{ n: 1, text: "Remove the valve plugs.", source: { docId: "sm1", fileId: null, filename: "9xpsvc.pdf", page: 8, line: "1. Remove the valve plugs." } }],
      },
    ],
    torque: [
      {
        item: "Manifold bolts",
        partNumber: "90030",
        thread: "M8",
        tool: "M21 Hex",
        inLbs: "115",
        ftLbs: "9.58",
        nm: "13",
        models: { include: [], exclude: [] },
        consistent: true,
        source: { docId: "sm1", fileId: null, filename: "9xpsvc.pdf", page: 7, line: "Manifold / M8 M21 Hex 115 9.58 13 [90030]" },
      },
      {
        item: "Valve plugs",
        partNumber: null,
        thread: "M10",
        tool: "M17 Hex",
        inLbs: "100",
        ftLbs: "8.3",
        nm: "999",
        models: { include: [], exclude: [] },
        consistent: false,
        source: { docId: "sm1", fileId: null, filename: "9xpsvc.pdf", page: 8, line: "Valve plugs / M10 M17 Hex 100 8.3 999" },
      },
    ],
    cautions: [
      {
        kind: "CAUTION",
        text: "Relieve system pressure before servicing.",
        source: { docId: "sm1", fileId: null, filename: "9xpsvc.pdf", page: 1, line: "CAUTION: Relieve system pressure before servicing." },
      },
    ],
    problems: [],
  };
}

const IDENTITY: Identity = { manufacturer: "CAT Pumps", model: "9XP1000", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 };
const WORK_ORDER: WorkOrderInput = {
  id: "WO-DEMO-0001",
  title: "Reseal pump",
  description: "Full reseal and valve service on the 9XP1000.",
  assetTag: "PUMP-1",
  site: "Plant A",
  synthetic: true,
};

function input(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-1",
    now: "2026-10-30T12:00:00Z",
    identity: IDENTITY,
    workOrder: WORK_ORDER,
    docs: [DOC_DS, DOC_SM],
    hazardFlags: [],
    ...overrides,
  };
}

function wireParsers(opts: { ds?: DataSheet | null; sm?: ServiceManual | null } = {}) {
  const ds = opts.ds === undefined ? mockDataSheet() : opts.ds;
  const sm = opts.sm === undefined ? mockServiceManual() : opts.sm;
  vi.mocked(parseCatPumpsDataSheet).mockImplementation((doc) => (doc.docId === "ds1" ? ds : null));
  vi.mocked(parseCatPumpsServiceManual).mockImplementation((doc) => (doc.docId === "sm1" ? sm : null));
  vi.mocked(sheetModelFor).mockImplementation(fakeSheetModelFor);
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────── selectTopics

describe("selectTopics", () => {
  it.each([
    ["replace the seal", "seals"],
    ["re-pack with v-packing", "seals"],
    ["lo-pressure packing swap", "seals"],
    ["hi-pressure packing swap", "seals"],
    ["inspect the valve", "valves"],
    ["swap the plunger", "plungers"],
    ["check the crankcase", "crankcase"],
    ["replace main bearing", "crankcase"],
    ["inspect connecting rod", "crankcase"],
    ["crankshaft runout check", "crankcase"],
    ["replace the oil seal", "crankcase"],
    ["schedule an oil change", "lubrication"],
    ["lubricating the crankshaft bore", "lubrication"],
  ] as const)("'%s' selects %s", (text, topic) => {
    const topics = selectTopics(text).map((m) => m.topic);
    expect(topics).toContain(topic);
  });

  it("reseal/rebuild/overhaul each select BOTH seals and valves", () => {
    for (const word of ["full reseal", "complete rebuild", "pump overhaul"]) {
      const topics = new Set(selectTopics(word).map((m) => m.topic));
      expect(topics.has("seals")).toBe(true);
      expect(topics.has("valves")).toBe(true);
    }
  });

  it("returns no matches for text naming no recognized task", () => {
    expect(selectTopics("General equipment check, nothing specific.")).toEqual([]);
  });
});

// ─────────────────────────────────────────────── refusals

describe("buildDraftPacket — refusals", () => {
  it("refuses identity_not_confirmed before looking at anything else", () => {
    wireParsers();
    const result = buildDraftPacket(input({ identity: { ...IDENTITY, status: "candidate" } }));
    expect(result).toMatchObject({ ok: false, reason: "identity_not_confirmed" });
  });

  it("refuses no_documents when nothing is attached", () => {
    wireParsers();
    const result = buildDraftPacket(input({ docs: [] }));
    expect(result).toMatchObject({ ok: false, reason: "no_documents" });
  });

  it("refuses unsupported_documents when nothing parses as a CAT Pumps document", () => {
    wireParsers({ ds: null, sm: null });
    const result = buildDraftPacket(input());
    expect(result).toMatchObject({ ok: false, reason: "unsupported_documents" });
  });

  it("refuses model_not_in_documents when the identified model isn't on any sheet or manual", () => {
    wireParsers();
    const result = buildDraftPacket(input({ identity: { ...IDENTITY, model: "0000" } }));
    expect(result).toMatchObject({ ok: false, reason: "model_not_in_documents" });
    if (!result.ok) expect(result.message).toContain("0000");
  });

  it("refuses no_task_matched when the work order names no recognized task", () => {
    wireParsers();
    const result = buildDraftPacket(
      input({ workOrder: { ...WORK_ORDER, title: "General check", description: "Look it over, nothing specific." } }),
    );
    expect(result).toMatchObject({ ok: false, reason: "no_task_matched" });
  });
});

// ─────────────────────────────────────────────── assembly

describe("buildDraftPacket — assembly", () => {
  it("builds a draft packet with verified parts, steps, measurements, cautions and the synthetic work order visible", () => {
    wireParsers();
    const result = buildDraftPacket(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { packet, warnings } = result;

    expect(warnings).toEqual([]);
    expect(packet.workOrder.synthetic).toBe(true);
    expect(packet.workOrder.id).toBe("WO-DEMO-0001");

    expect(packet.equipment.model).toMatchObject({ value: "9XP1000", label: "verified" });
    expect(packet.equipment.model.source).not.toBeNull();

    // scope picked up both seals and valves (from "reseal" and "valve")
    const scopeTopics = packet.scope.map((f) => f.value);
    expect(scopeTopics).toContain("seals");
    expect(scopeTopics).toContain("valves");

    // kit number row (proposed NBR) + two kit items (one verified, one unknown — item 2 blank NBR)
    const kitNumberRows = packet.parts.filter((p) => p.item === null);
    expect(kitNumberRows).toHaveLength(1);
    expect(kitNumberRows[0].partNumber).toMatchObject({ value: "90001", label: "proposed" });
    const item1 = packet.parts.find((p) => p.item === 1);
    expect(item1?.partNumber).toMatchObject({ value: "90010", label: "verified" });
    const item2 = packet.parts.find((p) => p.item === 2);
    expect(item2?.partNumber).toMatchObject({ value: null, label: "unknown" });

    // both sections' steps included (seals admitted — model isn't the excluded 9XP1000C; valves unscoped)
    expect(packet.steps).toHaveLength(2);
    expect(packet.steps.map((s) => s.text.value)).toEqual(
      expect.arrayContaining(["Remove the manifold bolts.", "Remove the valve plugs."]),
    );

    // consistent, topic-relevant torque row becomes a measurement; the inconsistent one does not
    expect(packet.measurements).toHaveLength(1);
    expect(packet.measurements[0]).toMatchObject({
      name: { value: "Manifold bolts", label: "verified" },
      value: { value: "115 in-lbs / 9.58 ft-lbs / 13 Nm", label: "verified" },
      tool: { value: "M21 Hex", label: "verified" },
    });

    // tools: the torque row's tool (verified) + Torque wrench (proposed, since a torque value exists)
    expect(packet.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "M21 Hex", label: "verified" }),
        expect.objectContaining({ value: "Torque wrench", label: "proposed" }),
      ]),
    );

    // cautions verbatim
    expect(packet.safety.cautions).toHaveLength(1);
    expect(packet.safety.cautions[0]).toMatchObject({ value: "Relieve system pressure before servicing.", label: "verified" });
    expect(packet.safety.siteIsolation).toMatchObject({ value: null, label: "unknown" });

    // unknowns: item-2 NBR blank + inconsistent valve-plugs row + the 3 always-present entries
    // (qualification and functional-test limits now have their own sections)
    expect(packet.unknowns.length).toBe(5);
    expect(packet.qualifications).toEqual([expect.objectContaining({ value: null, label: "unknown" })]);
    expect(packet.restoration?.at(-1)).toMatchObject({ value: null, label: "unknown", basis: expect.stringContaining("acceptance limits") });
    expect(packet.unknowns.some((u) => u.basis.includes("item 2") || u.basis.includes("O-ring"))).toBe(true);
    expect(packet.unknowns.some((u) => u.basis.includes("inconsistent"))).toBe(true);
    expect(packet.unknowns.some((u) => u.basis.includes("seal material"))).toBe(true);
    expect(packet.unknowns.some((u) => u.basis.includes("site isolation"))).toBe(true);
    expect(packet.unknowns.some((u) => u.basis.includes("serial"))).toBe(true);

    expect(packet.disclaimer).toContain("Your site owns isolation and lockout.");
    expect(packet.approval.supervisor.state).toBe("pending");
    expect(packet.approval.technicianReview.state).toBe("draft");
  });

  it("marks serial as proposed 'from nameplate, unconfirmed' when the identity carries one", () => {
    wireParsers();
    const result = buildDraftPacket(input({ identity: { ...IDENTITY, serialNumber: "SN-42" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.equipment.serial).toMatchObject({ value: "SN-42", label: "proposed", basis: expect.stringContaining("unconfirmed") });
    expect(result.packet.unknowns.some((u) => u.value === "SN-42" && u.label === "proposed")).toBe(true);
  });

  it("excludes a seals section scoped away from the identified model", () => {
    wireParsers({
      sm: {
        ...mockServiceManual(),
        sections: [
          {
            heading: "SERVICING THE SEALS",
            subheading: "Model 9XP1000 Only",
            topic: "seals",
            models: { include: ["9XP1000C"], exclude: [] }, // admits ONLY 9XP1000C, not our 9XP1000
            page: 6,
            steps: [{ n: 1, text: "Remove the manifold bolts.", source: { docId: "sm1", fileId: null, filename: "9xpsvc.pdf", page: 6, line: "1. Remove the manifold bolts." } }],
          },
        ],
        torque: [],
      },
    });
    const result = buildDraftPacket(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.steps).toHaveLength(0);
  });

  it("downgrades a field verifyPacket flags and reports it as a warning instead of returning it as verified", () => {
    const brokenDs = mockDataSheet();
    // The kit item's NBR part number ("90010") does not actually appear on this (deliberately
    // wrong) source line — buildDraftPacket must catch this via verifyPacket and downgrade it.
    brokenDs.kits[0].items[0].source = { docId: "ds1", fileId: null, filename: "9xp1000.pdf", page: 2, line: "1 Seal retainer 1 — —" };
    wireParsers({ ds: brokenDs });
    const result = buildDraftPacket(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.startsWith("parts["))).toBe(true);
    const item1 = result.packet.parts.find((p) => p.item === 1);
    expect(item1?.partNumber).toMatchObject({ value: null, label: "unknown" });
  });
});

describe("buildDraftPacket — a half-documented machine says what is missing", () => {
  it("data sheet only: no steps or torque, and an explicit unknown names the missing service manual", () => {
    wireParsers({ sm: null });
    const result = buildDraftPacket(input({ docs: [DOC_DS] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.steps).toEqual([]);
    expect(result.packet.measurements).toEqual([]);
    expect(result.packet.unknowns.some((u) => u.label === "unknown" && u.basis.includes("no service manual"))).toBe(true);
    expect(result.packet.unknowns.some((u) => u.basis.includes("no data sheet"))).toBe(false);
  });

  it("service manual only: no parts, and an explicit unknown names the missing data sheet", () => {
    wireParsers({ ds: null });
    const result = buildDraftPacket(input({ docs: [DOC_SM] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.parts).toEqual([]);
    expect(result.packet.unknowns.some((u) => u.label === "unknown" && u.basis.includes("no data sheet"))).toBe(true);
    expect(result.packet.unknowns.some((u) => u.basis.includes("no service manual"))).toBe(false);
  });
});

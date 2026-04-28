import { describe, test, expect } from "vitest";
import { formatTelegram, formatSlackBlocks } from "../morning-brief";
import type { MorningBrief } from "../morning-brief";

const EMPTY_BRIEF: MorningBrief = {
  tenantId: "tenant-1",
  generatedAt: "2026-04-28T05:00:00.000Z",
  windowHours: 12,
  overnightWOs: { opened: [], closed: [] },
  pmsDueToday: [],
  overdueCount: 0,
  safetyEvents: [],
  kgUpdates: { entitiesAdded: 0, relationshipsAdded: 0 },
};

const FULL_BRIEF: MorningBrief = {
  tenantId: "tenant-1",
  generatedAt: "2026-04-28T05:00:00.000Z",
  windowHours: 12,
  overnightWOs: {
    opened: [
      { id: "wo-1", title: "VFD fault F005", status: "open", priority: "high", asset: "Allen-Bradley VFD" },
      { id: "wo-2", title: "Bearing noise", status: "open", priority: "medium", asset: "CONV-03" },
    ],
    closed: [
      { id: "wo-3", title: "Filter replacement", status: "complete", priority: "low", asset: "HVAC-02" },
    ],
  },
  pmsDueToday: [
    { id: "pm-1", task: "Quarterly filter change", asset: "VFD-07", nextDueAt: "2026-04-28T08:00:00Z" },
    { id: "pm-2", task: "Belt inspection", asset: "CONV-03", nextDueAt: "2026-04-28T09:00:00Z" },
  ],
  overdueCount: 3,
  safetyEvents: [
    { id: "wo-4", title: "Live panel inspection", status: "open", priority: "high", asset: "Panel-A" },
  ],
  kgUpdates: { entitiesAdded: 4, relationshipsAdded: 6 },
};

describe("formatTelegram", () => {
  test("empty brief does not throw and contains header", () => {
    const out = formatTelegram(EMPTY_BRIEF);
    expect(out).toContain("MIRA Morning Brief");
    expect(out).toContain("2026-04-28");
  });

  test("includes overnight WO counts", () => {
    const out = formatTelegram(FULL_BRIEF);
    expect(out).toContain("Opened: 2");
    expect(out).toContain("Closed: 1");
  });

  test("includes PM due today count", () => {
    const out = formatTelegram(FULL_BRIEF);
    expect(out).toContain("Due today: 2");
  });

  test("shows overdue warning when overdueCount > 0", () => {
    const out = formatTelegram(FULL_BRIEF);
    expect(out).toContain("Overdue: 3");
  });

  test("no overdue line when zero", () => {
    const out = formatTelegram(EMPTY_BRIEF);
    expect(out).not.toContain("Overdue:");
  });

  test("safety events section present when events exist", () => {
    const out = formatTelegram(FULL_BRIEF);
    expect(out).toContain("Safety Events Overnight: 1");
    expect(out).toContain("Live panel inspection");
  });

  test("safety events section absent when empty", () => {
    const out = formatTelegram(EMPTY_BRIEF);
    expect(out).not.toContain("Safety Events");
  });

  test("KG section present when updates exist", () => {
    const out = formatTelegram(FULL_BRIEF);
    expect(out).toContain("+4 entities");
    expect(out).toContain("+6 relationships");
  });

  test("truncates WO list to 3 with ellipsis when more than 3", () => {
    const brief: MorningBrief = {
      ...FULL_BRIEF,
      overnightWOs: {
        opened: Array.from({ length: 5 }, (_, i) => ({
          id: `wo-${i}`, title: `WO ${i}`, status: "open", priority: "low", asset: "Asset",
        })),
        closed: [],
      },
    };
    const out = formatTelegram(brief);
    expect(out).toContain("…and 2 more");
  });
});

describe("formatSlackBlocks", () => {
  test("returns an array of blocks", () => {
    const blocks = formatSlackBlocks(FULL_BRIEF);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(3);
  });

  test("first block is header type", () => {
    const blocks = formatSlackBlocks(FULL_BRIEF) as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe("header");
  });

  test("contains overdue field when count > 0", () => {
    const out = JSON.stringify(formatSlackBlocks(FULL_BRIEF));
    expect(out).toContain("⚠️ 3");
  });

  test("safety events block included when events exist", () => {
    const out = JSON.stringify(formatSlackBlocks(FULL_BRIEF));
    expect(out).toContain("Safety Events: 1");
  });

  test("KG block included when updates exist", () => {
    const out = JSON.stringify(formatSlackBlocks(FULL_BRIEF));
    expect(out).toContain("+4 entities");
  });

  test("no undefined or null in output", () => {
    const out = JSON.stringify(formatSlackBlocks(EMPTY_BRIEF));
    expect(out).not.toContain('"undefined"');
    expect(out).not.toContain('"null"');
  });
});

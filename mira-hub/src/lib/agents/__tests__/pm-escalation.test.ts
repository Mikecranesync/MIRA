import { describe, test, expect } from "vitest";
import {
  escalationLevel,
  escalationAudience,
  formatEscalationTelegram,
  formatEscalationSlackBlocks,
} from "../pm-escalation";
import type { OverduePM } from "../pm-escalation";

// ── Level computation ─────────────────────────────────────────────────────────

describe("escalationLevel", () => {
  test("1 day overdue → level 1", () => {
    expect(escalationLevel(1)).toBe(1);
  });

  test("2 days overdue → level 1", () => {
    expect(escalationLevel(2)).toBe(1);
  });

  test("3 days overdue → level 2", () => {
    expect(escalationLevel(3)).toBe(2);
  });

  test("6 days overdue → level 2", () => {
    expect(escalationLevel(6)).toBe(2);
  });

  test("7 days overdue → level 3", () => {
    expect(escalationLevel(7)).toBe(3);
  });

  test("30 days overdue → level 3", () => {
    expect(escalationLevel(30)).toBe(3);
  });
});

// ── Audience routing ──────────────────────────────────────────────────────────

describe("escalationAudience", () => {
  test("level 1 → technician", () => {
    expect(escalationAudience(1)).toBe("technician");
  });

  test("level 2 → supervisor", () => {
    expect(escalationAudience(2)).toBe("supervisor");
  });

  test("level 3 → manager", () => {
    expect(escalationAudience(3)).toBe("manager");
  });
});

// ── Test fixture ──────────────────────────────────────────────────────────────

function makePM(daysOverdue: number): OverduePM {
  const dueDate = new Date(Date.now() - daysOverdue * 86_400_000).toISOString();
  return {
    id: "pm-test-1",
    task: "Quarterly filter change",
    asset: "Allen-Bradley VFD-07",
    equipmentId: "eq-test-1",
    nextDueAt: dueDate,
    daysOverdue,
    escalationLevel: escalationLevel(daysOverdue),
  };
}

// ── Telegram formatter ────────────────────────────────────────────────────────

describe("formatEscalationTelegram", () => {
  test("level 1 contains REMINDER label", () => {
    const msg = formatEscalationTelegram(makePM(1), 1);
    expect(msg).toContain("REMINDER");
  });

  test("level 2 contains SUPERVISOR ALERT", () => {
    const msg = formatEscalationTelegram(makePM(3), 2);
    expect(msg).toContain("SUPERVISOR ALERT");
  });

  test("level 3 contains MANAGER ALERT", () => {
    const msg = formatEscalationTelegram(makePM(7), 3);
    expect(msg).toContain("MANAGER ALERT");
  });

  test("includes task name", () => {
    const msg = formatEscalationTelegram(makePM(2), 1);
    expect(msg).toContain("Quarterly filter change");
  });

  test("includes asset name", () => {
    const msg = formatEscalationTelegram(makePM(2), 1);
    expect(msg).toContain("Allen-Bradley VFD-07");
  });

  test("includes days overdue", () => {
    const msg = formatEscalationTelegram(makePM(5), 2);
    expect(msg).toContain("5");
  });

  test("level 3 has critical urgency message", () => {
    const msg = formatEscalationTelegram(makePM(10), 3);
    expect(msg).toContain("critically overdue");
  });

  test("level 1 has friendly reminder tone", () => {
    const msg = formatEscalationTelegram(makePM(1), 1);
    expect(msg).toContain("Friendly reminder");
  });
});

// ── Slack block formatter ─────────────────────────────────────────────────────

describe("formatEscalationSlackBlocks", () => {
  test("returns array of blocks", () => {
    const blocks = formatEscalationSlackBlocks(makePM(5), 2);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  test("first block is header", () => {
    const blocks = formatEscalationSlackBlocks(makePM(1), 1) as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe("header");
  });

  test("header text contains level number", () => {
    const out = JSON.stringify(formatEscalationSlackBlocks(makePM(7), 3));
    expect(out).toContain("3/3");
  });

  test("level 3 shows MANAGER in header", () => {
    const out = JSON.stringify(formatEscalationSlackBlocks(makePM(7), 3));
    expect(out).toContain("MANAGER");
  });

  test("level 2 routes to supervisor in context", () => {
    const out = JSON.stringify(formatEscalationSlackBlocks(makePM(4), 2));
    expect(out).toContain("supervisor");
  });

  test("fields contain task name", () => {
    const out = JSON.stringify(formatEscalationSlackBlocks(makePM(2), 1));
    expect(out).toContain("Quarterly filter change");
  });

  test("no undefined values in output", () => {
    const out = JSON.stringify(formatEscalationSlackBlocks(makePM(1), 1));
    expect(out).not.toContain('"undefined"');
  });
});

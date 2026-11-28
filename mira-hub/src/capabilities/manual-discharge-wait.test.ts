import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import type { ManualChunk } from "@/lib/manual-rag";
import {
  asksDischargeWait,
  DISCHARGE_WAIT_BUDGET_CHARS,
  DISCHARGE_WAIT_DIRECTIVE,
  DISCHARGE_WAIT_ROWS_PER_DOC,
  isDischargeWaitText,
  retrieveDischargeWaitChunks,
} from "./manual-discharge-wait";

// Answer Test v0.2 Q11 (staging, 2026-11-27): "I just killed power to the GS10. How long until I can
// open it up?" was answered "the excerpt gives no fixed wait time" from the p. 235 DC-bus page, while
// the same manual's p. 326 warning (shown on Q9) says to wait at least 10 minutes and meter DC+ to DC-.
const P326 =
  "WARNING: Wait at least 10 minutes after all display lamps have gone out, and then confirm that the capacitors have fully discharged by measuring the voltage between DC+ and DC-.";
const P235 =
  "The drive disconnects the soft-start relay when the DC bus voltage falls below the Lv level, and displays dEb until power runs out.";

const DOC = "8b0a3f4e-2a1b-4c5d-9e6f-0123456789ab";
const URL = "hub://gs10usermanual.pdf";
const chunk = (content: string, page: number): ManualChunk => ({
  content, docId: DOC, sourceUrl: URL, sourcePage: page, manufacturer: "AutomationDirect", modelNumber: "GS10", title: "gs10usermanual.pdf", rank: 1,
});

type Row = { id: string; doc_id: string; content: string; source_url: string; page: number; page_label?: string | null };

function fakeClient(rows: Row[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      const needed = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      if (needed !== params.length) throw new Error(`bind count ${params.length} != ${needed}`);
      calls.push({ sql, params });
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      const [, docs] = params as [string, string[]];
      return { rows: rows.filter((r) => docs.includes(r.doc_id)) };
    },
  };
  return { client: client as unknown as Pick<PoolClient, "query">, calls };
}

describe("Q11: which questions read the manual's discharge wait", () => {
  it.each([
    "I just killed power to the GS10. How long until I can open it up?",
    "How long do the DC bus capacitors take to discharge?",
    "Power is off, is it safe to touch the terminals now?",
    "I locked it out, how long before I can open the cover?",
    "I turned off the breaker, how long before I can replace the fan?",
  ])("reads it: %s", (q) => {
    expect(asksDischargeWait(q)).toBe(true);
  });
  it.each(["What does fault ocA mean?", "How long is the accel time on P01.12?", "Drive shows dEb after power off, why?", "What is P09.04 set to?"])(
    "reads nothing extra: %s",
    (q) => {
      expect(asksDischargeWait(q)).toBe(false);
    },
  );
});

describe("Q11: the retrieved document's own discharge-wait warning joins the excerpts", () => {
  it("adds p. 326 after the retrieved p. 235, with its printed page", async () => {
    const { client, calls } = fakeClient([
      { id: "1", doc_id: DOC, content: P326, source_url: URL, page: 326, page_label: "6-4" },
      { id: "2", doc_id: DOC, content: "Wait 5 minutes for the motor to cool.", source_url: URL, page: 200 },
    ]);
    const out = await retrieveDischargeWaitChunks(client, "tenant-a", [chunk(P235, 235)]);
    expect(out.map((c) => [c.sourcePage, c.pageLabel, c.content])).toEqual([[326, "6-4", P326]]);
    const read = calls.find((c) => c.sql.includes("knowledge_entries"))!;
    expect(read.params[0]).toBe("tenant-a");
    expect(read.params).toContain(DISCHARGE_WAIT_ROWS_PER_DOC);
    expect(read.sql).toMatch(/ingest_route = 'v2'/);
  });

  it("does not repeat a warning retrieval already returned", async () => {
    const { client } = fakeClient([{ id: "1", doc_id: DOC, content: P326, source_url: URL, page: 326 }]);
    expect(await retrieveDischargeWaitChunks(client, "t", [chunk(P235, 235), chunk(P326, 326)])).toEqual([]);
  });

  it("stays inside its per-document budget", async () => {
    const big = `${P326} ${"x".repeat(1100)}`;
    const rows = [1, 2, 3, 4].map((i) => ({ id: String(i), doc_id: DOC, content: `${big} ${i}`, source_url: URL, page: 320 + i }));
    const out = await retrieveDischargeWaitChunks(fakeClient(rows).client, "t", [chunk(P235, 235)]);
    const used = out.reduce((n, c) => n + Math.min(c.content.length, 1200), 0);
    expect(used).toBeLessThanOrEqual(DISCHARGE_WAIT_BUDGET_CHARS);
    expect(out.length).toBeGreaterThan(0);
  });

  it("reads nothing when no retrieved chunk names a document", async () => {
    const { client, calls } = fakeClient([]);
    expect(await retrieveDischargeWaitChunks(client, "t", [{ ...chunk(P235, 235), docId: null }])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("the text test and the directive", () => {
    expect(isDischargeWaitText(P326)).toBe(true);
    expect(isDischargeWaitText(P235)).toBe(false);
    expect(DISCHARGE_WAIT_DIRECTIVE).toMatch(/Never say the manual gives no wait time/);
  });
});

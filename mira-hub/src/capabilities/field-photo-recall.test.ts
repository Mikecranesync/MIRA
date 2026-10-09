import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { buildRetrievalQuery } from "@/lib/notebook-query";

describe("photo vocabulary reaches the real selected-manual recall lane", () => {
  it("recalls a readout page even when the raw question finds an unrelated help page", async () => {
    const docId = "55555555-5555-4555-8555-555555555555";
    const support = { content: "For help, contact technical support.", doc_id: docId, source_page: 2, rank: 0.1 };
    const readout = { content: "PERI Read Peripheral Fault: a peripheral fault is present if value 1 is displayed.", doc_id: docId, source_page: 18, rank: 1 };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const q = String(params?.[1] ?? "");
      if (!sql.includes("replace(plainto_tsquery")) return { rows: [] };
      return { rows: /PERI/.test(q) ? [readout] : [support] };
    });
    const question = "Does this help?";
    const q = buildRetrievalQuery(question, [], "LCD display shows PERI, RD and 1.");
    const baselineChunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
      nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true,
    });
    expect(baselineChunks.some(c => c.sourcePage === 18)).toBe(false);
    const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
      nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true,
      includeQueryRecall: true,
    });
    expect(chunks.some(c => c.sourcePage === 18)).toBe(true);
    const recall = query.mock.calls.find(([sql, params]) => sql.includes("replace(plainto_tsquery") && String(params?.[1]).includes("PERI"));
    expect(recall).toBeDefined();
    expect(recall?.[0]).toContain("doc_id = ANY");
    expect(recall?.[1]?.[0]).toBe("tenant-1");
    expect(recall?.[1]?.[4]).toEqual([docId]);
  });
});


it.each(["Does this help?", "What am I looking at, and what should I check?"])("background markings cannot displace the readout for %s", async (question) => {
  const docId = "55555555-5555-4555-8555-555555555555";
  const readout = { content: "Fault ovA indicates an overvoltage condition.", doc_id: docId, source_page: 18, rank: 1 };
  const competitors = Array.from({ length: 6 }, (_, i) => ({ content: "Parameter A410 controls unrelated configuration.", doc_id: docId, source_page: 30 + i, rank: 0.1 }));
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("replace(plainto_tsquery") ? [readout, ...competitors] : [] }));
  const q = buildRetrievalQuery(question, [], "LCD display shows:\novA\nA cable marked A410 is connected.");
  const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
    nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true, includeQueryRecall: true,
  });
  expect(chunks.some(c => c.sourcePage === 18)).toBe(true);
});

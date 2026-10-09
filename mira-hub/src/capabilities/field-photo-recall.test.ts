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


it.each(["Does this help?", "What am I looking at, and what should I check?"].flatMap(question => ["LCD display shows:\novA\nA cable marked A410 is connected.", "LCD display shows ovA, and a cable marked A410 is connected.", "LCD display shows ovA, with a STICKER marked A410 above it."].map(observation => [question, observation])))("background markings cannot displace the readout for %s with %s", async (question, observation) => {
  const docId = "55555555-5555-4555-8555-555555555555";
  const readout = { content: "Fault ovA indicates an overvoltage condition.", doc_id: docId, source_page: 18, rank: 1 };
  const competitors = Array.from({ length: 6 }, (_, i) => ({ content: "Parameter A410 controls unrelated configuration.", doc_id: docId, source_page: 30 + i, rank: 0.1 }));
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("replace(plainto_tsquery") ? [readout, ...competitors] : [] }));
  const q = buildRetrievalQuery(question, [], observation);
  const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
    nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true, includeQueryRecall: true,
  });
  expect(chunks.some(c => c.sourcePage === 18)).toBe(true);
});


it.each(["Does this help?", "What am I looking at, and what should I check?"].flatMap(question => [
  "LCD display shows an error message ovA.",
  'LCD display shows the error message "ovA".',
  "LCD display shows the alarm reading ovA.",
  "LCD display shows an unexpected diagnostic message ovA, and a cable marked A410 is connected.",
].map(observation => [question, observation])))("qualified code reaches query-sensitive selected-manual recall: %s %s", async (question, observation) => {
  const docId = "55555555-5555-4555-8555-555555555555";
  const readout = { content: "Fault ovA indicates an overvoltage condition.", doc_id: docId, source_page: 18, rank: 1 };
  const competitors = Array.from({ length: 6 }, (_, i) => ({ content: "An error message needs technical help and support.", doc_id: docId, source_page: 30 + i, rank: 0.1 }));
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({ rows: sql.includes("replace(plainto_tsquery") ? /ovA/.test(String(params?.[1] ?? "")) ? [readout, ...competitors] : competitors : [] }));
  const q = buildRetrievalQuery(question, [], observation);
  const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
    nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true, includeQueryRecall: true,
  });
  expect(chunks.some(c => c.sourcePage === 18)).toBe(true);
});


it.each([["Does this help?", "LCD display shows ovA. A sticker below the LCD display reads A410."], ["Does this help?", "LCD display shows ovA. A cable beside the screen reads A410."], ["Does this help?", "LCD display shows ovA. The panel under the display shows A410."], ["Does this help?", "LCD display shows ovA. A button beside the screen reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. A sticker below the LCD display reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. A cable beside the screen reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The panel under the display shows A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. A button beside the screen reads A410."], ["Does this help?", "LCD display shows ovA. Near the LCD display, a sticker reads A410."], ["Does this help?", "LCD display shows ovA. Beside the screen, a cable reads A410."], ["Does this help?", "LCD display shows ovA. The LCD display has a sticker that reads A410."], ["Does this help?", "LCD display shows ovA. The LCD display has a cable label that reads A410."], ["Does this help?", "LCD display shows ovA. Above the screen, a panel shows A410."], ["Does this help?", "LCD display shows ovA. Next to the display, a button reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. Near the LCD display, a sticker reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. Beside the screen, a cable reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The LCD display has a sticker that reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The LCD display has a cable label that reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. Above the screen, a panel shows A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. Next to the display, a button reads A410."], ["Does this help?", "LCD display shows ovA, A410 on a nearby sticker."], ["Does this help?", "LCD display shows ovA, \"A410\" on a nearby sticker."], ["Does this help?", "LCD display shows ovA and A410 is printed on a sticker."], ["Does this help?", "LCD display shows ovA and \"A410\" is printed on a cable label."], ["Does this help?", "LCD display shows ovA. The LCD display has a sticker marked A410. It reads A410."], ["Does this help?", "LCD display shows ovA. The LCD display has a cable label marked \"A410\". It reads \"A410\"."], ["What am I looking at, and what should I check?", "LCD display shows ovA, A410 on a nearby sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA, \"A410\" on a nearby sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA and A410 is printed on a sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA and \"A410\" is printed on a cable label."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The LCD display has a sticker marked A410. It reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The LCD display has a cable label marked \"A410\". It reads \"A410\"."], ["Does this help?", "LCD display shows ovA, A410 on a red and white sticker."], ["Does this help?", "LCD display shows ovA, A410 printed in black and white on a sticker."], ["Does this help?", "LCD display shows ovA. The LCD display has a panel marked A410. It reads A410."], ["Does this help?", "LCD display shows ovA. A barcode above the LCD display reads A410."], ["Does this help?", "LCD display shows ovA, A410 on an adjacent placard."], ["Does this help?", "LCD display shows ovA and A410 is printed on a decal."], ["Does this help?", "LCD display shows ovA. The LCD display has a badge marked A410. It reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA, A410 on a red and white sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA, A410 printed in black and white on a sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The LCD display has a panel marked A410. It reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA. A barcode above the LCD display reads A410."], ["What am I looking at, and what should I check?", "LCD display shows ovA, A410 on an adjacent placard."], ["What am I looking at, and what should I check?", "LCD display shows ovA and A410 is printed on a decal."], ["What am I looking at, and what should I check?", "LCD display shows ovA. The LCD display has a badge marked A410. It reads A410."], ["Does this help?", "LCD display shows ovA, A410, printed in black and white on a sticker."], ["Does this help?", "LCD display shows ovA, A410, on a red and white sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA, A410, printed in black and white on a sticker."], ["What am I looking at, and what should I check?", "LCD display shows ovA, A410, on a red and white sticker."]])("background locations cannot displace the real fault page: %s %s", async (question, observation) => {
  const docId = "55555555-5555-4555-8555-555555555555";
  const readout = { content: "Fault ovA indicates an overvoltage condition.", doc_id: docId, source_page: 18, rank: 1 };
  const competitors = Array.from({ length: 6 }, (_, i) => ({ content: "Parameter A410 controls unrelated configuration.", doc_id: docId, source_page: 30 + i, rank: 0.1 }));
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("replace(plainto_tsquery") ? [readout, ...competitors] : [] }));
  const q = buildRetrievalQuery(question, [], observation);
  const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
    nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true, includeQueryRecall: true,
  });
  expect(chunks.some(c => c.sourcePage === 18)).toBe(true);
});


it.each(["Does this help?", "What am I looking at, and what should I check?"].flatMap(question =>
  ["LCD display shows ovA.", "LCD display shows PERI, RD and 1."].flatMap(observation =>
    [0.1, 1, 100].map(rank => [question, observation, rank] as const))))(
  "unquoted readouts outrank generic passages: %s %s rank=%s", async (question, observation, rank) => {
    const docId = "55555555-5555-4555-8555-555555555555";
    const code = observation.includes("ovA") ? "ovA" : "PERI";
    const readout = { content: code === "ovA" ? "Fault ovA indicates an overvoltage condition." : "PERI Read Peripheral Fault: RD reports value 1 when a peripheral fault is present.", doc_id: docId, source_page: 18, rank: 0.1 };
    const competitors = Array.from({ length: 6 }, (_, i) => ({ content: "LCD display help and technical support for equipment screens. Removal of covers and imperial measurement conversions.", doc_id: docId, source_page: 30 + i, rank }));
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("replace(plainto_tsquery")) return { rows: String(params?.[1]).includes(code) ? [readout, ...competitors] : competitors };
      if (sql.includes("content ~* ANY")) return { rows: String(params?.[2]).toLowerCase().includes(code.toLowerCase()) ? [readout] : [] };
      return { rows: [] };
    });
    const q = buildRetrievalQuery(question, [], observation);
    const chunks = await retrieveNodeChunks({ query } as unknown as PoolClient, "tenant-1", q, {
      nodeId: "node-1", docIds: [docId], rawQuery: question, validatedDocScope: true, includeQueryRecall: true,
    });
    expect(chunks.some(c => c.sourcePage === 18)).toBe(true);
    const exact = query.mock.calls.find(([sql]) => sql.includes("content ~* ANY"));
    expect(exact).toBeDefined();
    expect(exact?.[0]).toContain("doc_id = ANY");
    expect(exact?.[1]?.[0]).toBe("tenant-1");
    expect(exact?.[1]?.[4]).toEqual([docId]);
  });

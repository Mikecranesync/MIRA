/**
 * #5955 native review F5 — the asset chat's persisted "Why MIRA thinks this" trace and its streamed
 * source list must agree. The ACTUAL asset POST runs with the real source builders; only retrieval
 * results, the session, the DB client and the model stream are fixtures. The trace written to
 * decision_traces (manual_evidence) is read from the actual INSERT.
 *
 * Run: npx vitest run src/capabilities/__tests__/citation-integrity-asset-trace.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const traces = vi.hoisted(() => ({ inserts: [] as unknown[][] }));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ userId: "u_1", tenantId: "tenant-aaaa-bbbb", email: "x@y", status: "trial", trialExpiresAt: null })) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn(async (sql: string, params: unknown[]) => { if (/INSERT INTO decision_traces/.test(sql)) traces.inserts.push(params); return { rows: [] }; }) })),
}));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn() } }));
vi.mock("@/lib/knowledge-graph/extractor", () => ({ extractAndStore: vi.fn() }));
vi.mock("@/lib/knowledge-graph/context-builder", () => ({ buildGraphContext: vi.fn(async () => "") }));
vi.mock("@/lib/workspace-files", () => ({ linkedDocIdsForTarget: vi.fn(async () => []) }));
vi.mock("@/lib/manual-rag", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/manual-rag")>()), retrieveManualChunks: vi.fn(), retrieveNodeChunks: vi.fn(async () => []) }));
vi.mock("@/lib/approved-context", () => ({ approvedAskEnforcementEnabled: vi.fn(() => false), approvedContextReady: vi.fn(() => true), buildApprovedContextRefusal: vi.fn(() => ({ gate: "approved_context" })) }));
vi.mock("@/lib/agents/safety-alert", () => ({ scanBoth: vi.fn(() => null), handleSafetyAlert: vi.fn(), safetyAlertSseChunk: vi.fn() }));
vi.mock("@/lib/machine-context-packet", () => ({ buildMachineContextPacket: vi.fn(async () => null), renderMachineEvidenceSection: vi.fn(() => "") }));

import { POST } from "@/app/api/assets/[id]/chat/route";
import pool from "@/lib/db";
import { retrieveManualChunks, type ManualChunk } from "@/lib/manual-rag";

const ID = "11111111-2222-3333-4444-555555555555";
const asset = { equipment_number: "MTR-101", manufacturer: "Allen-Bradley", model_number: "PowerFlex 525", serial_number: "S1", equipment_type: "Drive", location: "Plant.Line", criticality: "high", description: "Line drive", installation_date: null, last_maintenance_date: null, last_reported_fault: null, work_order_count: 0 };
const chunk = (o: Partial<ManualChunk>): ManualChunk => ({
  content: "F004 UnderVoltage: the DC bus voltage fell below the minimum.", manufacturer: "Allen-Bradley", modelNumber: "PowerFlex 525",
  title: "PowerFlex 525 manual", rank: 1, verified: true, sourceUrl: "https://oem.invalid/520-um001.pdf", sourcePage: null, ...o,
});

async function ask(chunks: ManualChunk[]) {
  traces.inserts.length = 0;
  vi.mocked(retrieveManualChunks).mockResolvedValue(chunks);
  vi.mocked(pool.connect).mockResolvedValue({
    query: vi.fn(async (sql: string) => (/SELECT.*FROM cmms_equipment/.test(sql) ? { rows: [asset] } : /FROM kg_relationships/.test(sql) ? { rows: [{ count: 0 }] } : { rows: [] })),
    release: vi.fn(),
  } as never);
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) =>
    String(url).includes("/drive-pack/ask")
      ? new Response(JSON.stringify({ matched: false, answer_source: "none" }), { status: 200 })
      : new Response('data: {"choices":[{"delta":{"content":"F004 is an undervoltage fault [1]."}}]}\n\ndata: [DONE]\n\n', { status: 200 })));
  const res = await POST(new Request(`https://hub.test/api/assets/${ID}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "what does F004 mean" }] }) }), { params: Promise.resolve({ id: ID }) });
  expect(res.status).toBe(200);
  let raw = "";
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) { const { done, value } = await reader.read(); if (done) break; raw += dec.decode(value, { stream: true }); }
  const frame = raw.split("\n\n").map((f) => f.replace(/^data: /, "")).flatMap((f) => { try { return [JSON.parse(f)]; } catch { return []; } }).find((f) => Array.isArray(f.sources));
  const evidence = JSON.parse(String(traces.inserts[0]?.[3] ?? "[]")) as Array<{ page: number | null; url: string | null }>;
  return { streamed: frame?.sources as Array<{ page: number | null; url: string | null }>, evidence };
}

beforeEach(() => { process.env.NEON_DATABASE_URL = "postgres://test-only-not-used"; process.env.GROQ_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("F5 — the persisted explanation panel opens the same address as the streamed source", () => {
  it("unknown page + stale #page=715: BOTH drop the numeric fragment and the page", async () => {
    const r = await ask([chunk({ sourceUrl: "https://oem.invalid/520-um001.pdf#page=715", sourcePage: 715, chunkIndex: 715 })]);
    expect(traces.inserts).toHaveLength(1); // precondition: the actual asset POST wrote its trace
    expect(r.streamed[0]).toMatchObject({ url: "https://oem.invalid/520-um001.pdf", page: null });
    expect(r.evidence[0]).toMatchObject({ url: "https://oem.invalid/520-um001.pdf", page: null });
  });
  it("known page 161 + stale #p715: BOTH carry #page=161 (other fragment args kept)", async () => {
    const r = await ask([chunk({ sourceUrl: "https://oem.invalid/520-um001.pdf#view=Fit&p715", sourcePage: 161, chunkIndex: 3, pageTrust: "trusted" })]);
    expect(r.streamed[0]).toMatchObject({ url: "https://oem.invalid/520-um001.pdf#view=Fit&page=161", page: 161 });
    expect(r.evidence[0]).toEqual(expect.objectContaining({ url: r.streamed[0].url, page: 161 }));
  });
  it("control: a named anchor and a no-fragment address are unchanged in both", async () => {
    const r = await ask([chunk({ sourceUrl: "https://oem.invalid/520-um001.pdf#section-3", sourcePage: 161, chunkIndex: 3, pageTrust: "trusted" })]);
    expect(r.streamed[0].url).toBe("https://oem.invalid/520-um001.pdf#section-3");
    expect(r.evidence[0].url).toBe("https://oem.invalid/520-um001.pdf#section-3");
  });
});

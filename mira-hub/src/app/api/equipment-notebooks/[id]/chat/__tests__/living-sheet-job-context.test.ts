/**
 * F18 (TASK-EGM-C) — the chat answer itself sees the current Living Work
 * Sheet job (title, open steps, current readings with who/when), not only
 * the post-hoc `sheet_receipt` frame `withSheetReceipt` (receipt.ts) wraps
 * around the already-generated answer. Before this fix the job was loaded
 * ONLY when building that receipt, so a direct sheet edit or a reopened job
 * never informed the answer path (egm-review/verdict.md F18).
 *
 * Harness copied from machine-evidence.test.ts (legacy/non-canonical seam,
 * so the raw provider request body carries `messages` directly — the
 * `sentSystemPrompt()` helper reads it from there) and general-mode.test.ts
 * (unbound notebook + `mode: "general"`, so no source/retrieval setup is
 * needed — this feature is gated on the living-sheet flag + jobId only,
 * never on a bound asset).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(async () => ({ ok: false, error: "no_sources_selected" })),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

// Legacy (seam-off) cascade so the raw provider body carries `messages`.
const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

const storeMock = vi.hoisted(() => ({ loadJob: vi.fn() }));
vi.mock("@/capabilities/living-sheet/store", () => storeMock);
// withSheetReceipt is covered by receipt.test.ts / sheet-receipt-gating.test.ts;
// this suite is purely about what reaches the ANSWER, so make it a passthrough.
vi.mock("@/capabilities/living-sheet/receipt", () => ({ withSheetReceipt: vi.fn(async (res: Response) => res) }));

import { POST } from "../route";

function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

/** The system prompt the provider actually received (legacy seam: raw `messages`). */
function sentSystemPrompt(): string {
  const call = vi.mocked(fetch).mock.calls[0]!;
  const body = JSON.parse(String((call[1] as RequestInit).body));
  return body.messages[0].content as string;
}

const SHEET_VIEW = {
  jobId: JOB_ID,
  seq: 4,
  title: "PM — Pump 07",
  machine: { entityId: "cmms-pump07", name: "Pump 07" },
  templateRevisionId: null,
  template: { title: "PM — Pump 07", machineLabel: null, component: null, jobType: null, estHours: null, crewSize: null, isolationPoints: null, cautions: null, returnToService: [], items: [], torques: [], steps: [], author: null, notes: null },
  steps: [
    { id: "step-1", text: "Check seal", checkoff: "none" as const, torqueRef: null, source: null, done: false, doneBy: null, doneAt: null, note: null, history: [] },
    { id: "step-2", text: "Grease bearing", checkoff: "none" as const, torqueRef: null, source: null, done: true, doneBy: "tech-1", doneAt: "2026-11-03T12:00:00.000Z", note: null, history: [] },
  ],
  readings: [
    { id: "r1", what: "Discharge pressure", current: { value: 48, unit: "psi", by: "tech-1", at: "2026-11-03T11:00:00.000Z", eventId: "e1" }, history: [] },
  ],
  parts: [],
  notes: [],
  questions: [],
  photos: [],
  handover: { current: null, history: [] },
  finished: null,
  openSteps: 1,
  openQuestions: 0,
  warnings: [],
};

const ORIGINAL_FLAG = process.env.NOTEBOOK_LIVING_SHEET;
beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "k";
  delete process.env.NOTEBOOK_LIVING_SHEET;
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Pump 07" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  storeMock.loadJob.mockResolvedValue({ status: "ok", view: SHEET_VIEW });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("Finish the open step."), { status: 200 })));
});
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.NOTEBOOK_LIVING_SHEET;
  else process.env.NOTEBOOK_LIVING_SHEET = ORIGINAL_FLAG;
});

describe("F18 — chat answer sees the current Living Work Sheet job", () => {
  it("flag on + a valid livingSheetJobId: the job's open step and current reading reach the system prompt", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const res = await POST(req({ message: "what's left on this job?", mode: "general", livingSheetJobId: JOB_ID }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(storeMock.loadJob).toHaveBeenCalledWith(TENANT, NB, JOB_ID);
    const sys = sentSystemPrompt();
    expect(sys).toContain('Living Work Sheet — "PM — Pump 07"');
    expect(sys).toContain("Open steps: Check seal");
    expect(sys).not.toContain("Grease bearing"); // done — not an OPEN step
    expect(sys).toContain("Discharge pressure = 48 psi");
    expect(sys).toContain("recorded by tech-1");
  });

  it("flag OFF: byte-identical — loadJob is never called, nothing sheet-shaped reaches the prompt", async () => {
    delete process.env.NOTEBOOK_LIVING_SHEET;
    const res = await POST(req({ message: "what's left on this job?", mode: "general", livingSheetJobId: JOB_ID }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(storeMock.loadJob).not.toHaveBeenCalled();
    expect(sentSystemPrompt()).not.toContain("Living Work Sheet");
  });

  it("no livingSheetJobId on the turn: loadJob is never called even with the flag on", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    const res = await POST(req({ message: "what's left on this job?", mode: "general" }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(storeMock.loadJob).not.toHaveBeenCalled();
    expect(sentSystemPrompt()).not.toContain("Living Work Sheet");
  });

  it("an unknown/finished-elsewhere job (loadJob ⇒ job_not_found) degrades to no section, never a broken turn", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "1";
    storeMock.loadJob.mockResolvedValue({ status: "job_not_found" });
    const res = await POST(req({ message: "what's left?", mode: "general", livingSheetJobId: JOB_ID }), params);
    expect(res.status).toBe(200);
    await res.text();
    expect(sentSystemPrompt()).not.toContain("Living Work Sheet");
  });
});

describe("F08 wiring — the chat route keys sheet proposals on the turn id", () => {
  it("passes the request's clientRequestId into the sheet-receipt context as turnId", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "route.ts"), "utf8");
    expect(src).toMatch(/const turnId = typeof b\?\.clientRequestId === "string" && isUuid\(b\.clientRequestId\)/);
    expect(src).toMatch(/sheetReceiptCtx = \{[^}]*techText: text, turnId \}/);
  });
});

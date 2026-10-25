/**
 * #4687 — truthful chat progress. With MIRA_CHAT_PROGRESS=1 AND a client that opts in with
 * `x-mira-progress: 1`, the route opens the SSE response immediately and emits a `progress`
 * frame at the moment each real stage starts (identity → retrieval → generation → answer check).
 * Everyone else gets the exact stream they got before.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/chat-progress.test.ts"
 * Harness copied from energized-work-hard-stop.test.ts (same mocks, same ASK for the stop path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const TORQUE_CHUNK = {
  content: "Remove the four cover screws (M4). Tighten the cover screws to 10 in-lb (1.1 N·m) on reassembly.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/gs10_manual.pdf",
  sourcePage: 43,
  pageLabel: "4-3",
  chunkIndex: null,
  title: "GS10 User Manual.pdf",
  rank: 0.4,
  verified: true,
};
const LOCKOUT_CHUNK = {
  ...TORQUE_CHUNK,
  content:
    "WARNING! Hazardous voltage. Disconnect all power to the drive and wait at least 5 minutes for the DC bus capacitors to discharge before servicing. Lock out and tag out the disconnect.",
  sourcePage: 25,
  pageLabel: "2-15",
  rank: 0.3,
};

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn(async () => ({ rows: [] })) }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "../route";

function req(body: unknown, opts: { progress?: boolean; signal?: AbortSignal } = {}) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(opts.progress ? { "x-mira-progress": "1" } : {}) },
    signal: opts.signal,
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}


// The REAL TQ-29 wording (Review A supplied it). The reconstruction this
// replaced ("Can I swap the cooling fan...") passed while the real string
// returned false, which is exactly how the gap survived the first round.
const ASK = "How do I pull the RFI jumper with it powered?";

function providerAnswers(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "GS10 drive", manufacturer: "AutomationDirect", model: "GS10" });
  // The question's own retrieval hands back the torque page; the lockout
  // query (LOCKOUT_PAGE_QUERY) hands back the WARNING page.
  ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, query: unknown) =>
    /lockout tagout/i.test(String(query)) ? [LOCKOUT_CHUNK] : [TORQUE_CHUNK],
  );
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  providerAnswers("Remove the four cover screws and tighten to 10 in-lb on reassembly.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
});


const ORDINARY = "What is the cover screw torque on reassembly?";
const stages = (f: Record<string, unknown>[]) => f.filter((x) => x.kind === "progress").map((x) => String(x.stage));
const kinds = (f: Record<string, unknown>[]) => f.map((x) => String(x.kind));

describe("#4687 chat progress frames", () => {
  beforeEach(() => {
    process.env.MIRA_CHAT_PROGRESS = "1";
  });
  afterEach(() => {
    delete process.env.MIRA_CHAT_PROGRESS;
  });

  it("opted-in turn: progress frames arrive in real stage order, before the answer", async () => {
    const res = await POST(req({ message: ORDINARY, sourceDocIds: [DOC_A] }, { progress: true }), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const out = await frames(res);
    expect(stages(out)).toEqual(["finding_equipment", "searching_documentation", "generating_answer", "checking_answer"]);
    const firstContent = kinds(out).indexOf("content");
    const lastProgress = kinds(out).lastIndexOf("progress");
    expect(firstContent).toBeGreaterThan(lastProgress);
    expect((out.find((f) => f.kind === "status") as { status: string }).status).toBe("answered");
  });

  it("time-to-first-feedback: the response and first progress frame arrive while retrieval is still running", async () => {
    let releaseRetrieval!: () => void;
    const gate = new Promise<void>((r) => { releaseRetrieval = r; });
    ragMock.retrieveNodeChunks.mockImplementation(async () => { await gate; return [TORQUE_CHUNK]; });
    const pending = POST(req({ message: ORDINARY, sourceDocIds: [DOC_A] }, { progress: true }), params);
    const res = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 500))]);
    expect(res).not.toBeNull(); // headers are out before retrieval finished
    const reader = (res as Response).body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (!buf.includes("searching_documentation")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    expect(buf).toContain('"stage":"searching_documentation"');
    expect(buf).not.toContain('"kind":"content"');
    releaseRetrieval();
    while (!(await reader.read()).done) { /* drain */ }
  });

  it("energized-work stop never claims generation or checking", async () => {
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }, { progress: true }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(true);
    expect(stages(out)).not.toContain("generating_answer");
    expect(stages(out)).not.toContain("checking_answer");
  });

  it("not opted in (flag on, no header): no progress frames, same frame sequence as flag off", async () => {
    const on = kinds(await frames(await POST(req({ message: ORDINARY, sourceDocIds: [DOC_A] }), params)));
    delete process.env.MIRA_CHAT_PROGRESS;
    const off = kinds(await frames(await POST(req({ message: ORDINARY, sourceDocIds: [DOC_A] }), params)));
    expect(on).not.toContain("progress");
    expect(on).toEqual(off);
  });

  it("flag off: an opted-in client gets the legacy stream (no progress)", async () => {
    delete process.env.MIRA_CHAT_PROGRESS;
    const out = await frames(await POST(req({ message: ORDINARY, sourceDocIds: [DOC_A] }, { progress: true }), params));
    expect(stages(out)).toEqual([]);
  });

  it("a validation error after the stream opened ends with an http_error frame, not a hang", async () => {
    const res = await POST(req({ sourceDocIds: [DOC_A] }, { progress: true }), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    const out = text.split("\n").filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]")).map((l) => JSON.parse(l.slice(6)));
    const err = out.find((f: { kind: string }) => f.kind === "http_error") as { status: number; body: { error: string } };
    expect(err.status).toBe(400);
    expect(err.body.error).toBe("message_required");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("the inner SSE headers reach an opted-in client as a headers frame", async () => {
    // What a legacy client sees in the HTTP headers for this turn...
    const legacy = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    const expected: Record<string, string> = {};
    for (const [k, v] of legacy.headers) if (k.startsWith("x-safety-") || k === "x-mira-trace-id" || k === "x-idempotent-replay") expected[k] = v;
    await legacy.text();
    expect(Object.keys(expected).length).toBeGreaterThan(0); // the stop path does set a safety header
    // ...an opted-in client receives in the headers frame.
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }, { progress: true }), params));
    const h = out.find((f) => f.kind === "headers") as { headers: Record<string, string> } | undefined;
    expect(h?.headers).toEqual(expected);
  });

  it("client abort during retrieval stops the turn: no provider call", async () => {
    let releaseRetrieval!: () => void;
    const gate = new Promise<void>((r) => { releaseRetrieval = r; });
    ragMock.retrieveNodeChunks.mockImplementation(async () => { await gate; return [TORQUE_CHUNK]; });
    const ac = new AbortController();
    const res = await POST(req({ message: ORDINARY, sourceDocIds: [DOC_A] }, { progress: true, signal: ac.signal }), params);
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel();
    releaseRetrieval();
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

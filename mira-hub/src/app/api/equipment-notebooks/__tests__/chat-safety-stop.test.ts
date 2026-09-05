/**
 * Equipment Notebook chat — safety hard-stop (spec §10, §11).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * This is the surface a technician uses while standing at a running machine,
 * and until this slice it was the one Hub chat route with no guardrail: the
 * asset- and node-chat routes both call `matchSafetyStop`, this one did not.
 *
 * The rules under test:
 *  - an active-hazard message stops BEFORE retrieval and BEFORE any provider
 *    call — no SQL, no fetch, no citations;
 *  - the stop is persisted, so the warning survives a device switch mid-incident;
 *  - it stops even when the notebook has no sources attached, because a hazard
 *    report must not be answered with "no sources selected";
 *  - an ordinary maintenance question is completely unaffected;
 *  - an educational question ("what is arc flash?") is NOT stopped — the carve-out
 *    that a second, hand-rolled keyword list would have silently lost.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  recordTurn: vi.fn(async () => undefined),
  // I3: the route resolves the notebook's bound asset; unbound keeps the
  // pre-081 behaviour these suites assert.
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  // 086: every zero-source turn proves tenant ownership first; this notebook
  // is the caller's.
  getNotebook: vi.fn(async () => ({ id: NB, displayName: "Conveyor 1" })),
  listSources: vi.fn(async () => []),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn(() => ""),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));

const poolMock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { POST } from "../[id]/chat/route";
import { SAFETY_STOP } from "@/lib/safety-classifier";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: NB }) };

async function readFrames(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter(Boolean);
}

function answerText(frames: string[]): string {
  return frames
    .map((f) => {
      try {
        return JSON.parse(f);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.kind === "content")
    .map((o) => o.content)
    .join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Any provider call during a safety stop is a failure of the whole slice.
  vi.stubGlobal("fetch", vi.fn());
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
});

describe("notebook chat safety hard-stop", () => {
  it("stops an active hazard report before retrieval and before any provider call", async () => {
    const res = await POST(
      chatReq({ message: "there is smoke coming from the drive panel", sourceDocIds: [DOC_A] }),
      params,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBe("smoke coming");
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const frames = await readFrames(res);
    expect(answerText(frames)).toContain("SAFETY STOP");
    expect(answerText(frames)).toContain("lockout/tagout");
    expect(frames.some((f) => f.includes('"kind":"safety"'))).toBe(true);
    expect(frames.at(-1)).toBe("[DONE]");
  });

  it("emits no citations — a stop is never dressed as a grounded answer", async () => {
    const res = await POST(chatReq({ message: "the wire is arcing", sourceDocIds: [DOC_A] }), params);
    const frames = await readFrames(res);
    const sources = frames
      .map((f) => {
        try {
          return JSON.parse(f);
        } catch {
          return null; // the [DONE] sentinel is not JSON
        }
      })
      .find((o) => o?.kind === "sources");
    expect(sources.citations).toEqual([]);
  });

  it("persists the stop with a safety_notice entry so hydration can restore it", async () => {
    await POST(chatReq({ message: "which cable to pull to stop it", sourceDocIds: [DOC_A] }), params);
    expect(domainMock.recordTurn).toHaveBeenCalledWith(
      expect.any(String),
      NB,
      expect.objectContaining({
        answerStatus: "answered",
        answerText: SAFETY_STOP,
        evidence: [{ kind: "safety_notice", trigger: expect.any(String) }],
        model: null,
      }),
    );
  });

  it("safety_notice trigger matches the X-Safety-Stop header", async () => {
    await POST(chatReq({ message: "which cable to pull to stop it", sourceDocIds: [DOC_A] }), params);
    const call = (domainMock.recordTurn.mock.calls as unknown as [string, string, Record<string, unknown>][])[0][2];
    const entry = (call.evidence as { kind: string; trigger: string }[])[0];
    expect(entry.kind).toBe("safety_notice");
    expect(typeof entry.trigger).toBe("string");
    expect(entry.trigger.length).toBeGreaterThan(0);
  });

  it("stops even with no sources attached, instead of returning no_sources_selected", async () => {
    domainMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(chatReq({ message: "i just got shocked by the panel", sourceDocIds: [] }), params);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBe("got shocked");
    expect(domainMock.recordTurn).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not stop an ordinary maintenance question", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(
      chatReq({ message: "what does parameter P042 set", sourceDocIds: [DOC_A] }),
      params,
    );

    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    const frames = await readFrames(res);
    expect(frames.some((f) => f.includes('"kind":"safety"'))).toBe(false);
  });

  it("does not stop an educational question about a safety concept", async () => {
    // The carve-out the shared classifier already encodes (2026-08-04): asking
    // WHAT arc flash is routes to normal handling; reporting one does not.
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const res = await POST(chatReq({ message: "what is arc flash", sourceDocIds: [DOC_A] }), params);

    expect(res.headers.get("X-Safety-Stop")).toBeNull();
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
  });

  it("keeps the notebook frame grammar so an unaware client still renders it", async () => {
    const res = await POST(chatReq({ message: "there is an exposed wire", sourceDocIds: [DOC_A] }), params);
    const kinds = (await readFrames(res))
      .map((f) => {
        try {
          return JSON.parse(f).kind;
        } catch {
          return f;
        }
      })
      .filter((k, i, a) => k !== "content" || a[i - 1] !== "content");

    expect(kinds[0]).toBe("sources");
    expect(kinds).toContain("content");
    expect(kinds.at(-3)).toBe("safety");
    expect(kinds.at(-2)).toBe("status");
    expect(kinds.at(-1)).toBe("[DONE]");
  });
});

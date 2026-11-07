/**
 * #5265 edge profile — "AI finds, manual speaks". On the sealed tablet the
 * notebook answer is the retrieved manual passages, verbatim with page, and no
 * model runs (w0-tablet-spike.md, 2026-11-07: the model-written path took 53 s
 * on the 1.5B and came back uncited).
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/edge-passages.test.ts"
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

const HOWTO_CHUNK = {
  content:
    "Weighing the aircraft. Drain the fuel, fill the oil, place the aircraft level on the scales, record each scale reading, and divide the total moment by the total weight to find the empty weight CG.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: "node-doc/u1/faa-h-8083-1b.pdf",
  sourcePage: 43,
  pageLabel: "3-9",
  chunkIndex: null,
  title: "FAA-H-8083-1B Weight and Balance.pdf",
  rank: 0.4,
  verified: true,
};
// An index page: dotted leader lines and page numbers, no instruction.
const INDEX_CHUNK = {
  ...HOWTO_CHUNK,
  content:
    "E6-B flight compute .......................... 10-1 effects of weight ............................ 1-3 electronic calculator ................... 10-2",
  sourcePage: 111,
  pageLabel: "I-3",
  rank: 0.5,
};

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
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
  requestDialectFields: vi.fn(() => ({})),
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
import { EDGE_PASSAGES_LEAD } from "@/capabilities/edge-passages";
import { RESTART_BANNER } from "@/capabilities/restart-advisory";
import { SEMANTIC_UNVERIFIED_FALLBACK } from "@/capabilities/answer-safety-check";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
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

const contentOf = (f: Record<string, unknown>[]) =>
  f.filter((x) => x.kind === "content").map((x) => String(x.content)).join("");

const ASK = "How do I find the empty weight center of gravity?";

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
  delete process.env.GROQ_API_KEY;
  process.env.MIRA_PROFILE = "edge";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Aircraft weight and balance", manufacturer: "FAA", model: "FAA-H-8083-1B" });
  ragMock.retrieveNodeChunks.mockResolvedValue([INDEX_CHUNK, HOWTO_CHUNK]);
  ragMock.retrieveCitedPageChunks.mockResolvedValue([]);
  filesMock.photoLinkedToTarget.mockResolvedValue(null);
  providerAnswers("Use the equipment list.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.MIRA_PROFILE;
  delete process.env.NOTEBOOK_ANSWER_GATE;
});

describe("#5265 edge profile — the manual speaks", () => {
  it("answers with the passage verbatim and its page, skips the index page, calls no model", async () => {
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    const out = await frames(res);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content).toContain(HOWTO_CHUNK.content);
    expect(content).toContain("page 43");
    expect(content).not.toContain("equipment list");
    expect(content).not.toContain("E6-B");

    const sources = out.find((f) => f.kind === "sources") as { citations: Array<{ citationId: string; page: number | null }> };
    expect(sources.citations.map((c) => c.page)).toEqual([43]);
    expect(content).toContain(`[${sources.citations[0].citationId}]`);

    expect(content.startsWith(EDGE_PASSAGES_LEAD)).toBe(true);
    expect((out.find((f) => f.kind === "evidence") as { basis: string }).basis).toBe("oem_documentation");
    expect((out.find((f) => f.kind === "status") as { status: string }).status).toBe("answered");

    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      answerStatus: string;
      answerText: string;
      model: string | null;
    };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.answerText).toBe(content);
    expect(persisted.model).toBeNull();
  });

  it("only an index page retrieved: says nothing matched, records insufficient_evidence, calls no model", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([INDEX_CHUNK]);
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(contentOf(out)).toMatch(/qualified person/);
    expect((out.find((f) => f.kind === "status") as { status: string }).status).toBe("insufficient_evidence");
    expect((out.find((f) => f.kind === "sources") as { citations: unknown[] }).citations).toEqual([]);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as { answerStatus: string };
    expect(persisted.answerStatus).toBe("insufficient_evidence");
  });

  it("keeps the manual's warning that sits in a sibling chunk of the cited page: in the text and persisted", async () => {
    // The warning is NOT in the retrieved chunk (so not in any quoted window); only
    // the rest-of-page read returns it — Codex #5266 F2.
    ragMock.retrieveCitedPageChunks.mockResolvedValue([
      { content: "WARNING: Personal injury may result if the aircraft is jacked on an unlevel surface.", sourceUrl: HOWTO_CHUNK.sourceUrl, sourcePage: 43 },
    ]);
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(ragMock.retrieveCitedPageChunks).toHaveBeenCalled();
    const content = contentOf(out);
    expect(content).toContain('WARNING (page 43): "Personal injury may result if the aircraft is jacked on an unlevel surface."');
    expect(content.indexOf("WARNING")).toBeLessThan(content.indexOf(HOWTO_CHUNK.content));
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      evidence: Array<Record<string, unknown>>;
    };
    const entry = persisted.evidence.find((e) => e.kind === "manual_safety_statement");
    expect(entry).toMatchObject({ marker: "WARNING", page: 43, sourceDocId: DOC_A });
    expect(persisted.evidence.some((e) => e.kind === "safety_notice")).toBe(false);
  });

  it.each([
    ["usable passage", () => [INDEX_CHUNK, HOWTO_CHUNK]],
    ["index page only", () => [INDEX_CHUNK]],
  ])("a verified photo stays on the turn (%s) — live and persisted", async (_label, retrieved) => {
    const PHOTO = "44444444-4444-4444-8444-444444444444";
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-07T12:00:00.000Z" });
    ragMock.retrieveNodeChunks.mockResolvedValue(retrieved());
    const out = await frames(
      await POST(req({ message: ASK, sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO, capturedAt: "ignored" } }), params),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(JSON.stringify(out.filter((f) => f.kind === "evidence"))).toContain(PHOTO);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      evidence: Array<Record<string, unknown>>;
    };
    expect(JSON.stringify(persisted.evidence)).toContain(PHOTO);
  });

  // Codex #5266 round 2 (F5): the passage text is served through the SAME
  // finalization as a generated answer, so its safety layers still apply.
  it("a fault-reset ask still gets the restart banner ahead of the passages (live and persisted)", async () => {
    const out = await frames(await POST(req({ message: "It tripped on overcurrent, how do I restart it?", sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content.startsWith(RESTART_BANNER)).toBe(true);
    expect(content).toContain(HOWTO_CHUNK.content);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as { answerText: string };
    expect(persisted.answerText.startsWith(RESTART_BANNER)).toBe(true);
  });

  it("an active smoke report still gets the hazard banner ahead of the passages", async () => {
    const out = await frames(await POST(req({ message: "there is smoke from the drive panel, what do I check", sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content.startsWith("⚠️")).toBe(true);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as { answerText: string };
    expect(persisted.answerText.startsWith("⚠️")).toBe(true);
  });

  it("a retrieved passage saying lockout is not required gets the output validator's safety flag ahead of it", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([{ ...HOWTO_CHUNK, content: "Lockout is not required for this adjustment. Turn the trim screw a quarter turn." }]);
    const out = await frames(await POST(req({ message: "How do I adjust the trim?", sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content.startsWith("⚠️ **Safety flag on a step below:**")).toBe(true);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as { answerText: string };
    expect(persisted.answerText.startsWith("⚠️ **Safety flag on a step below:**")).toBe(true);
  });

  it("answer gate off (live streaming): the restart banner is streamed once, ahead of the passages", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    const out = await frames(await POST(req({ message: "It tripped on overcurrent, how do I restart it?", sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content.startsWith(RESTART_BANNER)).toBe(true);
    expect(content.split(RESTART_BANNER).length - 1).toBe(1);
    expect(content).toContain(HOWTO_CHUNK.content);
  });

  // The device runs with the semantic check at its default (on) and no
  // provider at all (no credentials): a flagged turn cannot be verified, so it
  // gets the controlled fallback, never the passages unjudged; an unflagged
  // turn is served.
  describe("device default: semantic check on, no provider configured", () => {
    beforeEach(() => {
      delete process.env.NOTEBOOK_SEMANTIC_CHECK;
      seamMock.canonicalProviders.mockReturnValue([]);
    });
    afterEach(() => {
      seamMock.canonicalProviders.mockReturnValue([{ name: "groq", url: "https://x/y", key: "k", model: "m" }]);
    });

    it("a flagged turn gets the controlled fallback, live and persisted, and calls no model", async () => {
      const out = await frames(await POST(req({ message: "there is smoke from the drive panel, what do I check", sourceDocIds: [DOC_A] }), params));
      expect(seamMock.canonicalProviders).toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      expect(out).toContainEqual({ kind: "safety", trigger: "unsafe-answer:semantic-unverified" });
      const content = contentOf(out);
      expect(content).toBe(SEMANTIC_UNVERIFIED_FALLBACK);
      expect(out.find((f) => f.kind === "sources")?.citations).toEqual([]);
      const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
        answerText: string;
        basis: unknown;
        evidence: { kind: string; trigger?: string }[];
      };
      expect(persisted.answerText).toBe(SEMANTIC_UNVERIFIED_FALLBACK);
      expect(persisted.basis).toBeNull();
      expect(persisted.evidence).toEqual(
        expect.arrayContaining([
          { kind: "safety_notice", trigger: "unsafe-answer:semantic-unverified" },
          { kind: "safety_stop", trigger: "unsafe-answer:semantic-unverified" },
        ]),
      );
      expect(persisted.evidence.some((e) => "citationId" in e)).toBe(false);
    });

    it("an unflagged how-to is still served as passages, and calls no model", async () => {
      const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      expect(out.some((f) => f.kind === "safety")).toBe(false);
      const content = contentOf(out);
      expect(content.startsWith(EDGE_PASSAGES_LEAD)).toBe(true);
      expect(content).toContain(HOWTO_CHUNK.content);
    });
  });

  it("control: with the profile off the same turn goes to the model", async () => {
    delete process.env.MIRA_PROFILE;
    process.env.GROQ_API_KEY = "k";
    await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });
});

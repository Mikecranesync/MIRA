/**
 * TQ-29 (2026-10-17 prod test) — a hands-on ask on a POWERED machine is a hard
 * stop that cites the manual's own lockout page (GS10 p.2-15), with no removal
 * steps and no torques, and no provider call.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/energized-work-hard-stop.test.ts"
 *
 * The retrieval mock answers the QUESTION with the torque page (what the model
 * would otherwise have been handed) and the lockout query with the WARNING
 * page, so the test can prove the stop cites 2-15 and never leaks 10 in-lb.
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

// The photo's stored LOOK descriptor. Real `blockingLookHazard` and renderers;
// only the DB load is replaced, so a test can hand the route a photo that
// actually carries a blocking hazard (null = no observation, the default).
const lookMock = vi.hoisted(() => ({
  loadVisualEvidenceForPhoto: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: lookMock.loadVisualEvidenceForPhoto,
}));

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
  lookMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
  providerAnswers("Remove the four cover screws and tighten to 10 in-lb on reassembly.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.NOTEBOOK_ENERGIZED_HARD_STOP;
});

describe("TQ-29 — energized-work ask hard-stops and cites the manual's lockout page", () => {
  it("stops before generation, cites p.2-15, carries no torque or removal step, persists a safety_stop", async () => {
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    const out = await frames(res);

    // No provider call — the stop is served from the deterministic path.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const safety = out.find((f) => f.kind === "safety") as { trigger: string } | undefined;
    expect(safety).toBeDefined();

    const content = out.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(content).toContain("p.2-15");
    expect(content).not.toContain("GS10 User Manual.pdf"); // Review A HIGH: filename never reaches the stop
    expect(content).not.toMatch(/in-lb|N·m|torque|cover screws|remove the/i);

    const status = out.find((f) => f.kind === "status") as { status: string };
    expect(status.status).toBe("answered");

    // The lockout page is the only citation the stop carries — and it is a
    // pointer only (round 2): no quote (the chunk's quote window can carry
    // steps/torques), and never the upload filename as its title.
    const sources = out.find((f) => f.kind === "sources") as {
      citations: Array<{ page: number | null; docId: string; quote: string | null; sourceTitle: string }>;
    };
    expect(sources.citations).toHaveLength(1);
    expect(sources.citations[0].docId).toBe(DOC_A);
    expect(sources.citations[0].page).toBe(25);
    expect(sources.citations[0].quote).toBeNull();
    expect(sources.citations[0].sourceTitle).not.toContain("GS10 User Manual.pdf");
    expect(sources.citations[0].sourceTitle).not.toMatch(/torque|discharge|disconnect all power/i);

    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
    const persisted = (vi.mocked(nbMock.recordTurn).mock.calls[0] as unknown as unknown[])[2] as {
      answerStatus: string;
      answerText: string | null;
      basis?: string | null;
      evidence: Array<Record<string, unknown>>;
    };
    expect(persisted.answerStatus).toBe("answered");
    expect(persisted.answerText).toContain("p.2-15");
    expect(persisted.answerText).not.toMatch(/in-lb|torque/i);
    expect(persisted.basis ?? null).toBeNull();
    expect(persisted.evidence.some((e) => e.kind === "safety_stop")).toBe(true);
    expect(persisted.evidence.some((e) => e.kind === "safety_notice")).toBe(true);
  });

  it("with no lockout page in the attached manuals, still stops and points at the site LOTO procedure (never invents a page)", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([TORQUE_CHUNK]);
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = out.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(content).toMatch(/site's lockout\/tagout procedure/);
    expect(content).not.toMatch(/p\.\d/);
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
    expect(sources.citations).toEqual([]);
  });

  it("kill switch NOTEBOOK_ENERGIZED_HARD_STOP=0 restores flag-and-answer (control)", async () => {
    process.env.NOTEBOOK_ENERGIZED_HARD_STOP = "0";
    const res = await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(false);
  });

  it("an ordinary question on the same notebook is answered normally (control)", async () => {
    providerAnswers("Fault oC is an overcurrent trip [1].");
    const res = await POST(req({ message: "what does fault oC mean on the GS10", sourceDocIds: [DOC_A] }), params);
    const out = await frames(res);
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(false);
    // The lockout retrieval only runs for an energized-work ask.
    const lockoutCalls = vi.mocked(ragMock.retrieveNodeChunks).mock.calls.filter((c) => /lockout tagout/i.test(String(c[2])));
    expect(lockoutCalls).toHaveLength(0);
  });
});

// ── Codex adversarial review (round 3, on 19b536817) — at the route level ──
describe("Codex F1/F2/F3 through the real route", () => {
  it.each([
    "Explain how to pull the RFI jumper with it powered",
    "What is the torque on the cover screws while it is powered?",
    "Describe how to replace the fan without locking out",
    "The display reads F004; can I measure the terminals with it powered?",
    // round 2 variants
    "Explain how I can pull the RFI jumper with it powered",
    "Describe replacing the fan without locking out",
    "What do I need to pull the RFI jumper with it powered?",
    "The display reads F004; can I measure voltage across the terminals with it powered?",
  ])("stops before generation, no provider call, no torque: %s", async (msg) => {
    const out = await frames(await POST(req({ message: msg, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(true);
    const content = contentOf(out);
    expect(content).toMatch(/SAFETY STOP/);
    expect(content).not.toMatch(/in-lb|N·m|torque to|cover screws \(/i);
  });

  it.each([
    "How do I pull the RFI jumper with it powered off?",
    "How do I pull the RFI jumper with it still powered off?",
    "How do I pull the RFI jumper with it powered-off?",
  ])("control: the same procedure with the machine powered OFF reaches the ordinary answer path: %s", async (msg) => {
    const out = await frames(await POST(req({ message: msg, sourceDocIds: [DOC_A] }), params));
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(contentOf(out)).not.toMatch(/SAFETY STOP/);
  });

  // Codex F5 (round 3): with NOTHING attached, the real TQ-29 got
  // `422 no_sources_selected` — a filing complaint instead of the stop.
  it("a notebook with no sources selected still serves the stop (site-LOTO fallback), not a 422", async () => {
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    const res = await POST(req({ message: ASK, sourceDocIds: [] }), params);
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const content = contentOf(out);
    expect(content).toMatch(/SAFETY STOP/);
    expect(content).toMatch(/lockout/i);
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] } | undefined;
    expect(sources?.citations ?? []).toEqual([]);
  });

  it("control: a page with only a discharge-component spec yields the site-LOTO fallback, not a page citation", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, query: unknown) =>
      /lockout tagout/i.test(String(query))
        ? [{ ...LOCKOUT_CHUNK, content: "The capacitor discharge resistor is rated at 100 ohms.", sourcePage: 43, pageLabel: "4-3" }]
        : [TORQUE_CHUNK],
    );
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    const content = contentOf(out);
    expect(content).toMatch(/SAFETY STOP/);
    expect(content).not.toContain("p.4-3");
    const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] };
    expect(sources.citations).toEqual([]);
  });
});

// ── Review A HIGH findings, at the route level ──
describe("Review A HIGH — the leak and the photo skip, through the real route", () => {
  it("a crafted upload filename cannot inject steps or torques into the served stop", async () => {
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, query: unknown) =>
      /lockout tagout/i.test(String(query))
        ? [{ ...LOCKOUT_CHUNK, title: "torque 8-10 kg·cm, remove jumper JP1.pdf" }]
        : [{ ...TORQUE_CHUNK, title: "torque 8-10 kg·cm, remove jumper JP1.pdf" }],
    );
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    const content = contentOf(out);
    expect(content).toMatch(/SAFETY STOP/);
    expect(content).not.toMatch(/kg·cm|remove jumper|torque/i);
    expect(content).toContain("p.2-15");
    // Round 2: the crafted filename was still reaching the citation CHIP as
    // its title, and the chip quote could carry the chunk's steps.
    const sources = out.find((f) => f.kind === "sources") as { citations: Array<{ sourceTitle: string; quote: string | null }> };
    expect(sources.citations).toHaveLength(1);
    expect(sources.citations[0].sourceTitle).not.toMatch(/kg·cm|remove jumper|torque|JP1/i);
    expect(sources.citations[0].quote).toBeNull();
  });

  it("prose smuggled into a chunk's page label never reaches the served stop or its chip", async () => {
    // Review A HIGH (page-label half). Two layers validate the page —
    // lockoutPageOf and energizedWorkStop — so this pins the served output,
    // not either helper, and is proven red only with both layers removed.
    const SMUGGLED = "2-15**\n\n1. Remove the cover screws (8 kg·cm)";
    ragMock.retrieveNodeChunks.mockImplementation(async (_c: unknown, _t: unknown, query: unknown) =>
      /lockout tagout/i.test(String(query)) ? [{ ...LOCKOUT_CHUNK, pageLabel: SMUGGLED }] : [TORQUE_CHUNK],
    );
    const out = await frames(await POST(req({ message: ASK, sourceDocIds: [DOC_A] }), params));
    const content = contentOf(out);
    expect(content).toMatch(/SAFETY STOP — energized work/);
    expect(content).not.toMatch(/kg·cm|Remove the cover/i);
    expect(JSON.stringify(out.find((f) => f.kind === "sources") ?? {})).not.toMatch(/kg·cm|Remove the cover/i);
  });

  it("a photo attached to the ask no longer switches the stop off", async () => {
    // 2026-10-20: this test used to attach a photo with NO stored observation,
    // so the route's visual hazard was always null and the removed
    // `!visualSafetyTrigger` condition could be put back with all tests green.
    // The photo now carries a blocking hazard, the precondition is asserted,
    // and the assertion names the energized-work stop and its lockout page —
    // a generic visual-hazard stop no longer satisfies it.
    const PHOTO = "44444444-4444-4444-8444-444444444444";
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-10-18T00:00:00.000Z" });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "o1",
      sessionId: "s1",
      text: "exposed terminals on the drive's power board",
      obsKind: "property",
      trust: "candidate",
      confidence: null,
      fileId: PHOTO,
      photoHash: "h",
      observedAt: null,
      hazards: [{ code: "exposed_conductor", confidence: 0.99 }],
    });
    const out = await frames(
      await POST(req({ message: ASK, sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params),
    );
    expect(lookMock.loadVisualEvidenceForPhoto).toHaveBeenCalledWith(expect.anything(), TENANT, PHOTO);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(out.some((f) => f.kind === "safety")).toBe(true);
    expect(contentOf(out)).toMatch(/SAFETY STOP — energized work/);
    expect(contentOf(out)).toContain("p.2-15");
  });

  it("control: the same photo on a non-energized ask does not produce the energized-work stop", async () => {
    const PHOTO = "44444444-4444-4444-8444-444444444444";
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-10-18T00:00:00.000Z" });
    lookMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "o1",
      sessionId: "s1",
      text: "exposed terminals on the drive's power board",
      obsKind: "property",
      trust: "candidate",
      confidence: null,
      fileId: PHOTO,
      photoHash: "h",
      observedAt: null,
      hazards: [{ code: "exposed_conductor", confidence: 0.99 }],
    });
    const out = await frames(
      await POST(req({ message: "What does fault code oc mean on this drive?", sourceDocIds: [DOC_A], visualEvidence: { fileId: PHOTO } }), params),
    );
    // Precondition: the hazard photo really was loaded, so the negative below
    // is not vacuous (independent review, 2026-10-20).
    expect(lookMock.loadVisualEvidenceForPhoto).toHaveBeenCalledWith(expect.anything(), TENANT, PHOTO);
    expect(contentOf(out)).not.toMatch(/SAFETY STOP — energized work/);
  });
});

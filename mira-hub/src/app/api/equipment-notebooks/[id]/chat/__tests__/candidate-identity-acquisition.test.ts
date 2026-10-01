/**
 * #4160 S6 — RC1 fix (candidate identity proposal from a label read, not just
 * the corpus) + the candidate-basis background manual acquisition it triggers
 * (PRD R2), end to end through the notebook chat route.
 *
 * The #4120 identity proposal (proposeIdentityFromText) only recognises a
 * maker that already has corpus rows (corpusManufacturers) — a maker with
 * none, like the SMC valve trace that started Manual-First, could never be
 * proposed. This suite proves the fallback (extractCandidateIdentity,
 * candidate-identity.ts) fires when the corpus misses, that it starts the
 * SAME background search a confirmation would, that the search never writes
 * a notebook identity column, and that it is gated off when the flag is off.
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/candidate-identity-acquisition.test.ts"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";

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
  listTurns: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

// Unlike general-mode.test.ts's harness, this suite needs corpusManufacturers
// to be a REAL, controllable mock — RC1 is specifically the case where it
// returns an empty/unmatching list and proposeIdentityFromText finds nothing.
const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  corpusManufacturers: vi.fn(async () => [] as string[]),
  manufacturerFromObservationText: vi.fn(() => null as string | null),
  resolveModelFromObservationText: vi.fn(() => ({ model: null as string | null, ambiguous: false })),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
// pool.connect() backs the identityProposal block's corpusManufacturers(client)
// call — corpusManufacturers itself is mocked above, so the client shape does
// not matter, only that connect()/release() exist.
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "groq", url: "https://x/y", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((provider: { model: string }, messages: unknown) => ({ model: provider.model, messages, stream: true })),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "groq" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

// The S6 capability layer: a controllable spy so this suite proves WIRING
// (is it called, with what, when) without re-proving the fencing SQL
// (notebook-manual-acquisition.test.ts, migration-104 integration test).
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  // #4175: follows the base flag unless a test pins it, as the real one requires both.
  candidateAcquisitionEnabled: vi.fn((): boolean => acqMock.acquisitionEnabled()),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, rec: unknown) => rec),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return {
    ...actual,
    acquisitionEnabled: acqMock.acquisitionEnabled,
    candidateAcquisitionEnabled: acqMock.candidateAcquisitionEnabled,
    startManualAcquisition: acqMock.startManualAcquisition,
    readAcquisition: acqMock.readAcquisition,
    reconcileAcquisition: acqMock.reconcileAcquisition,
    // acquisitionKey / acquisitionDeclineText stay REAL — they are pure and
    // already unit-proven; this suite checks the route calls them correctly.
  };
});

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

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try {
      out.push(JSON.parse(p));
    } catch {
      /* partial */
    }
  }
  return out;
}

beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine", nodeId: NODE, manufacturer: null, model: null });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  ragMock.corpusManufacturers.mockResolvedValue([]); // RC1: the corpus does not know this maker
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.candidateAcquisitionEnabled.mockImplementation(() => acqMock.acquisitionEnabled());
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
  acqMock.reconcileAcquisition.mockImplementation(async (_t: string, _n: string, rec: unknown) => rec);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream("That's a pneumatic manifold valve."), { status: 200 })),
  );
});

const SMC_MESSAGE = "Find the manual for the SMC SS5Y3-DUW01302";

describe("#4160 S6 RC1 — candidate identity proposal when the corpus misses", () => {
  it("proposes {manufacturer, model} from the label text even though corpusManufacturers() is empty", async () => {
    const res = await POST(req({ message: SMC_MESSAGE, mode: "general" }), params);
    const f = await frames(res);
    const proposal = f.find((x) => x.kind === "identity_proposal");
    expect(proposal).toMatchObject({ manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("control: the pre-existing corpus path still wins when it DOES find a match (no behaviour change there)", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["Allen-Bradley"]);
    const res = await POST(req({ message: "Find the manual for my Allen-Bradley SLC 5/03", mode: "general" }), params);
    const f = await frames(res);
    const proposal = f.find((x) => x.kind === "identity_proposal");
    expect(proposal).toMatchObject({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });

  it("never binds: the notebook identity is never written (no updateNotebook-shaped call exists on the equipment-notebooks mock to begin with)", async () => {
    await (await POST(req({ message: SMC_MESSAGE, mode: "general" }), params)).text();
    // recordTurn persists the TURN (basis/evidence), never the notebook's own
    // identity columns — getNotebook is read-only here (no update* mock exists).
    expect(nbMock.recordTurn).toHaveBeenCalled();
    expect(Object.keys(nbMock)).not.toContain("updateNotebook");
  });

  it("control: a teaching question with no maker+part named proposes nothing, and starts no search", async () => {
    const res = await POST(req({ message: "what does PNP mean on a sensor?", mode: "general" }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "identity_proposal")).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });
});

describe("#4160 S6 R2 — candidate-basis background acquisition triggers from the RC1 proposal", () => {
  it("starts a candidate-basis search keyed as manufacturer|part|<empty catalog>, exactly what the PATCH confirm would key", async () => {
    await POST(req({ message: SMC_MESSAGE, mode: "general" }), params);
    expect(acqMock.startManualAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        notebookId: NB,
        nodeId: NODE,
        identity: { identityStatus: "user_confirmed", manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "" },
        basis: "candidate",
      }),
    );
  });

  it("the flag off ⇒ nothing starts", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(false);
    await POST(req({ message: SMC_MESSAGE, mode: "general" }), params);
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("claim idempotency: a search already 'running' for the SAME key still attempts the atomic claim (its own idempotency, proven in notebook-manual-acquisition.test.ts) — a refused claim (false) is handled, never treated as a fresh start", async () => {
    acqMock.readAcquisition.mockResolvedValue({
      key: "SMC|SS5Y3DUW01302|",
      state: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
    });
    // The real startManualAcquisition refuses (returns false) when claim()'s
    // atomic UPDATE does not match a fresh, non-stale 'running' record — this
    // IS that idempotency, simulated here since startManualAcquisition itself
    // is a spy in this suite.
    acqMock.startManualAcquisition.mockResolvedValue(false);
    await (await POST(req({ message: SMC_MESSAGE, mode: "general" }), params)).text();
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    // A refused claim must fall through to reconcileAcquisition — never
    // fabricate a second 'running' record of its own.
    expect(acqMock.reconcileAcquisition).toHaveBeenCalled();
  });

  it("a message with no manual/documentation intent AND no photo observation does not trigger the search (half 1 nor half 2 of R2 is satisfied)", async () => {
    const res = await POST(
      req({ message: "is the SMC SS5Y3-DUW01302 compatible with 24VDC supply?", mode: "general" }),
      params,
    );
    const f = await frames(res);
    // The proposal still renders (identity extraction is independent of the
    // acquisition trigger) — only the BACKGROUND SEARCH is gated by R2.
    expect(f.find((x) => x.kind === "identity_proposal")).toMatchObject({ manufacturer: "SMC" });
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("relays the running search's honest status through the system prompt directive, not a new SSE frame", async () => {
    await (await POST(req({ message: SMC_MESSAGE, mode: "general" }), params)).text();
    const call = vi.mocked(global.fetch).mock.calls.at(-1)!;
    const sentBody = JSON.parse((call[1] as RequestInit).body as string);
    const systemMsg = (sentBody.messages as { role: string; content: string }[]).find((m) => m.role === "system");
    expect(systemMsg?.content).toMatch(/saved to this notebook's Sources/);
    expect(systemMsg?.content).not.toMatch(/Use its manuals|confirmed as that machine/);
    expect(systemMsg?.content).toMatch(/looking for the official SMC SS5Y3-DUW01302 manual/);
  });
});

// Codex r3 F5 (#4172): the corpus-independent fallback keeps the existing
// multi-machine rejection — a comparison never yields one machine's search.
describe("#4160 S6 — an ambiguous identity is never resurrected by the fallback", () => {
  it("a two-machine comparison proposes nothing and starts no search", async () => {
    const res = await POST(req({ message: "Compare the manuals for Siemens 6ES7214-1AG40-0XB0 and TP700", mode: "general" }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "identity_proposal")).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("control: the single part alone still proposes and searches", async () => {
    const res = await POST(req({ message: "Find the manual for Siemens 6ES7214-1AG40-0XB0", mode: "general" }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "identity_proposal")).toMatchObject({ model: "6ES7214-1AG40-0XB0" });
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
  });
});

// #4172 F13 / #4175: the candidate takeover flag, off, is exactly pre-S6 even
// with the base acquisition flag on.
describe("#4175 — candidate takeover gated behind MIRA_NOTEBOOK_CANDIDATE_ACQUISITION", () => {
  it("base flag on, candidate flag off → no RC1 proposal, no candidate search", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.candidateAcquisitionEnabled.mockReturnValue(false);
    const res = await POST(req({ message: SMC_MESSAGE, mode: "general" }), params);
    const f = await frames(res);
    expect(f.find((x) => x.kind === "identity_proposal")).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });
});

// #4160 gate NO-GO (PRD "Never"): on the turn the candidate search starts, a
// specificity fallback must not tell the technician to "get it from the
// manufacturer's support" while MIRA is already searching for it.
describe("#4160 gate — no 'fetch it yourself' advice while the search runs", () => {
  const UNSUPPORTED = "Set this machine's relief valve to 250 bar.";

  async function answerText(): Promise<string> {
    const f = await frames(await POST(req({ message: SMC_MESSAGE, mode: "general" }), params));
    return f
      .filter((x) => x.kind === "content" || x.kind === "replace")
      .map((x) => String(x.content ?? x.text ?? ""))
      .join("");
  }

  it("the candidate search is running → the fallback says MIRA is already searching", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(UNSUPPORTED), { status: 200 })));
    const text = await answerText();
    expect(acqMock.startManualAcquisition).toHaveBeenCalled();
    expect(text).not.toContain("manufacturer's support");
    expect(text).toContain("I'm already searching for the official manual");
    // Codex #4183 F1: a CANDIDATE manual lands turned off pending review, so
    // the fallback must say to check it and turn it on before asking again.
    expect(text).toContain("turned off until you check it");
    expect(text).toContain("turn it on there");
  });

  it("control: no search running (flags off) → the self-serve advice stays", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(UNSUPPORTED), { status: 200 })));
    const text = await answerText();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    expect(text).toContain("manufacturer's support");
  });
});

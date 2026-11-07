/**
 * Photo builds the notebook (owner decision 2026-11-07), end to end through
 * the notebook chat route: an UNBOUND notebook, a nameplate photo with a model
 * label AND a serial, a plain question — the official-manual search starts
 * from the plate reading on that same turn. No typed make/model, no confirm
 * step, no flag beyond the one kill switch, and the serial never leaves.
 *
 * Fixture: a GS10-series drive plate with a SYNTHETIC serial (public repo).
 *
 * Run: npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/photo-builds-notebook.route.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const PHOTO = "44444444-4444-4444-8444-444444444444";

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

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string, _chunks: unknown[], look?: string) => (look ? `${look}\n\n${q}` : q)),
  corpusManufacturers: vi.fn(async () => [] as string[]),
  manufacturerFromObservationText: vi.fn(() => null as string | null),
  // The real OEM model reader truncates "GS11N-20P2" to its family "GS11N" —
  // the search identity must come from the label reader, never this value.
  resolveModelFromObservationText: vi.fn(() => ({ model: "GS11N" as string | null, ambiguous: false })),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
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

const visualMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async () => ({ fileId: PHOTO, capturedAt: "2026-11-07T00:00:00Z" })),
  loadVisualEvidenceForPhoto: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: visualMock.photoLinkedToTarget }));
vi.mock("@/lib/visual-evidence-context", async (original) => ({
  ...(await original<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: visualMock.loadVisualEvidenceForPhoto,
  loadRecentLookObservations: vi.fn(async () => []),
}));

const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, rec: unknown) => rec),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return {
    ...actual,
    acquisitionEnabled: acqMock.acquisitionEnabled,
    startManualAcquisition: acqMock.startManualAcquisition,
    readAcquisition: acqMock.readAcquisition,
    reconcileAcquisition: acqMock.reconcileAcquisition,
  };
});

import { POST } from "../route";

const SERIAL = "7A3K9Q2026X11";
const MODEL = "GS11N-20P2";
const PLATE = [
  "AutomationDirect.com",
  `MODEL: ${MODEL}`,
  "INPUT: 1PH 200-240V 50/60Hz 8.4A",
  "OUTPUT: 3PH 0-240V 2.2A 0.5kW/0.5HP",
  `SERIAL NO: ${SERIAL}`,
].join("\n");
const QUESTION = "What is this drive and how do I clear a fault on it?";

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
const plateTurn = () => POST(req({ message: QUESTION, mode: "general", visualEvidence: { fileId: PHOTO } }), params);

const envBefore = { ...process.env };
afterEach(() => {
  process.env = { ...envBefore };
  vi.unstubAllGlobals();
});
beforeEach(() => {
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "New notebook", nodeId: NODE, manufacturer: null, model: null });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  ragMock.retrieveManualChunks.mockResolvedValue([]);
  ragMock.corpusManufacturers.mockResolvedValue([]);
  ragMock.manufacturerFromObservationText.mockReturnValue(null);
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
  visualMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-07T00:00:00Z" });
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs", sessionId: "session", text: PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("That is a GS10-series AC drive."), { status: 200 })));
});

const EXPECTED_IDENTITY = { identityStatus: "user_confirmed", manufacturer: "AUTOMATIONDIRECT", model: MODEL, catalogNumber: "" };

describe("a nameplate photo starts the manual search on the same turn", () => {
  it("unbound notebook + plate photo + plain question → proposal from the plate and a candidate-basis search, no confirm", async () => {
    const f = await frames(await plateTurn());
    expect(f.find((x) => x.kind === "identity_proposal")).toMatchObject({ manufacturer: "AUTOMATIONDIRECT", model: MODEL });
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expect(acqMock.startManualAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, notebookId: NB, nodeId: NODE, identity: EXPECTED_IDENTITY, basis: "candidate" }),
    );
    expect(f.find((x) => x.kind === "manual_search_status")).toMatchObject({ manufacturer: "AUTOMATIONDIRECT", model: MODEL, running: true });
    // No confirm-first chip and no "confirm the machine" ask on the wire.
    const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions ?? []).not.toContainEqual(expect.stringMatching(/Search the web for/));
  });

  it("the serial never leaves: not in the search identity, not in any proposal or chip", async () => {
    const f = await frames(await plateTurn());
    const started = JSON.stringify(acqMock.startManualAcquisition.mock.calls[0]?.[0] ?? null);
    expect(started).toContain(MODEL);
    expect(started).not.toContain(SERIAL);
    for (const frame of f) {
      if (frame.kind === "identity_proposal" || frame.kind === "manual_search_status" || frame.kind === "followups") {
        expect(JSON.stringify(frame)).not.toContain(SERIAL);
      }
    }
  });

  it("a library maker with NO citable pages for this model still searches — the full plate model, not the truncated family", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
    ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
    ragMock.retrieveManualChunks.mockResolvedValue([]);
    const f = await frames(await plateTurn());
    expect(f.find((x) => x.kind === "identity_proposal")).toMatchObject({ model: MODEL });
    expect(acqMock.startManualAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({ identity: expect.objectContaining({ manufacturer: "AutomationDirect", model: MODEL }), basis: "candidate" }),
    );
  });

  it("control: when the library already grounds the turn (pages found), no search is spent", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
    ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
    ragMock.retrieveManualChunks.mockResolvedValue([
      { id: "c1", content: "Fault codes: oC over-current …", score: 1, manufacturer: "AutomationDirect", model: "GS10", sourceTitle: "GS10 user manual", sourcePage: 12, sourceUrl: null, docId: "d1", chunkIndex: 0 },
    ]);
    const f = await frames(await plateTurn());
    expect(f.find((x) => x.kind === "identity_proposal")).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  // #5268 Codex F1: a private value from the photo typed back under a MODEL
  // label (or with its punctuation dropped) never starts a search.
  it.each([
    ["an asset tag typed back as MODEL", "SMC Asset tag: 12345678", "Find the manual for SMC MODEL: 12345678"],
    ["a serial retyped without its dash", "SMC S/N: AB-1234567", "Find the manual for SMC MODEL: AB1234567"],
    ["a bracketed suffix asset tag typed back as MODEL", "SMC 12345678 (asset tag)", "Find the manual for SMC MODEL: 12345678"],
    ["a suffix asset tag typed back as MODEL", "SMC 12345678 tag", "Find the manual for SMC MODEL: 12345678"],
    ["a bracketed suffix asset tag before a rating", "SMC 12345678 (asset tag), 24VDC", "Find the manual for SMC MODEL: 12345678"],
    ["a suffix asset tag with a rating on the next line", "SMC 12345678 tag\n24VDC", "Find the manual for SMC MODEL: 12345678"],
    ["a spaced value before a bracketed asset tag", "Siemens TP 1200 (asset tag)", "Find the manual for Siemens MODEL: TP1200"],
    ["a spaced value before a bracketed serial label", "Siemens TP 1200 (S/N)", "Find the manual for Siemens MODEL: TP1200"],
    ["a P/N-looking asset value", "SMC Asset tag: PN12345678", "Find the manual for this"],
    ["a P/N-looking serial value", "SMC S/N: PN12345678", "Find the manual for this"],
    ["a TYPE-looking asset value", "SMC Asset tag: TYPE12345678", "Find the manual for this"],
    ["a spaced P/N word inside an asset value", "SMC Asset tag: PN 12345678", "Find the manual for this"],
    ["a spaced P/N word inside a serial value", "SMC S/N: PN 12345678", "Find the manual for this"],
    ["a P/N word after another token in an asset value", "SMC Asset tag: ABC PN 12345678", "Find the manual for this"],
    ["an asset value wrapped to the next line", "SMC Asset tag:\nPN 12345678", "Find the manual for this"],
    ["a serial value wrapped to the next line", "SMC S/N:\nPN 12345678", "Find the manual for this"],
    ["a wrapped asset value after another token", "SMC Asset tag: ABC\nPN 12345678", "Find the manual for this"],
    ["a numbered asset-tag annotation", "SMC Asset tag (1): PN 12345678", "Find the manual for this"],
    ["a bracketed asset-tag annotation", "SMC Asset tag [1]: PN 12345678", "Find the manual for this"],
    ["a numbered serial annotation", "SMC S/N (1): PN 12345678", "Find the manual for this"],
  ])("%s → no search, no proposal of it", async (_name, plate, message) => {
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: plate, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({ message, mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    const proposal = JSON.stringify(f.find((x) => x.kind === "identity_proposal") ?? null);
    expect(proposal).not.toMatch(/12345678|AB-?1234567|TP ?1200/);
  });

  // #5268 Codex r2 F2: the photo search completed and enabled its manual, then
  // the technician turned that source off. The chat status must say so, not
  // promise that asking again will answer from it.
  describe("a completed photo search whose manual is now turned off", () => {
    const completeRec = async () => {
      const { acquisitionKey } = await vi.importActual<typeof import("@/capabilities/notebook-manual-acquisition")>(
        "@/capabilities/notebook-manual-acquisition",
      );
      const key = acquisitionKey({ identityStatus: "user_confirmed", manufacturer: "AUTOMATIONDIRECT", model: MODEL, catalogNumber: "" })!;
      return {
        key,
        source: (enabledByDefault: boolean) => ({
          docId: "d-photo", filename: "gs10.pdf", enabledByDefault, matchState: "verified", sourceRole: "manual",
          readiness: { canChat: true }, matchEvidence: { autoAcquisitionKey: key, sourceLabel: "from_photo" },
        }),
        rec: {
          key, state: "complete", started_at: "2026-11-07T00:00:00Z", finished_at: "2026-11-07T00:01:00Z",
          candidate_host: "www.automationdirect.com", match_state: "verified", oem_request_url: null, attached_indexed: true,
        },
      };
    };
    const statusMessage = (f: Record<string, unknown>[]) =>
      String((f.find((x) => x.kind === "manual_search_status") as { message?: string } | undefined)?.message ?? "");

    it("source off → the status says it is turned off and to turn it back on", async () => {
      const c = await completeRec();
      acqMock.readAcquisition.mockResolvedValue(c.rec);
      nbMock.listSources.mockResolvedValue([c.source(false)] as never);
      const msg = statusMessage(await frames(await plateTurn()));
      expect(msg).toMatch(/turned off there now/);
      expect(msg).toMatch(/Turn it back on in Sources/);
    });

    it("a failed source read is unknown → never claims the manual is turned off", async () => {
      const c = await completeRec();
      acqMock.readAcquisition.mockResolvedValue(c.rec);
      nbMock.listSources.mockRejectedValue(new Error("db down"));
      const msg = statusMessage(await frames(await plateTurn()));
      expect(msg).toMatch(/added it to this notebook's Sources/);
      expect(msg).not.toMatch(/turned off/);
    });

    it("control: source on → no 'turned off' claim", async () => {
      const c = await completeRec();
      acqMock.readAcquisition.mockResolvedValue(c.rec);
      nbMock.listSources.mockResolvedValue([c.source(true)] as never);
      const msg = statusMessage(await frames(await plateTurn()));
      expect(msg).toMatch(/added it to this notebook's Sources/);
      expect(msg).not.toMatch(/turned off/);
    });
  });

  it("control: the one kill switch off → nothing starts", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(false);
    await (await plateTurn()).text();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("the answer is told the search is running — never a silent general answer", async () => {
    await (await plateTurn()).text();
    const call = vi.mocked(global.fetch).mock.calls.at(-1)!;
    const sentBody = JSON.parse((call[1] as RequestInit).body as string);
    const systemMsg = (sentBody.messages as { role: string; content: string }[]).find((m) => m.role === "system");
    expect(systemMsg?.content).toMatch(/looking for the official AUTOMATIONDIRECT GS11N-20P2 manual/);
    expect(systemMsg?.content).not.toMatch(/once they confirm/);
  });
});

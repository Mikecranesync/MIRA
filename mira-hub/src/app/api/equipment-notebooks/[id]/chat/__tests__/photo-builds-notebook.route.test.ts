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
  resolveModelFromObservationText: vi.fn((_text: string) => ({ model: "GS11N" as string | null, ambiguous: false })),
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
  loadRecentLookObservations: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: visualMock.photoLinkedToTarget }));
vi.mock("@/lib/visual-evidence-context", async (original) => ({
  ...(await original<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: visualMock.loadVisualEvidenceForPhoto,
  loadRecentLookObservations: visualMock.loadRecentLookObservations,
}));

// #5268 option A: the public-manual proof is a DB read; default "not proven".
const proofMock = vi.hoisted(() => ({ publicManualSeries: vi.fn(async (..._a: unknown[]) => null as string | null) }));
vi.mock("@/capabilities/public-model-proof", () => proofMock);
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
import { resolveModelFromObservationText } from "@/capabilities/model-token";

const SERIAL = "7A3K9Q2026X11";
const MODEL = "GS11N-20P2";
// #5268 owner decision 2026-11-07: a plate that prints a serial or asset tag
// never searches by itself, so the automatic-search tests use the same plate
// without its serial line; SERIAL_PLATE pins the confirm-first path.
const PLATE = [
  "AutomationDirect.com",
  `MODEL: ${MODEL}`,
  "INPUT: 1PH 200-240V 50/60Hz 8.4A",
  "OUTPUT: 3PH 0-240V 2.2A 0.5kW/0.5HP",
].join("\n");
const SERIAL_PLATE = `${PLATE}\nSERIAL NO: ${SERIAL}`;
const SERIES_SERIAL_PLATE = SERIAL_PLATE.replace("MODEL:", "GS10\nMODEL:");
const UNREVIEWED_MODEL = "GS11N-20P5";
const UNREVIEWED_SERIAL_PLATE = SERIAL_PLATE.replace(MODEL, UNREVIEWED_MODEL);
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
  ragMock.resolveModelFromObservationText.mockReturnValue({ model: "GS11N", ambiguous: false });
  proofMock.publicManualSeries.mockResolvedValue(null);
  acqMock.acquisitionEnabled.mockReturnValue(true);
  acqMock.startManualAcquisition.mockResolvedValue(true);
  acqMock.readAcquisition.mockResolvedValue(null);
  visualMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-11-07T00:00:00Z" });
  visualMock.loadRecentLookObservations.mockResolvedValue([]);
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs", sessionId: "session", text: PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("That is a GS10-series AC drive."), { status: 200 })));
});

const EXPECTED_IDENTITY = { identityStatus: "user_confirmed", manufacturer: "AUTOMATIONDIRECT", model: MODEL, catalogNumber: "" };

it.each(["A loose cable is sitting on a workbench.", SERIAL_PLATE])(
  "offers the explicitly typed ABB model after an earlier, unrelated LOOK",
  async (text) => {
    visualMock.loadRecentLookObservations.mockResolvedValue([
      { observationId: "obs", sessionId: "session", obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [], text },
    ]);
    const res = await POST(req({ message: "Find the manual for ABB ACS355.", mode: "general" }), params);
    expect(await frames(res)).toContainEqual({ kind: "identity_proposal", manufacturer: "ABB", model: "ACS355" });
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("still withholds a proposal when the typed request conflicts with the current photo", async () => {
  const res = await POST(req({
    message: "Find the manual for ABB ACS355.", mode: "general", visualEvidence: { fileId: PHOTO },
  }), params);
  expect((await frames(res)).filter(({ kind }) => kind === "identity_proposal")).toEqual([]);
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
});

it("proposes the exact model from a formatted LOOK reading without issuing a search before confirmation", async () => {
  ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs", sessionId: "session", obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    text: `**Brand:** AutomationDirect\n**Model:** **${MODEL}**\n**Input:** 110-120 VAC\n**Serial number:** SYNTH-00081`,
  });
  const res = await POST(req({ message: "Find me the manual for this drive.", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
  const result = await frames(res);

  expect(result).toContainEqual({ kind: "identity_proposal", manufacturer: "AutomationDirect", model: MODEL });
  expect(result.find((frame) => frame.kind === "status")).toMatchObject({
    status: "insufficient_evidence", message: expect.stringContaining("Confirm the equipment"),
  });
  expect(result.filter(({ kind }) => kind === "manual_search_status" || kind === "followups")).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("SYNTH-00081");
  expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  "Find the manual for AutomationDirect GS11N-20P5.",
  "Find the manual for ABB ACS355.",
])("withholds lookup when the typed request and the verified photo disagree (%s)", async (message) => {
  // The corpus may know the typed machine even when it cannot recognize the photo's maker.
  ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect", "ABB"]);
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs", sessionId: "session", obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    text: `**Brand:** AutomationDirect\n**Model:** **${MODEL}**\n**Serial number:** SYNTH-00081`,
  });
  const res = await POST(req({ message, mode: "general", visualEvidence: { fileId: PHOTO } }), params);
  const result = await frames(res);

  expect(result.filter(({ kind }) => kind === "identity_proposal" || kind === "manual_search_status")).toEqual([]);
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves the exact model when a known maker's label also includes ratings and standards", async () => {
  ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs",
    sessionId: "session",
    text: `${PLATE}\n0.7KVA 0.6KVA 100KA IE2 19XK`,
    obsKind: "look",
    trust: "candidate",
    fileId: PHOTO,
    hazards: [],
  });
  const res = await POST(req({
    message: "Find me the manual for this drive.",
    mode: "general",
    visualEvidence: { fileId: PHOTO },
  }), params);
  const result = await frames(res);
  expect(result.find((frame) => frame.kind === "identity_proposal")).toMatchObject({ model: MODEL });
  expect(result.find((frame) => frame.kind === "status")).toMatchObject({
    message: expect.stringContaining("Confirm the equipment"),
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
});

it.each([
  ["ABB\nACS355", "ACS355"],
  ["Schneider Electric\nCA3KN22BD", "CA3KN22BD"],
  [SERIES_SERIAL_PLATE, MODEL],
])("offers confirmation from reviewed coverage on the label %s", async (text, model) => {
  ragMock.resolveModelFromObservationText.mockImplementation(resolveModelFromObservationText);
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs", sessionId: "session", text, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
  });
  const result = await frames(await POST(req({
    message: "Find me the manual for this.",
    mode: "general",
    visualEvidence: { fileId: PHOTO },
  }), params));
  expect(result.find((frame) => frame.kind === "identity_proposal")).toMatchObject({ model });
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
});

it.each([
  { manufacturer: "ABB", model: "ACS355", text: "ABB\nACS355\nS/N: TEST-ABB-001\nIP20" },
  { manufacturer: "ABB", model: "ACS355", text: "ABB\nACS355\nSerial No. TEST-ABB-001\nIP20" },
  { manufacturer: "Schneider Electric", model: "CA3KN22BD", text: "Schneider Electric\nCA3KN22BD\nS/N: TEST-SE-002\n24VDC" },
])("F2: offers $model for confirmation with a separate serial and trailing rating", async ({ manufacturer, model, text }) => {
  ragMock.resolveModelFromObservationText.mockImplementation(resolveModelFromObservationText);
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs", sessionId: "session", text, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
  });
  const result = await frames(await POST(req({
    message: "Find me the manual for this.",
    mode: "general",
    visualEvidence: { fileId: PHOTO },
  }), params));
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  expect(result.find((frame) => frame.kind === "identity_proposal")).toMatchObject({ manufacturer, model });
});

it.each([
  "Schneider Electric\nCA3KN22BD\nS/N: CA3KN22BD",
  "ABB\nACS355\nSerial No. ACS355\nIP20",
  "ABB\nACS355\nS/N: TEST-ABB-001\nACS580",
  "ABB\nACS355\nS/N: TEST-ABB-001\nACH580",
  "ABB\nACS355\nS/N: TEST-ABB-001\nACH580-01-07A3-4",
])("F2/F9: refuses a compact model repeated in the serial or seen beside a competing model (%j)", async (text) => {
  ragMock.resolveModelFromObservationText.mockImplementation(resolveModelFromObservationText);
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs",
    sessionId: "session",
    text,
    obsKind: "look",
    trust: "candidate",
    fileId: PHOTO,
    hazards: [],
  });
  const result = await frames(await POST(req({
    message: "Find me the manual for this.",
    mode: "general",
    visualEvidence: { fileId: PHOTO },
  }), params));
  expect(result.find((frame) => frame.kind === "identity_proposal")).toBeUndefined();
  expect(result.find((frame) => frame.kind === "status")).toMatchObject({
    status: "insufficient_evidence",
    message: expect.stringContaining("What manufacturer and model or order number"),
  });
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
});

it("F7: does not offer the model for confirmation when its label names an incompatible family", async () => {
  ragMock.resolveModelFromObservationText.mockImplementation(resolveModelFromObservationText);
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
    observationId: "obs",
    sessionId: "session",
    text: SERIES_SERIAL_PLATE.replace("\nGS10\n", "\nGS20\n"),
    obsKind: "look",
    trust: "candidate",
    fileId: PHOTO,
    hazards: [],
  });
  const result = await frames(await POST(req({
    message: "Find me the manual for this.",
    mode: "general",
    visualEvidence: { fileId: PHOTO },
  }), params));
  expect(result.find((frame) => frame.kind === "identity_proposal")).toBeUndefined();
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
});

it.each([
  "Show me the operating instructions for setting the acceleration time.",
  "Find the manual for this drive and tell me which parameter sets acceleration time.",
])("F5: retrieves and cites the OEM parameter when asked %s", async (message) => {
  ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
  ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
  const passage = "P01.12 Acceleration Time 1 sets the acceleration time.";
  ragMock.retrieveManualChunks.mockResolvedValue([{
    id: "acceleration-time",
    content: passage,
    score: 1,
    manufacturer: "AutomationDirect",
    model: "GS10",
    sourceTitle: "GS10 user manual",
    sourcePage: 139,
    sourceUrl: null,
    docId: "gs10-manual",
    chunkIndex: 0,
  }]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(passage + " [1]"), { status: 200 })));
  const result = await frames(await POST(req({ message, mode: "general", visualEvidence: { fileId: PHOTO } }), params));
  expect(ragMock.retrieveManualChunks).toHaveBeenCalledWith(
    expect.anything(), TENANT, expect.any(String), expect.objectContaining({ manufacturer: "AutomationDirect", rawQuery: message }),
  );
  expect(result.find((frame) => frame.kind === "sources")).toMatchObject({
    citations: [expect.objectContaining({ docId: "gs10-manual", page: 139 })],
  });
  expect(result.find((frame) => frame.kind === "identity_proposal")).toBeUndefined();
  expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
});

describe("ABB ACS355 voltage questions", () => {
  beforeEach(() => {
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: "ABB\nMODEL: ACS355", obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    ragMock.resolveModelFromObservationText.mockReturnValue({ model: "ACS355", ambiguous: false });
    ragMock.corpusManufacturers.mockResolvedValue(["ABB"]);
    ragMock.manufacturerFromObservationText.mockReturnValue("ABB");
  });

  it.each([
    "Show me the voltage from the ABB ACS355 manual.",
    "Find the manual for ABB ACS355. 240V?",
  ])("retrieves and cites the voltage page for %s", async (message) => {
    const passage = "Input voltage depends on the variant: 1-phase 200–240 V AC, 3-phase 200–240 V AC, or 3-phase 380–480 V AC.";
    ragMock.retrieveManualChunks.mockResolvedValue([{
      id: "abb-drive-ratings",
      content: passage,
      score: 1,
      manufacturer: "ABB",
      model: "ACS355",
      sourceTitle: "ACS355 user's manual",
      sourcePage: 387,
      sourceUrl: null,
      docId: "abb-acs355-manual",
      chunkIndex: 0,
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream(passage + " [1]"), { status: 200 })));
    const result = await frames(await POST(req({ message, mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    expect(ragMock.retrieveManualChunks).toHaveBeenCalledWith(
      expect.anything(), TENANT, expect.any(String), expect.objectContaining({ manufacturer: "ABB", rawQuery: message }),
    );
    expect(result.find((frame) => frame.kind === "sources")).toMatchObject({
      citations: [expect.objectContaining({ docId: "abb-acs355-manual", page: 387 })],
    });
    expect(result.find((frame) => frame.kind === "identity_proposal")).toBeUndefined();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it("uses document lookup for the document-only request ending in a period", async () => {
    const result = await frames(await POST(req({
      message: "Find the manual for ABB ACS355.", mode: "general", visualEvidence: { fileId: PHOTO },
    }), params));
    expect(result.find((frame) => frame.kind === "identity_proposal")).toMatchObject({ manufacturer: "ABB", model: "ACS355" });
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
    expect(acqMock.startManualAcquisition).toHaveBeenCalledWith(expect.objectContaining({
      basis: "candidate", identity: expect.objectContaining({ manufacturer: "ABB", model: "ACS355" }),
    }));
  });
});

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

  it("an unreviewed plate that prints a serial requires explicit search confirmation", async () => {
    proofMock.publicManualSeries.mockResolvedValue("GS10");
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: UNREVIEWED_SERIAL_PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({ message: "Find the manual for this drive", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    // The technician confirms instead: one chip names the exact model, never the serial.
    const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions).toContain(`Search the web for "${UNREVIEWED_MODEL}"`);
    for (const frame of f) {
      if (frame.kind === "identity_proposal" || frame.kind === "manual_search_status" || frame.kind === "followups") {
        expect(JSON.stringify(frame)).not.toContain(SERIAL);
      }
    }
  });

  it("F11: offers one reviewed identity confirmation when the public model could also be searched", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
    ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
    proofMock.publicManualSeries.mockResolvedValue("GS10");
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: SERIES_SERIAL_PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({
      message: "Find the manual for this drive",
      mode: "general",
      visualEvidence: { fileId: PHOTO },
    }), params));
    expect(f.filter((frame) => frame.kind === "identity_proposal")).toEqual([
      expect.objectContaining({ manufacturer: "AutomationDirect", model: MODEL }),
    ]);
    const followups = f.find((frame) => frame.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions ?? []).not.toContainEqual(expect.stringMatching(/Search the web for/));
    expect(proofMock.publicManualSeries).not.toHaveBeenCalled();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
  });

  it.each(["SMC MODEL: TP1200 (customer asset tag)", "SMC MODEL: TP1200 (internal asset tag)", "SMC MODEL: TP1200 (customer S/N)", "SMC MODEL: TP1200\n(customer asset tag)", "SMC MODEL: TP1200\r\n(internal asset tag)", "SMC MODEL: TP1200\n(customer S/N)", "SMC MODEL: TP1200\nTP 1200\n(asset tag)"])(
    "#5268 Codex r14: a model the plate marks private is never offered on the confirm chip either (%s)",
    async (plate) => {
      visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
        observationId: "obs", sessionId: "session", text: plate, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
      });
      const f = await frames(await POST(req({ message: "Find the manual for this", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
      expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
      for (const frame of f) expect(JSON.stringify(frame)).not.toMatch(/Search the web for[^"]*\\?"TP1200/);
      const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
      expect(followups?.suggestions ?? []).not.toContainEqual(expect.stringMatching(/TP1200/));
    },
  );
  it.each(["SMC MODEL: TP1200\n(customer\nasset tag)", "SMC MODEL: TP1200 (customer\nasset tag)", "SMC MODEL: TP1200 (internal\r\nasset tag)", "SMC MODEL: TP1200\n(customer\nS/N)", "SMC MODEL: TP1200 24VDC\n(asset tag)", "SMC MODEL: TP1200 (customer #1 asset tag)", "SMC MODEL: TP1200 (customer\n#1 asset tag)", "SMC MODEL: TP1200 (customer #1 S/N)"])(
    "#5268 Codex r16/r17: a dangling private label anywhere on the plate means no chip at all (%j)",
    async (plate) => {
      visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
        observationId: "obs", sessionId: "session", text: plate, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
      });
      const f = await frames(await POST(req({ message: "Find the manual for this", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
      expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
      for (const frame of f) expect(JSON.stringify(frame)).not.toMatch(/Search the web for[^"]*\\?"TP1200/);
      const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
      expect(followups?.suggestions ?? []).not.toContainEqual(expect.stringMatching(/TP1200/));
    },
  );
  // #5268 owner decision 2026-11-07 (option A): on a plate that shows a serial
  // or asset label, the maker's own public manuals decide — not label wording.
  it("option A: a serial plate whose model is NOT in the maker's public manuals offers no chip", async () => {
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: UNREVIEWED_SERIAL_PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({ message: "Find the manual for this drive", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions ?? []).not.toContainEqual(expect.stringMatching(/Search the web for/));
    expect(proofMock.publicManualSeries).toHaveBeenCalledWith(expect.anything(), "AUTOMATIONDIRECT", UNREVIEWED_MODEL);
  });

  it("option A: a library maker whose pages missed the full catalog number still offers the proven unreviewed model", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
    ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
    ragMock.retrieveManualChunks.mockResolvedValue([]);
    proofMock.publicManualSeries.mockResolvedValue("GS10");
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: UNREVIEWED_SERIAL_PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({ message: "Find the manual for this drive", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions).toContain(`Search the web for "${UNREVIEWED_MODEL}"`);
    // Only the maker and the model reach the proof query; the serial never leaves.
    expect(proofMock.publicManualSeries).toHaveBeenCalledWith(expect.anything(), "AUTOMATIONDIRECT", UNREVIEWED_MODEL);
    expect(JSON.stringify(proofMock.publicManualSeries.mock.calls)).not.toContain(SERIAL);
    expect(JSON.stringify(f)).not.toContain(SERIAL);
  });

  it("option A control: the same library-maker plate with the model NOT proven public offers no chip", async () => {
    ragMock.corpusManufacturers.mockResolvedValue(["AutomationDirect"]);
    ragMock.manufacturerFromObservationText.mockReturnValue("AutomationDirect");
    ragMock.retrieveManualChunks.mockResolvedValue([]);
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: UNREVIEWED_SERIAL_PLATE, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({ message: "Find the manual for this drive", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions ?? []).not.toContainEqual(expect.stringMatching(/Search the web for/));
  });

  it.each(["SMC MODEL: TP1200 (customer\n#1234 asset tag)", "SMC MODEL: TP1200 (customer\r\n#1234 S/N)"])(
    "option A: a wording the label rules miss (Codex r18) is stopped by the public-manual proof (%j)",
    async (plate) => {
      visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
        observationId: "obs", sessionId: "session", text: plate, obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
      });
      const f = await frames(await POST(req({ message: "Find the manual for this", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
      expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
      for (const frame of f) expect(JSON.stringify(frame)).not.toMatch(/Search the web for[^"]*\\?"TP1200/);
    },
  );
  it("r14 control: a public model beside a distinct serial is still offered on the confirm chip", async () => {
    proofMock.publicManualSeries.mockResolvedValue("");
    visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "obs", sessionId: "session", text: "SMC MODEL: TP1200\nS/N: 00998877", obsKind: "look", trust: "candidate", fileId: PHOTO, hazards: [],
    });
    const f = await frames(await POST(req({ message: "Find the manual for this", mode: "general", visualEvidence: { fileId: PHOTO } }), params));
    const followups = f.find((x) => x.kind === "followups") as { suggestions?: string[] } | undefined;
    expect(followups?.suggestions).toContain('Search the web for "TP1200"');
    expect(JSON.stringify(f)).not.toContain("00998877");
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
    ["the technician marks the plate's model as an asset tag", "Siemens MODEL: TP1200", "Find the manual for this. TP 1200 (asset tag)"],
    ["the technician marks the plate's model as a serial", "Siemens MODEL: TP1200", "Find the manual for this. TP 1200 (S/N)"],
    ["the plate marks its model as an asset tag", "Siemens MODEL: TP1200\nTP 1200 (asset tag)", "Find the manual for this"],
    ["the plate marks its model as a serial", "Siemens MODEL: TP1200\nTP 1200 (S/N)", "Find the manual for this"],
    ["the plate's asset tag label wraps onto its own line", "Siemens MODEL: TP1200\nTP 1200\n(asset tag)", "Find the manual for this"],
    ["the plate's serial label wraps, with CRLF line ends", "Siemens MODEL: TP1200\r\nTP 1200\r\n(S/N)", "Find the manual for this"],
    ["OCR splits the plate's private value into short tokens", "Siemens MODEL: TP1200\nT P 12 00 (asset tag)", "Find the manual for this"],
    ["a qualifier sits between the plate's private value and its label", "Siemens MODEL: TP1200\nTP 1200 (customer asset tag)", "Find the manual for this"],
    ["a qualified serial label follows the plate's model", "Siemens MODEL: TP1200\nTP 1200 (customer S/N)", "Find the manual for this"],
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
    const requestManual = () => POST(req({
      message: "Find the manual for this drive.", mode: "general", visualEvidence: { fileId: PHOTO },
    }), params);

    it("leaves Ready to the Sources snapshot when a photo lookup has already completed", async () => {
      const c = await completeRec();
      nbMock.listSources.mockResolvedValueOnce([]).mockResolvedValue([c.source(true)] as never);
      acqMock.readAcquisition.mockResolvedValueOnce(null).mockResolvedValue(c.rec);

      const msg = statusMessage(await frames(await requestManual()));

      expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
      expect(nbMock.listSources).toHaveBeenCalledTimes(2);
      expect(msg).toMatch(/added it to this notebook's Sources/i);
      expect(msg).not.toMatch(/ready|turned off|turn it back on/i);
    });

    it("does not claim the new manual is off or ready when the fresh Sources read fails", async () => {
      const c = await completeRec();
      nbMock.listSources.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("db down"));
      acqMock.readAcquisition.mockResolvedValueOnce(null).mockResolvedValue(c.rec);

      const msg = statusMessage(await frames(await requestManual()));

      expect(nbMock.listSources).toHaveBeenCalledTimes(2);
      expect(msg).toMatch(/couldn't check whether/);
      expect(msg).not.toMatch(/turned off|turn it back on|I can answer from it/i);
    });

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
    expect(systemMsg?.content).toMatch(/looking for the official documentation for the AUTOMATIONDIRECT GS11N-20P2/);
    expect(systemMsg?.content).not.toMatch(/once they confirm/);
  });
});

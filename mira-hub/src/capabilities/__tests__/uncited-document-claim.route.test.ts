/**
 * #4426 — a manufacturer-library turn whose answer cites NONE of the retrieved
 * passages is recorded as `insufficient_evidence` with a fixed, server-written
 * message. It is no longer left to the model to decline.
 *
 * Live evidence (retrieval acceptance, scenario 2, 2026-10-14; Siemens TP700
 * Comfort, no manual for that model in the corpus): the SAME six retrieved
 * chunks and the SAME 3390-token prompt produced an honest decline on two runs
 * (122 and 95 output tokens) and an uncited "answered" on two others (71
 * tokens), at `0905517be` and `47bc07d66`. That coin-flip blocked two
 * production releases.
 *
 * Scope (deliberately narrow): the identity-bound OEM search only — the same
 * search #4004/#4010 made abstain when it returns zero passages. Notebook
 * sources, safety-flagged turns, and machine-reading/photo turns are pinned
 * UNCHANGED by the controls below.
 *
 * Run: npx vitest run src/capabilities/__tests__/uncited-document-claim.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({
    status: "claimed" as const,
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null),
  recordTurn: vi.fn(async () => "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  resolveBoundAsset: vi.fn(async (): Promise<ResolvedAsset> => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Line 3 HMI",
    manufacturer: "Siemens",
    model: "TP700 Comfort",
  })),
  listSources: vi.fn(async () => [] as unknown[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  corpusManufacturers: vi.fn(async () => ["Siemens", "Allen-Bradley", "Automation Direct"]),
  manufacturerFromObservationText: vi.fn((text: string, names: readonly string[]) =>
    names.find((n) => text.toLowerCase().includes(n.toLowerCase())) ?? null,
  ),
  resolveModelFromObservationText: vi.fn(() => ({ model: null, ambiguous: false })),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    // Raw-pool client for the OEM corpus path (hybrid corpus law).
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "t" })) }));
const workspaceFilesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => workspaceFilesMock);
const visualMock = vi.hoisted(() => ({
  loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]),
  renderVisualEvidenceSection: vi.fn(() => ""),
  loadVisualEvidenceForPhoto: vi.fn(async () => null as unknown),
  loadRecentLookObservations: vi.fn(async () => [] as unknown[]),
  renderLookObservationSection: vi.fn<(row: unknown) => string>(() => ""),
  renderPriorLookObservationsSection: vi.fn<(rows: unknown) => string>(() => ""),
}));
vi.mock("@/lib/visual-evidence-context", () => ({
  blockingLookHazard: vi.fn(() => null),
  ...visualMock,
  normalizeLookHazards: vi.fn(() => []),
  recordLookObservation: vi.fn(async () => ({})),
}));
vi.mock("@/capabilities/part-search-claim", () => ({ claimPartSearchProposal: vi.fn(async () => true) }));
const manualDiscoveryMock = vi.hoisted(() => ({ discoverManual: vi.fn() }));
vi.mock("@/lib/manual-discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-discovery")>()),
  ...manualDiscoveryMock,
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async () => {
  const actual = await vi.importActual<typeof import("@/capabilities/notebook-manual-acquisition")>(
    "@/capabilities/notebook-manual-acquisition",
  );
  return {
    ...actual,
    acquisitionEnabled: vi.fn(() => false),
    candidateAcquisitionEnabled: vi.fn(() => false),
    readAcquisition: vi.fn(async () => null as unknown),
    reconcileAcquisition: vi.fn(async (_t: string, _n: string, r: unknown) => r),
    startManualAcquisition: vi.fn(async () => false),
  };
});

import {
  POST,
  UNCITED_OEM_CLAIM_TEXT,
  answerUsesEarlierPhoto,
  answerUsesStoredNameplateReading,
  isUncitedDocumentClaim,
} from "@/app/api/equipment-notebooks/[id]/chat/route";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import type { ResolvedAsset } from "@/lib/equipment-notebooks";

// One retrieved TP700 passage that does NOT answer the question asked.
const OEM_CHUNK = {
  content: "The TP700 Comfort accepts a 24 V DC supply on terminal X80.",
  manufacturer: "Siemens",
  modelNumber: "TP700 Comfort",
  sourceUrl: "https://support.example.com/tp700-comfort.pdf",
  sourcePage: 12,
  title: "TP700 Comfort operating instructions",
  rank: 1,
  verified: true,
};

/** The live shape: a plain-sounding answer that cites none of the passages. */
const UNCITED = "The TP700 Comfort has a 7-inch widescreen touch display with Ethernet and USB ports.";
/** Control: an answer that cites the retrieved passage. */
const CITED = "The panel takes a 24 V DC supply on terminal X80 [1].";
/** Control: the model's own honest decline (the refusal-regex path). */
const MODEL_REFUSAL = "The provided excerpts do not contain information about the display size.";

function chatReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

function stubProvider(answer: string) {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\n` +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    "data: [DONE]\n\n";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
  );
}

function frames(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("data:") && b.slice(5).trim() !== "[DONE]")
    .flatMap((b) => {
      try {
        return [JSON.parse(b.slice(5).trim()) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

async function ask(answer: string, body: Record<string, unknown> = { message: "What size is the display on this panel", mode: "general" }) {
  stubProvider(answer);
  const res = await POST(chatReq(body), params);
  expect(res.status).toBe(200);
  const out = frames(await res.text());
  const content = out.filter((f) => f.kind === "content").map((f) => String(f.content ?? "")).join("");
  const status = out.find((f) => f.kind === "status") as { status: string } | undefined;
  const sources = out.find((f) => f.kind === "sources") as { citations: unknown[] } | undefined;
  const persisted = (domainMock.recordTurn.mock.calls.at(-1) as unknown[] | undefined)?.[2] as
    | { answerStatus: string; answerText: string | null }
    | undefined;
  return { content, status: status?.status, citations: sources?.citations ?? null, persisted };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT, userId: "u1" });
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  domainMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  visualMock.loadVisualEvidenceForAsset.mockResolvedValue([]);
  visualMock.renderVisualEvidenceSection.mockReturnValue("");
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
  visualMock.loadRecentLookObservations.mockResolvedValue([]);
  visualMock.renderLookObservationSection.mockReturnValue("");
  visualMock.renderPriorLookObservationsSection.mockReturnValue("");
  workspaceFilesMock.photoLinkedToTarget.mockResolvedValue(null);
  ragMock.retrieveNodeChunks.mockResolvedValue([]);
  ragMock.retrieveManualChunks.mockResolvedValue([OEM_CHUNK]);
  manualDiscoveryMock.discoverManual.mockResolvedValue({
    serviceAvailable: false,
    found: false,
    candidate: null,
    validated: false,
    isDirectPdf: false,
    oemHost: false,
    trustedDistributorHost: false,
    reason: "search service unavailable",
    oemRequestUrl: null,
  });
  process.env.GROQ_API_KEY = "test-key";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.NOTEBOOK_ANSWER_GATE; // default ON
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.NOTEBOOK_ANSWER_GATE;
});

describe("#4426 — an uncited manufacturer-library answer abstains deterministically", () => {
  it("OEM passages retrieved + an answer citing none of them → insufficient_evidence with the fixed message", async () => {
    const r = await ask(UNCITED);
    // Precondition: this really was the identity-bound OEM search, and it returned a passage.
    expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(r.status).toBe("insufficient_evidence");
    expect(r.citations).toEqual([]);
    expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
    expect(r.content).not.toContain("7-inch");
    expect(r.persisted?.answerStatus).toBe("insufficient_evidence");
    expect(r.persisted?.answerText).toBe(UNCITED_OEM_CLAIM_TEXT);
  });

  it("control: an answer that cites a retrieved passage still ships, cited", async () => {
    const r = await ask(CITED);
    expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
    expect(r.status).toBe("answered");
    expect(r.citations).toHaveLength(1);
    expect(r.content).toContain("24 V DC");
  });

  it("control: the model's own honest decline is unchanged (its words, not the fixed message)", async () => {
    const r = await ask(MODEL_REFUSAL);
    expect(r.status).toBe("insufficient_evidence");
    expect(r.content).toBe(MODEL_REFUSAL);
  });

  it("control: with the pre-display gate off (emergency lever) the legacy behaviour is untouched", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    const r = await ask(UNCITED);
    expect(r.status).toBe("answered");
    expect(r.content).toContain("7-inch");
  });

  it("control: a safety-flagged turn is never blocked by the floor — it is answered under its banner", async () => {
    const r = await ask("Cut power at the disconnect from a safe distance and keep clear.", {
      message: "there is smoke coming from the panel",
      mode: "general",
    });
    expect(r.status).toBe("answered");
    expect(r.content).toContain("Cut power at the disconnect");
  });

  it("control: a notebook-source turn is out of scope — an uncited answer there is unchanged", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([
      { docId: DOC_A, filename: "panel.pdf", page: 7, content: "The panel accepts 24 V DC on X1." },
    ]);
    const r = await ask(UNCITED, { message: "What size is the display on this panel", sourceDocIds: [DOC_A] });
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    expect(r.status).toBe("answered");
    expect(r.content).toContain("7-inch");
  });

  it("control: an answer from the machine's stored nameplate photo is not withheld (prose attribution, no [n])", async () => {
    // A bound machine with a photographed-nameplate reading and OEM passages, but
    // no photo attached this turn and no machine readings. The visual-evidence
    // section tells the model to attribute these readings in prose and never with
    // bracketed numbers, so a correct answer cites no passage by design.
    domainMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved",
      entityId: "44444444-4444-4444-8444-444444444444",
      name: "Line 3 HMI",
      unsPath: "enterprise.plant.line3.hmi",
      selectedVia: null,
      confirmedAt: "2026-10-14T00:00:00Z",
    });
    const SECTION = "## Visual Evidence (nameplate photographed on THIS machine)\n- Supply 24 V DC (confirmed by a technician)";
    visualMock.loadVisualEvidenceForAsset.mockResolvedValue([{ text: "Supply 24 V DC", trust: "verified" }]);
    visualMock.renderVisualEvidenceSection.mockReturnValue(SECTION);
    const FROM_PHOTO = "The photographed nameplate shows a 24 V DC supply.";
    const r = await ask(FROM_PHOTO, { message: "What supply voltage does this panel need", mode: "general" });
    // Preconditions: the OEM search ran, and the nameplate section reached the provider.
    expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
    const sent = JSON.stringify((vi.mocked(fetch).mock.calls.at(-1) as unknown[])[1]);
    expect(sent).toContain("nameplate photographed on THIS machine");
    expect(r.status).toBe("answered");
    expect(r.content).toBe(FROM_PHOTO);
    expect(r.persisted?.answerStatus).toBe("answered");
    expect(r.persisted?.answerText).toBe(FROM_PHOTO);
  });

  it("a stored nameplate reading does NOT exempt an uncited answer that never uses it", async () => {
    // One photo of a machine must not switch the floor off for every later library
    // question on it: the exemption follows the section's own attribution rule.
    domainMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved",
      entityId: "44444444-4444-4444-8444-444444444444",
      name: "Line 3 HMI",
      unsPath: "enterprise.plant.line3.hmi",
      selectedVia: null,
      confirmedAt: "2026-10-14T00:00:00Z",
    });
    visualMock.loadVisualEvidenceForAsset.mockResolvedValue([{ text: "Supply 24 V DC", trust: "verified" }]);
    visualMock.renderVisualEvidenceSection.mockReturnValue(
      "## Visual Evidence (nameplate photographed on THIS machine)\n- Supply 24 V DC (confirmed by a technician)",
    );
    const r = await ask(UNCITED);
    const sent = JSON.stringify((vi.mocked(fetch).mock.calls.at(-1) as unknown[])[1]);
    expect(sent).toContain("nameplate photographed on THIS machine");
    expect(r.status).toBe("insufficient_evidence");
    expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
  });

  it("a passing nameplate mention does NOT exempt an unrelated uncited claim (Codex r2 F3)", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved",
      entityId: "44444444-4444-4444-8444-444444444444",
      name: "Line 3 HMI",
      unsPath: "enterprise.plant.line3.hmi",
      selectedVia: null,
      confirmedAt: "2026-10-14T00:00:00Z",
    });
    visualMock.loadVisualEvidenceForAsset.mockResolvedValue([{ text: "Supply 24 V DC", trust: "verified" }]);
    visualMock.renderVisualEvidenceSection.mockReturnValue(
      "## Visual Evidence (nameplate photographed on THIS machine)\n- Supply 24 V DC (confirmed by a technician)",
    );
    const r = await ask(`${UNCITED} Check the nameplate to confirm the model.`);
    const sent = JSON.stringify((vi.mocked(fetch).mock.calls.at(-1) as unknown[])[1]);
    expect(sent).toContain("nameplate photographed on THIS machine");
    expect(r.status).toBe("insufficient_evidence");
    expect(r.citations).toEqual([]);
    expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
    expect(r.persisted?.answerStatus).toBe("insufficient_evidence");
  });

  it("a bound machine with NO stored nameplate reading still abstains on an uncited answer", async () => {
    domainMock.resolveBoundAsset.mockResolvedValue({
      state: "resolved",
      entityId: "44444444-4444-4444-8444-444444444444",
      name: "Line 3 HMI",
      unsPath: "enterprise.plant.line3.hmi",
      selectedVia: null,
      confirmedAt: "2026-10-14T00:00:00Z",
    });
    const r = await ask(UNCITED);
    expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
    expect(visualMock.loadVisualEvidenceForAsset).toHaveBeenCalled();
    expect(r.status).toBe("insufficient_evidence");
    expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
  });

  // #4442 (production, 2026-10-15): one photo early in a conversation exempted
  // every later question in it from this floor, because the earlier photos ride
  // in the same context block as this turn's photo and the exemption was
  // presence-based. Same breadth defect #4432 fixed for stored nameplate readings.
  describe("#4442 — an earlier photo in this conversation", () => {
    const EARLIER_OBSERVATION = "Drive keypad showing fault F004 (undervoltage); nameplate reads GS10-20P2.";
    const PRIOR_SECTION =
      "## Photos the technician attached EARLIER in this conversation (visual observations)\n- Earlier photo 1: " +
      EARLIER_OBSERVATION;

    function earlierPhotoInThread() {
      visualMock.loadRecentLookObservations.mockResolvedValue([
        { text: EARLIER_OBSERVATION, trust: "candidate", fileId: "file-earlier", observedAt: "2026-10-15T11:33:46Z" },
      ]);
      visualMock.renderPriorLookObservationsSection.mockImplementation((rows: unknown) =>
        Array.isArray(rows) && rows.length > 0 ? PRIOR_SECTION : "",
      );
    }

    /** The photo block rides into the prompt as buildManualUserContent's third
     *  argument (the user-data channel); that builder is stubbed here, so assert
     *  what it was handed rather than the stub's output. */
    function photoContextHanded(): string {
      const call = ragMock.buildManualUserContent.mock.calls.at(-1) as unknown[] | undefined;
      return String(call?.[2] ?? "");
    }
    function priorSectionReachedProvider() {
      return photoContextHanded().includes("attached EARLIER in this conversation");
    }

    it("does NOT exempt an uncited library answer that never uses the photo", async () => {
      earlierPhotoInThread();
      const r = await ask(UNCITED);
      // Preconditions: the OEM search ran and the earlier photo reached the model.
      expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
      expect(visualMock.loadRecentLookObservations).toHaveBeenCalled();
      expect(priorSectionReachedProvider()).toBe(true);
      expect(r.status).toBe("insufficient_evidence");
      expect(r.citations).toEqual([]);
      expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
      expect(r.persisted?.answerStatus).toBe("insufficient_evidence");
    });

    it("a passing mention of the earlier photo does NOT exempt an unrelated uncited claim", async () => {
      earlierPhotoInThread();
      const r = await ask(`${UNCITED} Send another shot like your earlier photo if the screen changes.`);
      expect(priorSectionReachedProvider()).toBe(true);
      expect(r.status).toBe("insufficient_evidence");
      expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
    });

    it("a request for a NEW photo that names the earlier code does NOT exempt an uncited claim (Codex r1 F1)", async () => {
      earlierPhotoInThread();
      const r = await ask(`${UNCITED} Take the photo before checking F004 in the manual.`);
      expect(priorSectionReachedProvider()).toBe(true);
      expect(r.status).toBe("insufficient_evidence");
      expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
    });

    it("a longer model code that merely contains the photographed one does NOT exempt (Codex r1 F2)", async () => {
      earlierPhotoInThread();
      const r = await ask("Unlike your earlier photo, the GS10-20P20 has two Ethernet ports and a USB port.");
      expect(priorSectionReachedProvider()).toBe(true);
      expect(r.status).toBe("insufficient_evidence");
      expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
    });

    it("an instruction to check the earlier photo for its code does NOT exempt an uncited claim (Codex r2 F4)", async () => {
      earlierPhotoInThread();
      const r = await ask(`${UNCITED} Check your earlier photo to see whether F004 is visible.`);
      expect(priorSectionReachedProvider()).toBe(true);
      expect(r.status).toBe("insufficient_evidence");
      expect(r.content).toBe(UNCITED_OEM_CLAIM_TEXT);
    });

    it("control: an answer that uses the earlier photo (attributed, and naming what it showed) still ships", async () => {
      earlierPhotoInThread();
      const FROM_PHOTO = "From your earlier photo (an unconfirmed reading), the drive is showing fault F004, an undervoltage trip.";
      const r = await ask(FROM_PHOTO, { message: "what was the fault on it", mode: "general" });
      expect(ragMock.retrieveManualChunks).toHaveBeenCalled();
      expect(priorSectionReachedProvider()).toBe(true);
      expect(r.status).toBe("answered");
      expect(r.content).toBe(FROM_PHOTO);
      expect(r.persisted?.answerStatus).toBe("answered");
    });

    it("control: a photo attached THIS turn still exempts the answer it was asked with", async () => {
      workspaceFilesMock.photoLinkedToTarget.mockResolvedValue({ fileId: "file-now", capturedAt: "2026-10-15T11:35:00Z" });
      visualMock.loadVisualEvidenceForPhoto.mockResolvedValue({
        text: "HMI panel with a cracked touchscreen.",
        trust: "candidate",
        fileId: "file-now",
        hazards: [],
      });
      visualMock.renderLookObservationSection.mockImplementation((row: unknown) =>
        row ? "## Photo the technician attached this turn (visual observation)\n- HMI panel with a cracked touchscreen." : "",
      );
      const FROM_THIS_PHOTO = "The attached photo shows a cracked touchscreen on this panel.";
      const r = await ask(FROM_THIS_PHOTO, {
        message: "what is wrong with this screen",
        mode: "general",
        visualEvidence: { fileId: "file-now" },
      });
      // Preconditions: the photo was verified and its section reached the model.
      expect(workspaceFilesMock.photoLinkedToTarget).toHaveBeenCalled();
      expect(photoContextHanded()).toContain("attached this turn");
      expect(photoContextHanded()).not.toContain("attached EARLIER");
      expect(r.status).toBe("answered");
      expect(r.content).toBe(FROM_THIS_PHOTO);
    });
  });
});

describe("isUncitedDocumentClaim — the decision itself", () => {
  const cite = (id: string): EvidenceCitation => ({
    citationId: id,
    docId: "oem",
    sourceTitle: "TP700 Comfort operating instructions",
    page: 12,
    fileId: null,
    quote: null,
  });
  const base = { oemGrounded: true, citations: [cite("1")], exempt: false };

  it("uncited over OEM passages → true; cited → false", () => {
    expect(isUncitedDocumentClaim(UNCITED, base)).toBe(true);
    expect(isUncitedDocumentClaim(CITED, base)).toBe(false);
  });

  it("an invented marker that resolves to no shipped citation is still uncited", () => {
    expect(isUncitedDocumentClaim("It has a 7-inch display [9].", base)).toBe(true);
  });

  it("not an OEM-grounded turn → never applies", () => {
    expect(isUncitedDocumentClaim(UNCITED, { ...base, oemGrounded: false })).toBe(false);
  });

  it("exempt (safety flag, machine reading or photo) → never applies", () => {
    expect(isUncitedDocumentClaim(UNCITED, { ...base, exempt: true })).toBe(false);
  });

  it("a stored nameplate reading exempts only an answer that attributes to it AND repeats a reading", () => {
    const readings = ["Supply 24 V DC", "Order no. 6AV2124-0GC01-0AX0"];
    expect(answerUsesStoredNameplateReading("The photographed nameplate shows a 24 V DC supply.", readings)).toBe(true);
    expect(answerUsesStoredNameplateReading("The photographed nameplate reads 6AV2124-0GC01-0AX0.", readings)).toBe(true);
    // Attribution without a reading: the nameplate "lacks" it, then an unrelated claim.
    expect(
      answerUsesStoredNameplateReading(
        "The photographed nameplate doesn't list the display size; the panel has a 7-inch display.",
        readings,
      ),
    ).toBe(false);
    // A reading without the attribution is an ordinary uncited claim.
    expect(answerUsesStoredNameplateReading("The panel needs a 24 V DC supply.", readings)).toBe(false);
    // A recommendation to look at the nameplate is not attribution.
    expect(answerUsesStoredNameplateReading("Check the nameplate to confirm the 24 V model.", readings)).toBe(false);
    // A longer number is not the stored reading.
    expect(answerUsesStoredNameplateReading("The photographed nameplate says 240 V.", readings)).toBe(false);
    expect(answerUsesStoredNameplateReading("The photographed nameplate shows 24 V.", [])).toBe(false);
  });

  it("an earlier photo exempts only an answer that attributes to it AND names what it showed (#4442)", () => {
    const obs = ["Drive keypad showing fault F004 (undervoltage); nameplate reads GS10-20P2."];
    // Attributed + its identifier.
    expect(answerUsesEarlierPhoto("Your earlier photo shows fault F004 on the keypad.", obs)).toBe(true);
    // A photo that carries identifiers is used only when the answer repeats one:
    // naming the same kind of equipment is not enough (cheap-lane r2 on #4450).
    expect(answerUsesEarlierPhoto("From your earlier photo, the drive has two Ethernet ports and a USB port.", obs)).toBe(false);
    expect(answerUsesEarlierPhoto("That is an unconfirmed reading of an earlier photo: the drive has tripped.", obs)).toBe(false);
    // A photo with no identifiers: its equipment is the distinctive content, in
    // the prompt's own wording.
    const plain = ["Contactor coil with burn marks and discoloured terminals."];
    expect(answerUsesEarlierPhoto("That is an unconfirmed reading of an earlier photo: the contactor coil looks burned.", plain)).toBe(true);
    expect(answerUsesEarlierPhoto("From your earlier photo, the drive has two Ethernet ports.", plain)).toBe(false);
    expect(answerUsesEarlierPhoto("In the photo you sent earlier the drive keypad shows GS10-20P2.", obs)).toBe(true);
    // Content without the attribution is an ordinary uncited claim.
    expect(answerUsesEarlierPhoto("Fault F004 on this drive means undervoltage.", obs)).toBe(false);
    // Attribution with nothing from the photo: a passing mention, then an unrelated claim.
    expect(
      answerUsesEarlierPhoto("Unlike your earlier photo, the TP700 has a 7-inch touch display with Ethernet ports.", obs),
    ).toBe(false);
    // No earlier observation, nothing to use.
    expect(answerUsesEarlierPhoto("Your earlier photo shows fault F004.", [])).toBe(false);
  });

  it("recognises the ways a model actually refers back to an earlier photo (conversation review, #4450)", () => {
    const obs = ["Drive keypad showing fault F004 (undervoltage); nameplate reads GS10-20P2."];
    for (const answer of [
      "From the photo earlier, the keypad shows fault F004.",
      "In the picture you showed me before, the fault code was F004.",
      "As shown in the image you sent previously, the drive is a GS10-20P2.",
      "You showed me a photo earlier of the drive keypad with F004 on it.",
      "That matches what I saw in the photo before: F004.",
      "Referring to the photo from earlier in our conversation, the drive has tripped on F004.",
      "The photo you sent a few minutes ago shows F004.",
    ]) {
      expect(answerUsesEarlierPhoto(answer, obs), answer).toBe(true);
    }
    // Asking for a NEW photo is not attribution to an earlier one, even when the
    // answer names the earlier photo's equipment.
    for (const answer of [
      "Take a photo before you reset the drive, then check F004 in the manual.",
      // Codex r1 F1 on #4450: the definite article is still a request.
      "Take the photo before you reset the drive, then check F004 in the manual.",
      "Please retake that picture before you power down, and look up F004.",
      "Send a photo of the drive keypad if F004 comes back.",
      "Once you have a picture of the drive nameplate, I can confirm the model.",
      "Once you have sent a photo of the nameplate, I can confirm GS10-20P2.",
      "If you sent a photo of the keypad, F004 would show on it.",
    ]) {
      expect(answerUsesEarlierPhoto(answer, obs), answer).toBe(false);
    }
  });

  it("counts only a sentence that STATES what the earlier photo showed (Codex r2 F4, #4450)", () => {
    const obs = ["Drive keypad showing fault F004 (undervoltage); nameplate reads GS10-20P2."];
    for (const answer of [
      // Codex's case: an instruction to inspect the photo, naming its code.
      "The TP700 Comfort has a 7-inch widescreen touch display with Ethernet and USB ports. Check your earlier photo to see whether F004 is visible.",
      "Look at your earlier photo to confirm F004 is on the keypad.",
      "Compare the F004 reading in your earlier photo with the manual table.",
      "Please double-check the earlier photo for GS10-20P2.",
      // Questions about it.
      "Does your earlier photo show F004?",
      "Your earlier photo showed F004, right?",
      "Can you check the earlier photo for F004",
      // Conditionals.
      "If your earlier photo shows F004, the drive tripped on undervoltage.",
      "It depends on whether your earlier photo shows F004.",
      // The reference and the code in different sentences.
      "Your earlier photo is blurry. F004 on a TP700 means a backlight fault.",
    ]) {
      expect(answerUsesEarlierPhoto(answer, obs), answer).toBe(false);
    }
    // A statement of what it showed, even after an unrelated sentence, still counts.
    expect(
      answerUsesEarlierPhoto("The TP700 has a 7-inch display. Your earlier photo shows F004 on the drive keypad.", obs),
    ).toBe(true);
  });

  it("repeats an identifier only as a whole token, not inside a longer one (Codex r1 F2, #4450)", () => {
    const obs = ["Drive keypad showing fault F004 (undervoltage); nameplate reads GS10-20P2."];
    for (const answer of [
      "Unlike your earlier photo, the GS10-20P20 has two Ethernet ports and a USB port.",
      "Your earlier photo isn't the F0041 overcurrent code; that one needs a new IGBT module.",
      "Your earlier photo aside, the GS10-20P2-EX variant has a USB port.",
    ]) {
      expect(answerUsesEarlierPhoto(answer, obs), answer).toBe(false);
    }
    // Exact tokens, including next to punctuation, still count.
    expect(answerUsesEarlierPhoto("Your earlier photo shows fault (F004).", obs)).toBe(true);
    expect(answerUsesEarlierPhoto("Your earlier photo shows a GS10-20P2, faulted.", obs)).toBe(true);
    expect(answerUsesEarlierPhoto("your earlier photo shows f004", obs)).toBe(true);
  });

  it("the message names the library that was searched and the way forward", () => {
    expect(UNCITED_OEM_CLAIM_TEXT).toMatch(/manufacturer documentation I have/);
    expect(UNCITED_OEM_CLAIM_TEXT).toMatch(/show you the page/);
  });
});

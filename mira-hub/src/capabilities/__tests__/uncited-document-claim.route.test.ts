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
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
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
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));
vi.mock("@/lib/visual-evidence-context", () => ({
  blockingLookHazard: vi.fn(() => null),
  loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]),
  renderVisualEvidenceSection: vi.fn(() => ""),
  loadVisualEvidenceForPhoto: vi.fn(async () => null as unknown),
  loadRecentLookObservations: vi.fn(async () => []),
  renderLookObservationSection: vi.fn(() => ""),
  renderPriorLookObservationsSection: vi.fn(() => ""),
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

import { POST, UNCITED_OEM_CLAIM_TEXT, isUncitedDocumentClaim } from "@/app/api/equipment-notebooks/[id]/chat/route";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

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

  it("the message names the library that was searched and the way forward", () => {
    expect(UNCITED_OEM_CLAIM_TEXT).toMatch(/manufacturer documentation I have/);
    expect(UNCITED_OEM_CLAIM_TEXT).toMatch(/show you the page/);
  });
});

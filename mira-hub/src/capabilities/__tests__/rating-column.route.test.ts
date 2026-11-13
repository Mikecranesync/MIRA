/**
 * #5466 — an answer drawn from a contact-ratings table (make, break,
 * continuous) that does not keep the columns apart is withheld before release.
 *
 * Live evidence (CV-101 staging rerun, 2026-11-13, build 6da4ab674, trace
 * 3b78d674…): "Can I switch a 5 A, 120 V AC motor contactor coil load directly
 * from a Micro820 relay output?" was answered "Yes — rated for 15 A at 120 V
 * AC", citing p. 19 and marked grounded. 15 A is the make figure; the
 * continuous figure on that row is 2 A.
 *
 * The provider is stubbed: these tests make no model call.
 *
 * Run: npx vitest run src/capabilities/__tests__/rating-column.route.test.ts
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
    readAcquisition: vi.fn(async () => null as unknown),
    reconcileAcquisition: vi.fn(async (_t: string, _n: string, r: unknown) => r),
    startManualAcquisition: vi.fn(async () => false),
  };
});


import { BASE_SYSTEM_PROMPT, POST } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { ratingColumnText } from "@/capabilities/rating-column";
import type { ResolvedAsset } from "@/lib/equipment-notebooks";

// Pages 12 and 19 of Rockwell 2080-IN009B-EN-P, as stored (see rating-column.test.ts).
const P12 = {
  content:
    "Switching inductive loads without surge suppression can significantly reduce the life expectancy of relay contacts. "
    + "By adding a suppression device directly across the coil of an inductive device, you prolong the life of the output or relay contacts.",
  docId: DOC_A,
  manufacturer: "",
  modelNumber: "",
  sourceUrl: `upload://${DOC_A}`,
  sourcePage: 12,
  title: "2080-IN009B-EN-P.pdf",
};
const P19 = {
  ...P12,
  content:
    "Micro820 20-Point Programmable Controllers 19\nPublication 2080-IN009B-EN-P - April 2014\nRelay Contact Ratings\nMaximum\nVolts Amperes Amperes\n"
    + "Continuous Volt-Amperes\nMake Break Make Break\n120 V AC 15 A 1.5 A 2 A 1800 180\n240 V AC 7.5 A 0.75 A\n24 V DC 1.0 A 1 A 28\n125 V DC 0.22 A\n"
    + "Analog Output Specifications\nAttribute Value\nOutput count range 0...4008",
  sourcePage: 19,
};

const QUESTION = "Can I switch a 5 A, 120 V AC motor contactor coil load directly from a Micro820 relay output?";
/** The answer served on staging, verbatim. */
const SERVED =
  "Yes—the Micro820 relay output is rated for 15 A at 120 V AC, but inductive loads like motor starters and solenoids "
  + "should have surge suppression across the coil to protect the contacts [2][1]. Without suppression, switching inductive "
  + "loads can significantly reduce relay contact life [1].";
/** Control: the same page, read correctly. */
const NAMED =
  "No. At 120 V AC the relay contacts are rated 15 A make, 1.5 A break and 2 A continuous [2], so a 5 A coil load is over the continuous rating. "
  + "Use an interposing relay or contactor sized for the load.";
const WITHHELD = ratingColumnText({ rule: "load", title: "2080-IN009B-EN-P.pdf", page: 19, load: "5 A", row: "120 V AC", lower: ["1.5 A", "2 A"] });

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


async function ask(answer: string, body: Record<string, unknown> = { message: QUESTION, sourceDocIds: [DOC_A] }) {
  stubProvider(answer);
  const res = await POST(chatReq(body), params);
  expect(res.status).toBe(200);
  const out = frames(await res.text());
  const content = out.filter((f) => f.kind === "content").map((f) => String(f.content ?? "")).join("");
  const status = out.find((f) => f.kind === "status") as { status: string } | undefined;
  const sources = out.find((f) => f.kind === "sources") as { citations: Array<{ page: number | null }> } | undefined;
  const persisted = (domainMock.recordTurn.mock.calls.at(-1) as unknown[] | undefined)?.[2] as
    | { answerStatus: string; answerText: string | null }
    | undefined;
  const evidence = out.find((f) => f.kind === "evidence") as { basis?: string; label?: string } | undefined;
  const kinds = [...new Set(out.map((f) => String(f.kind)))].sort();
  return { content, status: status?.status, citations: sources?.citations ?? null, persisted, evidence: evidence ?? null, kinds };
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
  ragMock.retrieveNodeChunks.mockResolvedValue([P12, P19]);
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

describe("#5466 — a ratings-table answer that does not keep the columns apart is withheld", () => {
  it("the served answer is replaced before release: no yes, no 15 A, no citations, insufficient_evidence", async () => {
    const r = await ask(SERVED);
    // Precondition: this was the notebook-sources path, and it returned the ratings page.
    expect(ragMock.retrieveNodeChunks).toHaveBeenCalled();
    expect(r.content).toBe(WITHHELD);
    expect(r.content).not.toMatch(/15\s?A/);
    expect(r.content).not.toMatch(/^\W*yes\b/i);
    // The CV-101 S7 judge: the continuous figure is in the text, and it does not open with yes.
    expect(r.content).toMatch(/\b2\s?A\b/);
    expect(r.content).toContain("2080-IN009B-EN-P.pdf, p. 19");
    expect(r.content).toContain("below your 5 A load: 1.5 A, 2 A. The table's column headings say which figure is which.");
    expect(r.status).toBe("insufficient_evidence");
    expect(r.citations).toEqual([]);
    expect(r.persisted?.answerStatus).toBe("insufficient_evidence");
    expect(r.persisted?.answerText).toBe(WITHHELD);
    // A withheld draft is labelled like every other refused turn, and ships no
    // page link. Known gap, named in the PR: the text points at p. 19 in words only.
    expect(r.evidence).toMatchObject({ basis: "general_reasoning" });
    // The model was called, so the turn is metered like an answered one: the
    // same frame kinds reach the client (a usage frame among them when the
    // provider reports usage), only their contents differ.
    expect(r.kinds).toEqual((await ask(NAMED)).kinds);
  });

  it.each([
    ["with its citation markers dropped", "Yes, the Micro820 relay output is rated for 15 A at 120 V AC."],
    ["citing only the prose page", "Yes, the output is rated for 15 A at 120 V AC [1]."],
    ["approving with no figure at all", "Yes, it can be switched directly from the relay output [2]."],
    ["followed by a sentence that reads as a refusal", "Yes, the output is rated 15 A at 120 V AC. The excerpts do not say what the continuous rating is."],
    ["with the lower figure in view", "Yes. The relay output is rated 15 A make and 2 A continuous at 120 V AC [2], so a 5 A coil load can be switched."],
  ])("the same approval %s is withheld too", async (_how, answer) => {
    const r = await ask(answer);
    expect(r.content).toBe(WITHHELD);
    expect(r.status).toBe("insufficient_evidence");
    expect(r.citations).toEqual([]);
  });

  it("a rating question with no load: 15 A quoted without its column is withheld by the column rule", async () => {
    const r = await ask("The relay output is rated 15 A at 120 V AC [2].", { message: "What is the relay output rated for at 120 V AC?", sourceDocIds: [DOC_A] });
    expect(r.content).toBe(ratingColumnText({ rule: "column", title: "2080-IN009B-EN-P.pdf", page: 19, figure: "15 A" }));
    expect(r.status).toBe("insufficient_evidence");
  });

  it("a safety-flagged turn is not exempt, and keeps its hazard banner over the replacement", async () => {
    const r = await ask(SERVED, { message: `There is smoke coming from the panel. ${QUESTION}`, sourceDocIds: [DOC_A] });
    expect(r.content.endsWith(`\n\n${WITHHELD}`)).toBe(true);
    // What stands above it is the turn's own hazard banner, as an answered turn would carry it.
    const banner = r.content.slice(0, -WITHHELD.length).trim();
    const answered = await ask(NAMED, { message: `There is smoke coming from the panel. ${QUESTION}`, sourceDocIds: [DOC_A] });
    expect(banner.length).toBeGreaterThan(20);
    expect(answered.content.startsWith(banner)).toBe(true);
    expect(r.content).not.toMatch(/15\s?A/);
  });

  it("control: an answer that names each column ships, cited to the ratings page", async () => {
    const r = await ask(NAMED);
    expect(r.status).toBe("answered");
    expect(r.content).toContain("2 A continuous");
    expect(r.citations?.map((c) => c.page)).toContain(19);
  });

  it("control (Codex round 1, F1): a qualified approval of a coil with separate inrush and holding currents ships, cited", async () => {
    const r = await ask(
      "Yes. The 10 A inrush is under the 15 A make rating, and the 1 A holding current is under the 2 A continuous and 1.5 A break ratings at 120 V AC [2].",
      { message: "Can the relay output switch a 120 V AC coil with 10 A inrush and 1 A holding current?", sourceDocIds: [DOC_A] },
    );
    expect(r.status).toBe("answered");
    expect(r.content).toContain("15 A make rating");
    expect(r.citations?.map((c) => c.page)).toContain(19);
  });

  it("control: an answer from the prose page that quotes nothing from the table is not this check's business", async () => {
    const r = await ask("Fit a surge suppression device directly across the coil [1].");
    expect(r.status).toBe("answered");
    expect(r.content).toContain("suppression device");
  });

  it("control: with the pre-display gate off (emergency lever) the legacy behaviour is untouched", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    const r = await ask(SERVED);
    expect(r.status).toBe("answered");
    expect(r.content).toContain("15 A");
  });
});

describe("#5466 — the prompt asks for the column in the first place", () => {
  // A string pin only: what the model does with the line is not provable here
  // and is measured by the CV-101 S7 rerun. The floor above is the guarantee.
  it("the grounded prompt carries the ratings rule", () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/Say which column each figure you quote is from/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/A closing surge \(inrush\) is compared with the make figure/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/Do not approve a load whose steady current exceeds the continuous figure/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/For an inductive load \(a coil\), a volt-ampere rating in the same table also applies/);
  });
});

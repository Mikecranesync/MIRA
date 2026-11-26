/**
 * #5955 — the notebook chat ROUTE, end to end, over a real PostgreSQL corpus.
 *
 * Real: POST handler, retrieveManualChunks (actual SQL incl. the per-document page-fact read),
 * buildGroundedContext/buildManualUserContent, buildCitations, the SSE `sources` frame and the
 * persisted turn. Faked: session, notebook/domain store, the model provider (a canned stream),
 * observability. Fixture boundary: a dedicated test-owned schema (dropped in afterAll) with
 * hand-written `knowledge_entries` / `namespace_direct_uploads` — no RLS, no grants, no indexes.
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/citation-integrity.route.integration.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, Pool } from "pg";
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

// REAL retrieval and REAL builders: only the corpus-manufacturer list is pinned, and the model
// prompt is captured so the test can read what the model was shown.
const ragSpy = vi.hoisted(() => ({ userContent: [] as string[] }));
vi.mock("@/lib/manual-rag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/manual-rag")>();
  return {
    ...actual,
    corpusManufacturers: vi.fn(async () => ["Siemens", "Allen-Bradley", "Automation Direct"]),
    buildManualUserContent: vi.fn((q: string, chunks: never, visual?: string) => {
      const out = actual.buildManualUserContent(q, chunks, visual);
      ragSpy.userContent.push(out);
      return out;
    }),
  };
});

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
const dbHolder = vi.hoisted(() => ({ pool: null as null | { query: (...a: unknown[]) => unknown; connect: () => unknown } }));
vi.mock("@/lib/db", () => ({
  default: {
    query: (...a: unknown[]) => dbHolder.pool!.query(...a),
    connect: () => dbHolder.pool!.connect(),
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

import {
  POST,
  UNCITED_OEM_CLAIM_TEXT,
  answerUsesEarlierPhoto,
  answerUsesStoredNameplateReading,
  isUncitedDocumentClaim,
} from "@/app/api/equipment-notebooks/[id]/chat/route";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import type { ResolvedAsset } from "@/lib/equipment-notebooks";

import { citationHref, sourceFor } from "@/factorylm-ui/to-interaction";

const SCHEMA = "cit5955_route";
const SYSTEM = "59550000-0000-4000-8000-0000000000aa";
const LEGACY = "gdrive://520-um001_-en-e (1).pdf";
const ORDINAL = "gdrive://520-um001_-en-e.pdf";
const REAL = "https://crawler.invalid/520-um001_-en-e.pdf";
const TWIN_A = "https://oem-a.invalid/same-name.pdf";
const TWIN_B = "https://oem-b.invalid/same-name.pdf";
const F004 = "Fault F004 UnderVoltage: the DC bus voltage fell below the minimum value.";
const F004_B = "Fault F004 UnderVoltage second note: check the incoming line voltage at the drive terminals.";
let admin: Client;
let pgPool: Pool;

async function seed(url: string, page: number | null, chunk: number, content: string, title = "PowerFlex 525 manual") {
  await admin.query(
    `INSERT INTO ${SCHEMA}.knowledge_entries (tenant_id,content,manufacturer,model_number,source_url,source_page,metadata,verified,is_private)
     VALUES ($1,$2,'Allen-Bradley','PowerFlex 525',$3,$4,$5::jsonb,true,false)`,
    [SYSTEM, content, url, page, JSON.stringify({ title, chunk_index: chunk })],
  );
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw Error("Disposable local database required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw Error("Only loopback Postgres permitted");
  admin = new Client({ connectionString: url.href });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`CREATE TABLE ${SCHEMA}.knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, doc_id uuid,
    content text NOT NULL, content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    manufacturer text DEFAULT '', model_number text DEFAULT '', source_url text NOT NULL,
    source_page integer, page_start integer, section_path text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    verified boolean NOT NULL DEFAULT false, is_private boolean NOT NULL DEFAULT false, ingest_route text)`);
  await admin.query(`CREATE TABLE ${SCHEMA}.namespace_direct_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, upload_id uuid, source text NOT NULL DEFAULT 'user_upload')`);
  // legacy copy: two DISTINCT F004 passages, every row page 1
  await seed(LEGACY, 1, 7, `${F004} Legacy A.`);
  await seed(LEGACY, 1, 8, `${F004_B} Legacy B.`);
  for (let i = 0; i < 12; i++) await seed(LEGACY, 1, 20 + i, `Legacy filler ${i} fault.`);
  // ordinal copy
  await seed(ORDINAL, 715, 715, `${F004} Ordinal.`);
  for (let i = 0; i < 12; i++) await seed(ORDINAL, 800 + i, 800 + i, `Ordinal filler ${i} fault.`);
  // page-aware copy
  await seed(REAL, 161, 3, `${F004} Crawler.`);
  for (let i = 0; i < 12; i++) await seed(REAL, 170 + i, 40 + i, `Crawler filler ${i} fault.`);
  // two DIFFERENT documents with the same title and the same chunk index, both unknown pages
  for (const u of [TWIN_A, TWIN_B]) {
    await seed(u, 1, 0, `${F004} Twin ${u.includes("oem-a") ? "A" : "B"} wording.`, "Same Name Manual");
    for (let i = 1; i < 6; i++) await seed(u, 1, i, `Twin filler ${i} fault.`, "Same Name Manual");
  }
  pgPool = new Pool({ connectionString: url.href, options: `-c search_path=${SCHEMA}`, max: 2 });
  dbHolder.pool = pgPool as unknown as typeof dbHolder.pool;
});

afterAll(async () => {
  await pgPool?.end();
  await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin?.end();
});

const params = { params: Promise.resolve({ id: NB }) };
const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

function stubProvider(answer: string) {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\n` +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' + "data: [DONE]\n\n";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
}
const frames = (body: string) =>
  body.split("\n\n").map((b) => b.trim()).filter((b) => b.startsWith("data:") && b.slice(5).trim() !== "[DONE]").flatMap((b) => {
    try { return [JSON.parse(b.slice(5).trim()) as Record<string, unknown>]; } catch { return []; }
  });

beforeEach(() => {
  vi.clearAllMocks();
  ragSpy.userContent.length = 0;
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  process.env.GROQ_API_KEY = "test-key";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  delete process.env.NOTEBOOK_ANSWER_GATE;
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT, userId: "u1" });
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" });
  domainMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Drive 1", manufacturer: "Allen-Bradley", model: "PowerFlex 525" } as never);
  visualMock.loadVisualEvidenceForAsset.mockResolvedValue([]);
  visualMock.renderVisualEvidenceSection.mockReturnValue("");
  visualMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
  visualMock.loadRecentLookObservations.mockResolvedValue([]);
  visualMock.renderLookObservationSection.mockReturnValue("");
  visualMock.renderPriorLookObservationsSection.mockReturnValue("");
  workspaceFilesMock.photoLinkedToTarget.mockResolvedValue(null);
  manualDiscoveryMock.discoverManual.mockResolvedValue({
    serviceAvailable: false, found: false, candidate: null, validated: false, isDirectPdf: false, oemHost: false,
    trustedDistributorHost: false, reason: "search service unavailable", oemRequestUrl: null,
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
});

type Cite = EvidenceCitation;
async function ask(answerFor: (marks: string) => string) {
  stubProvider(answerFor("[1][2][3][4][5][6][7][8]"));
  const res = await POST(chatReq({ message: "What does fault F004 mean on the drive", mode: "general" }), params);
  expect(res.status).toBe(200);
  const out = frames(await res.text());
  const sources = out.find((f) => f.kind === "sources") as { citations: Cite[] } | undefined;
  const status = out.find((f) => f.kind === "status") as { status: string } | undefined;
  const recorded = domainMock.recordTurn.mock.calls.at(-1) as unknown[] | undefined;
  return { sources: sources?.citations ?? [], status: status?.status, recorded, prompt: ragSpy.userContent.join("\n") };
}

describe("#5955 notebook chat route — page integrity through retrieval, prompt, SSE and persistence", () => {
  it("shows the page only where it is proven: legacy all-page-1 and ordinal copies carry null, the page-aware copy keeps p.161", async () => {
    const r = await ask((m) => `F004 means UnderVoltage ${m}.`);
    // Preconditions: the real retrieval ran and this is the OEM path with the gate on.
    expect(r.status).toBe("answered");
    expect(r.prompt).toContain("RETRIEVED REFERENCE DOCUMENTS");
    const real = r.sources.find((c) => c.quote?.includes("Crawler."));
    expect(real?.page).toBe(161);
    // The model is never shown a page it must not repeat.
    expect(r.prompt).toContain("p.161");
    expect(r.prompt).not.toMatch(/p\.715/);
    expect(r.prompt).not.toMatch(/p\.1\b/);
    // Every chip for the unproven copies has no page and therefore no deep link.
    const legacyA = r.sources.find((c) => c.quote?.includes("Legacy A."));
    const ordinal = r.sources.find((c) => c.quote?.includes("Ordinal."));
    expect(legacyA).toBeDefined();
    expect(ordinal).toBeDefined();
    for (const c of r.sources.filter((x) => x !== real)) {
      expect(c.page).toBeNull();
      expect(citationHref({ ...c, sourceUrl: "https://crawler.invalid/x.pdf" }) ?? "").not.toContain("#page=");
      expect(sourceFor(c, "turn").locator).not.toMatch(/^p\. /);
    }
  });

  it("C2: the server attests only a page it proved (selector) — live and persisted — so a saved pre-fix citation can be told apart", async () => {
    const r = await ask((m) => `F004 means UnderVoltage ${m}.`);
    const real = r.sources.find((c) => c.quote?.includes("Crawler."));
    expect(real).toMatchObject({ page: 161, selector: { type: "page", value: 161 } });
    for (const c of r.sources.filter((x) => x !== real)) {
      expect(c.page).toBeNull();
      expect(c.selector).toBeUndefined();
    }
    const persisted = (((r.recorded?.[2] as { evidence?: Array<Record<string, unknown>> } | undefined)?.evidence ?? []) as Array<Record<string, unknown>>).filter((e) => typeof e.citationId === "string");
    expect(persisted.find((e) => String(e.quote).includes("Crawler."))).toMatchObject({ selector: { type: "page", value: 161 } });
  });

  it("several distinct null-page passages of ONE document all survive with contiguous ids; blank-docId twins do not collide", async () => {
    const r = await ask((m) => `F004 means UnderVoltage ${m}.`);
    // The two distinct legacy F004 passages (same document, same stamped page 1) are two citations.
    const legacyQuotes = r.sources.map((c) => c.quote ?? "");
    expect(legacyQuotes.some((q) => q.includes("Legacy A."))).toBe(true);
    expect(legacyQuotes.some((q) => q.includes("Legacy B."))).toBe(true);
    // Same-title twins at different addresses are different citations.
    expect(legacyQuotes.some((q) => q.includes("Twin A wording"))).toBe(true);
    expect(legacyQuotes.some((q) => q.includes("Twin B wording"))).toBe(true);
    expect(r.sources.map((c) => c.citationId)).toEqual(r.sources.map((_, i) => String(i + 1)));
  });

  it("the [n] the model was shown, the SSE chip and the persisted row are the SAME passage and page for every n", async () => {
    const r = await ask((m) => `F004 means UnderVoltage ${m}.`);
    const arg = r.recorded?.[2] as Record<string, unknown> | undefined;
    const persisted = ((arg?.evidence ?? []) as Array<Record<string, unknown>>).filter((e) => typeof e.citationId === "string") as unknown as Cite[];
    const live = r.sources;
    expect(live.length).toBeGreaterThan(3);
    // Every context block number maps to a chip with the same page the block printed.
    for (const c of live) {
      const block = new RegExp(`\\[${c.citationId}\\] [^\\n]*`).exec(r.prompt)?.[0] ?? "";
      expect(block).not.toBe("");
      if (c.page == null) expect(block).not.toMatch(/, p\.\d/);
      else expect(block).toContain(`, p.${c.page}`);
    }
    expect(persisted.length).toBe(live.length);
    expect(persisted.map((c) => [c.citationId, c.page, c.quote])).toEqual(live.map((c) => [c.citationId, c.page, c.quote]));
  });
});

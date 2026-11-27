/**
 * Equipment Notebook chat — a page a retrieved passage points to ("see page 45") reaches the model
 * and the citations through the production expansion (#6030 F2/F3).
 *
 * Run: npx vitest run src/capabilities/__tests__/referenced-page-expansion.route.test.ts
 *
 * Real: the notebook POST route, retrieveReferencedPageChunks, and manual-rag's prompt/citation
 * builders. Controlled: auth/session, the notebook domain functions, ordinary retrieval (returns ONLY
 * the referring page), the provider (a stubbed SSE stream; no model is called) and the tenant SQL
 * client, which emulates the two reads below over an in-memory corpus. The emulator is a convenience
 * for the route wiring; the tenant/document/label scope itself is proven against a real Postgres in
 * src/capabilities/__tests__/referenced-pages.integration.test.ts. Synthetic text, not OEM facts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", displayName: "Panel" })),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/manual-rag", async (importActual) => ({ ...(await importActual<typeof import("@/lib/manual-rag")>()), ...ragMock }));

type Row = { tenant: string; docId: string; url: string; page: number; label: string | null; content: string; extra?: Record<string, unknown> };
let corpus: Row[] = [];
const tenantClient = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as unknown[] })) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(tenantClient)),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const DOC_B = "44444444-4444-4444-8444-444444444444";
const DOC_UNSELECTED = "55555555-5555-4555-8555-555555555555";
const URL_A = "panelview.pdf";
const STEPS = "Setup steps: 1. Press SETUP. 2. Hold ENTER for 3 seconds. 3. Select the language.";
const QUESTION = "How do I set the language on the PanelView?";

const referrer = (over: Partial<Record<string, unknown>> = {}) => ({
  content: "PanelView terminal overview. For configuration steps see page 45.",
  docId: DOC_A, sourceUrl: URL_A, sourcePage: 44, pageLabel: "44", title: "PanelView manual",
  manufacturer: "Test", modelNumber: "PV1", rank: 1, verified: false, chunkIndex: null, ...over,
});

const params = { params: Promise.resolve({ id: NB }) };
const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });

function stubProvider(answer: string) {
  const sse = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const f = vi.fn(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", f);
  return f;
}
const userMessage = (f: ReturnType<typeof stubProvider>): string => {
  const msgs = JSON.parse(String((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).messages as Array<{ role: string; content: string }>;
  return msgs[msgs.length - 1].content;
};
const turn = () => (domainMock.recordTurn.mock.calls as unknown as Array<[string, string, Record<string, unknown>]>)[0][2];

beforeEach(() => {
  vi.clearAllMocks();
  corpus = [];
  tenantClient.query.mockImplementation((async (sql: string, p: unknown[] = []) => {
    const [tenant, scope] = p as [string, string[]];
    const inScope = (r: Row) => r.tenant === tenant && scope.includes(r.docId);
    if (sql.includes("first_pg")) {
      const [, , docs, urls, labels] = p as [string, string[], string[], string[], string[]];
      const groups = new Map<string, { r: Row; pages: number[] }>();
      for (const r of corpus.filter(inScope)) {
        if (!docs.some((d, i) => d === r.docId && urls[i] === r.url && labels[i] === r.label)) continue;
        const k = `${r.docId}|${r.url}|${r.label}`;
        groups.set(k, { r, pages: [...(groups.get(k)?.pages ?? []), r.page] });
      }
      return { rows: [...groups.values()].map(({ r, pages }) => ({ doc_id: r.docId, source_url: r.url, printed: r.label, first_pg: Math.min(...pages), last_pg: Math.max(...pages) })) };
    }
    if (sql.includes("rank() OVER")) {
      const [, , docs, urls, pages] = p as [string, string[], string[], string[], number[]];
      return {
        rows: corpus
          .filter(inScope)
          .filter((r) => docs.some((d, i) => d === r.docId && urls[i] === r.url && pages[i] === r.page))
          .map((r, i) => ({ id: `id-${i}`, content: r.content, doc_id: r.docId, source_url: r.url, pg: r.page, page_label: r.label, verified: false, ...r.extra })),
      };
    }
    return { rows: [] };
  }) as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A, DOC_B], nodeId: "n1" });
  domainMock.claimNotebookTurnRequest.mockResolvedValue(undefined);
  ragMock.retrieveNodeChunks.mockResolvedValue([referrer()]);
  process.env.GROQ_API_KEY = "test-key";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
});

const refQueries = () => tenantClient.query.mock.calls.filter((c) => String(c[0]).includes("first_pg") || String(c[0]).includes("rank() OVER"));

describe("referenced-page expansion through the notebook POST", () => {
  it("reads the page 'see page 45' points to; the provider sees it and its citation resolves to that document and page", async () => {
    corpus = [{ tenant: TENANT, docId: DOC_A, url: URL_A, page: 45, label: "45", content: STEPS }];
    const f = stubProvider("Press SETUP, then hold ENTER for 3 seconds [2].");
    const res = await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params);
    await res.text();

    const sent = userMessage(f);
    expect(sent).toContain(STEPS);
    expect(sent).toMatch(/\[2\] [^\n]*p\.45\n/);
    expect(sent).toMatch(/\[1\] [^\n]*p\.44\n/); // the retrieved page keeps number 1

    const t = turn() as { answerStatus: string; answerText: string; evidence: Array<{ citationId: string; docId: string; page: number | null; quote: string }> };
    expect(t.answerStatus).toBe("answered");
    expect(t.answerText).toContain("hold ENTER");
    expect(t.evidence).toEqual([expect.objectContaining({ citationId: "2", docId: DOC_A, page: 45, quote: STEPS })]);
  });

  it("binds the read to (document, file, printed page) tuples, the validated scope and the tenant", async () => {
    corpus = [{ tenant: TENANT, docId: DOC_A, url: URL_A, page: 45, label: "45", content: STEPS }];
    stubProvider("ok [1]");
    await (await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    const [labelRead] = refQueries();
    expect(labelRead[1]).toEqual([TENANT, [DOC_A, DOC_B], [DOC_A], [URL_A], ["45"]]);
  });

  it("excludes another manual, an unselected document and a same-URL different document with the same page", async () => {
    corpus = [
      { tenant: TENANT, docId: DOC_A, url: URL_A, page: 45, label: "45", content: STEPS },
      { tenant: TENANT, docId: DOC_B, url: "other.pdf", page: 45, label: "45", content: "OTHER MANUAL page 45 content" },
      { tenant: TENANT, docId: DOC_UNSELECTED, url: URL_A, page: 45, label: "45", content: "UNSELECTED same-URL page 45 content" },
      { tenant: "99999999-9999-4999-8999-999999999999", docId: DOC_A, url: URL_A, page: 45, label: "45", content: "OTHER TENANT page 45 content" },
    ];
    const f = stubProvider("Hold ENTER [2].");
    await (await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    const sent = userMessage(f);
    expect(sent).toContain(STEPS);
    for (const leak of ["OTHER MANUAL", "UNSELECTED", "OTHER TENANT"]) expect(sent).not.toContain(leak);
  });

  it("fails closed when the document stores no printed label for that page (no offset is guessed)", async () => {
    corpus = [{ tenant: TENANT, docId: DOC_A, url: URL_A, page: 45, label: null, content: STEPS }];
    const f = stubProvider("The retrieved page does not say [1].");
    await (await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(userMessage(f)).not.toContain(STEPS);
    expect(refQueries().length).toBeGreaterThan(0); // the lookup ran and found nothing: not a silent skip
  });

  it("resolves a printed label to its PHYSICAL page: printed 45 on physical page 47 cites page 47", async () => {
    corpus = [{ tenant: TENANT, docId: DOC_A, url: URL_A, page: 47, label: "45", content: STEPS }];
    const f = stubProvider("Hold ENTER [2].");
    await (await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(userMessage(f)).toMatch(/\[2\] [^\n]*p\.47\n/);
    const t = turn() as { evidence: Array<{ citationId: string; docId: string; page: number | null }> };
    expect(t.evidence).toEqual([expect.objectContaining({ citationId: "2", docId: DOC_A, page: 47 })]);
  });

  it("is one hop: a reference inside the added page is not followed", async () => {
    corpus = [
      { tenant: TENANT, docId: DOC_A, url: URL_A, page: 45, label: "45", content: `${STEPS} For options see page 46.` },
      { tenant: TENANT, docId: DOC_A, url: URL_A, page: 46, label: "46", content: "SECOND HOP content" },
    ];
    const f = stubProvider("Hold ENTER [2].");
    await (await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(userMessage(f)).toContain(STEPS);
    expect(userMessage(f)).not.toContain("SECOND HOP");
  });

  it("control: a retrieved page with no reference triggers no expansion read", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([referrer({ content: "PanelView terminal overview." })]);
    corpus = [{ tenant: TENANT, docId: DOC_A, url: URL_A, page: 45, label: "45", content: STEPS }];
    const f = stubProvider("Overview [1].");
    await (await POST(req({ message: QUESTION, sourceDocIds: [DOC_A] }), params)).text();
    expect(refQueries()).toHaveLength(0);
    expect(userMessage(f)).not.toContain(STEPS);
  });
});

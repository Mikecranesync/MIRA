/**
 * #6030 F10 — the executable Hub notebook cases (tests/eval/fixtures 70-76, `runner: hub_notebook`) through the notebook POST.
 *
 * Real: the notebook chat route, manual-rag prompt/citation builders, context selection, the page
 * expansion (retrieveReferencedPageChunks), validators. Controlled (stated limits): auth/session, notebook
 * domain functions, ORDINARY retrieval (returns the fixture's `retrieval` chunks), the provider (a stubbed
 * stream returning the fixture's provider_answer; no model is called) and an in-memory tenant SQL emulator
 * for the expansion reads; real-SQL scope is proven in referenced-pages.integration.test.ts. Synthetic text,
 * not OEM facts and not a staging/production verification.
 *
 * Run: npx vitest run src/capabilities/__tests__/hub-eval-fixtures.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml"; // transitive dependency of vitest; no dependency was added

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const URL = "manual.pdf";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({ status: "claimed" as const, claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
  recordTurn: vi.fn(async () => undefined),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" })),
  getNotebook: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", displayName: "Drive", manufacturer: "Acme", model: "D1" })),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);
const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveCitedPageChunks: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/manual-rag", async (importActual) => ({ ...(await importActual<typeof import("@/lib/manual-rag")>()), ...ragMock }));
const persistMock = vi.hoisted(() => ({ persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "t" })) }));
vi.mock("@/lib/inference/persist-usage", () => persistMock);
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visual-evidence-context")>()),
  loadVisualEvidenceForPhoto: vi.fn(async () => null),
  loadRecentLookObservations: vi.fn(async () => []),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";


type Part = string | { repeat: number; template: string };
type HubPage = { doc: string; page: number; label?: string; parts: Part[] };
type HubFixture = {
  id: string;
  hub_notebook: {
    question: string;
    retrieval: HubPage[];
    corpus?: HubPage[];
    provider_answer: string;
    expect: {
      provider_sees: string[];
      status: string;
      citation?: { doc: string; page: number; id: string };
      citations?: Array<{ doc: string; page: number; id: string }>;
      reply_contains?: string[];
    };
  };
};
const FIXTURE_DIR = path.resolve(__dirname, "../../../../tests/eval/fixtures");
const render = (parts: Part[]): string =>
  parts.flatMap((p) => (typeof p === "string" ? [p] : Array.from({ length: p.repeat }, (_, i) => p.template.replaceAll("{i}", String(i).padStart(3, "0"))))).join("\n");
const fixtures: HubFixture[] = readdirSync(FIXTURE_DIR)
  .filter((f) => /^\d\d_.*\.yaml$/.test(f))
  .sort()
  .map((f) => parseYaml(readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as HubFixture & { runner?: string })
  .filter((f) => (f as { runner?: string }).runner === "hub_notebook");

const DOCS: Record<string, string> = { A: "33333333-3333-4333-8333-333333333333", B: "44444444-4444-4444-8444-444444444444" };
const chunkOf = (p: HubPage) => ({
  content: render(p.parts), docId: DOCS[p.doc], sourceUrl: URL, sourcePage: p.page, pageLabel: p.label ?? String(p.page),
  title: `Manual ${p.doc}`, manufacturer: "", modelNumber: "", rank: 1, verified: false, chunkIndex: null,
});

const req = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = { params: Promise.resolve({ id: NB }) };
const enc = new TextEncoder();
const delta = (w: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`;
const STOP_FRAME = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
function stream(text: string): Response {
  const parts = [delta(text), STOP_FRAME, `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`, "data: [DONE]\n\n"];
  return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200 });
}
const contentOf = (raw: string): string =>
  raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return {}; } }).filter((f) => f.kind === "content").map((f) => f.content ?? "").join("");

type Outcome = { providerMessage: string; live: string; saved: string; status: string; evidence: Array<{ citationId: string; docId: string; page: number | null }> };

let corpus: Array<{ docId: string; page: number; label: string; content: string }> = [];
const tenantClient = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as unknown[] })) }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(tenantClient)) }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));


async function runFixture(fx: HubFixture, providerAnswer = fx.hub_notebook.provider_answer): Promise<Outcome> {
  vi.clearAllMocks();
  const hub = fx.hub_notebook;
  const retrieved = hub.retrieval.map(chunkOf);
  corpus = [...hub.retrieval, ...(hub.corpus ?? [])].map((p) => ({ docId: DOCS[p.doc], page: p.page, label: p.label ?? String(p.page), content: render(p.parts) }));
  tenantClient.query.mockImplementation((async (sql: string, p: unknown[] = []) => {
    const scope = p[1] as string[];
    const inScope = (r: { docId: string }) => scope.includes(r.docId);
    if (sql.includes("first_pg")) {
      const [, , docs, , labels] = p as [string, string[], string[], string[], string[]];
      const out: Array<Record<string, unknown>> = [];
      for (const r of corpus.filter(inScope)) if (docs.some((d, i) => d === r.docId && labels[i] === r.label)) out.push({ doc_id: r.docId, source_url: URL, printed: r.label, first_pg: r.page, last_pg: r.page });
      return { rows: out };
    }
    if (sql.includes("rank() OVER")) {
      const [, , docs, , pages] = p as [string, string[], string[], string[], number[]];
      return { rows: corpus.filter(inScope).filter((r) => docs.some((d, i) => d === r.docId && pages[i] === r.page)).map((r, i) => ({ id: `id-${i}`, content: r.content, doc_id: r.docId, source_url: URL, pg: r.page, page_label: r.label, verified: false })) };
    }
    return { rows: [] };
  }) as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: Object.values(DOCS), nodeId: "n1" });
  domainMock.claimNotebookTurnRequest.mockResolvedValue({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } as never);
  ragMock.retrieveNodeChunks.mockResolvedValue(retrieved as never);
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
    const b = String(init?.body ?? "");
    if (b.includes('"stream":true')) bodies.push(b);
    return stream(providerAnswer);
  }));
  const res = await POST(req({ message: hub.question, sourceDocIds: Object.values(DOCS) }), params);
  const raw = await res.text();
  await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
  const t = (domainMock.recordTurn.mock.calls as unknown as Array<[string, string, Record<string, unknown>]>)[0][2];
  const msgs = JSON.parse(bodies[0]).messages as Array<{ content: string }>;
  return {
    providerMessage: msgs[msgs.length - 1].content,
    live: contentOf(raw),
    saved: String(t.answerText ?? ""),
    status: String(t.answerStatus),
    evidence: (t.evidence as Array<Record<string, unknown>>).filter((e) => "citationId" in e) as Outcome["evidence"],
  };
}

/** The conjunction every Hub case must satisfy. Returns the failed clauses (empty = pass). */
function failures(fx: HubFixture, o: Outcome): string[] {
  const x = fx.hub_notebook.expect;
  const out: string[] = [];
  for (const s of x.provider_sees) if (!o.providerMessage.includes(s)) out.push(`provider did not see: ${s}`);
  if (o.status !== x.status) out.push(`status ${o.status} != ${x.status}`);
  const wanted = x.citations ?? (x.citation ? [x.citation] : []);
  for (const c of wanted) {
    if (!o.evidence.some((e) => e.citationId === c.id && e.docId === DOCS[c.doc] && e.page === c.page)) out.push(`no resolved citation [${c.id}] doc ${c.doc} page ${c.page}`);
  }
  for (const s of x.reply_contains ?? []) if (!o.saved.includes(s)) out.push(`reply lacks: ${s}`);
  if (o.live !== o.saved) out.push("stream != persisted reply");
  return out;
}

const ENV = { ...process.env };
beforeEach(() => {
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "1";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.OPENAI_API_KEY = "k0";
  for (const k of ["OPENROUTER_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "OPENAI_RUN_BUDGET_USD", "MIRA_JEV_SHADOW"]) delete process.env[k];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 10));
  process.env = { ...ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hub-notebook fixtures (tests/eval/fixtures, runner: hub_notebook)", () => {
  it("the expected seven fixtures are present", () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual(
      ["f16_p047_p88", "gs10_param_p06_53", "kinetix_sto_wiring", "panelview_expansion_44_45", "pf525_f081_table_row", "pf525_overcurrent_ranking_5998", "s7_1200_yellow_led"],
    );
    expect(fixtures.find((f) => f.id === "pf525_overcurrent_ranking_5998")?.hub_notebook.question).toBe("What causes overcurrent faults on a PowerFlex 525?");
  });

  it.each(fixtures.map((f) => [f.id, f] as const))("%s: complete rows reach the provider, status, resolved doc+page citation, stream == saved reply", async (_id, fx) => {
    const o = await runFixture(fx);
    expect(failures(fx, o)).toEqual([]);
  });

  it("a refusal that merely repeats a keyword FAILS the conjunction (what a pipeline any-keyword grader would pass)", async () => {
    const fx = fixtures.find((f) => f.id === "pf525_f081_table_row")!;
    const refusal = "The loaded excerpts do not contain enough information about F081, DSI, communication, Type 2, manual reset on a PowerFlex.";
    const o = await runFixture(fx, refusal);
    const bad = failures(fx, o);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.some((b) => b.startsWith("status") || b.startsWith("no resolved citation"))).toBe(true);
    // the pipeline's grading rule: ANY expected keyword in the reply passes
    expect(["F081", "DSI", "communication", "Type 2", "manual", "PowerFlex"].some((k) => o.saved.includes(k))).toBe(true);
  });

  it("the PanelView case really used the production expansion: the provider-visible p.45 text was never in ordinary retrieval", async () => {
    const fx = fixtures.find((f) => f.id === "panelview_expansion_44_45")!;
    expect(fx.hub_notebook.retrieval.map((p) => p.page)).toEqual([44]);
    const o = await runFixture(fx);
    expect(o.providerMessage).toContain("Hold ENTER for 3 seconds");
    expect(tenantClient.query.mock.calls.some((c) => String(c[0]).includes("first_pg"))).toBe(true);
  });
});

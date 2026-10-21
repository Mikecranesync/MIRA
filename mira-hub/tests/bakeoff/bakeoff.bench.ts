/**
 * Retrieval bake-off harness (2026-10-21). Drives the REAL notebook chat route (POST) in-process,
 * with production ingest (writePdfChunksForNode + embedPendingNodeChunks), production retrieval
 * (retrieveNodeChunks under withTenantContext/RLS), the real reranker client and the real answer
 * cascade. Only session, notebook ownership/persistence and inert side features are mocked.
 * Arms differ ONLY by their retrieval flags. Not a CI test; run via tests/bakeoff/vitest.bakeoff.config.ts.
 *
 *   BAKEOFF_MODE=ingest|run  BAKEOFF_PG=postgres://...  BAKEOFF_MANIFEST=manifest.json
 *   BAKEOFF_QUESTIONS=questions.json  BAKEOFF_ARMS=A,B,C,D,E  BAKEOFF_OUT=out.jsonl
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, vi } from "vitest";
import { NextRequest } from "next/server";

const uuidOf = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const TENANT = uuidOf("bakeoff-tenant");
const NODE = uuidOf("bakeoff-node");
const NB = uuidOf("bakeoff-notebook");
const docOf = (manualId: string) => uuidOf(`bakeoff-doc-${manualId}`);

/** Which doc set the current turn may use: set per turn by the runner (one manual per question). */
const current = vi.hoisted(() => ({ docIds: [] as string[], filename: "", usage: [] as unknown[] }));

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: uuidOf("bakeoff-tenant"), userId: "bakeoff-user" })),
}));
vi.mock("@/lib/db", async () => {
  const { Pool } = await import("pg");
  return { default: new Pool({ connectionString: process.env.BAKEOFF_PG, max: 5 }) };
});
vi.mock("@/lib/equipment-notebooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/equipment-notebooks")>("@/lib/equipment-notebooks");
  return {
    ...actual,
    // A stranger's project: no nameplate identity, one uploaded manual (the Stranger Walk shape).
    validateChatSources: vi.fn(async () => ({ ok: true as const, docIds: [...current.docIds], nodeId: uuidOf("bakeoff-node") })),
    claimNotebookTurnRequest: vi.fn(async () => ({ status: "claimed" as const, claimToken: uuidOf("claim") })),
    abandonNotebookTurnRequest: vi.fn(async () => undefined),
    listTurns: vi.fn(async () => [] as unknown[]),
    recordTurn: vi.fn(async () => uuidOf("turn-row")),
    resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
    getNotebook: vi.fn(async () => ({ id: uuidOf("bakeoff-notebook"), displayName: "Bake-off", manufacturer: null, model: null, identityStatus: null, nodeId: uuidOf("bakeoff-node") })),
    listSources: vi.fn(async () => current.docIds.map((d) => ({ filename: current.filename, docId: d }))),
    originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
  };
});
vi.mock("@/lib/inference/persist-usage", () => ({
  persistTurnUsage: vi.fn(async (scope: { question?: string }, usage: unknown) => {
    current.usage.push({ question: scope?.question ?? null, ...(usage as object) });
    return { persisted: true, traceId: "bakeoff" };
  }),
  tenantSpendSince: vi.fn(async () => 0),
}));
vi.mock("@/lib/workspace-files", async () => ({
  ...(await vi.importActual<object>("@/lib/workspace-files")),
  photoLinkedToTarget: vi.fn(async () => null),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async () => ({
  ...(await vi.importActual<object>("@/capabilities/notebook-manual-acquisition")),
  acquisitionEnabled: vi.fn(() => false),
  readAcquisition: vi.fn(async () => null),
  startManualAcquisition: vi.fn(async () => false),
}));

type Manual = { id: string; filename: string; sha256: string };
type Question = { id: string; manual: string; question: string };
const ARM_FLAGS: Record<string, Record<string, string>> = {
  A: { NOTEBOOK_LEXICAL_V2: "0", NOTEBOOK_HYBRID_RETRIEVAL: "0", NOTEBOOK_RERANK: "0" },
  B: { NOTEBOOK_LEXICAL_V2: "1", NOTEBOOK_HYBRID_RETRIEVAL: "0", NOTEBOOK_RERANK: "0" },
  C: { NOTEBOOK_LEXICAL_V2: "0", NOTEBOOK_HYBRID_RETRIEVAL: "1", NOTEBOOK_RERANK: "0" },
  D: { NOTEBOOK_LEXICAL_V2: "0", NOTEBOOK_HYBRID_RETRIEVAL: "0", NOTEBOOK_RERANK: "1" },
  E: { NOTEBOOK_LEXICAL_V2: "0", NOTEBOOK_HYBRID_RETRIEVAL: "1", NOTEBOOK_RERANK: "1" },
};

/** Every outbound HTTP call of the current turn: proves which lanes actually ran. */
const calls: { host: string; path: string; status: number | null; ms: number }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const t0 = performance.now();
  try {
    const r = await realFetch(input, init);
    calls.push({ host: u.host, path: u.pathname, status: r.status, ms: performance.now() - t0 });
    return r;
  } catch (e) {
    calls.push({ host: u.host, path: u.pathname, status: null, ms: performance.now() - t0 });
    throw e;
  }
}) as typeof fetch;

async function ingest(manuals: Manual[], dir: string) {
  const { writePdfChunksForNode, embedPendingNodeChunks } = await import("@/lib/node-knowledge-ingest");
  const pool = (await import("@/lib/db")).default;
  for (const m of manuals) {
    const buf = readFileSync(path.join(dir, m.filename));
    if (createHash("sha256").update(buf).digest("hex") !== m.sha256) throw new Error(`sha mismatch ${m.id}`);
    const uploadId = docOf(m.id);
    const n = await writePdfChunksForNode({ tenantId: TENANT, uploadId, nodeId: NODE, unsPath: null, filename: m.filename, buffer: buf });
    let pass = await embedPendingNodeChunks(TENANT, `node-doc/${uploadId}/${m.filename}`);
    for (let i = 0; pass.state !== "complete" && i < 5; i++) pass = await embedPendingNodeChunks(TENANT, `node-doc/${uploadId}/${m.filename}`);
    console.log(`[ingest] ${m.id}: ${n} chunks, embed ${pass.state}`);
  }
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n, count(embedding)::int AS e FROM knowledge_entries WHERE tenant_id = $1", [TENANT]);
  await pool.query("ANALYZE knowledge_entries");
  console.log(`[ingest] total chunks ${rows[0].n}, embedded ${rows[0].e}`);
  if (rows[0].n === 0 || rows[0].n !== rows[0].e) throw new Error("embedding coverage is not 100%");
}

function parseSse(text: string) {
  const frames: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try { frames.push(JSON.parse(line.slice(6))); } catch { /* [DONE] */ }
  }
  const answer = frames.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
  const status = [...frames].reverse().find((f) => f.kind === "status") ?? null;
  const sources = frames.filter((f) => f.kind === "sources").flatMap((f) => (f.citations as unknown[]) ?? []);
  const kinds = [...new Set(frames.map((f) => String(f.kind)))];
  return { answer, status, sources, kinds, frames };
}

async function run(manuals: Manual[], questions: Question[], arms: string[], out: string) {
  const { POST } = await import("@/app/api/equipment-notebooks/[id]/chat/route");
  const byId = new Map(manuals.map((m) => [m.id, m]));
  for (const [i, q] of questions.entries()) {
    const m = byId.get(q.manual);
    if (!m) throw new Error(`question ${q.id} names unknown manual ${q.manual}`);
    // Rotate the arm order per question so no arm always runs first (warm caches, drift).
    const order = arms.map((_, k) => arms[(k + i) % arms.length]);
    for (const arm of order) {
      Object.assign(process.env, ARM_FLAGS[arm]);
      current.docIds = [docOf(m.id)];
      current.filename = m.filename;
      current.usage = [];
      calls.length = 0;
      const t0 = performance.now();
      const res = await POST(
        new NextRequest(`http://bakeoff/api/equipment-notebooks/${NB}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: q.question, sourceDocIds: [docOf(m.id)], history: [] }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: Promise.resolve({ id: NB }) },
      );
      const body = await res.text();
      const ms = performance.now() - t0;
      // Usage is persisted after the stream closes: wait for THIS turn's record (same question), so a
      // row can never carry the previous turn's usage. Absent after 15 s -> recorded as missing.
      for (let w = 0; w < 150 && !current.usage.some((u) => (u as { question: string }).question === q.question); w++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const p = parseSse(body);
      appendFileSync(out, JSON.stringify({
        id: q.id, manual: q.manual, arm, http: res.status, ms, answer: p.answer, status: p.status,
        sources: p.sources, kinds: p.kinds, usage: current.usage.filter((u) => (u as { question: string }).question === q.question), calls: [...calls],
        frames: p.frames.filter((f) => f.kind !== "content"),
      }) + "\n");
    }
  }
}

describe("bakeoff", () => {
  it("runs", async () => {
    const manifest = JSON.parse(readFileSync(process.env.BAKEOFF_MANIFEST!, "utf8")) as Manual[];
    if (process.env.BAKEOFF_MODE === "ingest") {
      await ingest(manifest, path.dirname(process.env.BAKEOFF_MANIFEST!));
      return;
    }
    const questions = JSON.parse(readFileSync(process.env.BAKEOFF_QUESTIONS!, "utf8")) as Question[];
    await run(manifest, questions, (process.env.BAKEOFF_ARMS ?? "A,B,C,D,E").split(","), process.env.BAKEOFF_OUT!);
  }, 24 * 3600_000);
});

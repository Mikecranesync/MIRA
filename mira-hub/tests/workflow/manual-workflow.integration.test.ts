/** WF-01: real routes, PDF extraction, private lexical SQL, RLS, claims and persistence.
 * Provider responses are deterministic; every unexpected network call fails.
 * Requires an explicitly confirmed loopback database named mira_wf01_test.
 * See WF-01.md for the existing fixture/migration setup. No shared DB is permitted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import type { Pool } from "pg";

const { testPool, controls, previousNeon } = await vi.hoisted(async () => {
  const value = process.env.TEST_DATABASE_URL;
  const { workflowDatabaseConfig } = await import("./disposable-db");
  const config = workflowDatabaseConfig(value, process.env.MIRA_TEST_DB_CONFIRM);
  const previousNeon = process.env.NEON_DATABASE_URL;
  process.env.NEON_DATABASE_URL = value; // route configuration check only; the pool below is mocked explicitly
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool(config) as Pool, previousNeon,
    controls: { failFinalize: false, failTelemetry: false, suppressLifecycle: false,
      beforeIngress: null as null | (() => Promise<void>), ingressPending: [] as Promise<unknown>[],
      beforeParse: null as null | (() => Promise<void>), provider: "answer" as "answer" | "fail" | "hold", heldProvider: null as ReadableStreamDefaultController<Uint8Array> | null } };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/node-knowledge-ingest", async (original) => {
  const actual = await original<typeof import("@/lib/node-knowledge-ingest")>();
  return { ...actual, ingestPdfToNode: vi.fn(async (...args: Parameters<typeof actual.ingestPdfToNode>) => {
    await controls.beforeParse?.(); return actual.ingestPdfToNode(...args);
  }) };
});
vi.mock("@/lib/workspace-files", async (original) => {
  const actual = await original<typeof import("@/lib/workspace-files")>();
  return { ...actual, linkFileToUpload: vi.fn(async (...args: Parameters<typeof actual.linkFileToUpload>) => {
    if (controls.failFinalize) { controls.failFinalize = false; throw new Error("declared post-index finalization fault"); }
    return actual.linkFileToUpload(...args);
  }) };
});
vi.mock("@/lib/inference/persist-usage", async (original) => {
  const actual = await original<typeof import("@/lib/inference/persist-usage")>();
  return { ...actual, persistTurnUsage: vi.fn(async (...args: Parameters<typeof actual.persistTurnUsage>) => {
    if (controls.failTelemetry) throw new Error("declared telemetry failure after answer persistence");
    return actual.persistTurnUsage(...args);
  }) };
});
vi.mock("@/capabilities/observability/turn-lifecycle", async (original) => {
  const actual = await original<typeof import("@/capabilities/observability/turn-lifecycle")>();
  return { ...actual,
    openTurn: (input: Parameters<typeof actual.openTurn>[0]) => controls.suppressLifecycle
      ? Promise.resolve({ attemptId: input.attemptId!, durable: false }) : actual.openTurn(input),
    closeTurn: (input: Parameters<typeof actual.closeTurn>[0]) => controls.suppressLifecycle
      ? Promise.resolve({ closed: false, matched: false }) : actual.closeTurn(input),
  };
});
vi.mock("@/capabilities/observability/turn-ingress", async (original) => {
  const actual = await original<typeof import("@/capabilities/observability/turn-ingress")>();
  return { ...actual, recordResponse: (input: Parameters<typeof actual.recordResponse>[0]) => {
    const gate = controls.beforeIngress;
    const work = Promise.resolve(gate?.()).then(() => actual.recordResponse(input));
    if (gate) controls.ingressPending.push(work);
    return work;
  } };
});

import { POST as upload } from "@/app/api/namespace/node/[id]/files/route";
import { POST as attach } from "@/app/api/equipment-notebooks/[id]/sources/route";
import { POST as ask } from "@/app/api/equipment-notebooks/[id]/chat/route";
import { GET as inspect } from "@/app/api/workflows/manual-question/route";
import { DELETE as removeUpload } from "@/app/api/uploads/[id]/route";
import { PATCH as changeSource } from "@/app/api/equipment-notebooks/[id]/sources/[docId]/route";
import { createNotebook, claimNotebookTurnRequest, recordTurn, listTurns } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, claimIngest, linkFileToUpload, attachFileToTargets } from "@/lib/workspace-files";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
import { sessionOr401 } from "@/lib/session";

const tenantId = randomUUID(); const userId = randomUUID(); const otherTenant = randomUUID();
const answer = "Fault F12 means the inspection card is missing [1].";
const encoder = new TextEncoder();
const frame = (text: string) => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
let providerCalls = 0;
let nb: Awaited<ReturnType<typeof createNotebook>>;
let pdf: Buffer;
const session = (tenant = tenantId, user = userId) => vi.mocked(sessionOr401).mockResolvedValue({ tenantId: tenant, userId: user, role: "owner", status: "active", email: "fixture@example.test" } as never);

async function manual(): Promise<Buffer> {
  const doc = new PDFDocument({ compress: false }); const bytes: Buffer[] = [];
  const result = new Promise<Buffer>((resolve) => { doc.on("data", (b) => bytes.push(b)); doc.on("end", () => resolve(Buffer.concat(bytes))); });
  doc.text(`Fictional PM-42 manual ${randomUUID()}`); doc.addPage();
  doc.text("Fault F12 means the inspection card is missing. This is a read-only diagnostic description."); doc.end();
  return result;
}
async function sendPdf(signal?: AbortSignal, observed = true) {
  const body = new FormData(); body.set("file", new File([new Uint8Array(pdf)], "fictional-manual.pdf", { type: "application/pdf" }));
  const request = new Request(`https://hub.test/api/namespace/node/${nb.nodeId}/files`, { method: "POST", body,
    headers: observed ? { "X-Mira-Workflow": "mira.workflow.v1" } : {}, signal });
  const res = await upload(request, { params: Promise.resolve({ id: nb.nodeId }) });
  return { res, body: await res.json() };
}
async function attachDoc(docId: string) {
  return attach(new NextRequest(`https://hub.test/api/equipment-notebooks/${nb.id}/sources`, {
    method: "POST", body: JSON.stringify({ docId, sourceRole: "manual" }), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ id: nb.id }) });
}
const questionBody = (docId: string, clientRequestId: string) => ({ message: "What does fault F12 mean?", sourceDocIds: [docId], clientRequestId, threadId: "wf01" });
async function sendQuestion(docId: string, requestId: string, signal?: AbortSignal) {
  return ask(new NextRequest(`https://hub.test/api/equipment-notebooks/${nb.id}/chat`, {
    method: "POST", body: JSON.stringify(questionBody(docId, requestId)), headers: { "Content-Type": "application/json" }, signal,
  }), { params: Promise.resolve({ id: nb.id }) });
}
async function view(fileId: string, requestId?: string) {
  const q = new URLSearchParams({ notebook_id: nb.id, file_id: fileId });
  if (requestId) { q.set("client_request_id", requestId); q.set("thread_id", "wf01"); }
  const res = await inspect(new Request(`https://hub.test/api/workflows/manual-question?${q}`));
  return { res, body: await res.json() };
}
async function indexAndAttach() {
  const result = await sendPdf(); expect(result.body.indexed).toBe(true); expect((await attachDoc(result.body.uploadId)).status).toBe(201); return result.body;
}
async function cancelQuestion(docId: string, id: string) {
  controls.provider = "hold"; const abort = new AbortController();
  const response = await sendQuestion(docId, id, abort.signal);
  const stopped = response.text().catch(() => "stopped");
  await vi.waitFor(() => expect(controls.heldProvider).not.toBeNull()); abort.abort(); await stopped;
}

beforeAll(async () => {
  const { rows } = await testPool.query("SELECT current_database() AS db");
  if (rows[0].db !== "mira_wf01_test") throw new Error("WF-01 database identity mismatch");
  const ledger = await testPool.query("SELECT file_name FROM integration_schema_migrations WHERE file_name = ANY($1::text[])", [["044_workflow_runs.sql", "077_ingest_claim.sql", "089_notebook_turn_request_claim.sql"]]);
  if (ledger.rowCount !== 3) throw new Error("WF-01 fixture migrations missing");
  // Setup is separate: running this suite never applies DDL or migrations.
  const columns = await testPool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'knowledge_entries' AND column_name = ANY($1::text[])", [["content_tsv", "embedding"]]);
  if (columns.rowCount !== 2) throw new Error("WF-01 lexical fixture columns missing");
  await testPool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'WF-01 fixture')", [tenantId, `wf01_${tenantId}`]);
});
beforeEach(async () => {
  vi.clearAllMocks(); controls.failFinalize = false; controls.failTelemetry = false; controls.suppressLifecycle = false; controls.beforeParse = null; controls.provider = "answer"; controls.heldProvider = null; providerCalls = 0;
  controls.beforeIngress = null; controls.ingressPending = [];
  process.env.NODE_INGEST_EMBED = "0"; process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_ANSWER_GATE = "1"; process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.MIRA_CANONICAL_SEAM = "1"; process.env.OPENAI_API_KEY = "fixture-only-not-a-credential";
  process.env.NOTEBOOK_MANUAL_ACQUISITION = "0";
  session(); nb = await createNotebook(tenantId, { displayName: `WF-01 ${randomUUID()}`, createdBy: userId }); pdf = await manual();
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) !== "https://api.openai.com/v1/chat/completions") throw new Error(`unexpected network endpoint in WF-01 fixture`);
    providerCalls++;
    if (controls.provider === "fail") return new Response("fixture unavailable", { status: 503 });
    const payload = JSON.parse(String(init?.body));
    if (!payload.stream) return Response.json({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    return new Response(new ReadableStream<Uint8Array>({ start(c) {
      if (controls.provider === "hold") {
        controls.heldProvider = c;
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("fixture request aborted", "AbortError")), { once: true });
        return;
      }
      c.enqueue(frame(answer)); c.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop","delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":10}}\n\ndata: [DONE]\n\n')); c.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
  }));
});
afterAll(async () => {
  vi.unstubAllGlobals(); await testPool.end();
  if (previousNeon === undefined) delete process.env.NEON_DATABASE_URL; else process.env.NEON_DATABASE_URL = previousNeon;
});

describe("WF-01 existing manual-to-answer vertical slice", () => {
  it("preserves the default upload path without writing workflow metadata", async () => {
    const result = await sendPdf(undefined, false);
    expect(result.body.indexed).toBe(true);
    expect(result.res.headers.get("X-Mira-Workflow-Run-Id")).toBeNull();
    const rows = await testPool.query("SELECT run_id FROM workflow_runs WHERE tenant_id=$1 AND input->'workflow'->'identity'->>'operationId'=$2", [tenantId, result.body.fileId]);
    expect(rows.rowCount).toBe(0);
    expect((await view(result.body.fileId)).body.visibility.uploadRecorded).toBe(false);
  });
  it.each(["opaque.bin", "opaqueXpdf", "opaqueXtxt", "opaqueXmd"])("does not advertise an extractor for %s", async (filename) => {
    const body = new FormData(); body.set("file", new File(["stored only"], filename, { type: "application/octet-stream" }));
    const response = await upload(new Request(`https://hub.test/api/namespace/node/${nb.nodeId}/files`, { method: "POST", body }), { params: Promise.resolve({ id: nb.nodeId }) });
    const file = await response.json();
    expect((await view(file.fileId)).body.workflow).toMatchObject({ retry: { eligible: false }, recovery: { action: "none" } });
  });
  it("extracts a real PDF, indexes private anchored text, attaches it, retrieves and persists a cited gated answer; duplicates replay", async () => {
    const doc = await indexAndAttach();
    expect((await view(doc.fileId)).body.workflow.stage).toBe("question");
    const requestId = randomUUID(); const res = await sendQuestion(doc.uploadId, requestId); const text = await res.text();
    expect(text).toContain("inspection card"); expect(text).toContain('"kind":"sources"');
    const result = await view(doc.fileId, requestId);
    expect(result.body.workflow).toMatchObject({ state: "succeeded", stage: "answer_persisted" });
    expect(result.body.workflow.evidence).toContainEqual({ kind: "document", id: doc.uploadId, page: 2 });
    expect(JSON.stringify(result.body)).not.toContain("inspection card");
    const calls = providerCalls;
    await (await sendQuestion(doc.uploadId, requestId)).text(); expect(providerCalls).toBe(calls);
    const repeated = await sendPdf(); expect(repeated.body).toMatchObject({ fileId: doc.fileId, uploadId: doc.uploadId, duplicate: true });
    expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
    const counts = await testPool.query("SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE notebook_id=$1 AND client_request_id=$2", [nb.id, requestId]);
    expect(counts.rows[0].n).toBe(1);
  });
  it("reports an extraction failure while retaining bytes and permitting the existing retry", async () => {
    pdf = Buffer.from("%PDF-1.4 deliberately invalid synthetic file");
    const result = await sendPdf(); expect(result.body.indexed).toBe(false);
    const status = await view(result.body.fileId);
    expect(status.body.workflow.state).toBe("failed"); expect(status.body.workflow.recovery.action).toBe("upload_again");
    const bytes = await testPool.query("SELECT octet_length(content) AS n FROM namespace_direct_uploads WHERE id=$1", [result.body.fileId]);
    expect(bytes.rows[0].n).toBe(pdf.length);
  });
  it("recovers an indexed document after a declared finalization failure without parsing it again", async () => {
    controls.failFinalize = true; const first = await sendPdf(); expect(first.body.indexed).toBe(false);
    expect((await view(first.body.fileId)).body.workflow.state).toBe("interrupted");
    const recovered = await sendPdf(); expect(recovered.body).toMatchObject({ indexed: true, duplicate: true, fileId: first.body.fileId });
    expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
    expect((await view(first.body.fileId)).body.workflow.stage).toBe("source_attachment");
  });
  it("declines same-byte retry for a linked document whose index has disappeared", async () => {
    const doc = await sendPdf();
    await testPool.query("DELETE FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2 AND is_private = true", [tenantId, doc.body.uploadId]);
    const result = await view(doc.body.fileId);
    expect(result.body.workflow).toMatchObject({ state: "failed", retry: { eligible: false }, recovery: { action: "none" } });
    // The unchanged executor returns the old pointer; it cannot perform the advertised repair.
    const replay = await sendPdf();
    expect(replay.body).toMatchObject({ indexed: true, uploadId: doc.body.uploadId });
    const inspected = (await view(doc.body.fileId)).body;
    expect(inspected.stages.indexed).toBe(false);
    expect(inspected.uploadObservation.state).not.toBe("succeeded");
    expect(inspected.uploadObservation.stage).not.toBe("indexed");
    const run = await testPool.query("SELECT output FROM workflow_runs WHERE run_id = $1", [replay.res.headers.get("X-Mira-Workflow-Run-Id")]);
    expect(run.rows[0].output.workflow.state).not.toBe("succeeded");
  });
  it("declines pointer replay as repair when retained chunks lose all page locators", async () => {
    const doc = await indexAndAttach();
    await testPool.query("UPDATE knowledge_entries SET page_start = NULL, source_page = NULL WHERE tenant_id = $1 AND doc_id = $2 AND is_private = true", [tenantId, doc.uploadId]);
    const first = (await view(doc.fileId)).body;
    expect(first.readiness.canChat).toBe(false);
    expect(first.workflow).toMatchObject({ retry: { eligible: false }, recovery: { action: "none" } });
    const replay = await sendPdf(); expect(replay.body).toMatchObject({ indexed: true, uploadId: doc.uploadId });
    const second = (await view(doc.fileId)).body;
    expect(second.workflow.retry.eligible).toBe(false);
    expect(second.uploadObservation.state).not.toBe("succeeded");
    expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("does not declare a deleted upload currently indexed (historical answer=%s)", async (answered) => {
    const doc = await indexAndAttach(); const id = randomUUID();
    if (answered) await (await sendQuestion(doc.uploadId, id)).text();
    expect((await removeUpload(new NextRequest(`https://hub.test/api/uploads/${doc.uploadId}`, { method: "DELETE" }), { params: Promise.resolve({ id: doc.uploadId }) })).status).toBe(200);
    const result = (await view(doc.fileId)).body;
    expect(result.readiness.canChat).toBe(false); expect(result.stages.indexed).toBe(false);
    expect(result.workflow).toMatchObject({ state: "failed", retry: { eligible: false }, recovery: { action: "none" } });
    if (answered) expect((await view(doc.fileId, id)).body.workflow.state).toBe("succeeded");
    const replay = await sendPdf(); expect(replay.body.indexed).toBe(true);
    expect((await view(doc.fileId)).body.uploadObservation.state).not.toBe("succeeded");
  });
  it("validates the complete original question scope before suggesting same-key retry", async () => {
    const a = await indexAndAttach(); pdf = await manual(); const b = await indexAndAttach();
    const id = randomUUID(); controls.provider = "fail";
    const payload = { ...questionBody(a.uploadId, id), sourceDocIds: [a.uploadId, b.uploadId] };
    await (await ask(new NextRequest(`https://hub.test/api/equipment-notebooks/${nb.id}/chat`, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ id: nb.id }) })).text();
    expect((await view(a.fileId, id)).body.workflow.retry.eligible).toBe(true);
    expect((await changeSource(new NextRequest(`https://hub.test/api/equipment-notebooks/${nb.id}/sources/${b.uploadId}`, { method: "PATCH", body: JSON.stringify({ enabledByDefault: false }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ id: nb.id, docId: b.uploadId }) })).status).toBe(200);
    expect((await view(a.fileId, id)).body.workflow).toMatchObject({ state: "failed", retry: { eligible: false }, recovery: { action: "none" } });
    const saved = await testPool.query("SELECT client_request_state, answer_status FROM equipment_notebook_turns WHERE tenant_id=$1 AND notebook_id=$2 AND owner_user_id=$3 AND client_request_id=$4", [tenantId, nb.id, userId, id]);
    expect(saved.rows).toEqual([{ client_request_state: "complete", answer_status: "error" }]);
  });
  it.each(["answer", "fail"] as const)("does not change one owner's %s visibility when another owner uses the same request UUID", async (provider) => {
    const doc = await indexAndAttach(); const id = randomUUID();
    controls.provider = provider;
    await (await sendQuestion(doc.uploadId, id)).text();
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.visibility.gaps).toEqual(provider === "answer" ? [] : ["turn_outcome_unavailable"]));
    const first = (await view(doc.fileId, id)).body.visibility;
    controls.provider = "answer";
    session(tenantId, randomUUID()); await (await sendQuestion(doc.uploadId, id)).text();
    await vi.waitFor(async () => {
      const rows = await testPool.query("SELECT count(DISTINCT turn_id)::int AS n FROM decision_traces WHERE tenant_id=$1 AND notebook_id=$2 AND client_request_id=$3 AND lifecycle='closed'", [tenantId, nb.id, id]);
      expect(rows.rows[0].n).toBe(2);
    });
    session(); expect((await view(doc.fileId, id)).body.visibility).toEqual(first);
  });
  it.each(["txt", "md"])("does not advertise PDF-only orphan adoption for a %s file", async (extension) => {
    const body = new FormData();
    body.set("file", new File([`Fictional ${randomUUID()}\nFault F12 means the inspection card is missing.`], `fictional.${extension}`, { type: "text/plain" }));
    controls.failFinalize = true;
    const response = await upload(new Request(`https://hub.test/api/namespace/node/${nb.nodeId}/files`, { method: "POST", body, headers: { "X-Mira-Workflow": "mira.workflow.v1" } }), { params: Promise.resolve({ id: nb.nodeId }) });
    const parked = await response.json(); expect(parked.indexed).toBe(false);
    const result = await view(parked.fileId);
    expect(result.body.workflow).toMatchObject({ state: "interrupted", retry: { eligible: false }, recovery: { action: "none" } });
    expect(result.body.uploadObservation).toMatchObject({ state: "failed", retry: { eligible: false }, recovery: { action: "none" } });
    const docs = await testPool.query("SELECT id FROM hub_uploads WHERE tenant_id = $1 AND kg_entity_id = $2 AND status = 'parsed'", [tenantId, nb.nodeId]);
    expect(docs.rowCount).toBe(1);
    expect(result.body.workflow.evidence).toContainEqual({ kind: "document", id: docs.rows[0].id });
  });
  it("declines orphan retry from a secondary filing that cannot adopt the original node's PDF", async () => {
    controls.failFinalize = true; const first = await sendPdf();
    const originalNode = nb.nodeId;
    nb = await createNotebook(tenantId, { displayName: `secondary ${randomUUID()}`, createdBy: userId });
    await attachFileToTargets(tenantId, first.body.fileId, [{ targetType: "namespace_node", targetId: nb.nodeId, isPrimary: false }], { createdBy: userId });
    const result = await view(first.body.fileId);
    expect(result.body.workflow).toMatchObject({ state: "interrupted", retry: { eligible: false }, recovery: { action: "none" } });
    const docs = await testPool.query("SELECT id FROM hub_uploads WHERE tenant_id = $1 AND kg_entity_id = $2 AND status = 'parsed'", [tenantId, originalNode]);
    expect(docs.rowCount).toBe(1);
    expect(result.body.workflow.evidence).toContainEqual({ kind: "document", id: docs.rows[0].id });
  });
  it("optional metadata lock contention cannot hold inspections or unrelated domain queries", async () => {
    const doc = await indexAndAttach(); const locker = await testPool.connect();
    const pending: ReturnType<typeof view>[] = []; let beforeUnlock = false;
    try {
      await locker.query("BEGIN; LOCK TABLE workflow_runs IN ACCESS EXCLUSIVE MODE");
      for (let i = 0; i < 5; i++) { pending.push(view(doc.fileId)); await new Promise((r) => setTimeout(r, 10)); }
      const domain = testPool.query("SELECT 42 AS result");
      const result = await Promise.race([Promise.all([Promise.all(pending), domain]), new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
      if (result) {
        beforeUnlock = true;
        expect(result[1].rows[0].result).toBe(42);
        for (const v of result[0]) {
          expect(v.res.status).toBe(200); expect(v.body.workflow.state).toBe("waiting");
          expect(v.body.visibility.gaps).toContain("upload_observation_unavailable");
        }
      }
    } finally { await locker.query("ROLLBACK"); locker.release(); await Promise.allSettled(pending); }
    expect(beforeUnlock).toBe(true);
  });
  it("concurrent identical uploads share the existing claim and create one index", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; }); controls.beforeParse = () => gate;
    const first = sendPdf(); await vi.waitFor(() => expect(ingestPdfToNode).toHaveBeenCalledTimes(1));
    const second = await sendPdf(); expect(second.res.status).toBe(202);
    expect((await view(second.body.fileId)).body.workflow.state).toBe("running");
    release(); const result = await first; expect(result.body.indexed).toBe(true); expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
  });
  it("a client stopping its upload wait does not cancel or discard accepted extraction", async () => {
    const abort = new AbortController();
    controls.beforeParse = async () => { abort.abort(); };
    const result = await sendPdf(abort.signal); expect(result.body.indexed).toBe(true);
    const status = await view(result.body.fileId);
    expect(status.body.uploadObservation).toMatchObject({ state: "succeeded", cancellation: { requested: true, scope: "client_wait", acknowledged: false } });
  });
  it("a fresh consumer recovers a persisted stale producer claim and fences its late finalization", async () => {
    const file = await parkOrReuseFile({ tenantId, nodeId: nb.nodeId, filename: "fictional-manual.pdf", mimeType: "application/pdf", buffer: pdf, sizeBytes: pdf.length });
    const old = await claimIngest(tenantId, file.fileId); if (!old.claimed) throw new Error("fixture claim missing");
    // Simulated producer loss: only persisted state survives, with the lease aged past its domain timeout.
    await testPool.query("UPDATE namespace_direct_uploads SET ingest_claimed_at=now()-interval '11 minutes' WHERE id=$1", [file.fileId]);
    expect((await view(file.fileId)).body.workflow).toMatchObject({ state: "interrupted", recovery: { action: "upload_again" } });
    const result = await sendPdf(); expect(result.body.indexed).toBe(true);
    expect(await linkFileToUpload(tenantId, file.fileId, randomUUID(), old.claimToken)).toBe(false);
    expect((await view(file.fileId)).body.workflow.stage).toBe("source_attachment");
  });
  it("a provider failure is visible through the persisted request and never becomes an answered workflow", async () => {
    const doc = await indexAndAttach(); controls.provider = "fail"; const id = randomUUID();
    await (await sendQuestion(doc.uploadId, id)).text();
    expect((await view(doc.fileId, id)).body.workflow).toMatchObject({ state: "failed", failure: { code: "answer_failed" } });
  });
  it("a notebook stop is acknowledged by the existing domain path and leaves an inspectable non-answer", async () => {
    const doc = await indexAndAttach(); controls.provider = "hold"; const id = randomUUID(); const abort = new AbortController();
    const response = await sendQuestion(doc.uploadId, id, abort.signal);
    const finished = response.text().catch(() => "stopped");
    await vi.waitFor(() => expect(controls.heldProvider).not.toBeNull()); abort.abort(); await finished;
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    const result = await view(doc.fileId, id);
    expect(result.body.stages.answerPersisted).toBe(false);
    expect(result.body.workflow.cancellation).toEqual({ requested: true, scope: "execution", acknowledged: true });
  });
  it("keeps a cited retry successful when its telemetry fails after an earlier cancellation", async () => {
    const doc = await indexAndAttach(); controls.provider = "hold";
    const id = randomUUID(); const abort = new AbortController();
    const response = await sendQuestion(doc.uploadId, id, abort.signal);
    const stopped = response.text().catch(() => "stopped");
    await vi.waitFor(() => expect(controls.heldProvider).not.toBeNull()); abort.abort(); await stopped;
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    controls.provider = "answer"; controls.failTelemetry = true;
    expect(await (await sendQuestion(doc.uploadId, id)).text()).toContain("inspection card");
    const result = await view(doc.fileId, id);
    expect(result.body.workflow.state).toBe("succeeded");
    expect(result.body.stages.answerPersisted).toBe(true);
    expect(result.body.workflow.cancellation.acknowledged).toBe(false);
    expect(result.body.visibility.gaps).toEqual([]);
  });
  it("reports an evidence gap instead of acknowledging an old stop after a retry fails", async () => {
    const doc = await indexAndAttach(); controls.provider = "hold";
    const id = randomUUID(); const abort = new AbortController();
    const response = await sendQuestion(doc.uploadId, id, abort.signal);
    const stopped = response.text().catch(() => "stopped");
    await vi.waitFor(() => expect(controls.heldProvider).not.toBeNull()); abort.abort(); await stopped;
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    controls.provider = "fail"; controls.failTelemetry = true;
    await (await sendQuestion(doc.uploadId, id)).text();
    const result = await view(doc.fileId, id);
    expect(result.body.workflow.state).toBe("failed");
    expect(result.body.workflow.cancellation.acknowledged).toBe(false);
    expect(result.body.visibility.gaps).toContain("turn_outcome_unavailable");
  });
  it("uses surviving ingress when a retry loses its entire lifecycle", async () => {
    const doc = await indexAndAttach(); const id = randomUUID(); await cancelQuestion(doc.uploadId, id);
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    controls.provider = "fail"; controls.failTelemetry = true; controls.suppressLifecycle = true;
    await (await sendQuestion(doc.uploadId, id)).text();
    await vi.waitFor(async () => {
      const count = await testPool.query("SELECT count(DISTINCT attempt_id)::int AS n FROM turn_ingress WHERE tenant_id = $1 AND notebook_id = $2 AND client_request_id = $3 AND phase = 'responded'", [tenantId, nb.id, id]);
      expect(count.rows[0].n).toBe(2);
    });
    const result = await view(doc.fileId, id);
    expect(result.body.workflow.state).toBe("failed"); expect(result.body.workflow.cancellation.acknowledged).toBe(false);
    expect(result.body.visibility.gaps).toContain("turn_outcome_unavailable");
  });
  it("cannot inherit an old stop before a failed retry's delayed ingress commits", async () => {
    const doc = await indexAndAttach(); const id = randomUUID(); await cancelQuestion(doc.uploadId, id);
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    controls.provider = "fail"; controls.failTelemetry = true; controls.suppressLifecycle = true; controls.beforeIngress = () => gate;
    try {
      await (await sendQuestion(doc.uploadId, id)).text();
      await vi.waitFor(() => expect(controls.ingressPending).toHaveLength(1));
      const before = (await view(doc.fileId, id)).body;
      expect(before.workflow.state).toBe("failed"); expect(before.workflow.cancellation.acknowledged).toBe(false);
      expect(before.visibility.gaps).toContain("turn_outcome_unavailable");
    } finally { release(); await Promise.allSettled(controls.ingressPending); }
    const after = (await view(doc.fileId, id)).body;
    expect(after.workflow.state).toBe("failed"); expect(after.workflow.cancellation.acknowledged).toBe(false);
  });
  it("finds the same first-attempt cancellation for uppercase and lowercase request UUIDs", async () => {
    const doc = await indexAndAttach(); const id = randomUUID().toUpperCase(); await cancelQuestion(doc.uploadId, id);
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    expect((await view(doc.fileId, id.toLowerCase())).body.workflow.cancellation.acknowledged).toBe(true);
  });
  it("acknowledges the current saved stop while all optional telemetry is absent or delayed", async () => {
    const doc = await indexAndAttach(); const id = randomUUID();
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    controls.failTelemetry = true; controls.suppressLifecycle = true; controls.beforeIngress = () => gate;
    try {
      await cancelQuestion(doc.uploadId, id);
      await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
      const result = (await view(doc.fileId, id)).body;
      expect(result.workflow).toMatchObject({ state: "cancelled", cancellation: { acknowledged: true } });
      const publicHistory = await listTurns(tenantId, nb.id, 50, { viewerUserId: userId, threadId: "wf01" });
      expect(publicHistory.flatMap((t) => t.evidence).some((e) => (e as { kind?: string })?.kind === "notebook_turn_cancelled")).toBe(false);
      const traces = await testPool.query("SELECT attempt_id FROM decision_traces WHERE tenant_id = $1 AND client_request_id = $2 AND lifecycle IS NOT NULL", [tenantId, id]);
      expect(traces.rowCount).toBe(0);
    } finally { release(); await Promise.allSettled(controls.ingressPending); }
  });
  it("keeps old stop evidence inactive during reclaim, replaces it on completion, and fences the old writer", async () => {
    const doc = await indexAndAttach(); const id = randomUUID();
    controls.provider = "hold"; const abort = new AbortController();
    const res = await sendQuestion(doc.uploadId, id, abort.signal); const stopped = res.text().catch(() => "stopped");
    await vi.waitFor(() => expect(controls.heldProvider).not.toBeNull());
    const lease = await testPool.query("SELECT client_request_claim_token FROM equipment_notebook_turns WHERE tenant_id = $1 AND notebook_id = $2 AND client_request_id = $3", [tenantId, nb.id, id]);
    abort.abort(); await stopped;
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    const first = await testPool.query("SELECT evidence FROM equipment_notebook_turns WHERE tenant_id = $1 AND notebook_id = $2 AND client_request_id = $3", [tenantId, nb.id, id]);
    const receipt = first.rows[0].evidence.find((e: { kind?: string }) => e.kind === "notebook_turn_cancelled");
    expect(receipt).toBeDefined();
    controls.heldProvider = null; const secondAbort = new AbortController();
    const secondRes = await sendQuestion(doc.uploadId, id, secondAbort.signal); const secondStopped = secondRes.text().catch(() => "stopped");
    await vi.waitFor(() => expect(controls.heldProvider).not.toBeNull());
    expect((await view(doc.fileId, id)).body.workflow).toMatchObject({ state: "running", cancellation: { acknowledged: false } });
    secondAbort.abort(); await secondStopped;
    await vi.waitFor(async () => expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled"));
    const next = await testPool.query("SELECT evidence FROM equipment_notebook_turns WHERE tenant_id = $1 AND notebook_id = $2 AND client_request_id = $3", [tenantId, nb.id, id]);
    const nextReceipt = next.rows[0].evidence.find((e: { kind?: string }) => e.kind === "notebook_turn_cancelled");
    expect(nextReceipt.attemptId).not.toBe(receipt.attemptId);
    expect((await view(doc.fileId, id)).body.workflow.state).toBe("cancelled");
    controls.provider = "answer"; await (await sendQuestion(doc.uploadId, id)).text();
    await expect(recordTurn(tenantId, nb.id, { ownerUserId: userId, clientRequestId: id, threadId: "wf01",
      claimToken: lease.rows[0].client_request_claim_token, question: questionBody(doc.uploadId, id).message,
      answerStatus: "error", answerText: null, enabledSourceDocIds: [doc.uploadId], evidence: [receipt], model: null })).rejects.toThrow("notebook_not_found");
    expect((await view(doc.fileId, id)).body.workflow).toMatchObject({ state: "succeeded", cancellation: { acknowledged: false } });
  });
  it("the existing immediate-danger gate stays terminal, requires no model call, and cannot become workflow success", async () => {
    const doc = await indexAndAttach(); const id = randomUUID();
    const payload = { ...questionBody(doc.uploadId, id), message: "Smoke is coming from the control panel." };
    const response = await ask(new NextRequest(`https://hub.test/api/equipment-notebooks/${nb.id}/chat`, {
      method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" },
    }), { params: Promise.resolve({ id: nb.id }) });
    await response.text();
    expect(providerCalls).toBe(0);
    expect((await view(doc.fileId, id)).body.workflow).toMatchObject({ state: "refused", retry: { eligible: false } });
  });
  it("another in-flight question is observed through its existing request claim; retry does not start inference", async () => {
    const doc = await indexAndAttach(); const id = randomUUID(); const payload = questionBody(doc.uploadId, id);
    await claimNotebookTurnRequest(tenantId, nb.id, { ownerUserId: userId, clientRequestId: id, question: payload.message, threadId: "wf01", requestPayload: payload });
    expect((await view(doc.fileId, id)).body.workflow.state).toBe("running");
    expect((await sendQuestion(doc.uploadId, id)).status).toBe(409); expect(providerCalls).toBe(0);
    await testPool.query("UPDATE equipment_notebook_turns SET client_request_started_at=now()-interval '11 minutes' WHERE client_request_id=$1", [id]);
    expect((await view(doc.fileId, id)).body.workflow.state).toBe("interrupted");
    await (await sendQuestion(doc.uploadId, id)).text(); expect((await view(doc.fileId, id)).body.workflow.state).toBe("succeeded");
  });
  it("inspection enforces tenant, notebook relationship and conversation owner, and executes no writes", async () => {
    const doc = await indexAndAttach(); const id = randomUUID(); await (await sendQuestion(doc.uploadId, id)).text();
    session(otherTenant); expect((await view(doc.fileId, id)).res.status).toBe(404);
    session(tenantId, randomUUID()); expect((await view(doc.fileId, id)).body.stages.answerPersisted).toBe(false);
    session(); const old = nb; nb = await createNotebook(tenantId, { displayName: `unrelated ${randomUUID()}` });
    expect((await view(doc.fileId)).res.status).toBe(404); nb = old;
    const query = vi.spyOn(testPool, "query"); await view(doc.fileId, id);
    expect(query.mock.calls.every(([q]) => typeof q !== "string" || !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(q))).toBe(true);
    query.mockRestore();
  });
});

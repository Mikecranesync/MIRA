/** Actual HTTP + production handler/store + restricted PostgreSQL. Session is injected here;
 * real password/built-Next/browser qualification is a separate required stage. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server } from "node:http";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { Pool } from "pg";

const db = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw new Error("Disposable database required");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { pool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: db.pool }));
const auth = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage: Storage } = require("node:async_hooks");
  return new Storage() as AsyncLocalStorage<{ tenantId: string; userId: string } | null>;
});
vi.mock("@/lib/session", () => ({ sessionOr401: async () => auth.getStore() ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }));

import { abandonNotebookTurnRequest, claimNotebookTurnRequest, listTurns, recordTurn } from "@/lib/equipment-notebooks";
import { readTurnRetry } from "./store";
import { withTenantContext } from "@/lib/tenant-context";
import { GET } from "@/app/api/equipment-notebooks/[id]/requests/[requestId]/route";

describe("request recovery HTTP/PostgreSQL", () => {
  const tenant = uuid(), foreignTenant = uuid(), notebook = uuid(), requestId = uuid();
  const thread = "recovery-thread", owner = "recovery-user";
  const actors = { owner: { tenantId: tenant, userId: owner }, other: { tenantId: tenant, userId: "other-user" }, foreign: { tenantId: foreignTenant, userId: owner } };
  let server: Server, base: string, claimToken: string;
  const read = (token = "owner", suffix = `?threadId=${thread}`, id: string = requestId, nb: string = notebook) =>
    fetch(`${base}/${nb}/requests/${id}/${suffix}`, { headers: { authorization: token } });

  beforeAll(async () => {
    await db.pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'recovery A'),($2,$2::uuid::text,'recovery B')", [tenant, foreignTenant]);
    await db.pool.query("INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,equipment_entity_id) VALUES($1,$2,$3,'Recovery fixture','machine-A')", [notebook, tenant, uuid()]);
    const claim = await claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: requestId, question: "What fuse?", threadId: thread,
      requestPayload: { message: "What fuse?", expectedEquipmentEntityId: "machine-A", sourceDocIds: [], visualEvidence: { fileId: uuid() }, mustNotEcho: "private-field" } });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("fixture claim failed");
    claimToken = claim.claimToken;
    server = createServer((incoming, outgoing) => {
      const parts = new URL(incoming.url!, "http://localhost").pathname.split("/");
      const controller = new AbortController();
      outgoing.on("close", () => { if (!outgoing.writableEnded) controller.abort(); });
      const actor = actors[String(incoming.headers.authorization) as keyof typeof actors] ?? null;
      void auth.run(actor, async () => {
        try {
          const response = await GET(new Request(`http://localhost${incoming.url}`, { signal: controller.signal }), { params: Promise.resolve({ id: parts[1], requestId: parts[3] }) });
          outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
        } catch { outgoing.writeHead(500); outgoing.end("failed"); }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await db.pool.end(); });

  it("observes the pending question although completed history does not yet contain it", async () => {
    expect(await listTurns(tenant, notebook, 50, { viewerUserId: owner, threadId: thread })).toEqual([]);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ requestId, question: "What fuse?", state: "pending", target: { kind: "known", equipmentEntityId: "machine-A" } });
    expect(JSON.stringify(body)).not.toMatch(/private-field|claim_token/);
  });

  it("requires authentication and hides other owners, tenants, notebooks and conversations", async () => {
    expect((await read("anonymous")).status).toBe(401);
    for (const token of ["other", "foreign"]) expect((await read(token)).status).toBe(404);
    expect((await read("owner", "?threadId=other-thread")).status).toBe(404);
    expect((await read("owner", `?threadId=${thread}`, uuid())).status).toBe(404);
    expect((await read("owner", `?threadId=${thread}`, requestId, uuid())).status).toBe(404);
  });

  it("refuses malformed and repeated parameters", async () => {
    expect((await read("owner", "?threadId=bad%20thread")).status).toBe(400);
    expect((await read("owner", "?threadId=a&threadId=b")).status).toBe(400);
    expect((await read("owner", "?tenantId=foreign")).status).toBe(400);
    expect((await read("owner", "", "not-a-request-id")).status).toBe(400);
  });

  it("runs under restricted RLS and leaves the claim, lease and notebook recency byte-identical", async () => {
    const snapshot = async () => (await db.pool.query("SELECT to_jsonb(t) AS turn, to_jsonb(n) AS notebook FROM equipment_notebook_turns t JOIN equipment_notebooks n ON n.id=t.notebook_id WHERE t.client_request_id=$1", [requestId])).rows;
    const before = await snapshot();
    await read(); await read();
    expect(await snapshot()).toEqual(before);
    expect(await withTenantContext(tenant, async (c) => (await c.query("SELECT current_user AS role")).rows[0].role)).toBe("factorylm_app");
  });

  it("finds a failure committed after the first reload read, without claiming another execution", async () => {
    const locker = await db.pool.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT 1 FROM equipment_notebook_turns WHERE client_request_id=$1 FOR UPDATE", [requestId]);
    const completion = recordTurn(tenant, notebook, { question: "What fuse?", answerStatus: "error", answerText: null,
      enabledSourceDocIds: [], evidence: [], model: null, ownerUserId: owner, threadId: thread,
      clientRequestId: requestId, claimToken, equipmentEntityId: "machine-A" });
    try {
      expect((await (await read()).json()).state).toBe("pending");
      expect(await listTurns(tenant, notebook, 50, { viewerUserId: owner, threadId: thread })).toEqual([]);
    } finally { await locker.query("COMMIT"); locker.release(); }
    await completion;
    expect(await (await read()).json()).toMatchObject({ state: "complete", answerStatus: "error", question: "What fuse?" });
    expect(await listTurns(tenant, notebook, 50, { viewerUserId: owner, threadId: thread })).toHaveLength(1);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE client_request_id=$1", [requestId])).rows[0].n).toBe(1);
  });

  it("keeps original target A visible after the notebook is rebound to B", async () => {
    await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id='machine-B' WHERE id=$1", [notebook]);
    expect(await (await read()).json()).toMatchObject({ target: { kind: "known", equipmentEntityId: "machine-A" }, currentEquipmentEntityId: "machine-B" });
  });

  it("restores an existing failed exchange when its reclaimed retry is refused", async () => {
    const id = uuid(), photo = uuid();
    const body = { clientRequestId: id, message: "Original photo question", threadId: thread, sourceDocIds: [], expectedEquipmentEntityId: "machine-A", visualEvidence: { fileId: photo }, history: [{ role: "user", content: "original history" }] };
    const first = await claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: id, question: body.message, threadId: thread, requestPayload: body });
    if (first.status !== "claimed") throw new Error("claim failed");
    const evidence = [{ kind: "visual_observation", fileId: photo }];
    await recordTurn(tenant, notebook, { question: body.message, answerStatus: "error", answerText: null, enabledSourceDocIds: [], evidence, model: null,
      ownerUserId: owner, threadId: thread, clientRequestId: id, claimToken: first.claimToken, equipmentEntityId: "machine-A" });
    expect(await readTurnRetry(tenant, notebook, owner, thread, id)).toMatchObject({ body, target: { kind: "known", equipmentEntityId: "machine-A" } });
    const second = await claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: id, question: body.message, threadId: thread, requestPayload: body });
    if (second.status !== "claimed") throw new Error("retry did not own lease");
    expect(second.preserveFailedTurn).toBe(true);
    expect(await readTurnRetry(tenant, notebook, owner, thread, id)).toMatchObject({ error: "request_in_progress", status: 409 });
    await abandonNotebookTurnRequest(tenant, notebook, owner, id, second.claimToken, second.preserveFailedTurn);
    const saved = (await listTurns(tenant, notebook, 50, { viewerUserId: owner, threadId: thread })).find(row => row.clientRequestId === id);
    expect(saved).toMatchObject({ question: body.message, answerStatus: "error", evidence, equipmentEntityId: "machine-A" });
    expect(await readTurnRetry(tenant, notebook, "another-owner", thread, id)).toMatchObject({ error: "retry_request_not_found", status: 404 });
    expect(await readTurnRetry(tenant, notebook, owner, "other-thread", id)).toMatchObject({ error: "retry_request_not_found", status: 404 });
  });
});

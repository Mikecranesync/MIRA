/**
 * Retrieval replay — corpus provisioning (retrieval core spec, Phase 0).
 *
 * Builds the persistent STAGING tenant the zero-token replay reads: one project per stranger-walk
 * manual, created and filled through the SAME doors the walk's browser uses
 *   POST /api/equipment-notebooks/          {displayName: "<oem> <id>", identitySourceType: "user"}
 *   POST /api/namespace/node/<node>/files/  (multipart, the composer's attachment upload)
 *   POST /api/equipment-notebooks/<id>/sources/ {docId, sourceRole: "manual"}
 * so the stored chunks, headings and identity are the ones a stranger's notebook gets. It then
 * waits until every chunk of every manual carries an embedding (the vector lane needs full
 * coverage; the walk asked most questions while coverage was ~24%, which is a separate finding).
 *
 * Resumable and idempotent: state (account, ids) lives in $REPLAY_STATE (default
 * ../../../.planning/retrieval-phase0/replay-state.json — gitignored, never committed, holds the
 * throwaway staging password). Staging only. No model is called: uploads embed on the Hub's own
 * Ollama, which is not metered.
 *
 *   doppler run -p factorylm -c stg -- npx tsx tests/retrieval-replay/provision.ts
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadCorpus } from "./corpus";
import { identity, manualBytes, stagingBase } from "../stranger-walk/staging";

const corpus = loadCorpus();
const BASE = stagingBase();
export const STATE_PATH =
  process.env.REPLAY_STATE ?? path.resolve(__dirname, "../../../.planning/retrieval-phase0/replay-state.json");
const CACHE = process.env.STRANGER_WALK_CACHE ?? path.resolve(__dirname, "../../../.planning/retrieval-phase0/manuals");
const EMBED_WAIT_MS = Number(process.env.REPLAY_EMBED_WAIT_MS ?? 45 * 60_000);

export type ReplayManual = { notebookId: string; nodeId: string; docId: string | null; chunks?: number; embedded?: number };
export type ReplayState = {
  account: { email: string; password: string; tenantId: string } | null;
  provisionedAt?: string;
  provisionedOn?: { gitSha: string; builtAt: string };
  manuals: Record<string, ReplayManual>;
};

export function loadState(): ReplayState {
  return existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as ReplayState) : { account: null, manuals: {} };
}
function save(st: ReplayState): void {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
}

async function signIn(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf/`);
  const jar = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const res = await fetch(`${BASE}/api/auth/callback/credentials/`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar },
    body: new URLSearchParams({ email, password, csrfToken, redirect: "false", json: "true", callbackUrl: BASE }),
  });
  const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => /session-token=/.test(c));
  if (!session.length) throw new Error(`sign-in failed (${res.status})`);
  return session.join("; ");
}

async function api(cookie: string, route: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${route}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  const st = loadState();
  const deploy = await identity(BASE);
  if (!st.account) {
    const email = `qa+retrieval-replay-${Date.now()}@factorylm.com`;
    const password = randomBytes(18).toString("base64url");
    const res = await fetch(`${BASE}/api/auth/register/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: "Retrieval replay (Phase 0)" }),
    });
    const body = (await res.json().catch(() => ({}))) as { tenantId?: string };
    if (res.status !== 201 || !body.tenantId) throw new Error(`register failed ${res.status}`);
    st.account = { email, password, tenantId: body.tenantId };
    save(st);
    console.log(`registered ${email} tenant=${body.tenantId}`);
  }
  const cookie = await signIn(st.account.email, st.account.password);

  for (const m of corpus.manuals) {
    let rm = st.manuals[m.id];
    if (!rm) {
      const r = await api(cookie, "/api/equipment-notebooks/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: `${m.oem} ${m.id}`, identitySourceType: "user" }),
      });
      const nb = r.body.notebook as { id?: string; nodeId?: string } | undefined;
      if (r.status !== 201 || !nb?.id || !nb.nodeId) throw new Error(`create ${m.id} failed ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      rm = st.manuals[m.id] = { notebookId: nb.id, nodeId: nb.nodeId, docId: null };
      save(st);
      console.log(`${m.id}: project ${nb.id}`);
    }
    if (!rm.docId) {
      const pdf = await manualBytes(m, CACHE);
      if (!pdf.bytes) throw new Error(`${m.id}: ${pdf.problem}`);
      // curl, not fetch: Node's fetch abandons a response whose headers take > 300 s, and a
      // 440-page manual is extracted + chunked before the upload route answers.
      const tmp = path.join(CACHE, `upload-${m.filename}`);
      writeFileSync(tmp, pdf.bytes);
      const t0 = Date.now();
      const raw = execFileSync("curl", [
        "-sS", "--max-time", "1800", "-w", "\n%{http_code}", "-H", `cookie: ${cookie}`,
        "-F", `file=@${tmp};type=application/pdf;filename=${m.filename}`,
        `${BASE}/api/namespace/node/${encodeURIComponent(rm.nodeId)}/files/`,
      ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      const nl = raw.lastIndexOf("\n");
      let upBody: Record<string, unknown> = {};
      try { upBody = JSON.parse(raw.slice(0, nl)); } catch { upBody = { raw: raw.slice(0, 300) }; }
      const up = { status: Number(raw.slice(nl + 1)), body: upBody };
      if (up.status !== 201 || !up.body.uploadId || !up.body.indexed) {
        throw new Error(`${m.id}: upload ${up.status} indexed=${up.body.indexed} ${JSON.stringify(up.body).slice(0, 200)}`);
      }
      const docId = String(up.body.uploadId);
      const src = await api(cookie, `/api/equipment-notebooks/${rm.notebookId}/sources/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId, sourceRole: "manual" }),
      });
      if (src.status >= 300) throw new Error(`${m.id}: add source ${src.status}`);
      rm.docId = docId;
      save(st);
      console.log(`${m.id}: uploaded doc ${docId} chunks=${up.body.chunkCount} dup=${up.body.duplicate ?? false} ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }

  // Wait for full embedding coverage (read-only count on the owner connection).
  const db = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const deadline = Date.now() + EMBED_WAIT_MS;
    for (;;) {
      const { rows } = await db.query(
        `SELECT doc_id::text AS doc_id, count(*)::int AS chunks, count(embedding)::int AS embedded
           FROM knowledge_entries
          WHERE tenant_id = $1 AND ingest_route = 'v2' AND doc_id = ANY($2::uuid[])
          GROUP BY doc_id`,
        [st.account.tenantId, Object.values(st.manuals).map((x) => x.docId)],
      );
      let pending = 0;
      for (const [id, rm] of Object.entries(st.manuals)) {
        const row = rows.find((r) => r.doc_id === rm.docId);
        rm.chunks = row?.chunks ?? 0;
        rm.embedded = row?.embedded ?? 0;
        if (!rm.chunks || (rm.embedded ?? 0) < rm.chunks) pending++;
        void id;
      }
      save(st);
      console.log(`coverage: ${Object.entries(st.manuals).map(([id, x]) => `${id} ${x.embedded}/${x.chunks}`).join(" · ")}`);
      if (!pending) break;
      if (Date.now() > deadline) throw new Error(`embedding coverage incomplete after ${EMBED_WAIT_MS / 60_000} min`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  } finally {
    await db.end();
  }
  st.provisionedAt = new Date().toISOString();
  st.provisionedOn = deploy;
  save(st);
  console.log(`provisioned on ${deploy.gitSha.slice(0, 9)} — state ${STATE_PATH}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Notebook proof — the technician loop over HTTP, against a deployed Hub.
 *
 * register -> sign in -> create notebook -> upload a source -> attach it -> ask ->
 * parse the SSE frames -> assert what the answer actually contained.
 *
 * This is the HTTP-level sibling of tools/mobile-e2e (which drives a real emulator).
 * Use this one when the question is "does the SERVER behave", because it runs in
 * seconds, needs no Android toolchain, and hits the same canonical seam both clients
 * use: POST /api/equipment-notebooks/{id}/chat/.
 *
 * It deliberately does NOT read the database. Prod DB reads go through
 * .github/workflows/db-inspect.yml (environments doctrine hard rule #1); this script
 * asserts on what the technician can actually observe — the streamed frames.
 *
 * Usage:
 *   node tools/notebook-e2e/notebook_proof.mjs \
 *     --base https://app.factorylm.com \
 *     --email tester@example.test --password '...' \
 *     --pdf ./some-manual.pdf \
 *     --question "Which coil is published only after the reflash" \
 *     --expect-citation --expect-usage
 *
 * Reuse an existing notebook instead of creating one:
 *     --notebook <uuid> --doc <uuid>          (skips create/upload/attach)
 *
 * Exit codes: 0 pass · 1 assertion failed · 2 setup/transport failed.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const args = parseArgs(process.argv.slice(2));
const BASE = req("base").replace(/\/$/, "");
const EMAIL = req("email");
const PASSWORD = req("password");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
function req(name) {
  const v = args[name];
  if (typeof v !== "string" || !v) fail(2, `missing --${name}`);
  return v;
}
function fail(code, msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(code);
}
const log = (...a) => console.log(...a);

// --- cookie jar -------------------------------------------------------------
// NextAuth sign-in is a cookie flow; keeping our own jar avoids depending on a
// browser or on fetch's (absent) cookie handling.
const jar = new Map();
function stash(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/**
 * Every Hub API path here carries a TRAILING SLASH on purpose: the Hub
 * 308-redirects slashless paths, and a manual-redirect fetch then hands you the
 * redirect body instead of JSON. That failure surfaces as a JSON parse error a
 * long way from its cause.
 */
async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers || {}), cookie: cookieHeader() },
    });
  } catch (err) {
    fail(2, `${path} — transport error: ${err.message}`);
  }
  stash(res);
  return res;
}
const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// --- 1. account -------------------------------------------------------------
{
  const res = await api(
    "/api/auth/register/",
    json({ email: EMAIL, password: PASSWORD, name: "Notebook proof" }),
  );
  const body = await res.text();
  // 409 = the account already exists, which is the normal case on a re-run.
  if (res.status !== 201 && res.status !== 409) fail(2, `register -> ${res.status} ${body.slice(0, 200)}`);
  log(`register: ${res.status}${res.status === 409 ? " (existing account, fine)" : ""}`);
}

// --- 2. sign in -------------------------------------------------------------
const session = await (async () => {
  const csrfRes = await api("/api/auth/csrf/");
  const { csrfToken } = await csrfRes.json().catch(() => ({}));
  if (!csrfToken) fail(2, "no csrfToken — is this a Hub?");
  await api("/api/auth/callback/credentials/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: "true" }).toString(),
  });
  const res = await api("/api/auth/session/");
  const s = await res.json().catch(() => ({}));
  if (!s?.user?.tenantId) {
    fail(2, "sign-in produced no session — wrong password, or NEXTAUTH_URL does not match --base");
  }
  log(`session: tenant ${s.user.tenantId}`);
  return s;
})();

// --- 3. notebook + source ---------------------------------------------------
let notebookId = typeof args.notebook === "string" ? args.notebook : null;
let docId = typeof args.doc === "string" ? args.doc : null;

if (!notebookId) {
  // The display name must be unique: creating an equipment notebook mints a
  // kg_entities row keyed (tenant, type, name), so a repeated name 500s on the
  // unique constraint rather than returning a friendly error.
  const name = `NOTEBOOK PROOF ${Date.now()}`;
  const res = await api("/api/equipment-notebooks/", json({ displayName: name }));
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) fail(2, `create notebook -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  notebookId = body.notebook?.id ?? body.id;
  log(`notebook: ${notebookId} (${name})`);
}

if (!docId) {
  const pdf = req("pdf");
  const detail = await (await api(`/api/equipment-notebooks/${notebookId}/`)).json().catch(() => ({}));
  const nodeId = detail.notebook?.nodeId ?? detail.nodeId;
  if (!nodeId) fail(2, "notebook has no nodeId — cannot upload a source");

  const bytes = await readFile(pdf).catch((e) => fail(2, `cannot read --pdf: ${e.message}`));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), basename(pdf));
  const res = await api(`/api/namespace/node/${nodeId}/files/`, { method: "POST", body: form });
  const up = await res.json().catch(() => ({}));
  if (!up.uploadId) fail(2, `upload -> ${res.status} ${JSON.stringify(up).slice(0, 300)}`);
  docId = up.uploadId;
  log(`upload: indexed=${up.indexed} chunks=${up.chunkCount ?? "?"} doc=${docId}`);
  if (!up.indexed) fail(1, "source did not finish indexing — a turn now would answer without it");

  const attach = await api(
    `/api/equipment-notebooks/${notebookId}/sources/`,
    json({ docId, sourceRole: "manual" }),
  );
  if (attach.status !== 201) fail(2, `attach source -> ${attach.status}`);
  log("attach: 201");
}

// --- 4. ask -----------------------------------------------------------------
// sourceDocIds is REQUIRED: the route validates the doc set before retrieval and
// returns 422 no_sources_selected on an empty one. That validation is the
// tenant/notebook ownership boundary, so it is a feature, not an inconvenience.
const question = req("question");
const started = Date.now();
const res = await api(
  `/api/equipment-notebooks/${notebookId}/chat/`,
  json({ message: question, sourceDocIds: [docId] }),
);
if (res.status !== 200) fail(1, `chat -> ${res.status} ${(await res.text()).slice(0, 200)}`);
const raw = await res.text();
const elapsed = Date.now() - started;

const frames = [];
let answer = "";
for (const line of raw.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  const payload = line.slice(6);
  if (payload === "[DONE]") {
    frames.push({ kind: "[DONE]" });
    continue;
  }
  let obj;
  try {
    obj = JSON.parse(payload);
  } catch {
    continue;
  }
  if (obj.kind === "content") {
    answer += obj.content ?? "";
    continue;
  }
  frames.push(obj);
}

const kinds = frames.map((f) => f.kind);
const sources = frames.find((f) => f.kind === "sources");
const usage = frames.find((f) => f.kind === "usage");
const status = frames.find((f) => f.kind === "status");
const citations = sources?.citations ?? [];

log(`chat: 200 in ${elapsed} ms · frames ${kinds.join(" -> ")}`);
log(`status: ${status?.status ?? "(none)"} · citations: ${citations.length}`);
for (const c of citations) log(`  [${c.citationId}] ${c.sourceTitle} p.${c.page}`);
if (usage) {
  log(
    `usage: ${usage.provider} ${usage.model} ${usage.routeReason} · ` +
      `in=${usage.inputTokens} cached=${usage.cachedInputTokens ?? "-"} out=${usage.outputTokens} · ` +
      `$${usage.costUsdEstimate} · ${usage.status}`,
  );
}
log(`answer: ${answer.trim()}`);

// --- 5. assertions ----------------------------------------------------------
const problems = [];
// A truncated stream is what this ordering check exists to catch: the technician
// sees prose and assumes the turn completed.
if (kinds.at(-1) !== "[DONE]") {
  problems.push("stream did not end with [DONE] — the turn was interrupted, not answered");
}
if (!status) problems.push("no status frame");
if (args["expect-usage"] && !usage) {
  problems.push("no usage frame — the canonical seam is OFF on this deployment");
}
if (args["expect-citation"]) {
  if (citations.length === 0) problems.push("expected a citation, got none");
  if (citations.some((c) => c.docId !== docId)) {
    problems.push("a citation came from a document that was not the attached source");
  }
}
if (typeof args["expect-status"] === "string" && status?.status !== args["expect-status"]) {
  problems.push(`expected status ${args["expect-status"]}, got ${status?.status}`);
}
if (
  typeof args["expect-answer-contains"] === "string" &&
  !answer.toLowerCase().includes(args["expect-answer-contains"].toLowerCase())
) {
  problems.push(`answer did not contain ${JSON.stringify(args["expect-answer-contains"])}`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL: ${p}`);
  console.error(`\nNOTEBOOK_ID=${notebookId}\nDOC_ID=${docId}\nTENANT_ID=${session.user.tenantId}`);
  process.exit(1);
}
log(`\nPASS\nNOTEBOOK_ID=${notebookId}\nDOC_ID=${docId}\nTENANT_ID=${session.user.tenantId}`);

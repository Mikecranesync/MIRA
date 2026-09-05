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
 * It deliberately does NOT read the database for the single-user flow. Prod DB
 * reads go through .github/workflows/db-inspect.yml (environments doctrine hard
 * rule #1); this script asserts on what the technician can actually observe —
 * the streamed frames and what a reload (GET) shows.
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
 * Private history (two technicians, one shared notebook) — see README.md for
 * the full write-up. This scenario is the ONE deliberate exception to "no
 * database access": --db places a second test account into User A's tenant
 * (there is no self-service "join my colleague's tenant" HTTP endpoint), the
 * same way mira-hub/scripts/provision-beta-gate.ts mirrors a tenant. It never
 * reads application state back through --db — every assertion still comes
 * from the HTTP frames and GET responses, exactly like the rest of this file.
 *
 *   node tools/notebook-e2e/notebook_proof.mjs \
 *     --base http://localhost:3100 \
 *     --email tech-a@example.test --password '...' \
 *     --second-email tech-b@example.test --second-password '...' \
 *     --db "$NEON_DATABASE_URL" \
 *     --expect-private-history
 *
 * Exit codes: 0 pass · 1 assertion failed · 2 setup/transport failed.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const BASE = req("base").replace(/\/$/, "");
const EMAIL = req("email");
const PASSWORD = req("password");
// Rooted here (not lower in the file, near loadPgClient()) deliberately: this
// is a `const`, not a function declaration — it is NOT hoisted, and
// runPrivateHistoryScenario() can run as early as the `if` block a few dozen
// lines below. Declaring it after that call site would throw a
// "Cannot access before initialization" ReferenceError the first time --db is
// actually exercised.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_PACKAGE_JSON = path.resolve(__dirname, "..", "..", "mira-hub", "package.json");

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

// --- HTTP client --------------------------------------------------------------
// A "client" is a cookie jar + the api() fetch wrapper closed over it. NextAuth
// sign-in is a cookie flow; keeping our own jar avoids depending on a browser
// or on fetch's (absent) cookie handling. The single-user flow below uses
// exactly one client (`api`, unchanged in shape from before this file grew a
// second user); the private-history scenario opens an independent second one
// for User B so the two technicians' sessions never share a cookie jar.
function createClient() {
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
  return { api, jar };
}
const primary = createClient();
const api = primary.api;

const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// --- account / session helpers --------------------------------------------
// Extracted so the private-history scenario can register/sign in a SECOND
// user through its own client without duplicating this logic. `label` is
// empty for the primary (single-user) flow, so its log lines and failure
// messages are byte-for-byte identical to before this refactor.
async function registerAccount(apiFn, email, password, label = "") {
  const res = await apiFn("/api/auth/register/", json({ email, password, name: "Notebook proof" }));
  const body = await res.text();
  // 409 = the account already exists, which is the normal case on a re-run.
  if (res.status !== 201 && res.status !== 409) fail(2, `register${label} -> ${res.status} ${body.slice(0, 200)}`);
  log(`register${label}: ${res.status}${res.status === 409 ? " (existing account, fine)" : ""}`);
  return res.status;
}

async function signIn(apiFn, email, password, label = "") {
  const csrfRes = await apiFn("/api/auth/csrf/");
  const { csrfToken } = await csrfRes.json().catch(() => ({}));
  if (!csrfToken) fail(2, `no csrfToken${label} — is this a Hub?`);
  await apiFn("/api/auth/callback/credentials/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }).toString(),
  });
  const res = await apiFn("/api/auth/session/");
  const s = await res.json().catch(() => ({}));
  if (!s?.user?.tenantId) {
    fail(2, `sign-in produced no session${label} — wrong password, or NEXTAUTH_URL does not match --base`);
  }
  log(`session${label}: tenant ${s.user.tenantId}`);
  return s;
}

// --- SSE frame parsing --------------------------------------------------------
// Shared by the single-user "ask" step and the private-history scenario's
// zero-source asks, so both read the exact same frame contract.
function parseSseFrames(raw) {
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
  return { frames, answer };
}

// --- 0. pre-flight: the only destructive capability is checked before ANY HTTP
// call, so a refused --db never registers accounts or spends provider budget.
if (args["expect-private-history"]) {
  assertDisposableDbUrl(req("db"), BASE, { remoteOk: Boolean(args["db-remote-ok"]) });
  loadPgClient();
}

// --- 1. account -------------------------------------------------------------
await registerAccount(api, EMAIL, PASSWORD);

// --- 2. sign in -------------------------------------------------------------
const session = await signIn(api, EMAIL, PASSWORD);

if (args["expect-private-history"]) {
  await runPrivateHistoryScenario({ api, session });
} else {
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

  const { frames, answer } = parseSseFrames(raw);

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
}

// =============================================================================
// Private history (two users, one shared Equipment Notebook) — 086
// =============================================================================
//
// Proves the two things #3387-adjacent server change is FOR:
//   1. User A can create a general (zero-source, Mobile-shaped) turn on the
//      Notebook and reload it through the same GET Web uses.
//   2. User B — a second technician in the SAME tenant, using the SAME shared
//      Notebook — never sees User A's turn, and User A never sees User B's.
//
// The Notebook itself (manuals, evidence, asset identity) stays shared; only
// NEW chat turns are private to the technician who asked them
// (mira-hub/src/lib/equipment-notebooks.ts recordTurn/listTurns, migration
// 086_notebook_turn_owner.sql). Legacy (pre-086) turns have no owner and are
// `sharedLegacy: true` for everyone — this scenario only asks NEW questions,
// so it never has to reason about that case.

/**
 * The private-history scenario needs to move a SECOND test account into User
 * A's tenant. There is no self-service "join my colleague's tenant" HTTP
 * endpoint (by design — mira-hub/scripts/provision-beta-gate.ts does the same
 * kind of tenant mirroring for its own stranger-provisioning run), so this is
 * the one deliberate exception to "no database access" in this file: --db sets
 * up two real technicians sharing one tenant, exactly like an invited
 * teammate would look after accepting. It is never used to read back
 * application state to assert on — every assertion below still comes from
 * HTTP responses (chat frames, GET bodies), same as the rest of the file.
 * (`__dirname` / `HUB_PACKAGE_JSON` are declared up near the top of the file,
 * not here — see the comment on that declaration for why.)
 */

/**
 * `pg` is a dependency of mira-hub (mira-hub/package.json), not of this repo
 * root or of tools/notebook-e2e — and this repo has no root node_modules /
 * npm workspaces to hoist it there. Rather than add a second, duplicate `pg`
 * dependency (or require a NODE_PATH env var the caller must remember),
 * resolve it out of mira-hub's OWN install: createRequire() rooted at
 * mira-hub/package.json makes Node's CommonJS resolver start its node_modules
 * walk from mira-hub/, so `node tools/notebook-e2e/notebook_proof.mjs` run
 * from the repo root finds mira-hub/node_modules/pg regardless of this file's
 * own location or the caller's cwd. Lazy: only touched when --db is passed,
 * so the default single-user flow never needs mira-hub's node_modules at all.
 */
function loadPgClient() {
  let pg;
  try {
    pg = createRequire(HUB_PACKAGE_JSON)("pg");
  } catch (err) {
    fail(
      2,
      `--db needs the "pg" package from mira-hub/node_modules — run \`npm install\` (or bun install) in mira-hub/ first: ${err.message}`,
    );
  }
  const Client = pg?.Client;
  if (typeof Client !== "function") fail(2, `--db: resolved "pg" from mira-hub but it has no Client export`);
  return Client;
}

// Mirrors mira-hub/scripts/setup-integration-db.mjs's assertDisposable(), with
// one deliberate difference: this scenario's whole point is a dev/staging-shaped
// DB, so — unlike that script — "staging" is NOT refused here.
function isLocalHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  );
}

/** The `--db` write is the ONE destructive thing this harness can do, so the
 *  guard is fail-closed rather than pattern-based. Substring checks for
 *  "prod"/"prd" are NOT enough: real production Postgres URLs (Neon endpoint
 *  names, `/neondb`) contain neither. Rules, all required:
 *   1. MIRA_TEST_DB_CONFIRM=DISPOSABLE in the environment;
 *   2. the DB host is local/private (loopback, RFC1918, *.local) — a remote
 *      host is accepted ONLY with the explicit `--db-remote-ok` flag;
 *   3. never when `--base` is a production Hub host, and never when the DB
 *      host/path contains prod/prd/production (belt and braces). */
function assertDisposableDbUrl(urlText, baseText, { remoteOk = false } = {}) {
  // Function-local on purpose: this guard runs BEFORE the top-level flow, so it
  // must not depend on any top-level `const` (temporal dead zone).
  const PRODUCTION_HUB_HOSTS = new Set(["app.factorylm.com", "factorylm.com", "www.factorylm.com"]);
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    fail(2, "Set MIRA_TEST_DB_CONFIRM=DISPOSABLE in env to confirm --db is a disposable dev database.");
  }
  let url;
  try {
    url = new URL(urlText);
  } catch (err) {
    fail(2, `--db is not a valid connection URL: ${err.message}`);
  }
  let base;
  try {
    base = new URL(baseText);
  } catch {
    base = null;
  }
  if (base && PRODUCTION_HUB_HOSTS.has(base.hostname.toLowerCase())) {
    fail(2, `Refusing --db: --base ${base.hostname} is a production Hub. The two-user scenario never runs against production.`);
  }
  const lower = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (lower.includes("prod") || lower.includes("prd") || lower.includes("production")) {
    fail(2, `Refusing --db: host/path looks like production (${url.hostname}${url.pathname}).`);
  }
  if (!isLocalHost(url.hostname) && !remoteOk) {
    fail(
      2,
      `Refusing --db: ${url.hostname} is not a local/private host. A disposable REMOTE dev database needs the explicit --db-remote-ok flag (and is still refused for production Hub hosts).`,
    );
  }
}

/** The ONLY database write this file ever makes: move a second test account
 *  into User A's tenant, exactly like the effect of accepting a team invite
 *  (mira-hub/src/lib/users.ts hub_users.tenant_id / .role). Safety-checked by
 *  assertDisposableDbUrl() before this is ever called. */
async function placeSecondUserInTenant(dbUrl, email, tenantId) {
  const Client = loadPgClient();
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect().catch((err) => fail(2, `--db connect failed: ${err.message}`));
  try {
    await client.query(
      // The documented case is technician-to-technician: a freshly registered
      // account defaults to role 'owner', so set the role explicitly rather
      // than installing User B as a second owner.
      `UPDATE hub_users SET tenant_id = $1, role = 'technician' WHERE email_lower = lower($2)`,
      [tenantId, email],
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function createNotebookFor(apiFn, label = "") {
  const name = `NOTEBOOK PROOF ${Date.now()}`;
  const res = await apiFn("/api/equipment-notebooks/", json({ displayName: name }));
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) fail(2, `create notebook${label} -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  const id = body.notebook?.id ?? body.id;
  log(`notebook${label}: ${id} (${name})`);
  return id;
}

/** GET /api/equipment-notebooks/{id}/ as `apiFn`'s user — the same call Web
 *  makes on reload. A non-200 is pushed as a problem (not a hard fail): for
 *  User B this IS the assertion under test ("must be 200 — shared notebook,
 *  same tenant"), so it has to survive to the compact table, not abort early. */
async function getNotebookTurns(apiFn, notebookId, label, problems) {
  const res = await apiFn(`/api/equipment-notebooks/${notebookId}/`);
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) {
    problems.push(`GET notebook${label} -> ${res.status}, expected 200`);
    return [];
  }
  return Array.isArray(body.turns) ? body.turns : [];
}

/** POST a zero-source, general-mode question exactly as Mobile does
 *  (mode: "general", sourceDocIds: []) and parse the SSE frames. Frame-contract
 *  problems (missing [DONE], missing status) are pushed, not hard-failed: they
 *  are exactly the kind of assertion this scenario exists to make. */
async function askGeneral(apiFn, notebookId, question, label, problems) {
  const res = await apiFn(
    `/api/equipment-notebooks/${notebookId}/chat/`,
    json({ message: question, sourceDocIds: [], history: [], mode: "general" }),
  );
  if (res.status !== 200) fail(1, `chat${label} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  const raw = await res.text();
  const { frames, answer } = parseSseFrames(raw);
  const kinds = frames.map((f) => f.kind);
  const status = frames.find((f) => f.kind === "status");
  log(`chat${label}: 200 · frames ${kinds.join(" -> ")} · status ${status?.status ?? "(none)"}`);
  if (kinds.at(-1) !== "[DONE]") {
    problems.push(`chat${label} stream did not end with [DONE] — the turn was interrupted`);
  }
  if (!status) problems.push(`chat${label} produced no status frame — the turn may not have persisted`);
  return { frames, answer, status };
}

async function runPrivateHistoryScenario({ api: apiA, session: sessionA }) {
  const secondEmail = req("second-email");
  const secondPassword = req("second-password");
  const dbUrl = req("db");
  assertDisposableDbUrl(dbUrl, BASE, { remoteOk: Boolean(args["db-remote-ok"]) });
  loadPgClient(); // fail fast if mira-hub/node_modules/pg is missing, before spending any HTTP calls

  const problems = [];
  const notebookId = typeof args.notebook === "string" ? args.notebook : await createNotebookFor(apiA, " (A)");

  // Zero-source questions, exactly as Mobile sends them — see
  // mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts, `const general
  // = body.mode === "general"` (line ~464) and the `no_sources_selected` /
  // general carve-out just below it (line ~530).
  const questionA = "What's the safe first check if this machine won't start?";
  const questionB = "Which sensor would you check first if the belt keeps slipping?";

  // --- a. User A asks, then reloads (this is what Web does) -------------------
  await askGeneral(apiA, notebookId, questionA, " (A)", problems);
  const turnsAAfterOwn = await getNotebookTurns(apiA, notebookId, " (A, reload)", problems);
  const aTurn = turnsAAfterOwn.find((t) => t.question === questionA);
  if (!aTurn) {
    problems.push("User A's reload (GET) did not show A's own question — Mobile-asked turn did not survive to Web");
  } else {
    if (aTurn.sharedLegacy !== false) {
      problems.push(`User A's turn had sharedLegacy=${aTurn.sharedLegacy}, expected false`);
    }
    if (!aTurn.ownerUserId) {
      problems.push("User A's turn had no ownerUserId — the turn was not attributed to a technician");
    }
  }

  // --- b. User B: own jar, own account, placed into A's tenant via --db -------
  const B = createClient();
  await registerAccount(B.api, secondEmail, secondPassword, " (B)");
  await signIn(B.api, secondEmail, secondPassword, " (B, pre-placement)");
  await placeSecondUserInTenant(dbUrl, secondEmail, sessionA.user.tenantId);
  log(`db: placed ${secondEmail} into tenant ${sessionA.user.tenantId} (User A's tenant)`);
  // Re-sign-in is required, not cosmetic: mira-hub/src/auth.ts's jwt() callback
  // only copies `user.tenantId` onto the token when `user` is present — i.e. on
  // the initial credentials authorize() call, which re-reads hub_users fresh
  // (findUserByEmail). The cookie from the pre-placement sign-in still encodes
  // B's OLD tenant until B signs in again.
  const sessionB = await signIn(B.api, secondEmail, secondPassword, " (B, post-placement)");
  if (sessionB.user.tenantId !== sessionA.user.tenantId) {
    problems.push(
      `User B's session tenant is ${sessionB.user.tenantId} after placement, expected ${sessionA.user.tenantId} (the UPDATE or the re-sign-in did not take)`,
    );
  }

  // --- c. User B reads the shared notebook: must see it, must not see A's turn
  const turnsBBeforeOwn = await getNotebookTurns(B.api, notebookId, " (B, before B's own turn)", problems);
  if (turnsBBeforeOwn.some((t) => t.question === questionA)) {
    problems.push("User B's GET showed User A's question before B ever asked anything — private history leaked");
  }

  await askGeneral(B.api, notebookId, questionB, " (B)", problems);
  const turnsBAfterOwn = await getNotebookTurns(B.api, notebookId, " (B, reload)", problems);
  if (!turnsBAfterOwn.some((t) => t.question === questionB)) {
    problems.push("User B's reload (GET) did not show B's own question");
  }
  if (turnsBAfterOwn.some((t) => t.question === questionA)) {
    problems.push("User B's reload (GET) showed User A's question — private history leaked");
  }

  const turnsAFinal = await getNotebookTurns(apiA, notebookId, " (A, final)", problems);
  if (!turnsAFinal.some((t) => t.question === questionA)) {
    problems.push("User A's final GET no longer shows A's own question");
  }
  if (turnsAFinal.some((t) => t.question === questionB)) {
    problems.push("User A's final GET showed User B's question — private history leaked the other direction");
  }

  // --- d. compact table of what each user saw ----------------------------------
  const seen = (turns, q) => turns.some((t) => t.question === q);
  log("\nprivate-history table (who saw what, final state):");
  log(`  notebook ${notebookId}   tenant ${sessionA.user.tenantId}`);
  log(`  user  asked                                                   sees-own  sees-other`);
  log(
    `  A     ${questionA.padEnd(58)} ${String(seen(turnsAFinal, questionA)).padEnd(9)} ${seen(turnsAFinal, questionB)}`,
  );
  log(
    `  B     ${questionB.padEnd(58)} ${String(seen(turnsBAfterOwn, questionB)).padEnd(9)} ${seen(turnsBAfterOwn, questionA)}`,
  );

  if (problems.length) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    console.error(`\nNOTEBOOK_ID=${notebookId}\nTENANT_ID=${sessionA.user.tenantId}`);
    process.exit(1);
  }
  log(`\nPASS (private history)\nNOTEBOOK_ID=${notebookId}\nTENANT_ID=${sessionA.user.tenantId}`);
}

#!/usr/bin/env node
/**
 * Attach the CV-101 print set to a notebook, through the real ingest door.
 *
 * Usage:
 *   node tools/dogfood/seed-cv101-notebook-sources.mjs \
 *     --base https://app.factorylm.com \
 *     --email you@example.test --password '…' \
 *     --notebook <uuid>
 *
 * Exit codes: 0 every file indexed · 1 a file did not index · 2 setup failed.
 *
 * WHY A SCRIPT AND NOT A SQL SEED. Retrieval filters `ingest_route = 'v2'`
 * (`manual-rag.ts:506,542`), a value only the real parser writes
 * (`node-knowledge-ingest.ts:406`), and `apply-seeds.yml` already notes that
 * SQL-seeded chunks land with `embedding = NULL`. A seeded row would sit in the
 * table looking attached and never be citable — the worst outcome, because it
 * fails as silence rather than as an error.
 *
 * WHY NOT THE ASSET PAGE. `validateTargetTx` returns `nodeId: null` for
 * `cmms_asset` (`workspace-files.ts:396-402`) and `api/files/route.ts` gates
 * indexing on having a node, so a file uploaded against an asset parks and
 * never becomes citable. That is what mobile's asset Detail upload does today.
 * The notebook target is the door that parks bytes, links them, resolves the
 * node, indexes, and writes the source row.
 *
 * The script never sends `matchState`: `sources/route.ts` forces
 * `user_confirmed` server-side and rejects a client-minted trust level.
 */
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const BASE = String(args.base || "").replace(/\/$/, "");
const EMAIL = String(args.email || "");
const PASSWORD = String(args.password || "");
const NOTEBOOK = String(args.notebook || "");
if (!BASE || !EMAIL || !PASSWORD || !NOTEBOOK) {
  console.error("usage: --base <url> --email <e> --password <p> --notebook <uuid>");
  process.exit(2);
}

/** The CV-101 print set. Order matters only for readable output. */
const FILES = [
  "docs/onboarding/cv-101-evidence/cv101_print.pdf",
  "docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf",
  "plc/conv_simple_electrical/sheets/CV-101_print_set.pdf",
];

const REPO = resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const jar = new Map();
function stash(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function api(path, init = {}) {
  // Trailing slashes are load-bearing: the Hub 308-redirects slashless paths
  // and a manual-redirect fetch then parses the redirect body as JSON.
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers || {}), cookie: cookieHeader() },
  });
  stash(res);
  return res;
}

// --- sign in ---------------------------------------------------------------
const csrf = await (await api("/api/auth/csrf/")).json().catch(() => ({}));
if (!csrf?.csrfToken) {
  console.error("FAIL: no csrfToken — is --base a Hub?");
  process.exit(2);
}
await api("/api/auth/callback/credentials/", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: EMAIL, password: PASSWORD, json: "true" }).toString(),
});
const session = await (await api("/api/auth/session/")).json().catch(() => ({}));
if (!session?.user?.tenantId) {
  console.error("FAIL: sign-in produced no session");
  process.exit(2);
}
console.log(`session: tenant ${session.user.tenantId}`);
console.log(`notebook: ${NOTEBOOK}`);

// --- attach ----------------------------------------------------------------
let failures = 0;
for (const rel of FILES) {
  const path = resolve(REPO, rel);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (e) {
    console.error(`FAIL ${rel}: cannot read (${e.message})`);
    failures++;
    continue;
  }

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), basename(rel));
  form.append(
    "targets",
    JSON.stringify([{ targetType: "equipment_notebook", targetId: NOTEBOOK, role: "manual" }]),
  );

  const res = await api("/api/files/", { method: "POST", body: form });
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* fall through to the indexed check */
  }

  // A bare 200 is NOT success. The door returns ok:true with indexed:false when
  // the bytes parked but never became citable — the exact failure this script
  // exists to catch, because it is invisible until a question goes unanswered.
  if (body.indexed === true) {
    console.log(`OK   ${rel} — chunks=${body.chunkCount ?? "?"} file=${body.fileId ?? "?"}`);
  } else {
    console.error(
      `FAIL ${rel} — HTTP ${res.status} indexed=${String(body.indexed)} ${body.error ?? ""}`.trim(),
    );
    failures++;
  }
}

// --- verify what the notebook now sees -------------------------------------
// The sources sub-route is POST-only (a GET returns 405); the notebook detail
// endpoint is where membership is read. Getting this wrong made the seeder
// silently skip its own verification.
const detail = await (await api(`/api/equipment-notebooks/${NOTEBOOK}/`)).json().catch(() => null);
const sources = detail;
if (Array.isArray(sources?.sources)) {
  console.log(`\nnotebook sources (${sources.sources.length}):`);
  for (const s of sources.sources) {
    console.log(`  ${s.filename ?? "(unnamed)"} — docId=${s.docId} match=${s.matchState} role=${s.sourceRole ?? "-"} ready=${s.readiness?.canChat ?? "?"}`);
  }
}

if (failures) {
  console.error(`\n${failures} file(s) did not index. The notebook is NOT ready to answer from them.`);
  process.exit(1);
}
console.log("\nPASS — every file indexed and attached.");

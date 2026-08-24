#!/usr/bin/env node
/**
 * Attach the CV-101 print set to CV-101's notebook, through the real ingest door.
 *
 * Usage:
 *   MIRA_HUB_PASSWORD='…' node tools/dogfood/seed-cv101-notebook-sources.mjs \
 *     --base https://app.factorylm.com --email you@example.test [--tag CV-101]
 *
 * Exit codes: 0 every file indexed AND citable · 1 verification failed · 2 setup failed.
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
 *
 * THREE THINGS THIS SCRIPT REFUSES TO DO, each of which it used to do:
 *
 *  1. Take the notebook id on trust. `--notebook <uuid>` pointed the upload at
 *     ANY notebook in the tenant, so a stale id from a previous run silently
 *     seeded CV-101's prints into a different machine's notebook — and then
 *     reported PASS. The notebook is now RESOLVED from the tag through the
 *     canonical route, never supplied.
 *  2. Take the password on the command line. `--password` puts a live
 *     credential in the process table and in shell history.
 *  3. Take an arbitrary base URL. `--base` decided where the login and the PDFs
 *     were sent; a typo (or a paste) shipped both to whatever host was named.
 *
 * And the PASS line now means what it says — see verification, below.
 */
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1]]);
    return acc;
  }, []),
);

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

// --- credential ------------------------------------------------------------
// Environment only. A password in argv is readable from the process table by
// any local user and is written to shell history verbatim.
if (args.password) {
  die(
    "REFUSED: --password puts a live credential in the process table and your shell history.\n" +
      "Pass it as an environment variable instead:\n" +
      "  MIRA_HUB_PASSWORD='…' node tools/dogfood/seed-cv101-notebook-sources.mjs …\n" +
      "The one you just typed is already in history — rotate it.",
  );
}
const PASSWORD = process.env.MIRA_HUB_PASSWORD || "";

// --- destination -----------------------------------------------------------
// This script sends a password and customer PDFs. Where it sends them is not a
// free parameter. Loopback is allowed because nothing leaves the machine.
const ALLOWED_HOSTS = new Set(["app.factorylm.com", "stg.factorylm.com"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function checkedBase(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return die(`REFUSED: --base is not a URL: ${raw}`);
  }
  const loopback = LOOPBACK.has(u.hostname);
  if (u.protocol !== "https:" && !loopback) {
    return die(`REFUSED: --base must be https (got ${u.protocol}//) — this request carries a password.`);
  }
  if (!ALLOWED_HOSTS.has(u.hostname) && !loopback) {
    return die(
      `REFUSED: ${u.hostname} is not a known Hub.\n` +
        `Allowed: ${[...ALLOWED_HOSTS].join(", ")}, or loopback for local dev.`,
    );
  }
  return u.origin;
}

if (args.notebook) {
  die(
    "REFUSED: --notebook is no longer accepted. It pointed this upload at any notebook in\n" +
      "the tenant, so a stale id seeded CV-101's prints into another machine and still\n" +
      "printed PASS. The notebook is resolved from --tag through the canonical route.",
  );
}

const BASE = checkedBase(String(args.base || ""));
const EMAIL = String(args.email || "");
const TAG = String(args.tag || "CV-101");
if (!EMAIL) die("usage: --base <https url> --email <e> [--tag CV-101]   (password via MIRA_HUB_PASSWORD)");
if (!PASSWORD) die("FAIL: MIRA_HUB_PASSWORD is not set.");
if (!/^[A-Za-z0-9_-]{1,64}$/.test(TAG)) die(`FAIL: --tag ${TAG} is not a valid asset tag.`);

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
const json = async (res) => res.json().catch(() => ({}));
const POST = (b) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

// --- sign in ---------------------------------------------------------------
const csrf = await json(await api("/api/auth/csrf/"));
if (!csrf?.csrfToken) die("FAIL: no csrfToken — is --base a Hub?");
await api("/api/auth/callback/credentials/", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: EMAIL, password: PASSWORD, json: "true" }).toString(),
});
const session = await json(await api("/api/auth/session/"));
if (!session?.user?.tenantId) die("FAIL: sign-in produced no session");
console.log(`session: tenant ${session.user.tenantId}`);

// --- resolve the machine, then ITS notebook --------------------------------
// Tag → asset → the asset's own notebook. Every hop is the route the phone
// uses, so a notebook that this resolution cannot reach is one the technician
// cannot reach either.
const assetRes = await api(`/api/assets/by-tag/${encodeURIComponent(TAG)}/`);
const asset = await json(assetRes);
if (assetRes.status !== 200 || !asset?.id) {
  die(`FAIL: no asset tagged ${TAG} in tenant ${session.user.tenantId} (HTTP ${assetRes.status}).`, 1);
}
console.log(`asset:    ${TAG} → ${asset.id}${asset.name ? ` (${asset.name})` : ""}`);

const nbRes = await api(`/api/assets/${asset.id}/notebook/`, POST({ selectedVia: "asset_picker" }));
const nbBody = await json(nbRes);
const NOTEBOOK = nbBody?.notebook?.id;
if (!NOTEBOOK) die(`FAIL: could not open the notebook for ${TAG} (HTTP ${nbRes.status}).`, 1);
console.log(`notebook: ${NOTEBOOK}${nbBody.created ? " (created)" : ""}`);

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
  const body = await json(res);

  // A bare 200 is NOT success, and neither is `indexed:true` alone. The door
  // returns indexed:true with sourcesSynced:false when the chunks exist but the
  // notebook never got a source row — the file is citable by the corpus and
  // invisible to this notebook. Both must hold.
  if (body.indexed === true && body.sourcesSynced === true) {
    console.log(`OK   ${rel} — chunks=${body.chunkCount ?? "?"} file=${body.fileId ?? "?"}`);
  } else {
    console.error(
      `FAIL ${rel} — HTTP ${res.status} indexed=${String(body.indexed)} ` +
        `sourcesSynced=${String(body.sourcesSynced)} ${body.error ?? ""}`.trim(),
    );
    failures++;
  }
}

// --- verify what the notebook now sees -------------------------------------
// The upload response describes what the DOOR did. This block asserts what the
// NOTEBOOK now holds, which is the only thing a question can retrieve from.
// The sources sub-route is POST-only (a GET returns 405); the notebook detail
// endpoint is where membership is read.
const detail = await json(await api(`/api/equipment-notebooks/${NOTEBOOK}/`));
const sources = Array.isArray(detail?.sources) ? detail.sources : [];
console.log(`\nnotebook sources (${sources.length}):`);
for (const s of sources) {
  console.log(
    `  ${s.filename ?? "(unnamed)"} — docId=${s.docId} match=${s.matchState} ` +
      `role=${s.sourceRole ?? "-"} ready=${s.readiness?.canChat ?? "?"}`,
  );
}

for (const rel of FILES) {
  const want = basename(rel);
  const row = sources.find((s) => s.filename === want);
  if (!row) {
    console.error(`MISSING ${want} — uploaded but not a source of this notebook.`);
    failures++;
    continue;
  }
  const bad = [];
  if (row.sourceRole !== "manual") bad.push(`role=${row.sourceRole ?? "-"} (want manual)`);
  if (row.matchState !== "user_confirmed") bad.push(`match=${row.matchState} (want user_confirmed)`);
  if (row.readiness?.canChat !== true) bad.push(`canChat=${row.readiness?.canChat} (want true)`);
  if (bad.length) {
    console.error(`NOT CITABLE ${want} — ${bad.join(", ")}`);
    failures++;
  }
}

if (failures) {
  console.error(`\n${failures} problem(s). The notebook is NOT ready to answer from these prints.`);
  process.exit(1);
}
console.log(`\nPASS — every file indexed, attached to ${TAG}'s notebook, and citable.`);

#!/usr/bin/env node
/**
 * "Phone-ready" gate — the ONLY thing entitled to call a published bundle ready.
 *
 * WHY THIS EXISTS. Canary 1.1.8 was published, byte-verified, signature-valid and
 * fingerprint-matched, and was called ready for a handset test. It was not: the
 * client does not fetch `updates.factorylm.com/manifest.canary.json` — the URL that
 * was verified — it fetches the session-gated Hub route, which answered 308 then
 * 401, so no device could ever be offered the bundle. Every check run was true and
 * none of them was the one that mattered.
 *
 * The lesson is narrow and mechanical: verifying the PUBLISH path says nothing
 * about whether the CLIENT can ask for the bundle. So this probe speaks only the
 * client's contract — same path, same headers, same credential requirement.
 *
 * FAIL-CLOSED. Without a session this cannot prove readiness, so it exits non-zero
 * and says so. "Could not check" must never render as "ready"; that equivalence is
 * the whole bug this file guards against.
 *
 * Usage:
 *   OTA_PROBE_COOKIE='<session cookie>' node scripts/ota-readiness-probe.mjs \
 *     --channel canary --fingerprint dafaba3f19d380c4 [--expect-bundle 1.1.8-a36c63bf]
 *
 * Exit codes:  0 ready · 1 NOT ready (endpoint reachable, contract unmet) · 2 undecidable
 */

const API_BASE = process.env.OTA_PROBE_BASE || "https://app.factorylm.com";
// Must match MANIFEST_PATH in src/lib/live-update.ts, trailing slash included.
const MANIFEST_PATH = "/api/mobile/live-update/manifest/";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const channel = arg("channel", "canary");
const fingerprint = arg("fingerprint");
const expectBundle = arg("expect-bundle");
const cookie = process.env.OTA_PROBE_COOKIE || "";

const fail = (code, msg) => {
  console.error(`${code === 2 ? "UNDECIDABLE" : "NOT READY"}: ${msg}`);
  process.exit(code);
};

if (!fingerprint) fail(2, "--fingerprint is required; it is half the client's contract.");
if (!cookie) {
  fail(
    2,
    "OTA_PROBE_COOKIE is not set. The manifest route is session-gated, so without a\n" +
      "  session this probe cannot distinguish 'not ready' from 'not checked'. It refuses\n" +
      "  to guess: absence of proof is not readiness.",
  );
}

const url = `${API_BASE}${MANIFEST_PATH}?channel=${encodeURIComponent(channel)}&fingerprint=${encodeURIComponent(fingerprint)}`;

// redirect: manual — a 308 means the client is not using the canonical path and is
// paying a redirect hop on every check. Following it would hide that.
const res = await fetch(url, {
  headers: { accept: "application/json", cookie },
  redirect: "manual",
}).catch((e) => fail(2, `transport failure, cannot decide: ${e}`));

if (res.status >= 300 && res.status < 400) {
  fail(1, `${res.status} redirect to ${res.headers.get("location")} — path is not canonical.`);
}
if (res.status === 401) {
  fail(1, "401 Unauthorized — the client cannot authenticate to the manifest route.\n  This is the exact failure that made 1.1.8 undeliverable.");
}
if (res.status !== 200) fail(1, `HTTP ${res.status} — the route's contract says only a malformed request gets a 4xx.`);

let m;
try {
  m = await res.json();
} catch (e) {
  fail(1, `200 but the body is not JSON: ${e}`);
}

// A 200 with no downloadUrl is the route's documented "no update" — correct
// behaviour, but NOT phone-ready for a bundle we believe is published.
if (!m.downloadUrl || !m.bundleId) {
  fail(1, "200 but no downloadUrl/bundleId — the route is answering 'no update'.\n  Nothing would be offered to a handset.");
}
for (const field of ["checksum", "signature", "nativeFingerprint"]) {
  if (!m[field]) fail(1, `manifest is missing ${field}; the device would refuse it.`);
}
if (m.nativeFingerprint !== fingerprint) {
  fail(1, `fingerprint mismatch: shell ${fingerprint} vs manifest ${m.nativeFingerprint}.\n  The device refuses this BEFORE downloading.`);
}
if (!String(m.downloadUrl).startsWith("https://")) fail(1, `downloadUrl is not https: ${m.downloadUrl}`);
if (expectBundle && m.bundleId !== expectBundle) {
  fail(1, `expected bundle ${expectBundle}, route offers ${m.bundleId}.`);
}

console.log("PHONE-READY");
console.log(`  route      : 200 at the canonical path, no redirect`);
console.log(`  channel    : ${m.channel ?? channel}`);
console.log(`  bundleId   : ${m.bundleId}`);
console.log(`  fingerprint: ${m.nativeFingerprint} (matches the shell)`);
console.log(`  downloadUrl: ${m.downloadUrl}`);
console.log("\nThis proves the client can be OFFERED the bundle. It does not prove the");
console.log("download, signature check, or restart succeed on a real handset — that");
console.log("still requires: Check now -> Update ready -> Restart -> About shows the id.");

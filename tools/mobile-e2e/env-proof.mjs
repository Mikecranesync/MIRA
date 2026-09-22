#!/usr/bin/env node
// Prove which BACKEND the installed MIRA app on the attached device talks to,
// from inside the running app — package, versionCode, the flavor's own
// BuildConfig.getApiBase(), and the git SHA that backend reports. This is the
// device-side half of the retrieval acceptance contract: the server-side
// scenarios prove the Hub; this proves the phone reaches THAT Hub and no other.
//
//   MIRA_PKG=com.factorylm.mira.staging python3 tools/mobile-e2e/device.py cdp   # forwards tcp:9222
//   MIRA_PKG=com.factorylm.mira.staging node tools/mobile-e2e/env-proof.mjs [--expect-host app-staging.factorylm.com]
//
// Exit 0 only when the app's apiBase host equals --expect-host (default
// app-staging.factorylm.com) AND the backend answered /api/version/. Prints one
// JSON line (no cookies, no tokens). DEBUG builds only (WebView devtools).
import { execSync } from "node:child_process";
import { CDP } from "./cdp.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length));
const expectHost = args["expect-host"] ?? "app-staging.factorylm.com";
const pkg = process.env.MIRA_PKG ?? "com.factorylm.mira.staging";
const serial = process.env.ANDROID_SERIAL ? `-s ${process.env.ANDROID_SERIAL}` : "";
const adb = (c) => execSync(`adb ${serial} shell ${c}`, { encoding: "utf8" }).trim();

const dump = adb(`dumpsys package ${pkg}`);
const versionCode = /versionCode=(\d+)/.exec(dump)?.[1] ?? null;
const versionName = /versionName=([^\s]+)/.exec(dump)?.[1] ?? null;

const c = await CDP.attach();
const probe = await c.evaluate(async () => {
  const C = window.Capacitor;
  const out = { platform: C?.getPlatform?.(), native: C?.isNativePlatform?.() };
  try {
    out.apiBase = (await C.Plugins.BuildConfig.getApiBase()).apiBase;
    const dl = await C.Plugins.BuildConfig.getDeepLinkConfig();
    out.deepLinkHost = dl.host;
    out.scheme = dl.scheme;
  } catch (e) {
    out.buildConfigError = String(e);
  }
  try {
    const r = await C.Plugins.CapacitorHttp.request({ url: out.apiBase + "/api/version/", method: "GET" });
    out.backend = { status: r.status, gitSha: r.data?.gitSha, version: r.data?.version };
  } catch (e) {
    out.backendError = String(e);
  }
  return out;
});
await c.close();

const host = (() => { try { return new URL(probe.apiBase ?? "").hostname; } catch { return null; } })();
const ok = host === expectHost && probe.backend?.status === 200 && Boolean(probe.backend?.gitSha);
console.log(JSON.stringify({ ok, package: pkg, versionCode, versionName, apiBase: probe.apiBase ?? null, apiHost: host, expectHost, deepLinkHost: probe.deepLinkHost ?? null, scheme: probe.scheme ?? null, backend: probe.backend ?? null, error: probe.buildConfigError ?? probe.backendError ?? null }));
process.exit(ok ? 0 : 1);

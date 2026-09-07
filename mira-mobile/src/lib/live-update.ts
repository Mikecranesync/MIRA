/**
 * Signed OTA web-bundle updates (ADR-0034 amendment, 2026-08-24).
 *
 * WHAT THIS IS AND IS NOT
 * This ships HTML/CSS/JS only. It never downloads native code, never changes a
 * native plugin, and never points the WebView at a remote origin — the bundle is
 * unpacked into app-private storage and served from the SAME local origin, so
 * `server.url` stays unset and `allowNavigation` stays empty. Native changes go
 * through Firebase App Distribution / Play, and the release workflow fails
 * closed if a diff touches native sources.
 *
 * THE FOUR THINGS THAT MAKE IT SAFE
 *   1. HTTPS, FactoryLM-controlled endpoint only.
 *   2. SHA-256 checksum, enforced by the plugin.
 *   3. RSA signature verified against a public key COMPILED INTO THE APK. An
 *      attacker who owns the CDN still cannot ship code — this is the property
 *      that makes a remote bundle acceptable at all.
 *   4. A native compatibility fingerprint: a bundle built against native code
 *      this shell does not have is refused BEFORE download, not after it breaks.
 *
 * AND THE ONE THAT MAKES IT SURVIVABLE
 * `ready()` is called at startup before anything else. If a bundle fails to
 * reach it — white screen, boot crash, bad import — the native layer rolls back
 * to the previous working bundle on the next launch. The packaged APK bundle is
 * the permanent floor and is always recoverable.
 */
import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import { API_BASE, ApiError, request, withAuthEventsSuppressed } from "../api/client";

/** The canonical, session-gated manifest route. The trailing slash is the
 *  canonical form; without it the server answers 308 and the redirect hop is
 *  pure latency. Path only — the origin and the cookie jar belong to
 *  `api/client`, which is the single owner of native HTTP. */
export const MANIFEST_PATH = "/api/mobile/live-update/manifest/";
/** Retained for callers/tests that reference the absolute URL. */
export const OTA_MANIFEST_URL = `${API_BASE}${MANIFEST_PATH}`;
const MANIFEST_TIMEOUT_MS = 15_000;

export type OtaChannel = "canary" | "production";

/**
 * The native compatibility fingerprint.
 *
 * A web bundle is only safe to run on a shell that has the native plugins it
 * calls. Filenames and version labels lie — a bundle can be rebuilt with the
 * same version string after a plugin was added. So the build stamps a hash of
 * (Capacitor major + every native plugin at its exact version) into the
 * manifest, and the shell refuses anything whose fingerprint is not its own.
 *
 * Injected at build time by `scripts/ota-bundle.mjs` (Vite `define`), so it is
 * computed from the SAME dependency set that produced the bundle rather than
 * being maintained by hand.
 */
declare const __FLM_NATIVE_FINGERPRINT__: string | undefined;

// Read the BARE identifier, not `globalThis.__FLM_NATIVE_FINGERPRINT__`.
// Vite's `define` substitutes standalone identifiers; it does not rewrite a
// property access, so the globalThis form was never replaced and every build
// silently shipped "unset" — verified on the installed 1.0.1(2) APK and
// reproduced with a clean `vite build` on main. A shell whose fingerprint is
// "unset" refuses every correctly-stamped bundle (see checkForUpdate below),
// which disables OTA entirely. `typeof` keeps this safe when nothing defined it
// (plain `vitest`, `vite dev` without the define).
export const NATIVE_FINGERPRINT: string =
  typeof __FLM_NATIVE_FINGERPRINT__ !== "undefined" ? __FLM_NATIVE_FINGERPRINT__ : "unset";

export type OtaState = {
  /** Bundle id currently executing ("packaged" when running the APK's own copy). */
  currentBundleId: string;
  channel: OtaChannel;
  lastCheckedAt: string | null;
  lastResult: string | null;
  /** Downloaded, verified, and staged for the next restart. */
  pendingBundleId: string | null;
};

const CHANNEL_KEY = "flm.ota.channel";
const LAST_CHECK_KEY = "flm.ota.lastCheck";
const LAST_RESULT_KEY = "flm.ota.lastResult";

/**
 * Manifest contract (what a FactoryLM endpoint must return).
 *
 * `{}` — or any body without `downloadUrl` — means NO UPDATE, explicitly. A
 * missing/!ok response is also no-update: an unreachable update server must
 * leave the installed app working, never block startup.
 */
export type OtaManifest = {
  bundleId: string;
  downloadUrl: string;
  checksum: string;
  signature: string;
  channel: OtaChannel;
  /** Must equal this shell's NATIVE_FINGERPRINT or the bundle is refused. */
  nativeFingerprint: string;
  releaseSha: string;
  releasedAt: string;
};

/**
 * Called FIRST at startup, before any network or API initialisation.
 *
 * Why first: this is the signal that says "the bundle booted". Anything before
 * it — an API call, a store read — can fail on a bad bundle and prevent the
 * confirmation, which turns a recoverable rollback into a phone that boots to
 * nothing. Cheap, synchronous-ish, and unconditional.
 */
export async function confirmBundleReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LiveUpdate.ready();
  } catch (e) {
    // Never let this throw into startup: failing to CONFIRM is survivable (the
    // native layer rolls back next launch); failing to START is not.
    console.warn("[ota] ready() failed", e);
  }
}

/** True when it is safe to swap the bundle out from under the technician. */
export type BusyProbe = () => Promise<boolean> | boolean;

/**
 * Fetch → verify → stage. Never applies the bundle; never reloads.
 *
 * Returns the staged bundle id, or null for "nothing to do". The caller decides
 * when to surface it, and only the technician decides when to restart — an
 * update that reloads mid-diagnosis is a worse defect than the one it fixes.
 */
// Keyed on the strings the plugin ACTUALLY emits, read out of
// @capawesome/capacitor-live-update's Android sources (the authoritative side —
// that is the code that runs on the handset). The previous version of this
// classifier was written against invented messages, so the one message a real
// failed download produces, "Bundle could not be downloaded.", matched no rule
// and fell through to `verify_failed` — reporting a bad minute on the network as
// an integrity failure, which is the exact defect this function exists to prevent.
//
// Order matters: the specific plugin phrases come first, generic shapes after, so
// a message this table does not know still lands somewhere sensible.
const DOWNLOAD_FAILURE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Trust — the bytes are not what the manifest promised.
  [/checksum mismatch/, "checksum_mismatch"],
  [/failed to calculate checksum/, "verify_failed"], // could not check ≠ mismatched
  [/signature verification failed/, "signature_invalid"],
  [/does not contain a signature/, "unsigned_bundle"],
  [/invalid public key/, "signature_invalid"],
  // Policy — the server or the shell refused, nothing is wrong with the bytes.
  [/is blocked and will not be downloaded/, "bundle_blocked"],
  [/unauthorized\./, "channel_unauthorized"],
  // Transport — transient, retry later, never a trust event.
  [/bundle could not be downloaded/, "download_failed"],
  [/request timed out/, "download_failed"],
  // Payload shape.
  [/does not contain an index\.html/, "bundle_malformed"],
  // Concurrency / duplicates.
  [/sync is already in progress/, "busy"],
  [/already exists|duplicate/, "duplicate_bundle"],
  [/an unknown error has occurred/, "unknown_error"],
  // Generic shapes, for anything the plugin adds that this table has not learned.
  [/network|socket|connection|unreachable|dns|econn|offline|timeout|timed out/, "download_failed"],
  [/checksum|digest|sha-?256|hash/, "checksum_mismatch"],
  [/signature|signed|public key/, "signature_invalid"],
];

/**
 * Distinguish the failure modes the plugin reports through one rejected promise.
 * Checksum and signature are TRUST failures and must be named as such; anything
 * network-shaped is transient and must never be reported as an integrity problem.
 */
export function classifyDownloadFailure(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  for (const [pattern, reason] of DOWNLOAD_FAILURE_RULES) {
    if (pattern.test(msg)) return reason;
  }
  return "verify_failed";
}

export async function checkAndStage(opts: {
  channel: OtaChannel;
  /** Any pending offline work, upload, or in-flight mutation → skip this cycle. */
  isBusy: BusyProbe;
}): Promise<{ staged: string | null; reason: string }> {
  if (!Capacitor.isNativePlatform()) return { staged: null, reason: "not_native" };

  if (await opts.isBusy()) return { staged: null, reason: "busy" };

  let manifest: Partial<OtaManifest>;
  try {
    const query = `?channel=${encodeURIComponent(opts.channel)}&fingerprint=${encodeURIComponent(NATIVE_FINGERPRINT)}`;
    // Go through the ONE seam that owns the persisted NextAuth cookie jar. The
    // route is session-gated (`sessionOr401`), and a bare `fetch` carries no
    // credential on native — it 308s to the trailing-slash path and then 401s, so
    // every "Check now" reported `Update server error (401)` and no device could
    // ever be offered a bundle. Requesting MANIFEST_PATH directly (with its
    // trailing slash) also skips that redirect hop.
    //
    // Auth events are suppressed deliberately: a background update check that
    // happens to find an expired session must not throw the technician out to the
    // login screen mid-diagnosis. It reports `unauthenticated` and does nothing.
    const res = await withAuthEventsSuppressed(() =>
      request(`${MANIFEST_PATH}${query}`, { timeoutMs: MANIFEST_TIMEOUT_MS }),
    );
    manifest = (res.data ?? {}) as Partial<OtaManifest>;
  } catch (e) {
    // An unreachable update server is a non-event, not an error state.
    if (e instanceof ApiError) {
      if (e.kind === "auth") return { staged: null, reason: "unauthenticated" };
      if (e.kind === "network") return { staged: null, reason: "unreachable" };
      return { staged: null, reason: e.status ? `server_${e.status}` : "unreachable" };
    }
    return { staged: null, reason: "unreachable" };
  }

  if (!manifest || !manifest.downloadUrl || !manifest.bundleId) {
    return { staged: null, reason: "no_update" };
  }

  // Refuse BEFORE downloading. A bundle built against native code this shell
  // does not have would fail at runtime — after it has already replaced a
  // working one.
  if (manifest.nativeFingerprint !== NATIVE_FINGERPRINT) {
    return { staged: null, reason: "incompatible_native" };
  }
  // The plugin enforces these, but a manifest that omits them must never reach
  // it: absent checksum/signature would otherwise mean "unverified download".
  if (!manifest.checksum || !manifest.signature) {
    return { staged: null, reason: "unsigned" };
  }
  if (!manifest.downloadUrl.startsWith("https://")) {
    return { staged: null, reason: "not_https" };
  }

  // The manifest may legitimately offer the bundle this device is ALREADY
  // running — a canary that has not moved since the last publish. Re-downloading
  // it is pure waste and, worse, turns a healthy device into one that reports an
  // integrity failure every time the technician taps Check now.
  const active = await LiveUpdate.getCurrentBundle()
    .then((r) => r?.bundleId ?? "")
    .catch(() => "");
  if (active && active === manifest.bundleId) {
    return { staged: null, reason: "up_to_date" };
  }

  // Downloaded on an earlier cycle but not yet active: stage what we already
  // hold instead of fetching it twice. Behind a capability check — if the plugin
  // cannot enumerate bundles we fall through to the download path, which is
  // exactly today's behaviour.
  // Both methods answer "which bundles are already downloaded". getBundles() is
  // deprecated as of plugin 7.4.0 in favour of getDownloadedBundles(); we ship
  // 8.4.1, so prefer the current name and keep the old one as a fallback for an
  // older native shell that has not been rebuilt yet. Verified against the
  // installed plugin's own type definitions, not assumed.
  const api = LiveUpdate as unknown as {
    getDownloadedBundles?: () => Promise<{ bundleIds?: string[] } | string[] | undefined>;
    getBundles?: () => Promise<{ bundleIds?: string[] } | string[] | undefined>;
  };
  const enumerate = api.getDownloadedBundles ?? api.getBundles;
  if (typeof enumerate === "function") {
    const held = await enumerate
      .call(LiveUpdate)
      .then((r) => (Array.isArray(r) ? r : (r?.bundleIds ?? [])))
      .catch(() => [] as string[]);
    if (Array.isArray(held) && held.includes(manifest.bundleId)) {
      await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
      return { staged: manifest.bundleId, reason: "reused_local" };
    }
  }

  try {
    await LiveUpdate.downloadBundle({
      bundleId: manifest.bundleId,
      url: manifest.downloadUrl,
      checksum: manifest.checksum,
      signature: manifest.signature,
      artifactType: "zip",
    });
    // Staged for the NEXT launch. Nothing changes under the running app.
    await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
    return { staged: manifest.bundleId, reason: "staged" };
  } catch (e) {
    // These do NOT mean the same thing. A checksum or signature failure is a
    // trust event; a transport error is a bad minute on the network. Collapsing
    // them told a technician with a working phone that their update had failed an
    // integrity check.
    console.warn("[ota] download/verify rejected", e);
    return { staged: null, reason: classifyDownloadFailure(e) };
  }
}

/** Current bundle id, or "packaged" when running the APK's own copy. */
export async function currentBundleId(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return "web";
  try {
    const r = await LiveUpdate.getCurrentBundle();
    return r.bundleId ?? "packaged";
  } catch {
    return "packaged";
  }
}

/**
 * Drop every downloaded bundle and fall back to the packaged one.
 *
 * The manual escape hatch behind Settings → "Recover to packaged version", for
 * when a bundle is bad in a way that still reaches `ready()` (renders, but
 * wrong). Automatic rollback cannot catch that; a human can.
 */
export async function recoverToPackaged(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LiveUpdate.reset();
}

export const otaStorageKeys = { CHANNEL_KEY, LAST_CHECK_KEY, LAST_RESULT_KEY };

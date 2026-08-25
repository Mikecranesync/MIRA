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

/** Where the signed manifest lives. FactoryLM-controlled, HTTPS, no exceptions. */
export const OTA_MANIFEST_URL = "https://app.factorylm.com/api/mobile/live-update/manifest";

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
export const NATIVE_FINGERPRINT: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__FLM_NATIVE_FINGERPRINT__ ?? "unset";

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
export async function checkAndStage(opts: {
  channel: OtaChannel;
  /** Any pending offline work, upload, or in-flight mutation → skip this cycle. */
  isBusy: BusyProbe;
  manifestUrl?: string;
}): Promise<{ staged: string | null; reason: string }> {
  if (!Capacitor.isNativePlatform()) return { staged: null, reason: "not_native" };

  if (await opts.isBusy()) return { staged: null, reason: "busy" };

  let manifest: Partial<OtaManifest>;
  try {
    const url = `${opts.manifestUrl ?? OTA_MANIFEST_URL}?channel=${encodeURIComponent(opts.channel)}&fingerprint=${encodeURIComponent(NATIVE_FINGERPRINT)}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { staged: null, reason: `server_${res.status}` };
    manifest = (await res.json()) as Partial<OtaManifest>;
  } catch {
    // An unreachable update server is a non-event, not an error state.
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
    // Checksum mismatch, signature failure, or transport error all land here and
    // all mean the same thing to the technician: nothing changed.
    console.warn("[ota] download/verify rejected", e);
    return { staged: null, reason: "verify_failed" };
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

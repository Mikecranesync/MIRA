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
 * `ready()` is called after the selected Login/classic/unified root commits in
 * the normal path, with a bounded fallback after the local boot shell commits
 * so a slow/offline auth request cannot exceed the native rollback deadline.
 * Failures before either safe commit retain automatic rollback; later render
 * failures expose an explicit packaged-recovery action. The packaged APK
 * bundle is the permanent floor and is always recoverable.
 */
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import { API_BASE, ApiError, request } from "../api/client";

/** Where the signed manifest lives. FactoryLM-controlled, HTTPS, no exceptions. */
const OTA_MANIFEST_PATH = "/api/mobile/live-update/manifest/";
export const OTA_MANIFEST_URL = `${API_BASE}${OTA_MANIFEST_PATH}`;

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
 * Injected at build time by `vite.config.ts` (Vite `define`), so it is
 * computed from the SAME dependency set that produced the bundle rather than
 * being maintained by hand.
 */
declare const __FLM_NATIVE_FINGERPRINT__: string | undefined;
declare const __FLM_PACKAGED_BUILD_MINIMUM__: string | undefined;

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

/** Old pointers cannot predate the governed release attempt that built this bundle. */
export const PACKAGED_BUILD_MINIMUM: string =
  typeof __FLM_PACKAGED_BUILD_MINIMUM__ !== "undefined"
    ? __FLM_PACKAGED_BUILD_MINIMUM__
    : "unset";

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
const POINTER_HIGH_WATER_PREFIX = "flm.ota.pointerHighWater.v1";

// Byte-for-byte identical to the Capacitor plugin key and the release/Hub
// verifiers. This copy is deliberately compiled into the web bundle so the
// device authenticates the pointer itself instead of trusting the Hub hop.
const OTA_PUBLIC_KEY_COMPACT =
  "-----BEGIN PUBLIC KEY-----MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAuLU3ebXbdfu76Jpfc6rLCMU0kOsPEcrTj/0hQUrEyThtXJBsEh7Hr2Up058ibAt1lQkikjft+ilf8CMeQ/K4dZeKSuxxiOVkAiDVGKh1PLplSI6RRYT2mK1RzD3KeMaM2Dd42IJ4ql/VSEnCgvhjpEAyTxYQKrecgE3YCLxeOFIP1q06mspdipsoegx3N8znyfWvdhamvxIoXKV+PIQv0AsZdczG8sNOUq+tauVuhIocl0RXyOXw60M5L7N+u81hj1xfDtGHGkjd+8tO+W3SA6EKYqENE9YUs4Zth2gDqLmG9cmdr4AoRjmiq+51aHKiht/g7ots/nILeeUYnnyyb1c4Ga1wphzWrDSi71GH16+WQOqeA3nL2r5TRB4XHFFRA9WoT8diA0hP6gl/rYVvPFNgHaVXD/1UB1MsVC3xZLdkaVkXfqhFvNb15/e/4blcFc3LJPtNpn8w9KxA1o4BDpOmwH2aOWEc4muxESy6ekgzJ9GcbhOyz+f6K6y+CwaTAQpX2HFuVZCxY/YgVUt419k9+vOWqLnbV9rG56UdEy5JzA+lcFcO8/qVPVg6j0WbORDbYkywDfxRO6GNJYtomSB1ow6aU1SBty7EOMzsmCyQhd5K9Gw2J1sl+RybneV6/YqvHkd7gTCySOrMjKA+gaScinwgbKAkSt7vXATKyRECAwEAAQ==-----END PUBLIC KEY-----";

export const OTA_PUBLIC_KEY = OTA_PUBLIC_KEY_COMPACT
  .replace("-----BEGIN PUBLIC KEY-----", "-----BEGIN PUBLIC KEY-----\n")
  .replace("-----END PUBLIC KEY-----", "\n-----END PUBLIC KEY-----\n");

const PROVENANCE_FIELDS = [
  "bundleId",
  "version",
  "artifact",
  "checksum",
  "signature",
  "nativeFingerprint",
  "releaseSha",
  "releasedAt",
  "artifactSha256",
] as const;

const MANIFEST_POINTER_FIELDS = [
  ...PROVENANCE_FIELDS,
  "provenanceSignature",
  "channel",
  "downloadUrl",
  "pointerChangedAt",
] as const;

const CANONICAL_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_RELEASE_SHA_RE = /^[0-9a-f]{40}$/;

function isCanonicalPointerTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_RE.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function signedPayload(
  protocol: string,
  fields: readonly string[],
  value: Record<string, unknown>,
): string {
  const lines = [protocol];
  for (const field of fields) {
    const item = value[field];
    if (typeof item !== "string" || !item || /[\r\n]/.test(item)) {
      throw new TypeError(`invalid OTA signed field: ${field}`);
    }
    lines.push(`${field}=${item}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Stable wire encoding shared with publish and Hub verification. */
export function manifestPointerPayload(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new TypeError("invalid OTA manifest pointer");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.releaseSha !== "string" ||
    !CANONICAL_RELEASE_SHA_RE.test(record.releaseSha)
  ) {
    throw new TypeError("invalid OTA signed field: releaseSha");
  }
  if (!isCanonicalPointerTimestamp(record.pointerChangedAt)) {
    throw new TypeError("invalid OTA signed field: pointerChangedAt");
  }
  if (!isCanonicalPointerTimestamp(record.releasedAt)) {
    throw new TypeError("invalid OTA signed field: releasedAt");
  }
  if (Date.parse(record.pointerChangedAt) < Date.parse(record.releasedAt)) {
    throw new TypeError("OTA pointer timestamp predates its authenticated release");
  }
  return signedPayload(
    "factorylm-ota-manifest-pointer-v1",
    MANIFEST_POINTER_FIELDS,
    record,
  );
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function publicKeyDer(publicKeyPem: string): Uint8Array<ArrayBuffer> {
  return decodeBase64(
    publicKeyPem
      .replace("-----BEGIN PUBLIC KEY-----", "")
      .replace("-----END PUBLIC KEY-----", ""),
  );
}

/** Device-side RSA-SHA256 verification; never delegates pointer trust to the plugin. */
export async function verifyOtaManifestPointer(
  value: unknown,
  manifestSignature: string,
  publicKeyPem = OTA_PUBLIC_KEY,
): Promise<boolean> {
  try {
    if (!manifestSignature) return false;
    const publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyDer(publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64(manifestSignature),
      new TextEncoder().encode(manifestPointerPayload(value)),
    );
  } catch {
    return false;
  }
}

function pointerHighWaterKey(channel: OtaChannel): string {
  return `${POINTER_HIGH_WATER_PREFIX}.${channel}`;
}

type PointerHighWater = {
  pointerChangedAt: string;
  /** Canonical payload whose signature was verified before this record was written. */
  pointerIdentity: string | null;
};

function parsePointerHighWater(value: string): PointerHighWater | null {
  // Timestamp-only v1 records already exist on devices. Keep their rollback
  // floor, but mark identity unavailable so an equal-time pointer cannot be
  // admitted without proof that it is the same authenticated pointer.
  if (isCanonicalPointerTimestamp(value)) {
    return { pointerChangedAt: value, pointerIdentity: null };
  }

  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (
      !record ||
      typeof record !== "object" ||
      !isCanonicalPointerTimestamp(record.pointerChangedAt) ||
      typeof record.pointerIdentity !== "string" ||
      !record.pointerIdentity.startsWith("factorylm-ota-manifest-pointer-v1\n") ||
      !record.pointerIdentity.endsWith(`pointerChangedAt=${record.pointerChangedAt}\n`)
    ) {
      return null;
    }
    return {
      pointerChangedAt: record.pointerChangedAt,
      pointerIdentity: record.pointerIdentity,
    };
  } catch {
    return null;
  }
}

function serializePointerHighWater(
  pointerChangedAt: string,
  pointerIdentity: string,
): string {
  return JSON.stringify({ pointerChangedAt, pointerIdentity });
}

/**
 * Persist an authenticated channel pointer, reconciling a native bridge call
 * whose response may be lost after the write commits. Only an exact reread is
 * proof: a missing, older, malformed, or unreadable value leaves replay state
 * unavailable and must keep update controls locked.
 */
async function persistPointerHighWater(
  channel: OtaChannel,
  pointerChangedAt: string,
  pointerIdentity: string,
): Promise<boolean> {
  const key = pointerHighWaterKey(channel);
  const value = serializePointerHighWater(pointerChangedAt, pointerIdentity);
  try {
    await Preferences.set({ key, value });
    return true;
  } catch (writeError) {
    try {
      const persisted = (await Preferences.get({ key })).value;
      if (persisted === value) return true;
      console.warn("[ota] replay state write did not commit", writeError);
    } catch (readError) {
      console.warn("[ota] replay state write outcome unavailable", writeError, readError);
    }
    return false;
  }
}

export async function readOtaChannel(): Promise<OtaChannel> {
  const { value } = await Preferences.get({ key: CHANNEL_KEY });
  return value === "canary" || value === "production" ? value : "production";
}

export async function writeOtaChannel(channel: OtaChannel): Promise<void> {
  if (channel !== "canary" && channel !== "production") {
    throw new TypeError("invalid OTA channel");
  }
  await Preferences.set({ key: CHANNEL_KEY, value: channel });
}

/**
 * Manifest contract (what a FactoryLM endpoint must return).
 *
 * `{}` means NO UPDATE. A body without `downloadUrl` is also no-update unless
 * the authenticated Hub supplies one of the explicit refusal/outage reasons
 * below. Either way, update-server trouble leaves the installed app working.
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
  artifact: string;
  artifactSha256: string;
  provenanceSignature: string;
  manifestSignature: string;
  pointerChangedAt: string;
};

type OtaManifestResponse = Partial<OtaManifest> & {
  update?: unknown;
  reason?: unknown;
};

/**
 * The authenticated Hub intentionally omits bundle fields when it refuses a
 * published pointer. Preserve only its closed, code-owned vocabulary; an
 * arbitrary response string must never become technician-facing copy.
 */
const HUB_NO_UPDATE_REASON_MAP: Readonly<Record<string, string>> = Object.freeze({
  no_manifest: "no_update",
  upstream_unavailable: "unreachable",
  upstream_error: "check_failed",
  malformed_manifest: "invalid_pointer_signature",
  channel_mismatch: "channel_mismatch",
  invalid_pointer_timestamp: "invalid_pointer_timestamp",
  invalid_provenance: "invalid_pointer_signature",
  incompatible_native: "incompatible_native",
  bad_download_url: "invalid_manifest_origin",
  artifact_mismatch: "verify_failed",
});

function hubNoUpdateReason(response: unknown): string {
  if (!response || typeof response !== "object") return "no_update";
  const record = response as OtaManifestResponse;
  if (record.update !== false || typeof record.reason !== "string") return "no_update";
  if (!Object.prototype.hasOwnProperty.call(HUB_NO_UPDATE_REASON_MAP, record.reason)) {
    return "no_update";
  }
  return HUB_NO_UPDATE_REASON_MAP[record.reason] ?? "no_update";
}

/**
 * Called after React commits either the selected product root or the bounded
 * local boot fallback; never before a React-owned shell exists on screen.
 *
 * This signal says the bundle rendered locally, not merely that its imports
 * evaluated. It deliberately does not make rollback survival depend on a
 * network request. The outer boot boundary owns explicit packaged recovery if
 * a later authenticated root transition fails after the fallback deadline.
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

type BundleInventory = {
  currentBundleId: string | null;
  nextBundleId: string | null;
  downloadedBundleIds: string[];
};

async function readBundleInventory(): Promise<BundleInventory> {
  const [current, next, downloaded] = await Promise.all([
    LiveUpdate.getCurrentBundle(),
    LiveUpdate.getNextBundle(),
    LiveUpdate.getDownloadedBundles(),
  ]);
  return {
    currentBundleId: current.bundleId ?? null,
    nextBundleId: next.bundleId ?? null,
    downloadedBundleIds: downloaded.bundleIds,
  };
}

/** Delete only a proven orphan; an unreadable inventory is a preserve decision. */
async function cleanupOrphanedBundle(bundleId: string): Promise<void> {
  try {
    const inventory = await readBundleInventory();
    if (
      inventory.downloadedBundleIds.includes(bundleId) &&
      inventory.currentBundleId !== bundleId &&
      inventory.nextBundleId !== bundleId
    ) {
      await LiveUpdate.deleteBundle({ bundleId });
    }
  } catch (error) {
    console.warn("[ota] preserving bundle because cleanup inventory was unavailable", error);
  }
}

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

  let manifest: OtaManifestResponse;
  try {
    const configured = new URL(opts.manifestUrl ?? OTA_MANIFEST_URL, API_BASE);
    if (configured.origin !== API_BASE) {
      return { staged: null, reason: "invalid_manifest_origin" };
    }
    if (!configured.pathname.endsWith("/")) configured.pathname += "/";
    configured.searchParams.set("channel", opts.channel);
    configured.searchParams.set("fingerprint", NATIVE_FINGERPRINT);
    const response = await request(`${configured.pathname}${configured.search}`, {
      timeoutMs: 15_000,
    });
    manifest = response.data as OtaManifestResponse;
  } catch (error) {
    if (error instanceof ApiError && error.status !== null) {
      return { staged: null, reason: `server_${error.status}` };
    }
    // An unreachable update server is a non-event, not an error state.
    return { staged: null, reason: "unreachable" };
  }

  if (!manifest || !manifest.downloadUrl || !manifest.bundleId) {
    return { staged: null, reason: hubNoUpdateReason(manifest) };
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
  if (manifest.channel !== opts.channel) {
    return { staged: null, reason: "channel_mismatch" };
  }
  if (!isCanonicalPointerTimestamp(manifest.pointerChangedAt)) {
    return { staged: null, reason: "invalid_pointer_timestamp" };
  }
  if (!(await verifyOtaManifestPointer(manifest, manifest.manifestSignature ?? ""))) {
    return { staged: null, reason: "invalid_pointer_signature" };
  }
  const pointerIdentity = manifestPointerPayload(manifest);
  if (!isCanonicalPointerTimestamp(PACKAGED_BUILD_MINIMUM)) {
    return { staged: null, reason: "invalid_packaged_minimum" };
  }
  const pointerMillis = Date.parse(manifest.pointerChangedAt);
  if (pointerMillis < Date.parse(PACKAGED_BUILD_MINIMUM)) {
    return { staged: null, reason: "stale_pointer" };
  }

  let highWaterRaw: string | null;
  try {
    highWaterRaw = (await Preferences.get({ key: pointerHighWaterKey(opts.channel) })).value;
  } catch {
    return { staged: null, reason: "pointer_state_unavailable" };
  }
  let highWater: PointerHighWater | null = null;
  if (highWaterRaw !== null) {
    highWater = parsePointerHighWater(highWaterRaw);
    if (highWater === null) {
      return { staged: null, reason: "pointer_state_invalid" };
    }
    const highWaterMillis = Date.parse(highWater.pointerChangedAt);
    if (pointerMillis < highWaterMillis) {
      return { staged: null, reason: "replayed_pointer" };
    }
    if (pointerMillis === highWaterMillis) {
      if (highWater.pointerIdentity === null) {
        return { staged: null, reason: "pointer_state_unavailable" };
      }
      if (highWater.pointerIdentity !== pointerIdentity) {
        return { staged: null, reason: "replayed_pointer" };
      }
    }
  }

  // The native plugin refuses to download an ID that already exists. Recover
  // an orphan left by a prior post-download failure, but never delete the
  // bundle currently executing or already selected for restart.
  let inventory: BundleInventory;
  try {
    inventory = await readBundleInventory();
  } catch (error) {
    console.warn("[ota] bundle inventory unavailable", error);
    return { staged: null, reason: "bundle_state_unavailable" };
  }
  const existingOtaBundleIds = [inventory.currentBundleId, inventory.nextBundleId].filter(
    (bundleId): bundleId is string => Boolean(bundleId) && bundleId !== "packaged",
  );
  if (
    highWater === null &&
    existingOtaBundleIds.length > 0 &&
    existingOtaBundleIds.some((bundleId) => bundleId !== manifest.bundleId)
  ) {
    // A missing per-channel floor is safe to bootstrap only when every OTA
    // bundle already running or selected for restart matches this signed
    // pointer. Otherwise a restart after failed storage could admit a
    // different, older-but-still-signed pointer on this channel.
    return { staged: null, reason: "pointer_state_unavailable" };
  }
  if (
    inventory.currentBundleId === manifest.bundleId ||
    inventory.nextBundleId === manifest.bundleId
  ) {
    // This authenticated pointer is accepted for the requested channel even
    // when native already runs or targets its bundle. Persist that channel's
    // replay floor before returning; otherwise a bundle promoted from canary
    // to production would leave production open to an older signed pointer.
    if (
      !(await persistPointerHighWater(
        opts.channel,
        manifest.pointerChangedAt,
        pointerIdentity,
      ))
    ) {
      return { staged: null, reason: "pointer_state_unavailable" };
    }
    if (inventory.currentBundleId === manifest.bundleId) {
      return { staged: null, reason: "no_update" };
    }
    return { staged: manifest.bundleId, reason: "staged" };
  }
  if (inventory.downloadedBundleIds.includes(manifest.bundleId)) {
    try {
      await LiveUpdate.deleteBundle({ bundleId: manifest.bundleId });
    } catch (error) {
      console.warn("[ota] orphaned bundle cleanup failed", error);
      return { staged: null, reason: "bundle_cleanup_failed" };
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
  } catch (error) {
    console.warn("[ota] download/verify rejected", error);
    return { staged: null, reason: "verify_failed" };
  }

  // Make replay state durable BEFORE asking native code to stage the bundle.
  // Only the exact authenticated pointer remains retryable at an equal
  // timestamp, so a process death between these calls cannot strand a
  // downloaded bundle or weaken the anti-rollback floor.
  if (
    !(await persistPointerHighWater(
      opts.channel,
      manifest.pointerChangedAt,
      pointerIdentity,
    ))
  ) {
    await cleanupOrphanedBundle(manifest.bundleId);
    return { staged: null, reason: "pointer_state_unavailable" };
  }

  try {
    // Staged for the NEXT launch. Nothing changes under the running app.
    await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
    return { staged: manifest.bundleId, reason: "staged" };
  } catch (error) {
    // A native bridge can commit setNextBundle and then lose its response. Read
    // the authoritative restart target before rolling replay state back or
    // deleting anything. If that state is unreadable, preserve both the new
    // high-water mark and downloaded bundle: uncertainty must fail closed.
    try {
      const next = await LiveUpdate.getNextBundle();
      if (next.bundleId === manifest.bundleId) {
        return { staged: manifest.bundleId, reason: "staged" };
      }
    } catch (stateError) {
      console.warn("[ota] staging outcome unavailable", stateError);
      return { staged: null, reason: "bundle_state_unavailable" };
    }

    // Native confirms the candidate was not selected. Restore the prior
    // high-water mark so the exact pointer remains retryable, then remove only
    // a proven orphan.
    try {
      if (highWaterRaw === null) {
        await Preferences.remove({ key: pointerHighWaterKey(opts.channel) });
      } else {
        await Preferences.set({ key: pointerHighWaterKey(opts.channel), value: highWaterRaw });
      }
    } catch (restoreError) {
      console.warn("[ota] replay state restore failed", restoreError);
    }
    console.warn("[ota] staging rejected", error);
    await cleanupOrphanedBundle(manifest.bundleId);
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

/** Bundle selected for the next launch, or null when native selected packaged. */
export async function pendingBundleId(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const result = await LiveUpdate.getNextBundle();
  return result.bundleId ?? null;
}

/** Authoritative current/next state; unlike display helpers, native failures throw. */
export async function readBundleRestartState(): Promise<{
  currentBundleId: string;
  pendingBundleId: string | null;
}> {
  if (!Capacitor.isNativePlatform()) {
    return { currentBundleId: "web", pendingBundleId: null };
  }
  const [current, pending] = await Promise.all([
    LiveUpdate.getCurrentBundle(),
    LiveUpdate.getNextBundle(),
  ]);
  return {
    currentBundleId: current.bundleId ?? "packaged",
    pendingBundleId: pending.bundleId ?? null,
  };
}

/**
 * Select the packaged bundle for the next launch.
 *
 * The manual escape hatch behind Settings → "Recover to packaged version", for
 * when a bundle is bad in a way that still reaches `ready()` (renders, but
 * wrong). Automatic rollback cannot catch that; a human can. Previously
 * downloaded bundles remain in native storage until separately cleaned.
 */
export async function recoverToPackaged(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LiveUpdate.reset();
}

export const otaStorageKeys = {
  CHANNEL_KEY,
  LAST_CHECK_KEY,
  LAST_RESULT_KEY,
  POINTER_HIGH_WATER_PREFIX,
};

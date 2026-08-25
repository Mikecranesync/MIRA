/**
 * GET /api/mobile/live-update/manifest?channel=<canary|production>&fingerprint=<hex>
 *
 * The server half of OTA. The mobile client has called this on every "Check
 * now" since #3393, but the route did not exist — the Pixel reported
 * `Update server error (404)` and no OTA update had ever been possible.
 *
 * WHERE THE MANIFEST COMES FROM. `scripts/ota-publish.mjs` writes a signed
 * `manifest.<channel>.json`; `scripts/ota-deploy.mjs` uploads the artifacts
 * FIRST and that manifest LAST, to `/srv/factorylm/ota` on the VPS, which nginx
 * serves at OTA_ORIGIN (deployment/nginx-updates-factorylm.conf). This route
 * reads that published file rather than re-deriving anything: the manifest is
 * the single source of truth for what is live, and the publish pipeline already
 * owns it.
 *
 * WHY GO THROUGH THE HUB AT ALL when the file is already on a static host? So
 * the compatibility gate runs BEFORE the device commits to a download, and so
 * the app has one origin to talk to. The device still fetches the zip straight
 * from the release host — the Hub is not a CDN and never proxies the artifact.
 *
 * WHAT THIS ROUTE DOES NOT DO: verify the signature. It cannot — the signature
 * covers the SHA-256 of the zip, and the zip never passes through here. That
 * check belongs on the device, where the plugin does it against the public key
 * baked into the APK. This route's job is to refuse to POINT at anything
 * obviously wrong; the device still verifies what it actually downloads.
 *
 * STATUS CODES ARE PART OF THE CONTRACT. The client turns any non-2xx into
 * `server_<status>`, which a technician reads as "broken". So every ordinary
 * outcome — nothing published, wrong fingerprint, release host down — is a 200
 * whose body simply has no `downloadUrl`, which the client reads as
 * "no_update". Only a malformed REQUEST gets a 4xx.
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

const CHANNELS = new Set(["canary", "production"]);
/** nativeFingerprint() emits a 16-char hex digest; reject anything else. */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const UPSTREAM_TIMEOUT_MS = 8_000;

function releaseOrigin(): string {
  return (process.env.OTA_ORIGIN || "https://updates.factorylm.com").replace(/\/+$/, "");
}

/** Never cached: a stale manifest pins the fleet to an old bundle. */
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store, no-cache, must-revalidate" },
  });
}

/** A 200 the client reads as "no_update" — no bundleId, no downloadUrl. */
function noUpdate(reason: string) {
  return json({ update: false, reason });
}

/**
 * The download must live on the release host itself. A manifest is only a
 * pointer, and the device verifies the signature only AFTER downloading — so a
 * tampered or mis-published manifest that could name any host would aim the
 * whole fleet at someone else's zip first. Exact host or dot-suffix only, so
 * `updates.factorylm.com.evil.net` fails.
 */
function isOnReleaseHost(downloadUrl: string): boolean {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(downloadUrl);
    origin = new URL(releaseOrigin());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const allowed = origin.hostname.toLowerCase();
  return host === allowed || host.endsWith(`.${allowed}`);
}

interface PublishedManifest {
  bundleId?: unknown;
  downloadUrl?: unknown;
  checksum?: unknown;
  signature?: unknown;
  nativeFingerprint?: unknown;
  channel?: unknown;
  version?: unknown;
  releaseSha?: unknown;
  releasedAt?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export async function GET(req: Request) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const params = new URL(req.url).searchParams;
  const channel = (params.get("channel") || "").trim();
  const fingerprint = (params.get("fingerprint") || "").trim().toLowerCase();

  if (!CHANNELS.has(channel)) {
    return json({ error: "invalid_channel" }, 400);
  }
  // Without a fingerprint the compatibility gate is blind, and shipping a
  // bundle to a shell that cannot run it is the failure this whole mechanism
  // exists to prevent.
  if (!FINGERPRINT_RE.test(fingerprint)) {
    return json({ error: "invalid_fingerprint" }, 400);
  }

  const url = `${releaseOrigin()}/manifest.${channel}.json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // DNS failure, refused connection, timeout. Nothing is wrong with the
    // device; there is simply no update to be had right now.
    return noUpdate("upstream_unavailable");
  }

  if (res.status === 404) return noUpdate("no_manifest");
  if (!res.ok) return noUpdate("upstream_error");

  let manifest: PublishedManifest;
  try {
    manifest = (await res.json()) as PublishedManifest;
  } catch {
    return noUpdate("malformed_manifest");
  }

  const bundleId = str(manifest?.bundleId);
  const downloadUrl = str(manifest?.downloadUrl);
  const checksum = str(manifest?.checksum);
  const signature = str(manifest?.signature);
  const nativeFingerprint = str(manifest?.nativeFingerprint);

  // An unsigned or unchecksummed manifest must never reach the device: the
  // plugin would have nothing to verify the download against.
  if (!bundleId || !downloadUrl || !checksum || !signature || !nativeFingerprint) {
    return noUpdate("malformed_manifest");
  }

  if (str(manifest?.channel) !== channel) return noUpdate("channel_mismatch");
  if (nativeFingerprint.toLowerCase() !== fingerprint) return noUpdate("incompatible_native");
  if (!isOnReleaseHost(downloadUrl)) return noUpdate("bad_download_url");

  return json({
    bundleId,
    downloadUrl,
    checksum,
    signature,
    nativeFingerprint,
    channel,
    version: str(manifest?.version) ?? undefined,
    releaseSha: str(manifest?.releaseSha) ?? undefined,
    releasedAt: str(manifest?.releasedAt) ?? undefined,
  });
}

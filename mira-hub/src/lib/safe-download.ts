/**
 * safe-download — hardened fetcher for UNTRUSTED remote URLs (ARPK nameplate →
 * manual discovery). A URL that came back from a web search is attacker-
 * influenced input: it may point at the hub's own loopback, the docker network,
 * the cloud metadata endpoint, a 4 GB file, or an HTML landing page wearing an
 * `application/pdf` hat.
 *
 * Guarantees:
 *   - HTTPS only, no embedded credentials, default port only.
 *   - Host must be on the caller's allowlist (exact or dot-suffix subdomain) AND
 *     must not resolve to a literal loopback/private/link-local/CGNAT/metadata
 *     address — revalidated on EVERY redirect hop, bounded at 3 hops.
 *   - DNS is resolved by this module BEFORE connecting, every returned address
 *     is checked against the same loopback/private/link-local/CGNAT/metadata
 *     rules, and the socket is then pinned (via Node's `https.request` connect-
 *     time `lookup` hook) to CONNECT to exactly the address that was checked —
 *     a name that resolves (or re-resolves) to a private address between the
 *     check and the connect can no longer reach it (DNS rebinding is closed).
 *     TLS SNI/servername and certificate verification still use the URL
 *     hostname; `rejectUnauthorized` is never set to `false`.
 *   - One total-time budget across all hops (AbortSignal).
 *   - maxBytes enforced WHILE STREAMING — the response is destroyed as soon as
 *     the accumulated size crosses the limit; an oversized body is never
 *     buffered.
 *   - Content-Type must be application/pdf AND the first bytes must be `%PDF-`.
 *   - Any derived filename is sanitized (no separators, no control chars, no
 *     leading dots, length-capped, forced `.pdf`).
 *   - Logs carry the HOST and a reason code only — never the URL query string,
 *     credentials, or document content.
 */

import * as dns from "node:dns";
import * as https from "node:https";
import type { LookupFunction } from "node:net";

export type DownloadRejection =
  | "invalid_url"
  | "not_https"
  | "url_credentials"
  | "non_standard_port"
  | "blocked_host"
  | "blocked_address"
  | "host_not_allowed"
  | "too_many_redirects"
  | "redirect_no_location"
  | "http_error"
  | "network_error"
  | "timeout"
  | "wrong_content_type"
  | "not_pdf"
  | "too_large"
  | "empty_body";

export type SafeDownloadResult =
  | { ok: true; buffer: Buffer; finalUrl: string; contentType: string }
  /** `status` rides along only for http_error, so a caller can tell a 503 from a 404. */
  | { ok: false; reason: DownloadRejection; status?: number };

export interface SafeDownloadOptions {
  allowedHosts: string[];
  maxBytes: number;
  timeoutMs?: number;
}

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const PDF_MAGIC = "%PDF-";

// ── URL predicates ───────────────────────────────────────────────────────────

/**
 * HTTPS, no embedded credentials, default port only.
 *
 * Non-standard ports are REJECTED deliberately: a legitimate OEM documentation
 * host always serves on 443, while `https://oem.example.com:9200/` is a classic
 * way to reach an internal service that happens to sit behind an allowed name.
 * The cost of the choice is nil for this feature; the benefit is one fewer
 * pivot. Documented here so a future caller knows it is a policy, not an
 * oversight.
 */
export function isPublicHttpsUrl(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (!url.hostname) return false;
  return true;
}

function stripBrackets(h: string): string {
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

function normalizeHost(h: string): string {
  return stripBrackets((h ?? "").trim().toLowerCase().replace(/\.$/, ""));
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function ipv4Blocked(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 literal (incl. embedded IPv4 form) to 16 bytes, or null. */
function parseIpv6(host: string): number[] | null {
  if (!host.includes(":")) return null;
  let text = host;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  let tail4: number[] | null = null;
  const lastColon = text.lastIndexOf(":");
  const lastPiece = text.slice(lastColon + 1);
  if (lastPiece.includes(".")) {
    tail4 = parseIpv4(lastPiece);
    if (!tail4) return null;
    text = text.slice(0, lastColon + 1);
    // The dotted tail occupies the final two groups.
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (g === "") return null;
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const headSrc = halves[0].replace(/:+$/, "");
  const tailSrc = (halves[1] ?? "").replace(/^:+/, "").replace(/:+$/, "");
  const head = toGroups(headSrc);
  const tail = halves.length === 2 ? toGroups(tailSrc) : [];
  if (head === null || tail === null) return null;

  const totalGroups = 8 - (tail4 ? 2 : 0);
  let groups: number[];
  if (halves.length === 2) {
    const fill = totalGroups - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    if (head.length !== totalGroups) return null;
    groups = head;
  }
  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  if (tail4) bytes.push(...tail4);
  return bytes.length === 16 ? bytes : null;
}

function ipv6Blocked(b: number[]): boolean {
  // IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible — judge as IPv4.
  const firstTenZero = b.slice(0, 10).every((x) => x === 0);
  if (firstTenZero && b[10] === 0xff && b[11] === 0xff) {
    return ipv4Blocked(b.slice(12));
  }
  if (firstTenZero && b[10] === 0 && b[11] === 0) {
    // :: (unspecified), ::1 (loopback), ::a.b.c.d (deprecated compat form).
    const tail = b.slice(12);
    if (tail.every((x) => x === 0)) return true; // ::
    if (tail[0] === 0 && tail[1] === 0 && tail[2] === 0 && tail[3] === 1) return true; // ::1
    return ipv4Blocked(tail);
  }
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xff) return true; // multicast
  return false;
}

const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

/**
 * Loopback / private / link-local / CGNAT / metadata rejection for a hostname,
 * covering literal IPv4, literal IPv6 (including IPv4-mapped forms), and the
 * well-known non-routable names. Also the ONE classifier for a resolved DNS
 * address (see `resolveAndPin` below) — a bare IP literal always falls through
 * the name checks and into `parseIpv4`/`parseIpv6`.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (!h) return true;
  if (BLOCKED_NAMES.has(h)) return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;

  const v4 = parseIpv4(h);
  if (v4) return ipv4Blocked(v4);
  const v6 = parseIpv6(h);
  if (v6) return ipv6Blocked(v6);
  return false;
}

/**
 * Exact host, or a dot-suffix subdomain of an allowed host. A bare suffix test
 * would let `evil-rockwellautomation.com` through for `rockwellautomation.com`;
 * requiring the dot is the whole point of this function.
 */
export function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const h = normalizeHost(hostname);
  if (!h) return false;
  for (const raw of allowedHosts ?? []) {
    const a = normalizeHost(raw);
    if (!a) continue;
    if (h === a) return true;
    if (h.endsWith(`.${a}`)) return true;
  }
  return false;
}

// ── Filename sanitation ──────────────────────────────────────────────────────

/**
 * Derive a safe, human-recognizable `.pdf` filename from a URL path. Strips
 * path separators, control characters, and leading dots; caps the length; never
 * carries the query string (which may hold tokens).
 */
export function safePdfFilename(url: string, fallback = "manual.pdf"): string {
  let base = "";
  try {
    const u = new URL(url);
    base = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    base = "";
  }
  base = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    // Drop the extension first, THEN leading dots — otherwise "....pdf"
    // survives as "pdf.pdf" instead of collapsing to the fallback.
    .replace(/\.pdf$/i, "")
    .replace(/^\.+/, "")
    .trim();
  if (!base) return fallback;
  if (base.length > 120) base = base.slice(0, 120);
  return `${base}.pdf`;
}

// ── DNS resolve-and-pin (connect-time rebinding guard) ──────────────────────

/**
 * Resolves every address a hostname's DNS record advertises. Overridable in
 * tests via `__setResolverForTests` so the suite never touches a real
 * resolver. The default implementation is the one and only place `dns.lookup`
 * is called.
 */
export type LookupAllFn = (hostname: string) => Promise<dns.LookupAddress[]>;

let resolverOverride: LookupAllFn | null = null;

/** Test-only seam: inject a fake DNS resolver. Pass `null` to restore the real one. */
export function __setResolverForTests(fn: LookupAllFn | null): void {
  resolverOverride = fn;
}

function defaultLookupAll(hostname: string): Promise<dns.LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/** Every address the check approved, in DNS order (never empty). */
interface Pin {
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

type PinResult = { ok: true; pin: Pin } | { ok: false; reason: "blocked_address" | "network_error" };

/**
 * Resolve `hostname` to every address it advertises and reject if ANY of them
 * is loopback/private/link-local/CGNAT/metadata — reusing `isBlockedHost`
 * (the one classifier) rather than a second one for raw addresses. EVERY
 * checked address is kept, so the socket can fall back from a dead first
 * address (e.g. a broken IPv6 route) without a second, unchecked lookup.
 */
async function resolveAndPin(hostname: string): Promise<PinResult> {
  const resolver = resolverOverride ?? defaultLookupAll;
  let records: dns.LookupAddress[];
  try {
    records = await resolver(hostname);
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (!records || records.length === 0) {
    return { ok: false, reason: "network_error" };
  }
  for (const r of records) {
    if (isBlockedHost(r.address)) {
      return { ok: false, reason: "blocked_address" };
    }
  }
  return {
    ok: true,
    pin: {
      addresses: records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 })),
    },
  };
}

/**
 * A connect-time `lookup` hook (the shape `https.request`/`http.request`
 * accept) that ignores whatever the socket layer would otherwise resolve and
 * only ever hands back addresses `resolveAndPin` already checked. This is
 * what makes the connection go to a checked address instead of whatever a
 * second, independent resolution might return.
 *
 * Node >= 20 dials with `autoSelectFamily`, which calls this hook with
 * `{ all: true }` and REQUIRES an array — answering with a single pair there
 * fails every real connection. With the full list, Node's happy-eyeballs
 * fallback walks the checked addresses in DNS order.
 */
function makePinnedLookup(pin: Pin): LookupFunction {
  return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options && options.all) {
      callback(null, pin.addresses.map((a) => ({ address: a.address, family: a.family })));
      return;
    }
    const first = pin.addresses[0];
    callback(null, first.address, first.family);
  }) as unknown as LookupFunction;
}

// ── Transport (real https.request, injectable in tests) ────────────────────

export interface TransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: NodeJS.ReadableStream;
}

/**
 * Test-only seam: given the exact options this module would hand to
 * `https.request` (including the pinned `lookup` and `signal`), produce a
 * response. Lets tests assert on `options.lookup`/`options.servername`/
 * `options.rejectUnauthorized` without opening a real TLS socket.
 */
export type TransportFn = (options: https.RequestOptions, url: URL) => Promise<TransportResponse>;

let transportOverride: TransportFn | null = null;

/** Test-only seam: inject a fake transport. Pass `null` to restore the real one. */
export function __setTransportForTests(fn: TransportFn | null): void {
  transportOverride = fn;
}

function defaultTransport(options: https.RequestOptions): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: res });
    });
    req.on("error", reject);
    req.end();
  });
}

async function performRequest(url: URL, pin: Pin, signal: AbortSignal): Promise<TransportResponse> {
  const options: https.RequestOptions = {
    hostname: url.hostname,
    // Never set rejectUnauthorized: false. TLS SNI/certificate checks stay on
    // the URL's own hostname — `lookup` only changes where the socket
    // connects, never what the server is expected to present.
    servername: url.hostname,
    port: 443,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: { Accept: "application/pdf,*/*;q=0.5" },
    lookup: makePinnedLookup(pin),
    signal,
  };
  const transport = transportOverride ?? defaultTransport;
  return transport(options, url);
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function drainBody(body: NodeJS.ReadableStream | undefined): void {
  try {
    (body as { destroy?: () => void } | undefined)?.destroy?.();
  } catch {
    /* ignore */
  }
}

type ReadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "too_large" | "not_pdf" | "empty_body" | "timeout" | "network_error" };

/** Stream the body, enforcing maxBytes AS BYTES ARRIVE and checking the PDF magic. */
async function readBodyWithLimits(
  body: NodeJS.ReadableStream,
  maxBytes: number,
  timedOut: () => boolean,
): Promise<ReadResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  let magicChecked = false;
  try {
    for await (const chunk of body as unknown as AsyncIterable<Buffer | string>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf.length === 0) continue;
      total += buf.length;
      if (total > maxBytes) {
        // Destroy AS SOON AS the limit is crossed — the rest of an oversized
        // body is never read, let alone buffered.
        drainBody(body);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(buf);
      if (!magicChecked && total >= PDF_MAGIC.length) {
        const head = Buffer.concat(chunks, PDF_MAGIC.length).toString("latin1");
        if (head !== PDF_MAGIC) {
          drainBody(body);
          return { ok: false, reason: "not_pdf" };
        }
        magicChecked = true;
      }
    }
  } catch {
    return { ok: false, reason: timedOut() ? "timeout" : "network_error" };
  }

  if (total === 0) return { ok: false, reason: "empty_body" };
  const buffer = Buffer.concat(chunks, total);
  if (!magicChecked || buffer.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
    return { ok: false, reason: "not_pdf" };
  }
  return { ok: true, buffer };
}

// ── Fetch ────────────────────────────────────────────────────────────────────

function reject(host: string, reason: DownloadRejection): { ok: false; reason: DownloadRejection } {
  // Host + reason code ONLY. Never the full URL (query strings can carry
  // credentials) and never any body content.
  console.warn(`[safe-download] rejected host=${host || "?"} reason=${reason}`);
  return { ok: false, reason };
}

function gateUrl(u: string, allowedHosts: string[]): DownloadRejection | null {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "https:") return "not_https";
  if (url.username !== "" || url.password !== "") return "url_credentials";
  if (url.port !== "" && url.port !== "443") return "non_standard_port";
  if (!isPublicHttpsUrl(u)) return "invalid_url";
  if (isBlockedHost(url.hostname)) return "blocked_host";
  if (!hostAllowed(url.hostname, allowedHosts)) return "host_not_allowed";
  return null;
}

/**
 * Download a PDF from an untrusted URL under the guarantees documented at the
 * top of this file. Never throws — every failure is a typed rejection.
 */
export async function safeDownloadPdf(
  url: string,
  opts: SafeDownloadOptions,
): Promise<SafeDownloadResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = Math.max(1, opts.maxBytes);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let current = url;
    let hostForLog = "";

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
        hostForLog = parsed.hostname;
      } catch {
        return reject(hostForLog, "invalid_url");
      }

      const gate = gateUrl(current, opts.allowedHosts);
      if (gate) return reject(hostForLog, gate);

      const pinResult = await resolveAndPin(parsed.hostname);
      if (!pinResult.ok) {
        if (pinResult.reason === "blocked_address") return reject(hostForLog, "blocked_address");
        return reject(hostForLog, timedOut ? "timeout" : "network_error");
      }

      let resp: TransportResponse;
      try {
        resp = await performRequest(parsed, pinResult.pin, controller.signal);
      } catch {
        return reject(hostForLog, timedOut ? "timeout" : "network_error");
      }

      if (resp.statusCode >= 300 && resp.statusCode < 400) {
        drainBody(resp.body);
        if (hop === MAX_REDIRECTS) return reject(hostForLog, "too_many_redirects");
        const loc = getHeader(resp.headers, "location");
        if (!loc) return reject(hostForLog, "redirect_no_location");
        try {
          current = new URL(loc, current).toString();
        } catch {
          return reject(hostForLog, "invalid_url");
        }
        // Loop re-gates AND re-resolves-and-pins the new URL: a redirect off
        // the allowlist, onto a literal private address, or onto a name that
        // DNS-resolves private is rejected exactly like a first-hop attempt.
        continue;
      }

      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        drainBody(resp.body);
        return { ...reject(hostForLog, "http_error"), status: resp.statusCode };
      }

      const rawType = getHeader(resp.headers, "content-type") ?? "";
      const contentType = rawType.split(";")[0].trim().toLowerCase();
      if (contentType !== "application/pdf") {
        drainBody(resp.body);
        return reject(hostForLog, "wrong_content_type");
      }

      // A declared Content-Length over the cap is refused before reading a byte.
      const declared = Number(getHeader(resp.headers, "content-length") ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) {
        drainBody(resp.body);
        return reject(hostForLog, "too_large");
      }

      const read = await readBodyWithLimits(resp.body, maxBytes, () => timedOut);
      if (!read.ok) return reject(hostForLog, read.reason);

      return { ok: true, buffer: read.buffer, finalUrl: current, contentType };
    }

    return reject(hostForLog, "too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}

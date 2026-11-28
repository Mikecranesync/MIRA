/**
 * #6119: a manufacturer manual opens at the cited page.
 *
 * A shared-library citation (`knowledge_entries.is_private = false`, an http(s)
 * `source_url`, no parked file) used to open the vendor's own address. Android
 * Chrome has no inline PDF viewer and the Hub's cited-page viewer can only draw a
 * same-origin PDF, so the technician got a download or page 1 instead of the
 * cited page. This module serves the Hub's own copy of that public PDF, fetched
 * once from the vendor and kept in `oem_source_documents` (migration 119).
 *
 * The URL is never taken from the client. The byte route sends only a
 * `knowledge_entries` id; the URL is read from a non-private row on the server,
 * checked against a vendor host allowlist, and every redirect hop is checked
 * again. Pure parts are exported for unit tests.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import pool from "@/lib/db";
import { OEM_SOURCE_HOSTS } from "./oem-source-hosts";

export { OEM_SOURCE_HOSTS };

export const OEM_FETCH_TIMEOUT_MS = 30_000;
export const OEM_MAX_BYTES = 100 * 1024 * 1024;
export const OEM_MAX_REDIRECTS = 3;
/** How long a failed fetch is remembered before the vendor is asked again. */
export const OEM_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

const HOSTS = new Set(OEM_SOURCE_HOSTS);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEntryId(id: string): boolean {
  return UUID_RE.test(id);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The URL, parsed, when it is an https address on an allowlisted vendor host; else null. */
export function allowedSourceUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  return HOSTS.has(url.hostname.toLowerCase()) ? url : null;
}

function ipv4Private(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** A resolved address the server must never connect to: private, loopback, link-local,
 *  carrier-grade NAT, multicast or reserved. Anything unparseable counts as private. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return ipv4Private(a, b);
  }
  if (family !== 6) return true;
  const v6 = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (v6 === "::" || v6 === "::1") return true;
  const first = parseInt(v6.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

export function looksLikePdf(head: Uint8Array): boolean {
  return head.length >= 5 && Buffer.from(head.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** The file name the browser is offered: the URL's last path segment, as a PDF name. */
export function pdfFilename(url: string): string {
  let last = "";
  try {
    last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    last = "";
  }
  const safe = last.replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  if (!safe) return "manual.pdf";
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

export type FailureStatus = "fetch_failed" | "host_refused" | "not_pdf" | "too_large";

export type FetchOutcome =
  | { status: "ok"; httpStatus: number; bytes: Buffer; contentType: string }
  | { status: FailureStatus; httpStatus: number | null };

export type FetchDeps = {
  fetch: typeof fetch;
  /** Every address a hostname resolves to. */
  resolve: (hostname: string) => Promise<string[]>;
  timeoutMs: number;
  maxBytes: number;
};

async function resolveAll(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);
}

export const defaultFetchDeps: FetchDeps = {
  fetch: (...args) => fetch(...args),
  resolve: resolveAll,
  timeoutMs: OEM_FETCH_TIMEOUT_MS,
  maxBytes: OEM_MAX_BYTES,
};

/** Reads the body up to `max` bytes; null when it is larger (the stream is cancelled). */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * Fetches one vendor PDF. Every hop (the first request and each redirect) must be
 * an https URL on the allowlist whose host resolves only to public addresses;
 * redirects are followed by hand, at most OEM_MAX_REDIRECTS. The address check is
 * defense in depth: the allowlist is the guard, and a resolve-then-connect gap
 * (DNS answering differently to the fetch) remains.
 */
export async function fetchOemPdf(sourceUrl: string, deps: FetchDeps = defaultFetchDeps): Promise<FetchOutcome> {
  const signal = AbortSignal.timeout(deps.timeoutMs);
  let current = sourceUrl;
  try {
    for (let hop = 0; hop <= OEM_MAX_REDIRECTS; hop++) {
      const url = allowedSourceUrl(current);
      if (!url) return { status: "fetch_failed", httpStatus: null };
      const addresses = await deps.resolve(url.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) return { status: "fetch_failed", httpStatus: null };
      const res = await deps.fetch(url, { redirect: "manual", signal, headers: { accept: "application/pdf" } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) return { status: "fetch_failed", httpStatus: res.status };
        current = new URL(location, url).toString();
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "host_refused", httpStatus: res.status };
      }
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "fetch_failed", httpStatus: res.status };
      }
      const bytes = await readCapped(res, deps.maxBytes);
      if (bytes === null) return { status: "too_large", httpStatus: res.status };
      if (!looksLikePdf(bytes)) return { status: "not_pdf", httpStatus: res.status };
      return { status: "ok", httpStatus: res.status, bytes, contentType: "application/pdf" };
    }
    return { status: "fetch_failed", httpStatus: null };
  } catch {
    return { status: "fetch_failed", httpStatus: null };
  }
}

/**
 * The shared-library row a citation may open through the Hub's own copy: only a public
 * manufacturer manual chunk (no parked document id, not private, an https address on an
 * allowlisted vendor host). An upload, a private row, or any other address returns null and
 * keeps its old link.
 */
export function oemSourceEntryId(chunk: {
  docId?: string | null;
  isPrivate?: boolean;
  entryId?: string | null;
  sourceUrl?: string | null;
}): string | null {
  if (chunk.docId || chunk.isPrivate !== false || !chunk.entryId) return null;
  // Only a manual the Hub can actually fetch (https, allowlisted host). Anything else keeps its
  // raw vendor link, so a forum post or an http-only address is never turned into a dead end.
  return allowedSourceUrl(chunk.sourceUrl ?? "") ? chunk.entryId : null;
}

/** The address a shared manual chunk came from, or null. Raw owner pool: RLS on
 *  knowledge_entries would hide the shared rows (knowledge-entries tenant law). */
export const RESOLVE_SOURCE_SQL = `SELECT source_url FROM knowledge_entries
    WHERE id = $1::uuid AND is_private = false AND source_url ~ '^https?://' LIMIT 1`;

const CACHE_SQL = `SELECT status, content, retry_after FROM oem_source_documents WHERE url_sha256 = $1`;

const STORE_SQL = `INSERT INTO oem_source_documents
      (url_sha256, source_url, status, http_status, content, content_sha256, content_type, byte_length, page_count, fetched_at, retry_after)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, now(), $9)
    ON CONFLICT (url_sha256) DO UPDATE SET
      status = EXCLUDED.status, http_status = EXCLUDED.http_status, content = EXCLUDED.content,
      content_sha256 = EXCLUDED.content_sha256, content_type = EXCLUDED.content_type,
      byte_length = EXCLUDED.byte_length, page_count = NULL, fetched_at = now(), retry_after = EXCLUDED.retry_after`;

type CacheRow = { status: string; content: Buffer | null; retry_after: Date | string | null };

export type OemSourceResult =
  | { kind: "ok"; bytes: Buffer; filename: string }
  | { kind: "not_found" }
  | { kind: "unavailable" };

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Db = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };

export type SourceDeps = { db: Db; fetch: FetchDeps; now: () => number; log: (line: string) => void };

const defaultSourceDeps = (): SourceDeps => ({
  db: pool as unknown as Db,
  fetch: defaultFetchDeps,
  now: () => Date.now(),
  log: (line) => console.info(line),
});

function fromCache(row: CacheRow | undefined, now: number, url: string): OemSourceResult | null {
  if (!row) return null;
  if (row.status === "ok" && row.content) return { kind: "ok", bytes: Buffer.from(row.content), filename: pdfFilename(url) };
  const retryAt = row.retry_after ? new Date(row.retry_after).getTime() : 0;
  return retryAt > now ? { kind: "unavailable" } : null;
}

/**
 * The bytes of the public manual behind one shared knowledge_entries row: from the
 * cache, or fetched once and stored. Two concurrent misses for the same URL fetch
 * once: the second waits on a transaction-scoped advisory lock, then reads the row
 * the first stored.
 */
export async function oemSourceBytes(entryId: string, deps: SourceDeps = defaultSourceDeps()): Promise<OemSourceResult> {
  if (!isEntryId(entryId)) return { kind: "not_found" };
  const found = await deps.db.query(RESOLVE_SOURCE_SQL, [entryId]);
  const sourceUrl = String(found.rows[0]?.source_url ?? "");
  if (!sourceUrl) return { kind: "not_found" };
  const allowed = allowedSourceUrl(sourceUrl);
  const urlSha = sha256Hex(sourceUrl);
  const host = allowed?.hostname ?? "(not allowed)";
  if (!allowed) {
    deps.log(`[oem-source] url_sha256=${urlSha} host=${host} status=host_not_allowed`);
    return { kind: "unavailable" };
  }
  const cached = fromCache((await deps.db.query(CACHE_SQL, [urlSha])).rows[0] as CacheRow | undefined, deps.now(), sourceUrl);
  if (cached) return cached;

  const client = await deps.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [urlSha]);
    const again = fromCache((await client.query(CACHE_SQL, [urlSha])).rows[0] as CacheRow | undefined, deps.now(), sourceUrl);
    if (again) {
      await client.query("COMMIT");
      return again;
    }
    const started = deps.now();
    const outcome = await fetchOemPdf(sourceUrl, deps.fetch);
    const ok = outcome.status === "ok";
    const bytes = ok ? outcome.bytes : null;
    await client.query(STORE_SQL, [
      urlSha,
      sourceUrl,
      outcome.status,
      outcome.httpStatus,
      bytes,
      bytes ? sha256Hex(bytes) : null,
      ok ? outcome.contentType : null,
      bytes ? bytes.byteLength : null,
      ok ? null : new Date(deps.now() + OEM_RETRY_AFTER_MS),
    ]);
    await client.query("COMMIT");
    deps.log(
      `[oem-source] url_sha256=${urlSha} host=${host} status=${outcome.status} http=${outcome.httpStatus ?? "none"} bytes=${bytes?.byteLength ?? 0} ms=${deps.now() - started}`,
    );
    return bytes ? { kind: "ok", bytes, filename: pdfFilename(sourceUrl) } : { kind: "unavailable" };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

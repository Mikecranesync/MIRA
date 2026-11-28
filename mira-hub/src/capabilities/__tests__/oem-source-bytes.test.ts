// #6119: the server's copy of a public manufacturer manual. Every guard on the
// fetch (allowlist, redirect re-check, private address, PDF magic, size cap,
// negative cache) and the resolver's id-only input, with the DB and fetch stubbed.
// The real-Postgres half (migration 119, the grant, the resolver SQL against a
// private row, two concurrent misses) is oem-source-bytes.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/db", () => ({ default: {} }));

import {
  OEM_SOURCE_HOSTS,
  RESOLVE_SOURCE_SQL,
  allowedSourceUrl,
  fetchOemPdf,
  isPrivateAddress,
  looksLikePdf,
  STORE_SQL,
  oemCitationLink,
  oemSourceBytes,
  oemSourceEntryId,
  pdfFilename,
  type FetchDeps,
  type SourceDeps,
} from "../oem-source-bytes";

const ENTRY = "6119beef-0000-4000-8000-000000000001";
const URL_OK = "https://cache.industry.siemens.com/dl/files/g120.pdf";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n%%EOF\n");

type Row = { url: string; isPrivate: boolean };
type Stored = { status: string; content: Buffer | null; retry_after: Date | null; http_status: number | null; fetched_at: Date };
/** The database clock at the store; the result must carry this, not the request time. */
const STORED_AT = new Date("2026-11-20T08:00:00.000Z");

/** A database that honours the resolver's predicate (non-private, http(s)) and keeps the cache in memory. */
function fakeDb(entries: Record<string, Row>) {
  const cache = new Map<string, Stored>();
  const stores: string[] = [];
  const run = async (sql: string, params: unknown[] = []) => {
    if (sql === RESOLVE_SOURCE_SQL) {
      const e = entries[String(params[0])];
      return { rows: e && !e.isPrivate && /^https?:\/\//.test(e.url) ? [{ source_url: e.url }] : [] };
    }
    if (sql.startsWith("SELECT status, content, retry_after, fetched_at FROM oem_source_documents")) {
      const s = cache.get(String(params[0]));
      return { rows: s ? [s] : [] };
    }
    if (sql.startsWith("INSERT INTO oem_source_documents")) {
      const [sha, , status, http, content, , , , retryAfter] = params as [string, string, string, number | null, Buffer | null, string, string, number, Date | null];
      // Mirrors STORE_SQL's WHERE: a stored good copy is never replaced.
      if (cache.get(sha)?.status !== "ok") cache.set(sha, { status, content, retry_after: retryAfter, http_status: http, fetched_at: STORED_AT });
      stores.push(status);
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { db: { query: run }, cache, stores };
}

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    return r ? r() : new Response("missing", { status: 404 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const publicDns = async () => ["23.0.0.10"];

function deps(db: ReturnType<typeof fakeDb>["db"], f: typeof fetch, over: Partial<FetchDeps> = {}, now = 1_000_000): SourceDeps {
  return {
    db: db as unknown as SourceDeps["db"],
    fetch: { fetch: f, resolve: publicDns, timeoutMs: 5_000, maxBytes: 1024, ...over },
    now: () => now,
    log: () => undefined,
  };
}

describe("allowedSourceUrl — https on a curated vendor host, nothing else", () => {
  it("accepts an allowlisted https manual", () => {
    expect(allowedSourceUrl(URL_OK)?.hostname).toBe("cache.industry.siemens.com");
  });
  it("refuses http, other hosts, look-alike hosts, credentials and odd ports", () => {
    expect(allowedSourceUrl("http://cache.industry.siemens.com/x.pdf")).toBeNull();
    expect(allowedSourceUrl("https://evil.example.com/x.pdf")).toBeNull();
    expect(allowedSourceUrl("https://cache.industry.siemens.com.evil.example/x.pdf")).toBeNull();
    expect(allowedSourceUrl("https://user:pw@cache.industry.siemens.com/x.pdf")).toBeNull();
    expect(allowedSourceUrl("https://cache.industry.siemens.com:8443/x.pdf")).toBeNull();
    expect(allowedSourceUrl("not a url")).toBeNull();
  });
});

describe("OEM_SOURCE_HOSTS matches the curated OEM tiers of mira-crawler/sources.yaml", () => {
  it("is exactly the hosts of 3_manufacturer and 5_reference", () => {
    const yaml = readFileSync(join(__dirname, "../../../../mira-crawler/sources.yaml"), "utf8");
    const hosts = new Set<string>();
    let tier = "";
    for (const line of yaml.split("\n")) {
      const t = /^ {2}(\d_\w+):/.exec(line);
      if (t) tier = t[1];
      const u = /url:\s*"?(https?:\/\/[^/"\s]+)/.exec(line);
      if (u && (tier === "3_manufacturer" || tier === "5_reference")) hosts.add(new URL(u[1]).hostname);
    }
    expect(hosts.size).toBeGreaterThan(5);
    expect([...OEM_SOURCE_HOSTS].sort()).toEqual([...hosts].sort());
  });
});

describe("isPrivateAddress — the server never connects inward", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.12", "169.254.169.254", "100.70.49.126", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "garbage"])(
    "%s is refused",
    (a) => expect(isPrivateAddress(a)).toBe(true),
  );
  it.each(["23.0.0.10", "8.8.8.8", "2606:4700::1111"])("%s is public (control)", (a) => expect(isPrivateAddress(a)).toBe(false));
});

describe("small helpers", () => {
  it("looksLikePdf needs the %PDF- magic", () => {
    expect(looksLikePdf(PDF)).toBe(true);
    expect(looksLikePdf(Buffer.from("<html>"))).toBe(false);
  });
  it("pdfFilename is the last path segment, made safe", () => {
    expect(pdfFilename(URL_OK)).toBe("g120.pdf");
    expect(pdfFilename("https://cache.industry.siemens.com/")).toBe("manual.pdf");
  });
  it("the resolver reads only non-private rows with a web address", () => {
    expect(RESOLVE_SOURCE_SQL).toMatch(/is_private = false/);
    expect(RESOLVE_SOURCE_SQL).toMatch(/source_url ~ '\^https\?:\/\/'/);
  });
});

describe("oemSourceBytes — id in, bytes out; the URL never comes from the client", () => {
  it("a non-UUID id, an unknown id, a private row and a non-http URL are not found, and nothing is fetched", async () => {
    const { db } = fakeDb({
      [ENTRY]: { url: URL_OK, isPrivate: true },
      "6119beef-0000-4000-8000-000000000002": { url: "hub-upload://t/x.pdf", isPrivate: false },
    });
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF) });
    for (const id of ["../../etc/passwd", "6119beef-0000-4000-8000-00000000000f", ENTRY, "6119beef-0000-4000-8000-000000000002"]) {
      expect(await oemSourceBytes(id, deps(db, f.fn))).toEqual({ kind: "not_found" });
    }
    expect(f.calls).toEqual([]);
  });

  it("a miss fetches once, stores, then serves; the next call is a cache hit with no fetch", async () => {
    const { db, stores } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF) });
    const first = await oemSourceBytes(ENTRY, deps(db, f.fn));
    expect(first).toEqual({ kind: "ok", bytes: PDF, filename: "g120.pdf", fetchedAt: STORED_AT.toISOString() });
    expect(stores).toEqual(["ok"]);
    const second = await oemSourceBytes(ENTRY, deps(db, f.fn, {}, Date.parse("2026-12-01T00:00:00Z")));
    // The copy's own fetch date, not the time of this request: the viewer labels the page with it.
    expect(second).toEqual({ kind: "ok", bytes: PDF, filename: "g120.pdf", fetchedAt: STORED_AT.toISOString() });
    expect(f.calls).toEqual([URL_OK]);
  });

  it("a stored row with a host off the allowlist is unavailable and never fetched", async () => {
    const { db, stores } = fakeDb({ [ENTRY]: { url: "https://evil.example.com/x.pdf", isPrivate: false } });
    const f = fakeFetch({ "https://evil.example.com/x.pdf": () => new Response(PDF) });
    expect(await oemSourceBytes(ENTRY, deps(db, f.fn))).toEqual({ kind: "unavailable" });
    expect(f.calls).toEqual([]);
    expect(stores).toEqual([]);
  });

  it("a redirect off the allowlist stores no bytes and is unavailable", async () => {
    const { db, cache } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const f = fakeFetch({
      [URL_OK]: () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/x.pdf" } }),
      "https://evil.example.com/x.pdf": () => new Response(PDF),
    });
    expect(await oemSourceBytes(ENTRY, deps(db, f.fn))).toEqual({ kind: "unavailable" });
    expect(f.calls).toEqual([URL_OK]);
    expect([...cache.values()].every((r) => r.content === null)).toBe(true);
  });

  it("control — a redirect that stays on the allowlist is followed", async () => {
    const next = "https://cache.industry.siemens.com/dl/files/g120-r2.pdf";
    const { db } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const f = fakeFetch({
      [URL_OK]: () => new Response(null, { status: 301, headers: { location: next } }),
      [next]: () => new Response(PDF),
    });
    expect((await oemSourceBytes(ENTRY, deps(db, f.fn))).kind).toBe("ok");
    expect(f.calls).toEqual([URL_OK, next]);
  });

  it("a body that is not a PDF is stored as not_pdf and served as unavailable", async () => {
    const { db, stores } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const f = fakeFetch({ [URL_OK]: () => new Response("<html>login</html>", { headers: { "content-type": "application/pdf" } }) });
    expect(await oemSourceBytes(ENTRY, deps(db, f.fn))).toEqual({ kind: "unavailable" });
    expect(stores).toEqual(["not_pdf"]);
  });

  it("an oversize body is aborted and stored as too_large", async () => {
    const { db, stores } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const big = Buffer.concat([PDF, Buffer.alloc(4096)]);
    const f = fakeFetch({ [URL_OK]: () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(big)); c.close(); } })) });
    expect(await oemSourceBytes(ENTRY, deps(db, f.fn))).toEqual({ kind: "unavailable" });
    expect(stores).toEqual(["too_large"]);
  });

  it("a declared oversize length is refused before reading", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF, { headers: { "content-length": "999999" } }) });
    const out = await fetchOemPdf(URL_OK, { fetch: f.fn, resolve: publicDns, timeoutMs: 5_000, maxBytes: 1024 });
    expect(out.status).toBe("too_large");
  });

  it("a vendor 403 is host_refused with a retry window, and the next call does not fetch", async () => {
    const { db, cache } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const f = fakeFetch({ [URL_OK]: () => new Response("no", { status: 403 }) });
    expect(await oemSourceBytes(ENTRY, deps(db, f.fn))).toEqual({ kind: "unavailable" });
    const row = [...cache.values()][0];
    expect(row.status).toBe("host_refused");
    expect(row.http_status).toBe(403);
    expect(row.retry_after!.getTime()).toBeGreaterThan(1_000_000);
    expect(await oemSourceBytes(ENTRY, deps(db, f.fn))).toEqual({ kind: "unavailable" });
    expect(f.calls).toEqual([URL_OK]);
  });

  it("control — once the retry window has passed, the vendor is asked again", async () => {
    const { db } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    let status = 403;
    const f = fakeFetch({ [URL_OK]: () => (status === 403 ? new Response("no", { status }) : new Response(PDF)) });
    await oemSourceBytes(ENTRY, deps(db, f.fn, {}, 1_000_000));
    status = 200;
    const later = 1_000_000 + 7 * 60 * 60 * 1000;
    expect((await oemSourceBytes(ENTRY, deps(db, f.fn, {}, later))).kind).toBe("ok");
    expect(f.calls).toEqual([URL_OK, URL_OK]);
  });

  it("a host that resolves to a private address is never fetched", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF) });
    const out = await fetchOemPdf(URL_OK, { fetch: f.fn, resolve: async () => ["10.0.0.5"], timeoutMs: 5_000, maxBytes: 1024 });
    expect(out.status).toBe("fetch_failed");
    expect(f.calls).toEqual([]);
  });

  it("more than three redirects is a failure", async () => {
    const hop = (n: number) => `https://cache.industry.siemens.com/r${n}.pdf`;
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 6; i++) routes[hop(i)] = () => new Response(null, { status: 302, headers: { location: hop(i + 1) } });
    const f = fakeFetch(routes);
    const out = await fetchOemPdf(hop(0), { fetch: f.fn, resolve: publicDns, timeoutMs: 5_000, maxBytes: 1024 });
    expect(out.status).toBe("fetch_failed");
    expect(f.calls).toHaveLength(4);
  });
});

describe("oemSourceEntryId — which citations open the Hub's copy", () => {
  beforeEach(() => vi.stubEnv("MIRA_OEM_VIEWER", "1"));
  afterEach(() => vi.unstubAllEnvs());
  const shared = { docId: null, isPrivate: false, entryId: ENTRY, sourceUrl: URL_OK };
  it("a public manufacturer manual chunk carries its row id", () => {
    expect(oemSourceEntryId(shared)).toBe(ENTRY);
  });
  it("a private row never does, even with a web address", () => {
    expect(oemSourceEntryId({ ...shared, isPrivate: true })).toBeNull();
    expect(oemSourceEntryId({ ...shared, isPrivate: undefined })).toBeNull();
  });
  it("an upload keeps its file link alone", () => {
    expect(oemSourceEntryId({ ...shared, docId: "doc-1" })).toBeNull();
  });
  it("no web address, or no row id, is nothing to open", () => {
    expect(oemSourceEntryId({ ...shared, sourceUrl: "hub-upload://t/x.pdf" })).toBeNull();
    expect(oemSourceEntryId({ ...shared, entryId: null })).toBeNull();
  });
  it("default off: with MIRA_OEM_VIEWER unset or not 1/true, no citation opens the Hub's copy", () => {
    vi.stubEnv("MIRA_OEM_VIEWER", "");
    expect(oemSourceEntryId(shared)).toBeNull();
    vi.stubEnv("MIRA_OEM_VIEWER", "0");
    expect(oemSourceEntryId(shared)).toBeNull();
    vi.stubEnv("MIRA_OEM_VIEWER", "true");
    expect(oemSourceEntryId(shared)).toBe(ENTRY);
  });
  it("an address the Hub would refuse to fetch keeps its raw vendor link (no dead end)", () => {
    expect(oemSourceEntryId({ ...shared, sourceUrl: "https://forum.example.com/t/123" })).toBeNull();
    expect(oemSourceEntryId({ ...shared, sourceUrl: "http://cache.industry.siemens.com/dl/files/g120.pdf" })).toBeNull();
  });
});

describe("oemCitationLink — the page the viewer draws", () => {
  beforeEach(() => vi.stubEnv("MIRA_OEM_VIEWER", "1"));
  afterEach(() => vi.unstubAllEnvs());
  const shared = { docId: null, isPrivate: false, entryId: ENTRY, sourceUrl: URL_OK };
  it("a legacy chunk ordinal stored as the page (sourcePage === chunkIndex) is no page", () => {
    expect(oemCitationLink({ ...shared, sourcePage: 47, chunkIndex: 47 })).toEqual({ sourceEntryId: ENTRY, page: null });
  });
  it("control — a real page is kept", () => {
    expect(oemCitationLink({ ...shared, sourcePage: 906, chunkIndex: 12 })).toEqual({ sourceEntryId: ENTRY, page: 906 });
    expect(oemCitationLink({ ...shared, sourcePage: 906, chunkIndex: null })).toEqual({ sourceEntryId: ENTRY, page: 906 });
  });
  it("no Hub copy means no link at all", () => {
    expect(oemCitationLink({ ...shared, isPrivate: true, sourcePage: 9, chunkIndex: 1 })).toBeNull();
  });
});

describe("only a complete PDF is ever stored", () => {
  const fd = (f: typeof fetch, over: Partial<FetchDeps> = {}): FetchDeps => ({ fetch: f, resolve: publicDns, timeoutMs: 5_000, maxBytes: 1024, ...over });
  it("a 206 partial response is a failure, never a document", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF, { status: 206 }) });
    expect((await fetchOemPdf(URL_OK, fd(f.fn))).status).toBe("fetch_failed");
  });
  it("a 200 cut off before the %%EOF trailer is not_pdf", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(Buffer.from("%PDF-1.7\n1 0 obj\n")) });
    expect((await fetchOemPdf(URL_OK, fd(f.fn))).status).toBe("not_pdf");
  });
  it("a body shorter than its declared content-length is not_pdf", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF, { headers: { "content-length": String(PDF.byteLength + 10) } }) });
    expect((await fetchOemPdf(URL_OK, fd(f.fn))).status).toBe("not_pdf");
  });
  it("control — a complete 200 PDF with a matching length is ok", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF, { headers: { "content-length": String(PDF.byteLength) } }) });
    expect((await fetchOemPdf(URL_OK, fd(f.fn))).status).toBe("ok");
  });
  it("a DNS lookup that never answers is held to the fetch deadline", async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(PDF) });
    const out = await fetchOemPdf(URL_OK, fd(f.fn, { resolve: () => new Promise<string[]>(() => undefined), timeoutMs: 30 }));
    expect(out.status).toBe("fetch_failed");
    expect(f.calls).toEqual([]);
  });
  it("a stored good copy is never replaced (the write only overwrites a non-ok row)", () => {
    expect(STORE_SQL).toMatch(/ON CONFLICT \(url_sha256\) DO UPDATE SET[\s\S]*WHERE oem_source_documents\.status <> 'ok'\s*$/);
  });
});

describe("downloads: one per manual, at most two at once, no held connection", () => {
  /** A fetch that waits until released, so concurrent callers overlap. */
  function gatedFetch() {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      await gate;
      return new Response(PDF);
    });
    return { fn: fn as unknown as typeof fetch, calls, release };
  }
  const urlN = (n: number) => `https://cache.industry.siemens.com/dl/files/m${n}.pdf`;
  const idN = (n: number) => `6119beef-0000-4000-8000-00000000010${n}`;

  it("concurrent misses for one manual share a single download", async () => {
    const { db } = fakeDb({ [ENTRY]: { url: URL_OK, isPrivate: false } });
    const g = gatedFetch();
    const all = Promise.all([1, 2, 3].map(() => oemSourceBytes(ENTRY, deps(db, g.fn))));
    await vi.waitFor(() => expect(g.calls).toHaveLength(1));
    g.release();
    const out = await all;
    expect(out.map((r) => r.kind)).toEqual(["ok", "ok", "ok"]);
    expect(g.calls).toEqual([URL_OK]);
  });

  it("a third distinct manual while two download answers unavailable at once, without fetching", async () => {
    const entries = Object.fromEntries([1, 2, 3].map((n) => [idN(n), { url: urlN(n), isPrivate: false }]));
    const { db } = fakeDb(entries);
    const g = gatedFetch();
    const first = [oemSourceBytes(idN(1), deps(db, g.fn)), oemSourceBytes(idN(2), deps(db, g.fn))];
    await vi.waitFor(() => expect(g.calls).toHaveLength(2));
    expect(await oemSourceBytes(idN(3), deps(db, g.fn))).toEqual({ kind: "unavailable" });
    expect(g.calls).toEqual([urlN(1), urlN(2)]);
    g.release();
    expect((await Promise.all(first)).map((r) => r.kind)).toEqual(["ok", "ok"]);
    // control — once they finish, the third is fetched normally
    expect((await oemSourceBytes(idN(3), deps(db, g.fn))).kind).toBe("ok");
  });
});

// #6119: the server's copy of a public manufacturer manual. Every guard on the
// fetch (allowlist, redirect re-check, private address, PDF magic, size cap,
// negative cache) and the resolver's id-only input, with the DB and fetch stubbed.
// The real-Postgres half (migration 119, the grant, the resolver SQL against a
// private row, two concurrent misses) is oem-source-bytes.integration.test.ts.
import { describe, expect, it, vi } from "vitest";
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
  oemSourceBytes,
  oemSourceEntryId,
  pdfFilename,
  type FetchDeps,
  type SourceDeps,
} from "../oem-source-bytes";

const ENTRY = "6119beef-0000-4000-8000-000000000001";
const URL_OK = "https://cache.industry.siemens.com/dl/files/g120.pdf";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n");

type Row = { url: string; isPrivate: boolean };
type Stored = { status: string; content: Buffer | null; retry_after: Date | null; http_status: number | null };

/** A database that honours the resolver's predicate (non-private, http(s)) and keeps the cache in memory. */
function fakeDb(entries: Record<string, Row>) {
  const cache = new Map<string, Stored>();
  const stores: string[] = [];
  const run = async (sql: string, params: unknown[] = []) => {
    if (sql === RESOLVE_SOURCE_SQL) {
      const e = entries[String(params[0])];
      return { rows: e && !e.isPrivate && /^https?:\/\//.test(e.url) ? [{ source_url: e.url }] : [] };
    }
    if (sql.startsWith("SELECT status, content, retry_after FROM oem_source_documents")) {
      const s = cache.get(String(params[0]));
      return { rows: s ? [s] : [] };
    }
    if (sql.startsWith("INSERT INTO oem_source_documents")) {
      const [sha, , status, http, content, , , , retryAfter] = params as [string, string, string, number | null, Buffer | null, string, string, number, Date | null];
      cache.set(sha, { status, content, retry_after: retryAfter, http_status: http });
      stores.push(status);
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { db: { query: run, connect: async () => ({ query: run, release: () => undefined }) }, cache, stores };
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
    expect(first).toEqual({ kind: "ok", bytes: PDF, filename: "g120.pdf" });
    expect(stores).toEqual(["ok"]);
    const second = await oemSourceBytes(ENTRY, deps(db, f.fn));
    expect(second.kind).toBe("ok");
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
});

// Vitest coverage for src/lib/manual-discovery.ts — the best-effort client for
// the mira-ask manual-discovery router.
//
// The rule being protected: when the search service is unavailable the client
// says so and returns NOTHING. It never fabricates a URL, never synthesizes a
// candidate, and never lets "we could not look" masquerade as "nothing exists".
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/manual-discovery.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverManual, allowedHostsForCandidate } from "@/lib/manual-discovery";

const IDENTITY = { manufacturer: "Allen-Bradley", model: "525", catalogNumber: "25B-D010N104" };
const CTX = { tenantId: "test-tenant", userId: "test-user" };

const FOUND_BODY = {
  found: true,
  candidate: {
    url: "https://literature.rockwellautomation.com/idc/520-um001_-en-e.pdf",
    title: "PowerFlex 520-Series User Manual",
    host: "literature.rockwellautomation.com",
    score: 0.94,
    doc_type: "user_manual",
    is_direct_pdf: true,
    validated: true,
  },
  validated: true,
  is_direct_pdf: true,
  oem_host: true,
  reason: "validated OEM PDF",
};

beforeEach(() => {
  delete process.env.MIRA_ASK_URL;
  delete process.env.ASK_API_KEY;
  delete process.env.MANUAL_DISCOVERY_API_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("discoverManual — happy path", () => {
  it("maps the router response into a typed candidate", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(FOUND_BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(true);
    expect(res.found).toBe(true);
    expect(res.validated).toBe(true);
    expect(res.isDirectPdf).toBe(true);
    expect(res.oemHost).toBe(true);
    expect(res.candidate).toMatchObject({
      url: FOUND_BODY.candidate.url,
      host: "literature.rockwellautomation.com",
      docType: "user_manual",
      isDirectPdf: true,
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://mira-ask:8011/manual-discovery/search");
    expect(JSON.parse(String(init.body))).toEqual({
      manufacturer: "Allen-Bradley",
      model: "525",
      catalog_number: "25B-D010N104",
    });
    // No key configured → no header.
    expect((init.headers as Record<string, string>)["X-Mira-Key"]).toBeUndefined();
    // #4160 S4: required identity headers always sent.
    expect((init.headers as Record<string, string>)["X-Mira-Tenant"]).toBe("test-tenant");
    expect((init.headers as Record<string, string>)["X-Mira-User"]).toBe("test-user");
  });

  it("never calls the service when ctx.userId is null, and refuses honestly", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await discoverManual(IDENTITY, { tenantId: "t1", userId: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.serviceAvailable).toBe(false);
    expect(res.found).toBe(false);
    expect(res.quotaExceeded).toBe(false);
    expect(res.reason).toMatch(/signed-in user/i);
  });

  it("never calls the service when ctx.tenantId is blank", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await discoverManual(IDENTITY, { tenantId: "   ", userId: "u1" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.serviceAvailable).toBe(false);
  });

  it("honors MIRA_ASK_URL and sends X-Mira-Key when MANUAL_DISCOVERY_API_KEY is set", async () => {
    process.env.MIRA_ASK_URL = "http://ask.internal:9000/";
    process.env.MANUAL_DISCOVERY_API_KEY = "k123";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(FOUND_BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await discoverManual(IDENTITY, CTX);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ask.internal:9000/manual-discovery/search");
    expect((init.headers as Record<string, string>)["X-Mira-Key"]).toBe("k123");
  });

  // #4160 S2: the endpoint has its own key. The shared ASK_API_KEY belongs to
  // the kiosk-facing endpoints and must not leak to this one.
  it("never sends the shared ASK_API_KEY to the discovery endpoint", async () => {
    process.env.ASK_API_KEY = "shared-kiosk-key";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(FOUND_BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await discoverManual(IDENTITY, CTX);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Mira-Key"]).toBeUndefined();
  });
});

describe("discoverManual — honest degradation", () => {
  it("reports 'search service unavailable' when the router refuses an unconfigured key (503)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "manual discovery is not configured" }), { status: 503 }),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(false);
    expect(res.found).toBe(false);
    expect(res.candidate).toBeNull();
  });

  it("reports 'search service unavailable' on a network failure and invents nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(false);
    expect(res.found).toBe(false);
    expect(res.candidate).toBeNull();
    expect(res.reason).toBe("search service unavailable");
  });

  it("reports unavailable on a non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(false);
    expect(res.candidate).toBeNull();
  });

  it("reports unavailable on a malformed body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(false);
    expect(res.candidate).toBeNull();
  });

  it("distinguishes 'found nothing' from 'could not look'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ found: false, candidate: null, reason: "no OEM PDF" }), {
          status: 200,
        }),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(true);
    expect(res.found).toBe(false);
    expect(res.reason).toBe("no OEM PDF");
  });

  it("treats a found:true body with no URL as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ found: true, candidate: { title: "x" } }), { status: 200 }),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.found).toBe(false);
    expect(res.candidate).toBeNull();
  });

  // ── #4160 S4: a quota denial must never look like "no manual exists" ──────

  it("maps reason=quota_exceeded to a distinct quotaExceeded result, not a plain miss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            found: false,
            candidate: null,
            reason: "quota_exceeded",
            reason_detail: "Daily manual-search limit reached for this user.",
          }),
          { status: 200 },
        ),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.serviceAvailable).toBe(true);
    expect(res.found).toBe(false);
    expect(res.quotaExceeded).toBe(true);
    expect(res.reason).toBe("Daily manual-search limit reached for this user.");
  });

  it("a quota_exceeded body with no reason_detail still reports quotaExceeded with a sane reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ found: false, candidate: null, reason: "quota_exceeded" }), {
          status: 200,
        }),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.quotaExceeded).toBe(true);
    expect(res.reason.length).toBeGreaterThan(0);
  });

  it("control: a plain miss (no cap language in reason) is NOT quotaExceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ found: false, candidate: null, reason: "no_result" }), {
          status: 200,
        }),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    expect(res.quotaExceeded).toBe(false);
  });

  it("a server-reported reason=search_unavailable (quota_unavailable or a timeout) is 'could not look', not 'found nothing' (pre-existing defect fixed in S4)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ found: false, candidate: null, reason: "search_unavailable" }),
          { status: 200 },
        ),
      ),
    );
    const res = await discoverManual(IDENTITY, CTX);
    // Before the fix this was serviceAvailable:true (notFound()) — acquisition
    // then reported "no_manual_found" for what was actually an infra miss.
    expect(res.serviceAvailable).toBe(false);
    expect(res.found).toBe(false);
    expect(res.quotaExceeded).toBe(false);
  });

  it("never calls the service without a manufacturer and a model/catalog", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await discoverManual({ manufacturer: "Allen-Bradley" }, CTX);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.found).toBe(false);
    expect(res.reason).toMatch(/manufacturer and model/i);
  });
});

describe("allowedHostsForCandidate", () => {
  it("includes the candidate host, its registrable parent, and known OEM domains", () => {
    const hosts = allowedHostsForCandidate(
      { manufacturer: "Allen-Bradley" },
      { host: "literature.rockwellautomation.com" },
    );
    expect(hosts).toContain("literature.rockwellautomation.com");
    expect(hosts).toContain("rockwellautomation.com");
  });

  it("never returns an empty allowlist silently for an unknown manufacturer", () => {
    const hosts = allowedHostsForCandidate({ manufacturer: "Obscure GmbH" }, { host: "docs.obscure.de" });
    expect(hosts).toEqual(expect.arrayContaining(["docs.obscure.de", "obscure.de"]));
  });
});

// ── #3400: the INDEPENDENT OEM-host predicate ───────────────────────────────
//
// This is a security gate, not a convenience. The confirm route uses it to
// decide whether an UNVALIDATED discovery candidate may be handed to
// safeDownloadPdf at all. It must never say yes on the discovery service's
// word alone — it re-derives the answer from our own OEM domain table.
describe("isOemDocumentationHost", () => {
  it("accepts the manufacturer own documentation subdomain", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    // The real Siemens case from #3400.
    expect(isOemDocumentationHost("SIEMENS", "support.industry.siemens.com")).toBe(true);
    expect(isOemDocumentationHost("Siemens", "siemens.com")).toBe(true);
    expect(isOemDocumentationHost("Allen-Bradley", "literature.rockwellautomation.com")).toBe(true);
  });

  it("rejects a third-party manual aggregator", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    expect(isOemDocumentationHost("SIEMENS", "manualslib.com")).toBe(false);
    expect(isOemDocumentationHost("SIEMENS", "scribd.com")).toBe(false);
  });

  it("rejects a lookalike domain that merely ENDS with the OEM name", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    // The classic suffix-match bug: notsiemens.com must not pass as siemens.com.
    expect(isOemDocumentationHost("SIEMENS", "notsiemens.com")).toBe(false);
    expect(isOemDocumentationHost("SIEMENS", "siemens.com.evil.net")).toBe(false);
    expect(isOemDocumentationHost("SIEMENS", "evilsiemens.com")).toBe(false);
  });

  it("rejects another manufacturer domain", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    expect(isOemDocumentationHost("SIEMENS", "literature.rockwellautomation.com")).toBe(false);
  });

  it("accepts SMC regional documentation hosts and rejects lookalikes", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    // 2026-09-29 staging probe: the real VQ(C)1000 manual is on static.smc.eu.
    expect(isOemDocumentationHost("SMC", "static.smc.eu")).toBe(true);
    expect(isOemDocumentationHost("SMC", "content2.smcetech.com")).toBe(true);
    expect(isOemDocumentationHost("SMC Corporation", "www.smcworld.com")).toBe(true);
    expect(isOemDocumentationHost("SMC", "notsmc.eu")).toBe(false);
    expect(isOemDocumentationHost("SMC", "smc.eu.attacker.net")).toBe(false);
  });

  it("rejects when the manufacturer is unknown to the table", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    expect(isOemDocumentationHost("Nobody Inc", "nobody.com")).toBe(false);
  });

  it("rejects empty or missing input rather than defaulting to trust", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    expect(isOemDocumentationHost("", "support.industry.siemens.com")).toBe(false);
    expect(isOemDocumentationHost("SIEMENS", "")).toBe(false);
    expect(isOemDocumentationHost(null, null)).toBe(false);
    expect(isOemDocumentationHost(undefined, undefined)).toBe(false);
  });

  it("is case and whitespace insensitive", async () => {
    const { isOemDocumentationHost } = await import("../manual-discovery");
    expect(isOemDocumentationHost("  siemens  ", "  SUPPORT.INDUSTRY.SIEMENS.COM  ")).toBe(true);
  });
});

describe("discoverManual — judge rejections disappear honestly", () => {
  it("renders the judge's reason_detail and the OEM request link when everything read was rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            found: false,
            candidate: null,
            validated: false,
            is_direct_pdf: false,
            oem_host: false,
            trusted_distributor_host: false,
            reason: "judged_not_applicable",
            reason_detail: "Read the PDF: a newspaper article about a car show.",
            judged_rejected: [{ url: "https://linpub.example/news.pdf", reason: "newspaper" }],
            oem_request_url: "https://www.harringtonhoists.com/owners-manual-request",
          }),
          { status: 200 },
        ),
      ),
    );
    const r = await discoverManual({ manufacturer: "Harrington", model: "UMS3-0335", catalogNumber: null }, CTX);
    expect(r.serviceAvailable).toBe(true);
    expect(r.found).toBe(false);
    expect(r.candidate).toBeNull();
    expect(r.reason).toBe("Read the PDF: a newspaper article about a car show.");
    expect(r.oemRequestUrl).toBe("https://www.harringtonhoists.com/owners-manual-request");
  });

  it("drops a non-https request link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ found: false, candidate: null, reason: "no_result", oem_request_url: "javascript:alert(1)" }), { status: 200 }),
      ),
    );
    const r = await discoverManual({ manufacturer: "X", model: "Y", catalogNumber: null }, CTX);
    expect(r.oemRequestUrl).toBeNull();
  });
});

// Vitest coverage for src/lib/safe-download.ts — the SSRF + size + content
// gates on an UNTRUSTED remote URL.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/safe-download.test.ts
//
// No network: global.fetch is stubbed per test. The oversized-body case uses a
// pull-counting ReadableStream so we can prove the body is aborted mid-stream
// rather than buffered and measured afterwards.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  safeDownloadPdf,
  isPublicHttpsUrl,
  isBlockedHost,
  hostAllowed,
  safePdfFilename,
} from "@/lib/safe-download";

const OEM = "literature.rockwellautomation.com";
const ALLOWED = ["rockwellautomation.com"];

function pdfResponse(body: string | Uint8Array, type = "application/pdf"): Response {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { "content-type": type } });
}

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { location: to } });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isPublicHttpsUrl", () => {
  it("accepts a plain https URL on the default port", () => {
    expect(isPublicHttpsUrl("https://literature.rockwellautomation.com/a.pdf")).toBe(true);
    expect(isPublicHttpsUrl("https://oem.example.com:443/a.pdf")).toBe(true);
  });
  it("rejects http, credentials, and non-standard ports", () => {
    expect(isPublicHttpsUrl("http://oem.example.com/a.pdf")).toBe(false);
    expect(isPublicHttpsUrl("https://user:pass@oem.example.com/a.pdf")).toBe(false);
    expect(isPublicHttpsUrl("https://user@oem.example.com/a.pdf")).toBe(false);
    expect(isPublicHttpsUrl("https://oem.example.com:9200/a.pdf")).toBe(false);
    expect(isPublicHttpsUrl("not a url")).toBe(false);
    expect(isPublicHttpsUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("isBlockedHost", () => {
  const blocked = [
    "localhost",
    "LOCALHOST",
    "api.localhost",
    "gateway.local",
    "mira-hub.internal",
    "metadata.google.internal",
    "127.0.0.1",
    "127.9.9.9",
    "10.0.0.5",
    "172.16.4.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "fd00::1",
    "fc00::1234",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:192.168.0.1",
    "::",
  ];
  for (const h of blocked) {
    it(`blocks ${h}`, () => expect(isBlockedHost(h)).toBe(true));
  }

  const allowed = [
    "literature.rockwellautomation.com",
    "8.8.8.8",
    "172.32.0.1",
    "192.169.1.1",
    "100.128.0.1",
    "2606:4700::1111",
  ];
  for (const h of allowed) {
    it(`allows ${h}`, () => expect(isBlockedHost(h)).toBe(false));
  }
});

describe("hostAllowed", () => {
  it("matches the exact host and dot-suffix subdomains", () => {
    expect(hostAllowed("rockwellautomation.com", ALLOWED)).toBe(true);
    expect(hostAllowed("literature.rockwellautomation.com", ALLOWED)).toBe(true);
    expect(hostAllowed("A.B.RockwellAutomation.COM", ALLOWED)).toBe(true);
  });
  it("does NOT match a lookalike that merely ends with the allowed string", () => {
    expect(hostAllowed("evil-rockwellautomation.com", ALLOWED)).toBe(false);
    expect(hostAllowed("rockwellautomation.com.evil.net", ALLOWED)).toBe(false);
    expect(hostAllowed("notrockwellautomation.com", ALLOWED)).toBe(false);
  });
  it("rejects when the allowlist is empty", () => {
    expect(hostAllowed("rockwellautomation.com", [])).toBe(false);
  });
});

describe("safePdfFilename", () => {
  it("sanitizes and forces a .pdf extension", () => {
    expect(safePdfFilename("https://oem.com/docs/520-um001_-en-e.pdf?token=abc")).toBe(
      "520-um001_-en-e.pdf",
    );
    expect(safePdfFilename("https://oem.com/")).toBe("manual.pdf");
    expect(safePdfFilename("https://oem.com/docs/um001.pdf")).toBe("um001.pdf");
    // Traversal + separators are neutralized, leading dots stripped.
    expect(safePdfFilename("https://oem.com/%2e%2e%2fetc%2fpasswd")).toBe("_etc_passwd.pdf");
    expect(safePdfFilename("https://oem.com/....pdf")).toBe("manual.pdf");
    expect(safePdfFilename(`https://oem.com/${"x".repeat(300)}.pdf`).length).toBeLessThanOrEqual(124);
  });
});

describe("safeDownloadPdf — SSRF gates", () => {
  it("rejects http://", async () => {
    const res = await safeDownloadPdf("http://rockwellautomation.com/a.pdf", {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    expect(res).toEqual({ ok: false, reason: "not_https" });
  });

  it("rejects credentials embedded in the URL", async () => {
    const res = await safeDownloadPdf("https://u:p@rockwellautomation.com/a.pdf", {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    expect(res).toEqual({ ok: false, reason: "url_credentials" });
  });

  it("rejects a non-standard port", async () => {
    const res = await safeDownloadPdf("https://rockwellautomation.com:9200/a.pdf", {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    expect(res).toEqual({ ok: false, reason: "non_standard_port" });
  });

  for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]"]) {
    it(`rejects the private/loopback host ${host}`, async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await safeDownloadPdf(`https://${host}/a.pdf`, {
        allowedHosts: [host.replace(/[[\]]/g, "")],
        maxBytes: 1024,
      });
      expect(res).toEqual({ ok: false, reason: "blocked_host" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("rejects a host that is not on the allowlist", async () => {
    const res = await safeDownloadPdf("https://evil-rockwellautomation.com/a.pdf", {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    expect(res).toEqual({ ok: false, reason: "host_not_allowed" });
  });
});

describe("safeDownloadPdf — redirects are revalidated", () => {
  it("rejects a redirect from an allowed host to a private IP", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://169.254.169.254/latest/meta-data"));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "blocked_host" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to a host outside the allowlist", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(redirect("https://evil.example.com/a.pdf"));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "host_not_allowed" });
  });

  it("rejects when the redirect limit is exceeded", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (u: string) => {
      const n = Number(new URL(u).pathname.replace(/\D/g, "") || "0");
      return redirect(`https://${OEM}/${n + 1}.pdf`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await safeDownloadPdf(`https://${OEM}/0.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(fetchSpy).toHaveBeenCalledTimes(4); // initial + 3 hops
  });

  it("follows an allowed same-domain redirect and returns the final URL", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://rockwellautomation.com/final.pdf"))
      .mockResolvedValueOnce(pdfResponse("%PDF-1.7\nreal manual bytes"));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.finalUrl).toBe("https://rockwellautomation.com/final.pdf");
      expect(res.contentType).toBe("application/pdf");
      expect(res.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});

describe("safeDownloadPdf — content validation", () => {
  it("rejects an HTML landing page served as application/pdf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(pdfResponse("<!doctype html><html>Sign in to download</html>")),
    );
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "not_pdf" });
  });

  it("rejects a wrong Content-Type even when the bytes are a PDF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(pdfResponse("%PDF-1.7 ok", "text/html; charset=utf-8")),
    );
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "wrong_content_type" });
  });

  it("accepts application/pdf with a charset parameter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(pdfResponse("%PDF-1.4 body", "application/pdf; charset=binary")),
    );
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "http_error" });
  });

  it("returns network_error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "network_error" });
  });
});

describe("safeDownloadPdf — maxBytes is enforced WHILE streaming", () => {
  it("aborts an oversized body mid-stream instead of buffering it", async () => {
    const CHUNK = 1024;
    const TOTAL_CHUNKS = 500; // 512 KB if fully read
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls === 0) {
          const head = new Uint8Array(CHUNK);
          head.set(new TextEncoder().encode("%PDF-1.7"));
          controller.enqueue(head);
        } else if (pulls < TOTAL_CHUNKS) {
          controller.enqueue(new Uint8Array(CHUNK));
        } else {
          controller.close();
        }
        pulls++;
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { "content-type": "application/pdf" } }),
      ),
    );

    const res = await safeDownloadPdf(`https://${OEM}/big.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4 * CHUNK,
    });
    expect(res).toEqual({ ok: false, reason: "too_large" });
    // Proof it stopped early: a buffer-then-measure implementation would have
    // pulled all 500 chunks.
    expect(pulls).toBeLessThan(12);
    expect(cancelled).toBe(true);
  });

  it("refuses before reading when Content-Length already exceeds the cap", async () => {
    const body = new Uint8Array(64);
    body.set(new TextEncoder().encode("%PDF-1.7"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/pdf", "content-length": "99999999" },
        }),
      ),
    );
    const res = await safeDownloadPdf(`https://${OEM}/big.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    expect(res).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a body exactly at the cap", async () => {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode("%PDF-1.7"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pdfResponse(bytes)));
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 32,
    });
    expect(res.ok).toBe(true);
  });
});

describe("safeDownloadPdf — logging discipline", () => {
  it("logs the host and reason code only, never the query string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await safeDownloadPdf("https://evil-rockwellautomation.com/a.pdf?key=SUPERSECRET", {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("evil-rockwellautomation.com");
    expect(logged).toContain("host_not_allowed");
    expect(logged).not.toContain("SUPERSECRET");
  });
});

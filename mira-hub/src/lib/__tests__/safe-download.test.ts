// Vitest coverage for src/lib/safe-download.ts — the SSRF + size + content
// gates on an UNTRUSTED remote URL, INCLUDING the connect-time DNS
// resolve-and-pin that closes the rebinding residual (PRD R6, #4160).
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/safe-download.test.ts
//
// No network, no real DNS, no real TLS socket: `__setResolverForTests` stubs
// what a hostname resolves to, and `__setTransportForTests` stubs what
// `https.request` would hand back — including the exact options (lookup,
// servername, rejectUnauthorized) the module would have used for a real
// socket, so tests can assert on the pin without opening one. The oversized-
// body case uses a pull-counting Readable so we can prove the body is
// destroyed mid-stream rather than buffered and measured afterwards.

import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  safeDownloadPdf,
  isPublicHttpsUrl,
  isBlockedHost,
  hostAllowed,
  safePdfFilename,
  __setResolverForTests,
  __setTransportForTests,
  type TransportResponse,
} from "@/lib/safe-download";

const OEM = "literature.rockwellautomation.com";
const ALLOWED = ["rockwellautomation.com"];
/** A harmless public IPv4 (example.com) — never actually dialed; the transport is always stubbed. */
const PUBLIC_IP = "93.184.216.34";

function pdfBody(bytes: string | Uint8Array): Readable {
  const buf = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  return Readable.from([buf]);
}

function pdfResponse(body: string | Uint8Array, type = "application/pdf"): TransportResponse {
  return { statusCode: 200, headers: { "content-type": type }, body: pdfBody(body) };
}

function redirectResponse(to: string, status = 302): TransportResponse {
  return { statusCode: status, headers: { location: to }, body: Readable.from([]) };
}

function errorResponse(status: number, text = "nope"): TransportResponse {
  return { statusCode: status, headers: {}, body: pdfBody(text) };
}

/** Any hostname resolves to one public, non-blocked IPv4 address. */
function pinPublic(): void {
  __setResolverForTests(async () => [{ address: PUBLIC_IP, family: 4 }]);
}

/** Every hostname resolves to exactly these records. */
function pinRecords(records: { address: string; family: number }[]): void {
  __setResolverForTests(async () => records);
}

/** Different DNS answers per hostname — e.g. hop 1 clean, hop 2 private. */
function pinByHost(map: Record<string, { address: string; family: number }[]>): void {
  __setResolverForTests(async (hostname: string) => map[hostname] ?? [{ address: PUBLIC_IP, family: 4 }]);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  __setResolverForTests(null);
  __setTransportForTests(null);
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
      const transportSpy = vi.fn();
      __setTransportForTests(transportSpy);
      const res = await safeDownloadPdf(`https://${host}/a.pdf`, {
        allowedHosts: [host.replace(/[[\]]/g, "")],
        maxBytes: 1024,
      });
      expect(res).toEqual({ ok: false, reason: "blocked_host" });
      expect(transportSpy).not.toHaveBeenCalled();
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
  it("rejects a redirect from an allowed host to a literal private IP", async () => {
    pinPublic();
    const transportSpy = vi.fn().mockResolvedValueOnce(redirectResponse("https://169.254.169.254/latest/meta-data"));
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "blocked_host" });
    expect(transportSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to a host outside the allowlist", async () => {
    pinPublic();
    const transportSpy = vi.fn().mockResolvedValueOnce(redirectResponse("https://evil.example.com/a.pdf"));
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "host_not_allowed" });
  });

  it("rejects when the redirect limit is exceeded", async () => {
    pinPublic();
    const transportSpy = vi.fn().mockImplementation(async (_options: RequestOptions, url: URL) => {
      const n = Number(url.pathname.replace(/\D/g, "") || "0");
      return redirectResponse(`https://${OEM}/${n + 1}.pdf`);
    });
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf(`https://${OEM}/0.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(transportSpy).toHaveBeenCalledTimes(4); // initial + 3 hops
  });

  it("follows an allowed same-domain redirect and returns the final URL", async () => {
    pinPublic();
    const transportSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://rockwellautomation.com/final.pdf"))
      .mockResolvedValueOnce(pdfResponse("%PDF-1.7\nreal manual bytes"));
    __setTransportForTests(transportSpy);
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

describe("safeDownloadPdf — DNS resolve-and-pin (connect-time rebinding guard, #4160 S3b)", () => {
  it("rejects an allowlisted host whose resolver returns a private address, and never makes a request", async () => {
    pinRecords([{ address: "10.0.0.5", family: 4 }]);
    const transportSpy = vi.fn();
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, { allowedHosts: ALLOWED, maxBytes: 4096 });
    expect(res).toEqual({ ok: false, reason: "blocked_address" });
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it("rejects when ANY resolved address is private, even if another is public (mixed)", async () => {
    pinRecords([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const transportSpy = vi.fn();
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, { allowedHosts: ALLOWED, maxBytes: 4096 });
    expect(res).toEqual({ ok: false, reason: "blocked_address" });
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["::ffff:169.254.169.254", 6],
    ["100.68.1.2", 4],
  ])("rejects the resolved address %s", async (address, family) => {
    pinRecords([{ address, family }]);
    const transportSpy = vi.fn();
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, { allowedHosts: ALLOWED, maxBytes: 4096 });
    expect(res).toEqual({ ok: false, reason: "blocked_address" });
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it("rejects a redirect to an allowed host whose DNS resolves private (blocked_address on hop 2)", async () => {
    const hosts = ["oem-a.example.com", "oem-b.example.com"];
    pinByHost({ "oem-b.example.com": [{ address: "10.0.0.9", family: 4 }] });
    const transportSpy = vi.fn().mockResolvedValueOnce(redirectResponse("https://oem-b.example.com/manual.pdf"));
    __setTransportForTests(transportSpy);
    const res = await safeDownloadPdf("https://oem-a.example.com/a.pdf", {
      allowedHosts: hosts,
      maxBytes: 4096,
    });
    expect(res).toEqual({ ok: false, reason: "blocked_address" });
    // Hop 1 made a request (it was clean); hop 2 was rejected before any
    // socket/transport call was made for it.
    expect(transportSpy).toHaveBeenCalledTimes(1);
  });

  it("connects the socket to exactly the address the check approved", async () => {
    pinRecords([{ address: "203.0.113.7", family: 4 }]);
    let capturedAddress: string | undefined;
    let capturedFamily: number | undefined;
    __setTransportForTests(async (options) => {
      await new Promise<void>((resolve) => {
        options.lookup!(OEM, {} as never, (_err, address, family) => {
          capturedAddress = address as string;
          capturedFamily = family;
          resolve();
        });
      });
      return pdfResponse("%PDF-1.7 body");
    });
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, { allowedHosts: ALLOWED, maxBytes: 4096 });
    expect(res.ok).toBe(true);
    expect(capturedAddress).toBe("203.0.113.7");
    expect(capturedFamily).toBe(4);
  });

  it("never disables TLS verification and keeps servername/hostname as the URL hostname", async () => {
    pinPublic();
    let seenOptions: RequestOptions | undefined;
    __setTransportForTests(async (options) => {
      seenOptions = options;
      return pdfResponse("%PDF-1.7 body");
    });
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, { allowedHosts: ALLOWED, maxBytes: 4096 });
    expect(res.ok).toBe(true);
    expect(seenOptions?.rejectUnauthorized).not.toBe(false);
    expect(seenOptions?.servername).toBe(OEM);
    expect(seenOptions?.hostname).toBe(OEM);
  });
});

describe("safeDownloadPdf — content validation", () => {
  beforeEach(() => {
    pinPublic();
  });

  it("rejects an HTML landing page served as application/pdf", async () => {
    __setTransportForTests(
      vi.fn().mockResolvedValue(pdfResponse("<!doctype html><html>Sign in to download</html>")),
    );
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "not_pdf" });
  });

  it("rejects a wrong Content-Type even when the bytes are a PDF", async () => {
    __setTransportForTests(
      vi.fn().mockResolvedValue(pdfResponse("%PDF-1.7 ok", "text/html; charset=utf-8")),
    );
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "wrong_content_type" });
  });

  it("accepts application/pdf with a charset parameter", async () => {
    __setTransportForTests(
      vi.fn().mockResolvedValue(pdfResponse("%PDF-1.4 body", "application/pdf; charset=binary")),
    );
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a non-2xx response", async () => {
    __setTransportForTests(vi.fn().mockResolvedValue(errorResponse(404)));
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "http_error", status: 404 });
  });

  it("Codex #4118 r11 F15: a 503 carries its status so the caller can retry later", async () => {
    __setTransportForTests(vi.fn().mockResolvedValue(errorResponse(503, "busy")));
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "http_error", status: 503 });
  });

  it("returns network_error when the transport throws", async () => {
    __setTransportForTests(vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await safeDownloadPdf(`https://${OEM}/a.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 8192,
    });
    expect(res).toEqual({ ok: false, reason: "network_error" });
  });
});

describe("safeDownloadPdf — maxBytes is enforced WHILE streaming", () => {
  beforeEach(() => {
    pinPublic();
  });

  it("destroys an oversized body mid-stream instead of buffering it", async () => {
    const CHUNK = 1024;
    const TOTAL_CHUNKS = 500; // 512 KB if fully read
    let pulls = 0;
    let destroyed = false;

    class CountingStream extends Readable {
      constructor() {
        super({ highWaterMark: CHUNK });
      }
      _read() {
        if (pulls === 0) {
          const head = Buffer.alloc(CHUNK);
          head.write("%PDF-1.7");
          this.push(head);
        } else if (pulls < TOTAL_CHUNKS) {
          this.push(Buffer.alloc(CHUNK));
        } else {
          this.push(null);
        }
        pulls++;
      }
      _destroy(err: Error | null, callback: (error?: Error | null) => void) {
        destroyed = true;
        callback(err);
      }
    }

    __setTransportForTests(
      vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: { "content-type": "application/pdf" },
        body: new CountingStream(),
      }),
    );

    const res = await safeDownloadPdf(`https://${OEM}/big.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 4 * CHUNK,
    });
    expect(res).toEqual({ ok: false, reason: "too_large" });
    // Proof it stopped early: a buffer-then-measure implementation would have
    // pulled all 500 chunks.
    expect(pulls).toBeLessThan(12);
    expect(destroyed).toBe(true);
  });

  it("refuses before reading when Content-Length already exceeds the cap", async () => {
    const body = Buffer.alloc(64);
    body.write("%PDF-1.7");
    __setTransportForTests(
      vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: { "content-type": "application/pdf", "content-length": "99999999" },
        body: Readable.from([body]),
      }),
    );
    const res = await safeDownloadPdf(`https://${OEM}/big.pdf`, {
      allowedHosts: ALLOWED,
      maxBytes: 1024,
    });
    expect(res).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a body exactly at the cap", async () => {
    const bytes = Buffer.alloc(32);
    bytes.write("%PDF-1.7");
    __setTransportForTests(vi.fn().mockResolvedValue(pdfResponse(bytes)));
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

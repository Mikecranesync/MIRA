// #5265 W1 — the runtime egress block. Real sockets, real loopback servers, no network
// needed: every off-device attempt must fail before a packet leaves, and a loopback
// positive control must still work, or the guard is unproven.
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { EDGE_EGRESS_CODE, installEdgeEgressGuard, isLoopbackHost } from "../edge-egress";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect-out") {
      res.writeHead(302, { Location: "http://93.184.216.34/landed" });
      res.end();
      return;
    }
    if (req.url === "/redirect-name") {
      res.writeHead(302, { Location: "https://updates.factorylm.com/x" });
      res.end();
      return;
    }
    if (req.url === "/redirect-local") {
      res.writeHead(302, { Location: "/ok" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("local-ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let guard: ReturnType<typeof installEdgeEgressGuard> | null = null;
const lines: string[] = [];
function install() {
  lines.length = 0;
  guard = installEdgeEgressGuard((l) => lines.push(l));
  return guard;
}
afterEach(() => {
  guard?.uninstall();
  guard = null;
});

const codeOf = (e: unknown): string | undefined => {
  let cur = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur.code) return cur.code;
    cur = cur.cause as typeof cur;
  }
  return undefined;
};

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.8.9.10", "localhost", "::1", "[::1]", "::ffff:127.0.0.1", "", "foo.localhost"])("%s is loopback", (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each(["192.168.4.23", "10.0.0.1", "100.96.120.63", "93.184.216.34", "::ffff:8.8.8.8", "2606:4700::1", "app.factorylm.com", "localhost.evil.com", "0.0.0.0"])(
    "%s is not",
    (h) => {
      expect(isLoopbackHost(h)).toBe(false);
    },
  );
});

describe("installEdgeEgressGuard", () => {
  it("positive control: loopback fetch still works, and a local redirect is followed", async () => {
    install();
    expect(await (await fetch(`${base}/ok`)).text()).toBe("local-ok");
    expect(await (await fetch(`${base}/redirect-local`)).text()).toBe("local-ok");
    expect(guard!.blocked()).toHaveLength(0);
  });

  it("blocks fetch to a public IP literal before connecting", async () => {
    install();
    const err = await fetch("http://93.184.216.34/").catch((e) => e);
    expect(codeOf(err)).toBe(EDGE_EGRESS_CODE);
    expect(guard!.blocked()).toEqual([{ host: "93.184.216.34", port: 80, via: "connect" }]);
    expect(lines.some((l) => l.includes("BLOCKED connect 93.184.216.34:80"))).toBe(true);
  });

  it("blocks a host name (https, the cloud OTA default)", async () => {
    install();
    const err = await fetch("https://updates.factorylm.com/manifest.json").catch((e) => e);
    expect(codeOf(err)).toBe(EDGE_EGRESS_CODE);
    expect(guard!.blocked()[0].host).toBe("updates.factorylm.com");
  });

  it("blocks the hop when a loopback service redirects off the device", async () => {
    install();
    for (const path of ["/redirect-out", "/redirect-name"]) {
      const err = await fetch(`${base}${path}`).catch((e) => e);
      expect(codeOf(err)).toBe(EDGE_EGRESS_CODE);
    }
    expect(guard!.blocked().map((b) => b.host)).toEqual(["93.184.216.34", "updates.factorylm.com"]);
  });

  it("blocks LAN and tailnet addresses too: 'on the device' means loopback", async () => {
    install();
    for (const h of ["192.168.4.23", "100.96.120.63"]) {
      expect(codeOf(await fetch(`http://${h}:3000/`).catch((e) => e))).toBe(EDGE_EGRESS_CODE);
    }
  });

  it("blocks raw net.connect and http.request", async () => {
    install();
    const sockErr = await new Promise<unknown>((resolve) => {
      const s = net.connect({ host: "8.8.8.8", port: 53 });
      s.on("error", resolve);
      s.on("connect", () => resolve(null));
    });
    expect(codeOf(sockErr)).toBe(EDGE_EGRESS_CODE);
    const reqErr = await new Promise<unknown>((resolve) => {
      const r = http.get("http://example.com/", () => resolve(null));
      r.on("error", resolve);
    });
    expect(codeOf(reqErr)).toBe(EDGE_EGRESS_CODE);
  });

  it("blocks DNS for off-device names, callback and promise forms; localhost resolves", async () => {
    install();
    const cbErr = await new Promise<unknown>((resolve) => dns.lookup("api.groq.com", (e) => resolve(e)));
    expect(codeOf(cbErr)).toBe(EDGE_EGRESS_CODE);
    expect(codeOf(await dns.promises.resolve4("example.com").catch((e) => e))).toBe(EDGE_EGRESS_CODE);
    const local = await dns.promises.lookup("localhost");
    expect(isLoopbackHost(local.address)).toBe(true);
  });

  it("uninstall restores the original functions (so the tests above cannot leak)", () => {
    const before = net.Socket.prototype.connect;
    const g = install();
    expect(net.Socket.prototype.connect).not.toBe(before);
    g.uninstall();
    guard = null;
    expect(net.Socket.prototype.connect).toBe(before);
  });
});

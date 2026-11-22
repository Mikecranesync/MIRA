/**
 * #5798, #5831: the magic-link fixture's browser isolation sees every redirect
 * hop, and the allowed origin is only a name. TEST ONLY and self-contained:
 * throwaway HTTP servers, no Hub. `fixture` stands in for the Hub and listens
 * on a Unix socket, as the Hub does; `occupant` holds the TCP port that the
 * fixture's origin names, and `outside` is a second local listener. Neither
 * may ever receive a request. Runs in the same Playwright invocation as the
 * Hub test (run.sh), and also on its own:
 *
 *   npx playwright test --config tests/local-fixtures/magic-link-return/playwright.config.ts browser-isolation
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { isolatedContext, offOrigin, type IsolatedContext } from "./browser-isolation";

let fixture: http.Server;
let occupant: http.Server;
let outside: http.Server;
let socketDir = "";
let fixtureSocket = "";
let fixtureOrigin = "";
let outsideOrigin = "";
const outsideHits: string[] = [];
const occupantHits: string[] = [];

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function recorder(hits: string[], body: string): http.Server {
  return http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.end(body);
  });
}

test.beforeAll(async () => {
  // The fixture origin names the occupant's port; the fixture itself answers
  // only on the socket.
  occupant = recorder(occupantHits, "occupant");
  fixtureOrigin = await listen(occupant);
  outside = http.createServer((req, res) => {
    outsideHits.push(`${req.method} ${req.url}`);
    res.end("outside");
  });
  outsideOrigin = await listen(outside);
  fixture = http.createServer((req, res) => {
    const send = (status: number, headers: Record<string, string>, body = "") => {
      res.writeHead(status, headers);
      res.end(body);
    };
    switch (req.url) {
      case "/away":
        return send(302, { location: `${outsideOrigin}/stolen-nav` });
      case "/away-img":
        return send(302, { location: `${outsideOrigin}/stolen-img` });
      case "/page-with-image":
        return send(200, { "content-type": "text/html" }, '<p id="ok">page</p><img id="img" src="/away-img">');
      case "/hop":
        return send(302, { location: "/landed" });
      case "/hang":
        return; // never answered; the browser abandons it
      case "/landed":
        return send(200, { "content-type": "text/html" }, '<p id="landed">landed</p>');
      default:
        return send(404, {}, "missing");
    }
  });
  socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlr-iso-"));
  fixtureSocket = path.join(socketDir, "fixture.sock");
  await new Promise<void>((resolve) => fixture.listen(fixtureSocket, resolve));
});

test.afterAll(async () => {
  fixture.closeAllConnections();
  await new Promise((r) => fixture.close(r));
  await new Promise((r) => outside.close(r));
  await new Promise((r) => occupant.close(r));
  fs.rmSync(socketDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  outsideHits.length = 0;
  occupantHits.length = 0;
});

async function withIsolation(browser: import("@playwright/test").Browser, body: (iso: IsolatedContext) => Promise<void>) {
  const iso = await isolatedContext(browser, fixtureOrigin, fixtureSocket);
  try {
    await body(iso);
  } finally {
    await iso.close();
  }
  expect(occupantHits, "the listener on the fixture origin's own port received nothing").toEqual([]);
  expect(iso.upstreamFailures).toEqual([]);
}

test.describe("browser isolation for the magic-link fixture (#5798, #5831)", () => {
  test("a navigation that redirects to another local listener is refused before it is sent", async ({ browser }) => {
    await withIsolation(browser, async (iso) => {
      await iso.page.goto(`${fixtureOrigin}/away`).catch(() => undefined);
      await expect.poll(() => iso.blocked.length).toBe(1);
      expect(outsideHits, "the other listener received nothing").toEqual([]);
      expect(iso.paths).toEqual(["/away"]);
      expect(iso.blocked).toEqual([`${outsideOrigin}/stolen-nav`]);
      expect(offOrigin(iso.attempted, fixtureOrigin)).toEqual([`${outsideOrigin}/stolen-nav`]);
    });
  });

  test("a subresource that redirects off the fixture, a direct request to another port and a remote host are refused", async ({ browser }) => {
    await withIsolation(browser, async (iso) => {
      await iso.page.goto(`${fixtureOrigin}/page-with-image`);
      await expect(iso.page.locator("#ok")).toBeVisible();
      await expect.poll(() => iso.blocked.length).toBe(1);
      await iso.page.evaluate((u) => fetch(u).catch(() => "refused"), `${outsideOrigin}/stolen-fetch`);
      await iso.page.evaluate(() => fetch("https://evil.example/stolen-tls").catch(() => "refused"));
      await expect.poll(() => iso.blocked.length).toBe(3);
      expect(outsideHits, "the other listener received nothing").toEqual([]);
      expect([...iso.blocked].sort()).toEqual([
        `${outsideOrigin}/stolen-fetch`,
        `${outsideOrigin}/stolen-img`,
        "connect evil.example:443",
      ].sort());
      expect(offOrigin(iso.attempted, fixtureOrigin).sort()).toEqual([
        `${outsideOrigin}/stolen-fetch`,
        `${outsideOrigin}/stolen-img`,
        "https://evil.example/stolen-tls",
      ].sort());
    });
  });

  test("the allowed origin is served from the socket, never from its own port", async ({ browser }) => {
    await withIsolation(browser, async (iso) => {
      await iso.page.goto(`${fixtureOrigin}/landed`);
      await expect(iso.page.locator("#landed")).toBeVisible();
      expect(iso.paths).toEqual(["/landed"]);
      expect(iso.blocked).toEqual([]);
    });
  });

  test("a request whose socket cannot be reached is recorded as an upstream failure", async ({ browser }) => {
    const iso = await isolatedContext(browser, fixtureOrigin, path.join(socketDir, "missing.sock"));
    try {
      await iso.page.goto(`${fixtureOrigin}/landed`).catch(() => undefined);
      await expect.poll(() => iso.upstreamFailures.length).toBe(1);
      expect(iso.upstreamFailures[0]).toBe(`${fixtureOrigin}/landed ENOENT`);
      expect(iso.blocked).toEqual([]);
    } finally {
      await iso.close();
    }
    expect(occupantHits).toEqual([]);
  });

  test("a request the browser abandons is not counted as an upstream failure", async ({ browser }) => {
    await withIsolation(browser, async (iso) => {
      await iso.page.goto(`${fixtureOrigin}/hang`, { timeout: 1_000 }).catch(() => undefined);
      await iso.page.goto(`${fixtureOrigin}/landed`);
      await expect(iso.page.locator("#landed")).toBeVisible();
      expect(iso.paths).toEqual(["/hang", "/landed"]);
      expect(iso.upstreamFailures).toEqual([]);
    });
  });

  test("a same-origin redirect is still followed", async ({ browser }) => {
    await withIsolation(browser, async (iso) => {
      await iso.page.goto(`${fixtureOrigin}/hop`);
      await expect(iso.page.locator("#landed")).toBeVisible();
      expect(new URL(iso.page.url()).pathname).toBe("/landed");
      expect(iso.paths).toEqual(["/hop", "/landed"]);
      expect(iso.blocked).toEqual([]);
      expect(outsideHits).toEqual([]);
    });
  });
});

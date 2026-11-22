/**
 * #5798: the magic-link fixture's browser isolation sees every redirect hop.
 * TEST ONLY and self-contained: two throwaway HTTP servers on loopback, no Hub.
 * `fixture` stands in for the Hub; `outside` is a second local listener that
 * must never receive a request. Runs in the same Playwright invocation as the
 * Hub test (run.sh), and also on its own:
 *
 *   npx playwright test --config tests/local-fixtures/magic-link-return/playwright.config.ts browser-isolation
 */
import { test, expect } from "@playwright/test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { isolatedContext, offOrigin, type IsolatedContext } from "./browser-isolation";

let fixture: http.Server;
let outside: http.Server;
let fixtureOrigin = "";
let outsideOrigin = "";
const outsideHits: string[] = [];

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

test.beforeAll(async () => {
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
      case "/landed":
        return send(200, { "content-type": "text/html" }, '<p id="landed">landed</p>');
      default:
        return send(404, {}, "missing");
    }
  });
  fixtureOrigin = await listen(fixture);
});

test.afterAll(async () => {
  await new Promise((r) => fixture.close(r));
  await new Promise((r) => outside.close(r));
});

test.beforeEach(() => {
  outsideHits.length = 0;
});

async function withIsolation(browser: import("@playwright/test").Browser, body: (iso: IsolatedContext) => Promise<void>) {
  const iso = await isolatedContext(browser, fixtureOrigin);
  try {
    await body(iso);
  } finally {
    await iso.close();
  }
}

test.describe("browser isolation for the magic-link fixture (#5798)", () => {
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

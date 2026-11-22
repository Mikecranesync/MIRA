/**
 * #5753 (follow-up to #5751 F4): email sign-in returns a technician to the
 * cited manual page, proven in a real browser against the real login form
 * (`login-form.tsx`), the real sign-in route (`capabilities/auth-link.ts`)
 * and the real verify page (`magic/page.tsx`).
 *
 * Runs ONLY against a local Hub on a disposable database, started by
 * `tests/e2e/magic-link-return.run.sh`, which seeds one synthetic user, tenant
 * and 30-page PDF and captures the sign-in email with a Node preload
 * (`fixtures/magic-link-mail-capture.cjs`) instead of sending it.
 *
 *   cd mira-hub && bash tests/e2e/magic-link-return.run.sh
 *
 * Every URL here is absolute (MLR_HUB_URL, loopback only), and every browser
 * request to a non-loopback host is aborted, so nothing can reach staging or
 * production even though playwright.config.ts names production as baseURL.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const HUB = (process.env.MLR_HUB_URL ?? "").replace(/\/$/, "");
const CAPTURE = process.env.MLR_MAIL_CAPTURE ?? "";
if (!HUB || !LOOPBACK.has(new URL(HUB).hostname)) {
  throw new Error("MLR_HUB_URL must be a loopback Hub (run tests/e2e/magic-link-return.run.sh)");
}
if (!CAPTURE) throw new Error("MLR_MAIL_CAPTURE must name the server's mail capture file");

const seed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "magic-link-return-seed.json"), "utf8"),
) as { email: string; fileId: string; filename: string; pages: number; citedPage: number };

const VIEWER = `/v3/source/?file=${seed.fileId}&page=${seed.citedPage}`;

interface CapturedEmail {
  to: string[];
  subject: string;
  html: string;
}

function capturedEmails(): CapturedEmail[] {
  if (!fs.existsSync(CAPTURE)) return [];
  return fs
    .readFileSync(CAPTURE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { email: CapturedEmail }).email);
}

/** The sign-in link from the first email captured after `before` emails. */
async function nextSignInLink(before: number): Promise<URL> {
  await expect.poll(() => capturedEmails().length, { message: "a sign-in email is captured", timeout: 15_000 })
    .toBeGreaterThan(before);
  const email = capturedEmails()[before];
  expect(email.to).toEqual([seed.email]);
  expect(email.subject).toBe("Your FactoryLM sign-in link");
  const href = /href="([^"]+)"/.exec(email.html)?.[1];
  expect(href, "the email carries a link").toBeTruthy();
  const link = new URL(href!.replace(/&amp;/g, "&"));
  // The link must lead back to this local Hub, never to a deployed one.
  expect(link.origin).toBe(new URL(HUB).origin);
  expect(link.pathname).toBe("/magic/");
  // The token rides only the fragment (#5747); the query never carries it.
  expect(link.hash).toMatch(/^#token=[0-9a-f-]{36}$/);
  expect(link.search).not.toContain("token");
  return link;
}

/** A fresh, signed-out browser whose requests can reach only loopback.
 *  `blocked` records every other host the page tried to reach. */
async function freshContext(
  browser: import("@playwright/test").Browser,
): Promise<{ context: BrowserContext; page: Page; blocked: string[]; paths: string[] }> {
  const context = await browser.newContext();
  const blocked: string[] = [];
  const paths: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!LOOPBACK.has(url.hostname)) {
      blocked.push(url.hostname);
      return route.abort("blockedbyclient");
    }
    paths.push(url.pathname);
    return route.continue();
  });
  return { context, page: await context.newPage(), blocked, paths };
}

/** Submits the email form and returns the JSON body the form posted. */
async function requestSignInLink(page: Page): Promise<Record<string, unknown>> {
  await page.locator("#magic-email").fill(seed.email);
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/auth/magic-link/"),
    page.getByRole("button", { name: "Send link" }).click(),
  ]);
  await expect(page.getByText("Check your inbox")).toBeVisible();
  return request.postDataJSON() as Record<string, unknown>;
}

test.describe("email sign-in returns to the cited manual page (#5753)", () => {
  test("a signed-out technician who opens page 26 lands back on page 26 after email sign-in", async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    expect(await context.cookies(), "the browser starts signed out").toEqual([]);

    // 1. The cited-page link, opened signed out, lands on /login carrying it.
    await page.goto(HUB + VIEWER);
    await expect(page).toHaveURL((u) => u.pathname === "/login/");
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(VIEWER);

    // 2. The email form posts that page as the return path.
    const before = capturedEmails().length;
    const body = await requestSignInLink(page);
    expect(body).toEqual({ email: seed.email, returnTo: VIEWER });

    // 3. The captured email's link carries it as `next`, token in the fragment.
    const link = await nextSignInLink(before);
    expect(link.searchParams.get("next")).toBe(VIEWER);

    // 4. Opening the link signs in and shows that file at page 26.
    await page.goto(link.href);
    await page.waitForURL((u) => u.pathname === "/v3/source/", { timeout: 20_000 });
    const landed = new URL(page.url());
    expect(landed.searchParams.get("file")).toBe(seed.fileId);
    expect(landed.searchParams.get("page")).toBe(String(seed.citedPage));
    await expect(page.getByTestId("viewer-caption")).toHaveText(
      `${seed.filename} · page ${seed.citedPage} of ${seed.pages} · file ${seed.fileId.slice(0, 8)}`,
      { timeout: 20_000 },
    );
    await expect(page.locator(`canvas[data-rendered-page="${seed.citedPage}"]`)).toBeVisible();
    // The verify page strips the token from history before leaving.
    expect(page.url()).not.toContain("token");
    await context.close();
  });

  const rejected = [
    { label: "another host", value: `https://evil.example${VIEWER}` },
    { label: "a protocol-relative host", value: `//evil.example${VIEWER}` },
    { label: "an unknown path", value: "/settings/security" },
  ];
  for (const { label, value } of rejected) {
    test(`a return path to ${label} is dropped at every hop and sign-in lands on /feed`, async ({ browser }) => {
      const { context, page, blocked, paths } = await freshContext(browser);
      await page.goto(`${HUB}/login/?callbackUrl=${encodeURIComponent(value)}`);
      await expect(page.locator("#magic-email")).toBeVisible();

      // The form never posts it.
      const before = capturedEmails().length;
      const body = await requestSignInLink(page);
      expect(body).toEqual({ email: seed.email });

      // The email never carries it.
      const link = await nextSignInLink(before);
      expect(link.searchParams.has("next")).toBe(false);

      // The verify page re-checks `next` too: an edited link still goes to
      // /feed (DEFAULT_RETURN_PATH), which the middleware then forwards to
      // the /v3 shell in every environment (capabilities/hub-landing.ts, #3880).
      link.searchParams.set("next", value);
      const feed = page.waitForRequest((r) => ["/feed", "/feed/"].includes(new URL(r.url()).pathname), { timeout: 20_000 });
      await page.goto(link.href);
      await feed;
      await page.waitForURL((u) => u.pathname === "/v3/" || u.pathname === "/v3", { timeout: 20_000 });
      expect(new URL(page.url()).origin).toBe(new URL(HUB).origin);
      expect(blocked, "no request left the local Hub").toEqual([]);
      // Neither the rejected path nor a host-stripped copy of it was opened.
      const forbidden = new URL(value, "http://unused.invalid").pathname.replace(/\/$/, "");
      expect(paths.filter((p) => p.replace(/\/$/, "") === forbidden), "the rejected destination was never requested").toEqual([]);
      await context.close();
    });
  }
});

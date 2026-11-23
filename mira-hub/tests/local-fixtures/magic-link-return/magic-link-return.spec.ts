/**
 * #5753 (follow-up to #5751 F4): email sign-in returns a technician to the
 * cited manual page, proven in a real browser against the real login form
 * (`login-form.tsx`), the real sign-in route (`capabilities/auth-link.ts`)
 * and the real verify page (`magic/page.tsx`).
 *
 * TEST ONLY. Runs ONLY against a local Hub on a disposable database, started
 * by `run.sh` next to this file, which seeds one synthetic user, tenant and
 * 30-page PDF and captures the sign-in email with a Node preload
 * (`mail-capture.cjs`) instead of sending it. It lives outside tests/e2e and
 * has its own config (`playwright.config.ts` next to it), so the
 * default suite never collects it.
 *
 *   cd mira-hub && bash tests/local-fixtures/magic-link-return/run.sh
 *
 * Every URL here is absolute (MLR_HUB_URL, loopback only). The browser can
 * reach only that origin, redirect hops included, and its requests are carried
 * to the Hub's private Unix socket (MLR_HUB_SOCKET), never to the TCP port the
 * URL names (`browser-isolation.ts`, proven by `browser-isolation.spec.ts`).
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { isolatedContext, offOrigin, type IsolatedContext } from "./browser-isolation";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const HUB = (process.env.MLR_HUB_URL ?? "").replace(/\/$/, "");
const CAPTURE = process.env.MLR_MAIL_CAPTURE ?? "";
const HUB_SOCKET = process.env.MLR_HUB_SOCKET ?? "";
if (!HUB || !LOOPBACK.has(new URL(HUB).hostname)) {
  throw new Error("MLR_HUB_URL must be a loopback Hub (run tests/local-fixtures/magic-link-return/run.sh)");
}
if (!CAPTURE) throw new Error("MLR_MAIL_CAPTURE must name the server's mail capture file");
if (!HUB_SOCKET) throw new Error("MLR_HUB_SOCKET must name the Hub server's Unix socket");

const seed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"),
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

/** Runs `body` in a fresh, signed-out browser that can reach only the local
 *  Hub, then checks that nothing else was attempted and closes it. */
async function withIsolatedHub(
  browser: import("@playwright/test").Browser,
  body: (iso: IsolatedContext) => Promise<void>,
): Promise<void> {
  const iso = await isolatedContext(browser, HUB, HUB_SOCKET);
  try {
    await body(iso);
    expect(iso.upstreamFailures, "every request reached this run's Hub server").toEqual([]);
    expect(iso.blocked, "no request left the local Hub").toEqual([]);
    expect(offOrigin(iso.attempted, HUB), "the browser asked for nothing but the local Hub").toEqual([]);
  } finally {
    await iso.close();
  }
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
    await withIsolatedHub(browser, async ({ context, page }) => {
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
      expect(page.url()).not.toContain("token");

      // 5. The verify page removed the token from its own history entry before
      //    leaving (#5795 review F5): going back must not reveal the fragment.
      //    The URL is read when the back navigation commits, before the verify
      //    page could redirect again.
      const backUrl = new Promise<string>((resolve) => {
        page.on("framenavigated", (frame) => {
          if (frame === page.mainFrame()) resolve(frame.url());
        });
      });
      await page.goBack({ waitUntil: "commit" });
      const back = new URL(await backUrl);
      expect(back.pathname).toBe("/magic/");
      expect(back.hash, "the verify entry in history keeps no token").toBe("");
      expect(back.href).not.toContain("token");
    });
  });

  const rejected = [
    { label: "another host", value: `https://evil.example${VIEWER}` },
    { label: "a protocol-relative host", value: `//evil.example${VIEWER}` },
    { label: "an unknown path", value: "/settings/security" },
  ];
  for (const { label, value } of rejected) {
    test(`a return path to ${label} is dropped at every hop and sign-in lands on /feed`, async ({ browser }) => {
      await withIsolatedHub(browser, async ({ page, paths }) => {
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
        // Neither the rejected path nor a host-stripped copy of it was opened,
        // on any request or redirect hop.
        const forbidden = new URL(value, "http://unused.invalid").pathname.replace(/\/$/, "");
        expect(paths.filter((p) => p.replace(/\/$/, "") === forbidden), "the rejected destination was never requested").toEqual([]);
      });
    });
  }
});

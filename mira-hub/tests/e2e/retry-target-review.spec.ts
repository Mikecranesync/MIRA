/**
 * Tablet semantic-retry gap — a question asked about the selected component, with a photo,
 * is refused (409 selection_changed) because another screen cleared the selection. It must
 * not be retried onto the whole machine silently: no Retry control, both targets named, the
 * question kept, and only a fresh Send asks it — about the new target, with the same photo.
 *
 * Runs against a real local hub + database (real sign-in, real project, real component,
 * real selection writes; the 409 comes from the real chat route). Mocked: the photo read
 * (/look/, so no vision call is spent) and the SECOND chat request, which is captured and
 * answered 503 so no model is called.
 *
 * Must turn red under `if (false && held)` in hub-host.tsx's Send path (the mutation the
 * unit suite does not catch), and under reverting cf55cade3 when the question is reworded.
 *
 *   HUB_URL=http://localhost:3131/hub PW_CHANNEL=chrome npx playwright test tests/e2e/retry-target-review.spec.ts -c playwright.config.ts
 *
 * Status 2026-11-15: written on CHARLIE, NOT yet run (needs the coordinator's local-auth
 * workspace). Selectors for the attach menu are a best guess; fix them, not the assertions.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3131/hub").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.use({ viewport: { width: 1440, height: 900 }, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });

const rand = () => Math.random().toString(36).slice(2, 8);

async function signUpAndIn(page: Page): Promise<void> {
  const reuse = !!(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
  const creds = reuse
    ? { email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD!, name: "E2E retry" }
    : { email: `e2e-retry-${rand()}@example.com`, password: `Pw-${rand()}-${rand()}!A1`, name: "E2E retry" };
  if (!reuse) {
    const reg = await page.request.post(`${HUB}/api/auth/register/`, { data: creds });
    expect(reg.status(), `register failed: ${await reg.text()}`).toBe(201);
  }
  const csrf = (await (await page.request.get(`${HUB}/api/auth/csrf`)).json()) as { csrfToken: string };
  const res = await page.request.post(`${HUB}/api/auth/callback/credentials/`, {
    form: { email: creds.email, password: creds.password, csrfToken: csrf.csrfToken, redirect: "false", json: "true", callbackUrl: HUB },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(res.status());
}

async function json(page: Page, method: "GET" | "POST" | "PUT", url: string, data?: unknown) {
  const res = await page.request.fetch(url, { method, ...(data === undefined ? {} : { data }) });
  expect(res.ok(), `${method} ${url} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

test("a refused 'selected component' question with a photo is held for review, then re-asked with the same photo", async ({ page }) => {
  test.setTimeout(240_000);
  await signUpAndIn(page);
  const nb = (await json(page, "POST", `${HUB}/api/equipment-notebooks/`, {
    displayName: `E2E retry ${rand()}`, manufacturer: "AutomationDirect", model: "GS10", identityStatus: "user_confirmed", identitySourceType: "user",
  })).notebook.id as string;
  const comps = `${HUB}/api/equipment-notebooks/${nb}/components/`;
  const { componentId } = await json(page, "POST", comps, {
    origin: "technician", kind: "drive", position: 0, clientRequestId: crypto.randomUUID(),
    revision: { rawLabel: "AutomationDirect GS10", localTag: "VFD1", inputKind: "typed" },
  }) as { componentId: string };
  const v0 = (await json(page, "GET", comps)).selectionVersion as number | null;
  await json(page, "PUT", `${comps}selection/`, { threadId: null, componentId, expectedVersion: v0 });

  // The photo read is mocked: a parked, linked, persisted observation. Each upload gets its
  // own id, so a re-upload on the fresh Send cannot pass for the held photo.
  let looks = 0;
  await page.route(/\/api\/equipment-notebooks\/[0-9a-f-]{36}\/look\/?$/, (route) => route.fulfill({
    json: { fileId: `f-photo-${++looks}`, observation: { text: "Nameplate: AutomationDirect GS10", capturedAt: "2026-11-15T06:00:00.000Z" }, attachment: { linkId: "l-held" }, observationPersisted: true },
  }));
  // Chat: the first request goes to the real route (it must answer 409); later ones are captured.
  const sent: Record<string, unknown>[] = [];
  let chatCalls = 0;
  await page.route(/\/api\/equipment-notebooks\/[0-9a-f-]{36}\/chat\/?$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    chatCalls += 1;
    if (chatCalls === 1) return route.fallback();
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 503, json: { error: "test_stop" } });
  });

  await page.goto(`${HUB}/v3/?notebook=${encodeURIComponent(nb)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const box = page.getByRole("textbox", { name: /ask mira/i });
  await expect(box).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/VFD1/).first()).toBeVisible({ timeout: 60_000 });

  // Attach a photo (menu labels are a best guess).
  const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
  await page.getByRole("button", { name: /attach/i }).first().click();
  const photoItem = page.getByRole("menuitem", { name: /photo|image|camera/i }).first();
  if (await photoItem.isVisible().catch(() => false)) await photoItem.click();
  await (await chooser).setFiles({ name: "nameplate.png", mimeType: "image/png", buffer: PNG });

  // Another screen clears the selection; this screen still shows VFD1.
  const v1 = (await json(page, "GET", comps)).selectionVersion as number;
  await json(page, "PUT", `${comps}selection/`, { threadId: null, componentId: null, expectedVersion: v1 });
  const v2 = (await json(page, "GET", comps)).selectionVersion as number;

  const question = "what fuse does the selected component take";
  await box.fill(question);
  await page.getByRole("button", { name: "Send" }).click();

  // Held for review: both targets named, no Retry, the question kept.
  await expect(page.getByText(/asked about .*VFD1/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/now the whole machine/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /retry|try again/i })).toHaveCount(0);
  await expect(box).toHaveValue(question);
  expect(sent, "nothing may be re-sent before the technician presses Send").toHaveLength(0);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, "2026-11-15_retry-target-review_desktop.png") });

  // Precondition: no attachment chip is left in the composer, so the photo can only ride
  // the fresh Send through the held body.
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  expect(looks, "exactly one photo upload before the review").toBe(1);

  // Reworded, then a fresh Send: the new target, the new version, the same photo.
  await box.fill("what fuse does the drive take");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1);
  const body = sent[0] as { message?: string; componentSelection?: { componentId: unknown; selectionVersion: unknown }; visualEvidence?: { fileId?: string } };
  expect(body.message).toBe("what fuse does the drive take");
  expect(body.componentSelection).toMatchObject({ componentId: null, selectionVersion: v2 });
  expect(body.visualEvidence?.fileId, "the held photo must ride the fresh Send").toBe("f-photo-1");
  expect(looks, "the photo is not uploaded again").toBe(1);
});

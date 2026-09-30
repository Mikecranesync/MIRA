/**
 * V3 addressable thread history (#3922) — Playwright proof against a real
 * local dev server (real dev Neon + real free-tier LLM cascade).
 *
 * `/v3/?notebook=<id>&thread=<id>` must open the exact persisted thread for
 * BOTH an unbound (no asset) notebook and a bound (asset) notebook, survive a
 * reload, be reachable from the sidebar tree on HOME, take a web follow-up
 * that persists, never fall back to the legacy `/equipment/<id>` page, and
 * "New chat" must start a fresh, empty, addressable thread.
 *
 * Everything is seeded through the REAL routes (register → sign in → create
 * notebooks/asset → chat), never direct SQL — mirrors the auth pattern in
 * `folder-brain-proof.spec.ts`. This file runs once per Playwright PROJECT
 * (see playwright.v3-history.config.ts: "desktop" and "mobile"), each
 * registering its own tenant so the two viewports never share state.
 *
 * Spec: docs issue #3922. Config: playwright.v3-history.config.ts.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3131").replace(/\/$/, "");
const SHOT_DIR = path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ---- auth (same pattern as tests/e2e/folder-brain-proof.spec.ts) ----------

interface Creds {
  email: string;
  password: string;
  name: string;
}

/** Reuse a pre-registered account (E2E_EMAIL/E2E_PASSWORD) instead of
 *  registering: the register route rate-limits per IP per hour, and every
 *  run seeds its own uniquely named notebooks anyway. */
async function register(creds: Creds): Promise<string> {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
    creds.email = process.env.E2E_EMAIL;
    creds.password = process.env.E2E_PASSWORD;
    return "reused";
  }
  const res = await fetch(`${HUB}/api/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds),
  });
  const json = (await res.json().catch(() => ({}))) as { tenantId?: string };
  if (res.status !== 201 || !json.tenantId) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.tenantId;
}

async function apiSignIn(creds: Creds) {
  const csrfRes = await fetch(`${HUB}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const setCookie1 = csrfRes.headers.get("set-cookie") ?? "";

  const form = new URLSearchParams();
  form.set("email", creds.email);
  form.set("password", creds.password);
  form.set("csrfToken", csrfToken);
  form.set("redirect", "false");
  form.set("json", "true");
  form.set("callbackUrl", HUB);

  const signInRes = await fetch(`${HUB}/api/auth/callback/credentials/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: setCookie1 },
    body: form.toString(),
    redirect: "manual",
  });
  expect([200, 302]).toContain(signInRes.status);

  const raw = [setCookie1, signInRes.headers.get("set-cookie") ?? ""].join(", ");
  const { hostname } = new URL(HUB);
  const cookies = raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .map((c) => {
      const eq = c.indexOf("=");
      return { name: c.slice(0, eq), value: c.slice(eq + 1), domain: hostname, path: "/" };
    });
  const session = cookies.find((c) => c.name.includes("next-auth.session-token"));
  expect(session, "no session cookie from credentials signin").toBeTruthy();
  return cookies;
}

// ---- seeding via the real routes only (never SQL) -------------------------

interface Notebook {
  id: string;
  asset: unknown;
}

async function createUnboundNotebook(page: Page): Promise<Notebook> {
  const res = await page.request.post(`${HUB}/api/equipment-notebooks/`, {
    data: {
      displayName: "MOBILE-3922-unbound",
      manufacturer: "AutomationDirect",
      model: "GS10",
      identityStatus: "user_confirmed",
      identitySourceType: "user",
    },
  });
  expect(res.ok(), `create unbound notebook failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { notebook: Notebook };
  expect(body.notebook.asset, "unbound notebook must have asset:null").toBeNull();
  return body.notebook;
}

async function createBoundNotebook(page: Page, tag: string): Promise<Notebook> {
  const assetRes = await page.request.post(`${HUB}/api/assets/`, {
    data: { name: `E2E-3922 ${tag}`, manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" },
  });
  expect(assetRes.ok(), `create asset failed: ${assetRes.status()} ${await assetRes.text()}`).toBeTruthy();
  const asset = (await assetRes.json()) as { id: string };

  const nbRes = await page.request.post(`${HUB}/api/assets/${encodeURIComponent(asset.id)}/notebook/`);
  expect(nbRes.ok(), `open asset notebook failed: ${nbRes.status()} ${await nbRes.text()}`).toBeTruthy();
  const nbBody = (await nbRes.json()) as { notebook: Notebook };
  expect(nbBody.notebook.asset, "bound notebook must have a non-null asset").not.toBeNull();
  return nbBody.notebook;
}

async function postChat(page: Page, notebookId: string, threadId: string, message: string): Promise<void> {
  const res = await page.request.post(`${HUB}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/chat/`, {
    data: { message, sourceDocIds: [], history: [], clientRequestId: randomUUID(), threadId, mode: "general" },
    timeout: 95_000,
  });
  expect(res.ok(), `chat post failed: ${res.status()} ${await res.text().catch(() => "")}`).toBeTruthy();
  await res.text(); // drain the SSE body to completion
}

interface NotebookDetail {
  notebook: { id: string };
  turns: { question: string; answerText: string | null }[];
}

async function getDetail(page: Page, notebookId: string, threadId: string): Promise<NotebookDetail> {
  const res = await page.request.get(
    `${HUB}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/?threadId=${encodeURIComponent(threadId)}`,
  );
  expect(res.ok(), `get notebook detail failed: ${res.status()} ${await res.text().catch(() => "")}`).toBeTruthy();
  return (await res.json()) as NotebookDetail;
}

// ---- browser-side helpers ---------------------------------------------

async function gotoV3(page: Page, search = ""): Promise<void> {
  await page.goto(`${HUB}/v3/${search}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

/** The drawer starts open on mount (navigationVisible defaults true) and
 *  closes itself after any item click — open it only when it is actually
 *  hidden, on either viewport. */
async function ensureDrawerOpen(page: Page): Promise<void> {
  const aside = page.locator('aside[aria-label="FactoryLM navigation"]');
  await expect(aside).toBeAttached();
  // A closed mobile drawer is `inert` (out of the tab order) even when its box
  // is still laid out, so visibility alone is not "open".
  const inert = await aside.evaluate((el) => el.hasAttribute("inert"));
  if (!inert && (await aside.isVisible())) return;
  const toggle = page.locator('button[aria-label="Open navigation"]');
  await toggle.click();
  await expect(aside).toBeVisible();
  await expect.poll(() => aside.evaluate((el) => el.hasAttribute("inert"))).toBe(false);
}

async function sendComposerMessage(page: Page, text: string): Promise<void> {
  const box = page.locator('textarea[aria-label="Ask MIRA"]');
  const send = page.locator('button[aria-label="Send"]');
  // The reducer resets the draft when the open thread id changes (hydration
  // after a deep link), so a draft typed during that window is wiped. Type,
  // then require both the draft and an enabled Send before clicking; retry
  // once if hydration cleared it. A disabled Send fails fast, never hangs.
  for (let attempt = 0; attempt < 3; attempt++) {
    await box.fill(text);
    try {
      await expect(box).toHaveValue(text, { timeout: 3_000 });
      await expect(send).toBeEnabled({ timeout: 3_000 });
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(500);
    }
  }
  await send.click();
}

/** Busy ends when the Stop control (shown only while `hooks.busy`) is gone —
 *  which, per hub-host.tsx's `send()`, happens only AFTER the server's own
 *  GET has already been refreshed. So "Stop gone" also means "safe to assert
 *  server-side persistence". */
async function waitForSendToFinish(page: Page): Promise<void> {
  const stop = page.locator('button[aria-label="Stop"]');
  await stop.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
    /* a very fast local answer can beat this poll — not a failure */
  });
  await expect(stop).toHaveCount(0, { timeout: 95_000 });
}

function conversation(page: Page) {
  return page.locator('[aria-label="Conversation"]');
}

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let label = "unknown";
let unbound: Notebook;
let bound: Notebook;
let unboundThread: string;
let boundThread: string;
const visitedUrls: string[] = [];
let unboundTitle = "";
let boundTitle = "";

test.beforeAll(async ({ browser }, testInfo) => {
  label = testInfo.project.name;
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const suffix = `${label}-${rand()}`;
  const creds: Creds = {
    email: `playwright-v3hist-${suffix}@factorylm.com`,
    password: "TestPass123!",
    name: "V3 Thread History Proof",
  };
  await register(creds);
  const cookies = await apiSignIn(creds);

  const use = testInfo.project.use as {
    viewport?: { width: number; height: number } | null;
    isMobile?: boolean;
    hasTouch?: boolean;
  };
  context = await browser.newContext({
    viewport: use.viewport ?? { width: 1440, height: 900 },
    isMobile: use.isMobile ?? false,
    hasTouch: use.hasTouch ?? false,
  });
  await context.addCookies(cookies);
  page = await context.newPage();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visitedUrls.push(frame.url());
  });

  unbound = await createUnboundNotebook(page);
  bound = await createBoundNotebook(page, suffix);

  unboundThread = `e2e-3922-unbound-${rand()}`;
  boundThread = `e2e-3922-bound-${rand()}`;

  await postChat(page, unbound.id, unboundThread, `E2E-3922 unbound turn 1 (${suffix}): what does a VFD do?`);
  await postChat(page, unbound.id, unboundThread, `E2E-3922 unbound turn 2 (${suffix}): what does PNP mean?`);
  await postChat(page, bound.id, boundThread, `E2E-3922 bound turn 1 (${suffix}): what is a proximity switch?`);
  await postChat(page, bound.id, boundThread, `E2E-3922 bound turn 2 (${suffix}): how does a VFD work?`);

  const unboundDetail = await getDetail(page, unbound.id, unboundThread);
  expect(unboundDetail.turns.length).toBe(2);
  const boundDetail = await getDetail(page, bound.id, boundThread);
  expect(boundDetail.turns.length).toBe(2);
});

test.afterAll(async () => {
  await context?.close();
});

test("A - deep link opens the unbound notebook's persisted thread", async () => {
  await gotoV3(page, `?notebook=${unbound.id}&thread=${unboundThread}`);
  await expect(conversation(page)).toBeVisible();
  await expect(conversation(page).getByText(`E2E-3922 unbound turn 1`, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(conversation(page).getByText(`E2E-3922 unbound turn 2`, { exact: false })).toBeVisible();

  await ensureDrawerOpen(page);
  await expect(page.locator(`[data-project-id="project-${unbound.id}"]`)).toBeVisible();
  unboundTitle = (await page.locator("h1").first().textContent())?.trim() ?? "";
  expect(unboundTitle.length).toBeGreaterThan(0);

  const url = new URL(page.url());
  expect(url.searchParams.get("notebook")).toBe(unbound.id);
  expect(url.searchParams.get("thread")).toBe(unboundThread);

  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(SHOT_DIR, `2026-09-21_v3-thread-history-a-unbound_${label}.png`),
    fullPage: false,
  });
});

test("B - deep link opens the bound notebook's persisted thread", async () => {
  await gotoV3(page, `?notebook=${bound.id}&thread=${boundThread}`);
  await expect(conversation(page)).toBeVisible();
  await expect(conversation(page).getByText(`E2E-3922 bound turn 1`, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(conversation(page).getByText(`E2E-3922 bound turn 2`, { exact: false })).toBeVisible();

  await ensureDrawerOpen(page);
  await expect(page.locator(`[data-project-id="project-${bound.id}"]`)).toBeVisible();
  boundTitle = (await page.locator("h1").first().textContent())?.trim() ?? "";
  expect(boundTitle.length).toBeGreaterThan(0);

  const url = new URL(page.url());
  expect(url.searchParams.get("notebook")).toBe(bound.id);
  expect(url.searchParams.get("thread")).toBe(boundThread);

  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(SHOT_DIR, `2026-09-21_v3-thread-history-b-bound_${label}.png`),
    fullPage: false,
  });
});

test("C - refresh restores the same thread", async () => {
  const before = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(conversation(page).getByText(`E2E-3922 bound turn 1`, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(conversation(page).getByText(`E2E-3922 bound turn 2`, { exact: false })).toBeVisible();
  expect(page.url()).toBe(before);
});

test("D - from HOME, the sidebar tree opens the unbound thread", async () => {
  await gotoV3(page);
  await ensureDrawerOpen(page);
  const itemId = `notebook-${unbound.id}:thread-${unboundThread}`;
  const row = page.locator(`[data-kind="thread"][data-item-id="${itemId}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  await expect(conversation(page).getByText(`E2E-3922 unbound turn 1`, { exact: false })).toBeVisible({ timeout: 20_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("notebook")).toBe(unbound.id);
  expect(url.searchParams.get("thread")).toBe(unboundThread);
});

test("E - a web follow-up in the unbound thread persists", async () => {
  const before = await getDetail(page, unbound.id, unboundThread);
  const beforeCount = before.turns.length;

  await sendComposerMessage(page, "E2E-3922 web follow-up: name one safety step before opening a drive cabinet");
  await waitForSendToFinish(page);
  await expect(conversation(page).getByText("E2E-3922 web follow-up", { exact: false })).toBeVisible();

  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(SHOT_DIR, `2026-09-21_v3-thread-history-e-followup_${label}.png`),
    fullPage: false,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(conversation(page).getByText("E2E-3922 web follow-up", { exact: false })).toBeVisible({ timeout: 20_000 });

  const after = await getDetail(page, unbound.id, unboundThread);
  expect(after.turns.length).toBe(beforeCount + 1);
});

test("F - no legacy /equipment hop anywhere in A-E", async () => {
  const legacyLinks = page.locator('[data-testid="hub-shell"] a[href*="/equipment"]');
  await expect(legacyLinks).toHaveCount(0);

  const offPath = visitedUrls.filter((u) => !u.startsWith(`${HUB}/v3`) && u !== "about:blank");
  expect(offPath, `visited URLs left /v3: ${JSON.stringify(offPath)}`).toEqual([]);
});

test("G - New chat starts a fresh, addressable, empty thread", async () => {
  // Currently on the unbound notebook's seeded thread (left there by E).
  const beforeUrl = new URL(page.url());
  await ensureDrawerOpen(page);
  await page.locator("button.fl-shell__new-chat", { hasText: "New chat" }).click();

  const afterUrl = new URL(page.url());
  expect(afterUrl.searchParams.get("notebook")).toBe(unbound.id);
  const newThreadId = afterUrl.searchParams.get("thread");
  expect(newThreadId).toBeTruthy();
  expect(newThreadId).not.toBe(beforeUrl.searchParams.get("thread"));

  // Empty: the FirstRun greeting renders, no persisted-turn rows.
  await expect(page.getByText("What can I help you with?")).toBeVisible();
  await expect(page.locator("[data-role]")).toHaveCount(0);
  await expect(page.locator('textarea[aria-label="Ask MIRA"]')).toBeEditable();

  // The unbound FirstRun grounding line (hooks.groundingLine, rendered only
  // on an empty thread — see packages/factorylm-ui/src/assistant/AssistantThread.tsx FirstRun).
  await expect(page.getByText("General question", { exact: false })).toBeVisible();

  // Deep link to the fresh id survives a reload: no crash, still empty.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("What can I help you with?")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-role]")).toHaveCount(0);
  const reloadedUrl = new URL(page.url());
  expect(reloadedUrl.searchParams.get("thread")).toBe(newThreadId);
});

test("H - the bound notebook is machine-scoped, unbound is not", async () => {
  // Machine scope is observable on the composer and the tree; the persisted
  // turn context is NOT asserted (a row's context is its own machine_evidence,
  // Codex #3839 Spec P1, so a general-mode turn says "No machine" by design).
  await gotoV3(page, `?notebook=${encodeURIComponent(bound.id)}&thread=${encodeURIComponent(boundThread)}`);
  await expect(conversation(page).getByText("E2E-3922 bound turn 1", { exact: false })).toBeVisible({ timeout: 20_000 });
  const composer = page.locator('textarea[aria-label="Ask MIRA"]');
  await expect(composer).toHaveAttribute("placeholder", /this machine/, { timeout: 15_000 });
  // The bound project's tree carries a machine-link row (children are a sibling
  // list inside the project's <li>); the unbound project carries none.
  await expect(page.locator('aside[aria-label="FactoryLM navigation"] [data-kind="machine"][data-machine-id]').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.locator(`li:has(> [data-project-id="project-${unbound.id}"]) [data-kind="machine"][data-machine-id]`)).toHaveCount(0);

  await gotoV3(page, `?notebook=${encodeURIComponent(unbound.id)}&thread=${encodeURIComponent(unboundThread)}`);
  await expect(conversation(page).getByText("E2E-3922 unbound turn 1", { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(composer).not.toHaveAttribute("placeholder", /this machine/, { timeout: 15_000 });

  // A turn in the bound notebook still sends and persists.
  await gotoV3(page, `?notebook=${encodeURIComponent(bound.id)}&thread=${encodeURIComponent(boundThread)}`);
  await expect(conversation(page).getByText("E2E-3922 bound turn 1", { exact: false })).toBeVisible({ timeout: 20_000 });
  await sendComposerMessage(page, "E2E-3922 machine-scope probe: what maintenance does this need?");
  await waitForSendToFinish(page);
  await expect(conversation(page).getByText("E2E-3922 machine-scope probe", { exact: false })).toBeVisible({ timeout: 20_000 });
});

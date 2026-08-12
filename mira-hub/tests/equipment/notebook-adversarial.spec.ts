/**
 * Equipment Notebook — adversarial pass. Everything here tries to make the
 * product lie, crash, or hang; every assertion is an HONESTY property:
 *
 *  - multi-source attribution (the citation must target the RIGHT document)
 *  - scanned/image-only PDF → the honest "can't index" message, never a
 *    silent success and never a phantom source
 *  - non-PDF upload → an error note, never a success note
 *  - out-of-corpus question → structured abstention, ZERO citation chips
 *  - deep-linked source viewer with a nonexistent doc id → honest not-found
 *  - provider failure (500) and network abort mid-ask → visible failed turn,
 *    composer recovers (no infinite spinner)
 *  - unauthenticated access → login, never data
 *
 * Runs on desktop AND phone (see playwright.equipment.config.ts projects).
 * Creates its own notebook — provable for a brand-new account.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";

const FIX_A = path.join(__dirname, "fixtures", "diagnostic-fixture.pdf");
const FIX_B = path.join(__dirname, "fixtures", "belt-tension-fixture.pdf");
const FIX_SCANNED = path.join(__dirname, "fixtures", "scanned-fixture.pdf");

let NB = "";
const NB_NAME = `Adversarial Rig ${Date.now()}`;

test.describe.configure({ mode: "serial" });

async function uploadViaSheet(page: import("@playwright/test").Page, file: string) {
  const dialog = page.getByRole("dialog", { name: "Sources" });
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: /^Sources · / }).click();
    await expect(dialog).toBeVisible();
  }
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    dialog.getByRole("button", { name: /Upload PDF/ }).click(),
  ]);
  await chooser.setFiles(file);
  return dialog;
}

test.describe("Equipment Notebook adversarial", () => {
  test("create the adversarial rig (empty-state copy present)", async ({ page }) => {
    page.on("dialog", (d) => void d.accept(NB_NAME));
    await page.goto("equipment/");
    await expect(page.getByRole("heading", { name: "Equipment Notebooks" })).toBeVisible();
    await page.getByRole("button", { name: "New notebook" }).first().click();
    await page.waitForURL(/\/equipment\/[0-9a-f-]{36}/, { timeout: 30_000 });
    NB = page.url().match(/equipment\/([0-9a-f-]{36})/)![1];
    await expect(page.getByRole("button", { name: /^Sources · 0\/0/ })).toBeVisible();
  });

  test("two sources attach and count correctly", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    let dialog = await uploadViaSheet(page, FIX_A);
    await expect(dialog.getByRole("status")).toHaveText(/Source added|Already in the cabinet/, { timeout: 60_000 });
    dialog = await uploadViaSheet(page, FIX_B);
    await expect(dialog.getByRole("status")).toHaveText(/Source added|Already in the cabinet/, { timeout: 60_000 });
    await expect(dialog.getByText("belt-tension-fixture.pdf")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
  });

  test("multi-source attribution: the citation targets the RIGHT document", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
    await page.getByLabel("Ask this machine anything").fill(
      "What value should parameter Q902 be set to for standard belts?",
    );
    await page.getByRole("button", { name: "Send" }).click();
    // Both sources enabled — the chip must name the belt-tension doc, not A.
    const chip = page.getByRole("button", { name: /Open citation \d+: belt-tension-fixture/ }).last();
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("main")).toContainText(/45/);
    // And there must be NO citation attributing this answer to fixture A.
    const lastTurnWrongChips = await page
      .getByRole("button", { name: /Open citation \d+: diagnostic-fixture/ })
      .count();
    // (fixture-A chips may exist from OTHER turns in later runs; this rig is
    // fresh in this serial run, so any A-chip here is a misattribution)
    expect(lastTurnWrongChips).toBe(0);
  });

  test("scanned/image-only PDF → honest can't-index message, no phantom source", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    const dialog = await uploadViaSheet(page, FIX_SCANNED);
    await expect(dialog.getByRole("status")).toHaveText(/no extractable text|couldn't be indexed/i, {
      timeout: 60_000,
    });
    await page.keyboard.press("Escape");
    // Source count unchanged — the scanned file must not appear as askable.
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
  });

  test("non-PDF upload → error note, never a success note", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    const dialog = page.getByRole("dialog", { name: "Sources" });
    await page.getByRole("button", { name: /^Sources · / }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      dialog.getByRole("button", { name: /Upload PDF/ }).click(),
    ]);
    await chooser.setFiles({
      name: "not-a-manual.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("plain text, not a pdf"),
    });
    const status = dialog.getByRole("status");
    await expect(status).not.toHaveText(/Source added/, { timeout: 30_000 });
    await expect(status).toHaveText(/.+/, { timeout: 30_000 }); // some honest note rendered
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
  });

  test("out-of-corpus question → structured abstention, zero citation chips", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
    const q = "What is the recommended sourdough hydration percentage for rye flour?";
    await page.getByLabel("Ask this machine anything").fill(q);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main")).toContainText(
      /couldn't find that in the selected sources|No selected source supported this/,
      { timeout: 60_000 },
    );
    // The abstaining turn must not carry a citation chip for either source.
    const lastAnswer = page.locator("main article, main li, main div").filter({ hasText: q }).last();
    expect(await lastAnswer.getByRole("button", { name: /Open citation/ }).count()).toBe(0);
  });

  test("deep link to a nonexistent source id → honest not-found, no crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`equipment/${NB}/source/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/?page=3`);
    // The viewer's honest copy for a doc id that isn't a member of this
    // notebook — never a broken iframe or a crash. (getByText, not
    // getByRole("alert"): Next's route announcer is also role=alert.)
    await expect(page.getByText(/isn.t in the notebook|Couldn.t load the source/)).toBeVisible({
      timeout: 20_000,
    });
    expect(errors).toEqual([]);
  });

  test("provider 500 mid-ask → failed turn is visible, composer recovers", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
    await page.route(`**/api/equipment-notebooks/${NB}/chat/`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"provider down"}' }),
    );
    await page.getByLabel("Ask this machine anything").fill("What resets the fixture device?");
    await page.getByRole("button", { name: "Send" }).click();
    // Honest failure copy, not a hang and not a fabricated answer.
    await expect(page.locator("main")).toContainText(
      /No answer provider was available|error|failed|try again/i,
      { timeout: 30_000 },
    );
    await page.unroute(`**/api/equipment-notebooks/${NB}/chat/`);
    // Composer must be usable again: typing re-enables Send (it is disabled
    // while empty by design — `disabled={busy || !input.trim()}`).
    await expect(page.getByLabel("Ask this machine anything")).toBeEnabled({ timeout: 15_000 });
    await page.getByLabel("Ask this machine anything").fill("recovered?");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    await page.getByLabel("Ask this machine anything").fill("");
  });

  test("network abort mid-ask (timeout shape) → no infinite spinner", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await expect(page.getByRole("button", { name: /^Sources · 2\/2/ })).toBeVisible();
    await page.route(`**/api/equipment-notebooks/${NB}/chat/`, (route) => route.abort("timedout"));
    await page.getByLabel("Ask this machine anything").fill("Any timeout handling?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main")).toContainText(
      /No answer provider was available|error|failed|try again|couldn't/i,
      { timeout: 30_000 },
    );
    await page.unroute(`**/api/equipment-notebooks/${NB}/chat/`);
    await expect(page.getByLabel("Ask this machine anything")).toBeEnabled({ timeout: 15_000 });
  });

  test("unauthenticated visitor never sees notebook data", async ({ browser, baseURL }) => {
    // In @playwright/test, browser.newContext() DOES inherit the project's
    // use{} — including the logged-in storageState — so "anonymous" must be
    // forced with an explicit storageState: undefined override.
    const ctx = await browser.newContext({ baseURL: baseURL!, storageState: undefined });
    const page = await ctx.newPage();
    // Absolute URL + no redirect following: a relative path here once resolved
    // WITHOUT the /hub base and the root redirect chain ended on the login
    // page (HTTP 200 HTML) — masking the API verdict. curl-verified: the API
    // itself answers 401 anonymously.
    const apiUrl = new URL(`api/equipment-notebooks/${NB}/`, baseURL!).toString();
    const res = await page.request.get(apiUrl, { maxRedirects: 0 });
    expect([401, 403, 404], `anonymous ${apiUrl} must be denied`).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain(NB_NAME); // no data leak in any error shape
    await page.goto("equipment/");
    await page.waitForURL(/login/, { timeout: 20_000 });
    await ctx.close();
  });
});

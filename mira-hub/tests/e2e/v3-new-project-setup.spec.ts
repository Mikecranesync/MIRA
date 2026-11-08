/**
 * #4632 browser proof: the New project setup sheet in the real v3 shell.
 *
 * Runs on a LOCAL dev Hub (dev Neon, never staging) with a real sign-in. The
 * project, machine and document APIs are stubbed in the browser, so no dev rows
 * are written and no model is called; the page bundle, auth and shell are real.
 *
 *   HUB_URL=http://localhost:3131/hub E2E_EMAIL=… E2E_PASSWORD=… \
 *     npx playwright test --config tests/e2e/v3-new-project-setup.playwright.config.ts
 */
import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const HUB = (process.env.HUB_URL ?? "http://localhost:3131/hub").replace(/\/$/, "");
const OUT = process.env.PROOF_DIR ?? path.join(__dirname, "..", "..", "..", "docs", "proofs", "2026-11-08-4632-new-project-setup");

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;

const NOW = "2026-11-08T12:00:00.000Z";
const notebook = (id: string, name: string, entityId: string | null) => ({
  id, displayName: name, manufacturer: null, model: null, catalogNumber: null, serialNumber: null,
  equipmentType: null, assetTag: null, locationLabel: null, identityStatus: "unknown", identityConfidence: null,
  identitySourceType: "user", nodeId: `node-of-${id}`, sourceCount: 0, lastOpenedAt: null, createdAt: NOW,
  asset: entityId ? { entityId, name, assetTag: id === "nb-cv101" ? "CV-101" : null, selectedVia: "asset_picker", confirmedBy: "u", confirmedAt: NOW } : null,
  threads: [],
});

async function signIn(page: Page, email: string, password: string): Promise<void> {
  const csrf = (await (await page.request.get(`${HUB}/api/auth/csrf`)).json()) as { csrfToken: string };
  const res = await page.request.post(`${HUB}/api/auth/callback/credentials/`, {
    form: { email, password, csrfToken: csrf.csrfToken, redirect: "false", json: "true", callbackUrl: HUB },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(res.status());
  expect((await page.request.get(`${HUB}/api/me/`)).status(), "signed-in /api/me").toBe(200);
}

/** Stubs every API the sheet touches. Returns the list of non-GET requests the page sent. */
async function stub(page: Page): Promise<string[]> {
  const writes: string[] = [];
  page.on("request", (r: Request) => {
    if (r.method() !== "GET" && /\/api\/(equipment-notebooks|assets|namespace|files)/.test(r.url())) {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  const existing = [notebook("nb-existing-cv102", "Infeed Conveyor", "node-cv102")];
  await page.route(/\/api\/equipment-notebooks\/(\?.*)?$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill(json({ notebooks: existing }))
      : route.fulfill(json({ notebook: notebook("nb-general", "Bench notes (synthetic)", null) }, 201)));
  await page.route(/\/api\/namespace\/tree\/?$/, (route) => route.fulfill(json({
    nodes: [{ id: "site", name: "Lake Wales", kind: "site", unsPath: "enterprise.lake_wales", children: [
      { id: "line4", name: "Line 4", kind: "line", unsPath: "enterprise.lake_wales.line_4", children: [
        { id: "node-cv101", name: "Discharge Conveyor CV-101 (synthetic)", kind: "asset", unsPath: "enterprise.lake_wales.line_4.cv_101", children: [] },
        { id: "node-cv102", name: "Infeed Conveyor CV-102 (synthetic)", kind: "asset", unsPath: "enterprise.lake_wales.line_4.cv_102", children: [] },
      ] },
    ] }],
  })));
  await page.route(/\/api\/files\/\?/, (route) => route.fulfill(json({ files: [
    { id: "f-gs10", filename: "GS10 drive user manual.pdf", uploadId: "up-gs10" },
    { id: "f-gs20", filename: "GS20 drive user manual.pdf", uploadId: "up-gs20" },
    { id: "f-scan", filename: "Wiring scan.pdf", uploadId: null },
  ] })));
  // One handler: Playwright tries the most recently added route first, so a
  // separate catch-all would shadow the CV-101 row.
  await page.route(/\/api\/namespace\/node\/[^/]+\/files\/?$/, (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill(json({ ok: true, indexed: false, fileId: "f-new", warning: "no text layer found" }));
    }
    return route.fulfill(json({
      files: route.request().url().includes("/node/node-cv101/")
        ? [{ id: "up-gs10", filename: "GS10 drive user manual.pdf", source: "upload", indexed: true }]
        : [],
    }));
  });
  await page.route(/\/api\/assets\/node-cv101\/notebook\/?$/, (route) => route.fulfill(json({
    ok: true, created: true, notebook: { ...notebook("nb-cv101", "Discharge Conveyor CV-101 (synthetic)", "cmms-cv101"), asset: { entityId: "cmms-cv101", confirmedAt: null } },
  }, 201)));
  await page.route(/\/api\/equipment-notebooks\/nb-cv101\/asset\/?$/, (route) => route.fulfill(json({
    ok: true, notebook: { asset: { entityId: "cmms-cv101", confirmedAt: NOW } },
  })));
  await page.route(/\/api\/equipment-notebooks\/nb-[a-z0-9-]+\/sources\/?$/, (route) => route.fulfill(json({ ok: true }, 201)));
  await page.route(/\/api\/equipment-notebooks\/nb-cv101\/(\?.*)?$/, (route) => route.fulfill(json({
    notebook: notebook("nb-cv101", "Discharge Conveyor CV-101 (synthetic)", "cmms-cv101"),
    sources: [
      { docId: "up-gs10", filename: "GS10 drive user manual.pdf", enabledByDefault: true, readiness: { state: "chat_ready_basic", canChat: true }, matchState: "verified" },
      { docId: "up-gs20", filename: "GS20 drive user manual.pdf", enabledByDefault: true, readiness: { state: "failed", canChat: false }, matchState: "candidate" },
    ],
    turns: [], threads: [],
  })));
  await page.route(/\/api\/equipment-notebooks\/nb-general\/(\?.*)?$/, (route) => route.fulfill(json({
    notebook: notebook("nb-general", "Bench notes (synthetic)", null), sources: [], turns: [], threads: [],
  })));
  return writes;
}

async function openSheet(page: Page, mobile: boolean): Promise<Locator> {
  await page.goto(`${HUB}/v3/`);
  if (mobile) await page.getByRole("button", { name: "Open navigation" }).first().click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  const dlg = page.getByRole("dialog", { name: "New project" });
  await expect(dlg.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
  return dlg;
}

const shot = async (page: Page, vp: string, step: string) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${vp}-${step}.png`), fullPage: false });
};

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });

    test.beforeEach(async ({ page }) => {
      const email = process.env.E2E_EMAIL;
      const password = process.env.E2E_PASSWORD;
      test.skip(!email || !password, "E2E_EMAIL/E2E_PASSWORD required (dev account)");
      await signIn(page, email!, password!);
    });

    test("CV-101 with its linked manual, an upload and a wrong-model manual", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
      test.info().annotations.push({ type: "errors", description: "see console-errors attachment" });
      const writes = await stub(page);
      const dlg = await openSheet(page, vp.mobile);
      await shot(page, vp.name, "1-choose");
      await dlg.getByRole("button", { name: /Discharge Conveyor CV-101/ }).click();
      await expect(dlg.getByText("Line 4", { exact: false }).first()).toBeVisible();
      await dlg.getByRole("button", { name: "Next", exact: true }).click();
      await expect(dlg.getByRole("heading", { name: "Load references" })).toBeVisible();
      await expect(dlg.getByRole("checkbox", { name: /GS10 drive user manual/ })).toBeChecked();
      await dlg.getByRole("checkbox", { name: /GS20 drive user manual/ }).check();
      await expect(dlg.getByRole("checkbox", { name: /Wiring scan/ })).toBeDisabled();
      await dlg.getByLabel("Upload PDF").setInputFiles({ name: "Unknown pump datasheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%synthetic\n") });
      await shot(page, vp.name, "2-references");
      expect(writes, "no writes before Create project").toEqual([]);
      await dlg.getByRole("button", { name: "Review" }).click();
      await dlg.getByRole("button", { name: "Create project" }).click();
      const dialog = dlg;
      await expect(dialog.getByText("Ready to search")).toBeVisible();
      await expect(dialog.getByText("Verified for this machine")).toBeVisible();
      await expect(dialog.getByText("Suggested, not approved")).toBeVisible();
      await expect(dialog.getByText("Needs attention")).toHaveCount(2);
      await shot(page, vp.name, "3-readiness");
      expect(writes).toEqual([
        "POST /hub/api/assets/node-cv101/notebook/",
        "PUT /hub/api/equipment-notebooks/nb-cv101/asset/",
        "POST /hub/api/equipment-notebooks/nb-cv101/sources/",
        "POST /hub/api/equipment-notebooks/nb-cv101/sources/",
        "POST /hub/api/namespace/node/node-of-nb-cv101/files/",
      ]);
      await dlg.getByRole("button", { name: "Continue" }).click();
      await shot(page, vp.name, "4-start");
      await dlg.getByRole("button", { name: "Open project" }).click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/notebook=nb-cv101/);
      await expect(page.getByText("no selected sources", { exact: false })).toHaveCount(0);
      await shot(page, vp.name, "5-opened");
      fs.writeFileSync(path.join(OUT, `${vp.name}-console-errors.txt`), errors.join("\n") || "(none)");
    });

    test("phone/browser Back closes the sheet and keeps the shell's address", async ({ page }) => {
      const writes = await stub(page);
      const dlg = await openSheet(page, vp.mobile);
      await page.waitForTimeout(400); // the sheet arms its Back entry after the drawer's own history step
      const before = page.url();
      await page.goBack();
      await expect(dlg).toBeHidden();
      await expect(page).toHaveURL(before);
      expect(writes).toEqual([]);
    });

    test("General project with no machine stays unbound", async ({ page }) => {
      const writes = await stub(page);
      const dlg = await openSheet(page, vp.mobile);
      await dlg.getByRole("button", { name: "General (no machine)" }).click();
      await expect(dlg.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      await dlg.getByRole("textbox").fill("Bench notes (synthetic)");
      await dlg.getByRole("button", { name: "Next", exact: true }).click();
      await dlg.getByRole("button", { name: "Review" }).click();
      await dlg.getByRole("button", { name: "Create project" }).click();
      await expect(dlg.getByRole("button", { name: "Continue" })).toBeVisible();
      expect(writes).toEqual(["POST /hub/api/equipment-notebooks/"]);
    });

    test("Back and Cancel write nothing; a machine with a project is refused", async ({ page }) => {
      const writes = await stub(page);
      const dlg = await openSheet(page, vp.mobile);
      await dlg.getByRole("button", { name: /Infeed Conveyor CV-102/ }).click();
      await expect(dlg.getByText("This machine already has a project: Infeed Conveyor")).toBeVisible();
      await expect(dlg.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      await shot(page, vp.name, "1-duplicate");
      await dlg.getByRole("button", { name: /Discharge Conveyor CV-101/ }).click();
      await dlg.getByRole("button", { name: "Next", exact: true }).click();
      await dlg.getByRole("button", { name: "Back", exact: true }).click();
      await expect(dlg.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
      await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dlg).toBeHidden();
      await page.keyboard.press("Escape");
      expect(writes).toEqual([]);
    });

    test("#5296: the server refuses machine A; after Back, machine B's project opens, never A's", async ({ page }) => {
      const writes = await stub(page);
      const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
      // CV-103 passes the client pre-check (no project in the list) but the server
      // says it already has one: created:false.
      await page.route(/\/api\/namespace\/tree\/?$/, (route) => route.fulfill(json({
        nodes: [{ id: "line4", name: "Line 4", kind: "line", unsPath: "enterprise.lake_wales.line_4", children: [
          { id: "node-cv102", name: "Infeed Conveyor CV-102 (synthetic)", kind: "asset", unsPath: "enterprise.lake_wales.line_4.cv_102", children: [] },
          { id: "node-cv103", name: "Transfer Conveyor CV-103 (synthetic)", kind: "asset", unsPath: "enterprise.lake_wales.line_4.cv_103", children: [] },
        ] }],
      })));
      await page.route(/\/api\/assets\/node-cv103\/notebook\/?$/, (route) => route.fulfill(json({
        ok: true, created: false, notebook: { id: "nb-cv103-old", nodeId: "node-of-nb-cv103-old", displayName: "Transfer Conveyor (older project)" },
      })));
      await page.route(/\/api\/equipment-notebooks\/nb-existing-cv102\/(\?.*)?$/, (route) => route.fulfill(json({
        notebook: notebook("nb-existing-cv102", "Infeed Conveyor", "node-cv102"), sources: [], turns: [], threads: [],
      })));
      await page.route(/\/api\/equipment-notebooks\/nb-cv103-old\/(\?.*)?$/, (route) => route.fulfill(json({
        notebook: notebook("nb-cv103-old", "Transfer Conveyor (older project)", "node-cv103"), sources: [], turns: [], threads: [],
      })));
      const dlg = await openSheet(page, vp.mobile);
      await dlg.getByRole("button", { name: /Transfer Conveyor CV-103/ }).click();
      await dlg.getByRole("button", { name: "Next", exact: true }).click();
      await dlg.getByRole("button", { name: "Review" }).click();
      await dlg.getByRole("button", { name: "Create project" }).click();
      await expect(dlg.getByText("This machine already has a project: Transfer Conveyor (older project)")).toBeVisible();
      await shot(page, vp.name, "5296-1-refused-a");
      await dlg.getByRole("button", { name: "Back", exact: true }).click();
      await dlg.getByRole("button", { name: "Back", exact: true }).click();
      await expect(dlg.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
      await expect(dlg.getByText("Transfer Conveyor (older project)")).toHaveCount(0);
      await dlg.getByRole("button", { name: /Infeed Conveyor CV-102/ }).click();
      await expect(dlg.getByText("This machine already has a project: Infeed Conveyor")).toBeVisible();
      await shot(page, vp.name, "5296-2-chose-b");
      await dlg.getByRole("button", { name: "Open that project" }).click();
      await expect(dlg).toBeHidden();
      await expect(page).toHaveURL(/notebook=nb-existing-cv102/);
      await expect(page).not.toHaveURL(/nb-cv103-old/);
      await shot(page, vp.name, "5296-3-opened-b");
      expect(writes).toEqual(["POST /hub/api/assets/node-cv103/notebook/"]);
    });

    test("a manual another upload is still reading shows Processing, then Ready once it is indexed", async ({ page }) => {
      const writes = await stub(page);
      const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
      let fileReads = 0;
      let attached = false;
      await page.route(/\/api\/namespace\/node\/[^/]+\/files\/?$/, (route) => route.fulfill(json({ ok: true, indexed: false, indexing: true, fileId: "f-late" }, 202)));
      await page.route(/\/api\/files\/f-late\/?$/, (route) => {
        fileReads++;
        return route.fulfill(json({ file: { id: "f-late", filename: "Pump manual.pdf", uploadId: fileReads < 3 ? null : "up-late", indexed: fileReads >= 3 }, links: [] }));
      });
      await page.route(/\/api\/equipment-notebooks\/nb-general\/sources\/?$/, (route) => { attached = true; return route.fulfill(json({ ok: true }, 201)); });
      await page.route(/\/api\/equipment-notebooks\/nb-general\/(\?.*)?$/, (route) => route.fulfill(json({
        notebook: notebook("nb-general", "Bench notes (synthetic)", null),
        sources: attached ? [{ docId: "up-late", filename: "Pump manual.pdf", enabledByDefault: true, readiness: { state: "chat_ready_basic", canChat: true }, matchState: "user_confirmed" }] : [],
        turns: [], threads: [],
      })));
      const dlg = await openSheet(page, vp.mobile);
      await dlg.getByRole("button", { name: "General (no machine)" }).click();
      await dlg.getByRole("textbox").fill("Bench notes (synthetic)");
      await dlg.getByRole("button", { name: "Next", exact: true }).click();
      await dlg.getByLabel("Upload PDF").setInputFiles({ name: "Pump manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%synthetic\n") });
      await dlg.getByRole("button", { name: "Review" }).click();
      await dlg.getByRole("button", { name: "Create project" }).click();
      await expect(dlg.getByText("Processing")).toBeVisible();
      await expect(dlg.getByText("Needs attention")).toHaveCount(0);
      await shot(page, vp.name, "indexing-1-processing");
      await expect(dlg.getByText("Ready to search")).toBeVisible({ timeout: 30_000 });
      await shot(page, vp.name, "indexing-2-ready");
      expect(fileReads).toBe(3);
      expect(writes).toEqual([
        "POST /hub/api/equipment-notebooks/",
        "POST /hub/api/namespace/node/node-of-nb-general/files/",
        "POST /hub/api/equipment-notebooks/nb-general/sources/",
      ]);
    });

    test("an interrupted upload is Needs attention and the project still opens", async ({ page }) => {
      const writes = await stub(page);
      await page.route(/\/api\/namespace\/node\/[^/]+\/files\/?$/, (route) => route.abort("connectionreset"));
      const dlg = await openSheet(page, vp.mobile);
      await dlg.getByRole("button", { name: "General (no machine)" }).click();
      await dlg.getByRole("textbox").fill("Bench notes (synthetic)");
      await dlg.getByRole("button", { name: "Next", exact: true }).click();
      await dlg.getByLabel("Upload PDF").setInputFiles({ name: "Pump manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%synthetic\n") });
      await dlg.getByRole("button", { name: "Review" }).click();
      await dlg.getByRole("button", { name: "Create project" }).click();
      await expect(dlg.getByText("Needs attention")).toBeVisible();
      await expect(dlg.getByText("Couldn't save this file. Try again.")).toBeVisible();
      await expect(dlg.getByText("Ready to search")).toHaveCount(0);
      await shot(page, vp.name, "interrupted-upload");
      await dlg.getByRole("button", { name: "Continue" }).click();
      await dlg.getByRole("button", { name: "Open project" }).click();
      await expect(page).toHaveURL(/notebook=nb-general/);
      expect(writes).toEqual(["POST /hub/api/equipment-notebooks/", "POST /hub/api/namespace/node/node-of-nb-general/files/"]);
    });
  });
}

/**
 * #5551 — Prepare job for a maker job packets don't cover, and the synthetic demo controls.
 * Every /api request the PAGE makes is answered here (an unmocked write is aborted and fails the
 * test); the server behind it is the shared loopback-only, credential-free harness (#5731), so
 * nothing reaches a database or a provider. Fixture proof only, not staging or device acceptance.
 * LOCAL ONLY: lives outside tests/e2e (the default config's testDir targets production).
 * Run: npx playwright test --config playwright.prepare-job-5551.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { FIXTURES, fixturePages } from "../../src/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "../../src/capabilities/work-packet/draft";
import { addNote, emptyRecord } from "../../src/capabilities/work-packet/job-record";
import { installSessionCookie } from "./harness/fixture-harness.cjs";

const PORT = 3951; // must match playwright.prepare-job-5551.config.ts
const NB = "00000000-0000-4000-8000-000000005551";
const SHOT_DIR = process.env.SHOT_DIR ?? path.join(__dirname, "..", "..", "..", "docs", "promo-screenshots");

async function shot(page: Page, name: string, project: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `2026-11-21_${name}_${project}.png`) });
}

type Avail = { manufacturer: string; blocking: null | { reason: string; message: string }; deferred?: boolean };
const SIEMENS: Avail = { manufacturer: "Siemens", deferred: true, blocking: { reason: "manufacturer_not_supported", message: "stale server wording" } };
const CAT: Avail = { manufacturer: "CAT Pumps", blocking: null };
const PENDING: Avail = { manufacturer: "", blocking: { reason: "identity_not_confirmed", message: "Confirm identity." } };
const pending = (a: Avail) => a.blocking?.reason === "identity_not_confirmed";

function notebook(a: Avail) {
  return {
    id: NB, displayName: "Pump 5551", manufacturer: a.manufacturer, model: "X1", catalogNumber: null, serialNumber: null, equipmentType: null,
    assetTag: null, locationLabel: null, identityStatus: pending(a) ? "pending" : "user_confirmed", identityConfidence: null, identitySourceType: "user",
    nodeId: "node-5551", sourceCount: 0, lastOpenedAt: null, createdAt: "2026-11-14T00:00:00.000Z", asset: null,
  };
}
const availability = (a: Avail) => ({
  enabled: true, documents: [], documentsState: a.deferred ? "deferred" : "read",
  identity: { manufacturer: a.manufacturer, model: "X1", catalogNumber: null, serialNumber: null, status: pending(a) ? "pending" : "user_confirmed", confidence: null },
  blocking: a.blocking,
});

/** What the page's confirmation requests are answered with, as the real routes word them. */
type Confirm = { typed?: string; nameplate?: { ok: boolean; message: string } };
type State = { avail: Avail; confirm: Confirm };

/** Answers every /api request the page makes. Unmocked reads get an empty 200 and are listed; an
 *  unmocked write is aborted and recorded, and the test fails on it. */
async function mockApi(page: Page, state: State, unhandled: string[]) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const p = url.pathname.replace(/\/$/, "");
    if (p.endsWith("/work-packet") && method === "GET") return route.fulfill({ json: availability(state.avail) });
    if (p.endsWith("/identity/confirm") && method === "POST") {
      state.avail = SIEMENS;
      return route.fulfill({ json: { ok: true, notebookId: NB, manufacturer: "Siemens", model: "X1", message: state.confirm.typed ?? "Confirmed." } });
    }
    if (p.endsWith("/nameplate/recognize") && method === "POST") {
      return route.fulfill({ json: { fileId: "plate-1", confidence: 0.92, candidate: { manufacturer: "Siemens", model: "X1", catalogNumber: null, serialNumber: null }, rawObservation: { rawText: ["SIEMENS", "X1"] } } });
    }
    if (p.endsWith("/nameplate/confirm") && method === "POST") {
      const out = state.confirm.nameplate ?? { ok: true, message: "Nameplate confirmed." };
      if (out.ok) state.avail = SIEMENS;
      return route.fulfill({ json: out });
    }
    if (p === "/api/equipment-notebooks" && method === "GET") return route.fulfill({ json: { notebooks: [{ ...notebook(state.avail), threads: [] }] } });
    if (p === `/api/equipment-notebooks/${NB}` && method === "GET") {
      return route.fulfill({ json: { notebook: notebook(state.avail), sources: [], turns: [], threads: [], photos: [], manualSearch: null } });
    }
    if (p === "/api/auth/session") return route.fulfill({ json: { user: { email: "pj5551@factorylm-test.com" }, expires: new Date(Date.now() + 86_400_000).toISOString() } });
    if (p.startsWith("/api/auth")) return route.fulfill({ json: {} });
    unhandled.push(`${method} ${p}`);
    if (method !== "GET") return route.abort();
    return route.fulfill({ status: 200, json: {} });
  });
}
const noWrites = (unhandled: string[]) => expect(unhandled.filter((u) => !u.startsWith("GET "))).toEqual([]);

const FORM = ["wp-workorder", "wp-build", "wp-load-synthetic", "wp-typed-confirm", "wp-nameplate-input"];
async function expectNoForm(page: Page) {
  for (const id of FORM) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByText(/Synthetic \/ demo/)).toHaveCount(0);
}

test.beforeEach(async ({ context, baseURL }) => {
  // The exact-origin check runs before the secret is read, a token is encoded or the context is touched.
  await installSessionCookie(context, baseURL, PORT, {
    uid: "pj5551", tid: "00000000-0000-0000-0000-000000005551", status: "trial",
    trialExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), email: "pj5551@factorylm-test.com",
  });
});

test("known unsupported maker: no Prepare job entry up front", async ({ page }) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: SIEMENS, confirm: {} }, unhandled);
  const settled = page.waitForResponse((r) => r.url().includes("/work-packet/"), { timeout: 60_000 });
  await page.goto(`/v3/?notebook=${NB}`, { waitUntil: "domcontentloaded" });
  await settled;
  await page.waitForTimeout(750); // the menu registers on the render after the response
  await expect(page.getByTestId("notebook-actions")).toBeAttached({ timeout: 60_000 });
  await expect(page.getByTestId("wp-open")).toHaveCount(0);
  const more = page.getByTestId("notebook-more");
  if (await more.count()) await more.click();
  await expect(page.getByTestId("notebook-more-item-work-packet")).toHaveCount(0);
  noWrites(unhandled);
});

test("direct ?workpacket=open on Siemens: plain message, Close works, no form or demo controls", async ({ page }, info) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: SIEMENS, confirm: {} }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  const msg = page.getByTestId("wp-unsupported-message");
  await expect(msg).toBeVisible({ timeout: 60_000 });
  await expect(msg).toContainText("Job packets aren't available for Siemens equipment yet.");
  await expect(page.getByTestId("wp-dialog")).not.toContainText(/own documents|attach/i);
  await expectNoForm(page);
  await shot(page, "prepare-job-5551-siemens-direct-link", info.project.name);
  await page.getByTestId("wp-close").click();
  await expect(page.getByTestId("wp-dialog")).not.toBeVisible();
  noWrites(unhandled);
});

// F3: the manual-acquisition outcome the server gave stays visible, labelled, beside the reason.
const TYPED_OUTCOMES = {
  ready: "Confirmed — I found the Siemens X1 manual and it's ready to answer from.",
  searching: "Confirmed as a Siemens X1. I'll look for its manual.",
  "no search": "Confirmed as a Siemens X1. No automatic manual search was started — add its manual in Sources.",
} as const;
for (const [kind, message] of Object.entries(TYPED_OUTCOMES)) {
  test(`typed confirmation turns unsupported: the "${kind}" outcome and the reason are both shown, form hidden`, async ({ page }, info) => {
    const unhandled: string[] = [];
    await mockApi(page, { avail: PENDING, confirm: { typed: message } }, unhandled);
    await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("wp-typed-manufacturer").fill("Siemens", { timeout: 60_000 });
    await page.getByTestId("wp-typed-model").fill("X1");
    await page.getByTestId("wp-typed-confirm").click();
    await expect(page.getByTestId("wp-unsupported-message")).toContainText("Siemens equipment yet");
    const feedback = page.getByTestId("wp-confirmation-feedback");
    await expect(feedback).toContainText("Identity and manual search");
    await expect(page.getByTestId("wp-typed-outcome")).toHaveText(message);
    await expect(page.getByTestId("wp-close")).toBeVisible();
    await expectNoForm(page);
    if (kind === "ready") await shot(page, "prepare-job-5551-typed-outcome-siemens", info.project.name);
    noWrites(unhandled);
  });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function readNameplate(page: Page) {
  await page.getByTestId("wp-nameplate-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("wp-nameplate-review")).toBeVisible();
  await page.getByRole("button", { name: "Confirm nameplate" }).click();
}

test("nameplate confirmation turns unsupported: its outcome and the reason are both shown, form hidden", async ({ page }) => {
  const unhandled: string[] = [];
  const message = "Nameplate confirmed. Manual search was not requested.";
  await mockApi(page, { avail: PENDING, confirm: { nameplate: { ok: true, message } } }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("wp-nameplate-input").waitFor({ timeout: 60_000 });
  await readNameplate(page);
  await expect(page.getByTestId("wp-unsupported-message")).toContainText("Siemens equipment yet");
  await expect(page.getByTestId("wp-nameplate-outcome")).toHaveText(message);
  await expect(page.getByTestId("wp-confirmation-feedback")).toContainText("Identity and manual search");
  await expectNoForm(page);
  noWrites(unhandled);
});

test("nameplate still being indexed: that outcome is shown and the identity form stays", async ({ page }) => {
  const unhandled: string[] = [];
  const message = "Your nameplate was saved but is still being indexed (or indexing failed). Retry in a moment — the manual search runs once the nameplate is citable.";
  await mockApi(page, { avail: PENDING, confirm: { nameplate: { ok: false, message } } }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("wp-nameplate-input").waitFor({ timeout: 60_000 });
  await readNameplate(page);
  await expect(page.getByTestId("wp-nameplate-outcome")).toHaveText(message);
  await expect(page.getByTestId("wp-unsupported")).toHaveCount(0);
  await expect(page.getByTestId("wp-typed-confirm")).toBeVisible();
  noWrites(unhandled);
});

// F2: an old CAT Pumps packet saved on this device, the notebook now confirmed as Siemens.
function savedCatPacket() {
  const built = buildDraftPacket({
    notebookId: NB, packetId: "pk-5551-old", now: "2026-11-03T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO-OLD", title: "Reseal", description: "Pump leaking at the shaft — reseal it.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(FIXTURES["manual-85v2.txt"]), via: "file" }], hazardFlags: [],
  });
  if (!built.ok) throw new Error(built.message);
  const record = addNote(emptyRecord("pk-5551-old"), { id: "n1", kind: "issue", text: "Seal kit not in stores", stepIndex: null, by: "T. Original", at: "2026-11-03T12:00:00Z", resolved: false });
  return { packet: built.packet, record };
}

test("saved CAT packet + current Siemens: Resume keeps the record, the reason shows, no form/rebuild, export disabled", async ({ page }, info) => {
  const unhandled: string[] = [];
  const { packet, record } = savedCatPacket();
  await page.addInitScript(([draft, rec, key1, key2]) => {
    window.localStorage.setItem(key1, draft);
    window.localStorage.setItem(key2, rec);
  }, [JSON.stringify(packet), JSON.stringify(record), `work-packet-draft:${NB}`, "work-packet-record:pk-5551-old"]);
  await mockApi(page, { avail: SIEMENS, confirm: {} }, unhandled);
  await page.goto(`/v3/?notebook=${NB}`, { waitUntil: "domcontentloaded" });

  // Resume is still offered for the saved packet.
  await page.getByTestId("notebook-more").click({ timeout: 60_000 });
  const item = page.getByTestId("notebook-more-item-work-packet");
  await expect(item).toContainText("Resume job packet");
  await item.click();

  await expect(page.getByTestId("wp-unsupported-message")).toContainText("Siemens equipment yet");
  await expect(page.getByTestId("wp-packet")).toBeVisible();
  await expect(page.getByTestId("wp-synthetic-stamp")).toBeVisible(); // old synthetic marker kept
  await expect(page.getByTestId("wp-note-issue")).toContainText("Seal kit not in stores"); // saved record kept
  await expect(page.getByTestId("wp-note-issue")).toContainText("T. Original"); // row attribution kept
  const stale = page.getByTestId("wp-stale");
  await expect(stale).toContainText("Out of date");
  await expect(stale).toContainText("cannot be rebuilt for this equipment");
  await expect(stale).not.toContainText("Build the packet again");
  await expect(page.getByTestId("wp-export")).toBeDisabled();
  await expectNoForm(page);
  await expect(page.getByTestId("wp-rebuild-note")).toHaveCount(0);
  await shot(page, "prepare-job-5551-saved-packet-siemens", info.project.name);

  // The record is still on this device: nothing was deleted or rebuilt.
  const kept = await page.evaluate(([k1, k2]) => [window.localStorage.getItem(k1), window.localStorage.getItem(k2)], [`work-packet-draft:${NB}`, "work-packet-record:pk-5551-old"]);
  expect(kept[0]).toContain("pk-5551-old");
  expect(kept[1]).toContain("Seal kit not in stores");
  noWrites(unhandled);
});

test("supported CAT Pumps: normal form, no demo controls", async ({ page }, info) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: CAT, confirm: {} }, unhandled);
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("wp-build")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("wp-unsupported")).toHaveCount(0);
  await expect(page.getByTestId("wp-load-synthetic")).toHaveCount(0);
  await expect(page.getByText(/Synthetic \/ demo/)).toHaveCount(0);
  await shot(page, "prepare-job-5551-cat-pumps-no-demo", info.project.name);
  // Control: for a supported maker the Prepare job entry IS listed under More.
  await page.getByTestId("wp-close").click();
  await page.getByTestId("notebook-more").click();
  await expect(page.getByTestId("notebook-more-item-work-packet")).toBeVisible();
  await page.keyboard.press("Escape");
  noWrites(unhandled);
});

// F5: wait for the EXACT 404s (delayed on purpose) and for the render after them, then assert absence.
test("feature flag off (404): renders nothing, after both 404s arrived and the page re-rendered", async ({ page }) => {
  const unhandled: string[] = [];
  await mockApi(page, { avail: CAT, confirm: {} }, unhandled);
  await page.route("**/api/equipment-notebooks/*/work-packet/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500)); // a late answer, so "nothing yet" cannot pass for "nothing ever"
    await route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  const isPacket = (r: { url(): string }) => r.url().includes("/work-packet/");
  const metadata = page.waitForResponse((r) => isPacket(r) && r.url().includes("metadataOnly=1"), { timeout: 60_000 });
  const full = page.waitForResponse((r) => isPacket(r) && !r.url().includes("metadataOnly=1"), { timeout: 60_000 });
  await page.goto(`/v3/?notebook=${NB}&workpacket=open`, { waitUntil: "domcontentloaded" });
  expect((await metadata).status()).toBe(404);
  expect((await full).status()).toBe(404);
  // The response has been handled once React has committed the state it caused.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.waitForTimeout(300);
  await expect(page.getByTestId("notebook-actions")).toBeAttached();
  await expect(page.getByTestId("wp-dialog")).toHaveCount(0);
  await expect(page.getByTestId("wp-open")).toHaveCount(0);
  const more = page.getByTestId("notebook-more");
  if (await more.count()) await more.click();
  await expect(page.getByTestId("notebook-more-item-work-packet")).toHaveCount(0);
  noWrites(unhandled);
});

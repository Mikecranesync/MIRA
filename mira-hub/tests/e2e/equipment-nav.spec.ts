/**
 * Equipment-first navigation in the Hub (#5625), flag on and off, end to end in a real
 * browser against the production build.
 *
 * Data: every /api/** request is answered here (the fidelity harness's declared surface,
 * plus the equipment-browser routes and a component checklist), so nothing reaches a
 * database. The panel's flag is MIRA_EQUIPMENT_NAV on the server; the browser only sees
 * what the routes answer, so "on" = the availability probe answers 200, "off" = 404.
 *
 * What is proved:
 *   - on: browse → Ask about sends one resolve carrying the revision on screen and the open
 *     conversation's selection version, then the checklist (the only selection writer)
 *     selects that component through its own PUT, version-checked.
 *   - a record that changed elsewhere (409 stale_revision) shows a notice and selects nothing.
 *   - off: the panel is not rendered.
 *
 * Auth: a next-auth JWE signed with the SAME AUTH_SECRET the server boots with
 * (playwright.command-center.config.ts).
 */
import { test, expect, type BrowserContext, type Page, type Request } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { installRoutes, NB } from "../fidelity/harness";

const AUTH_SECRET = "cc-e2e-fixed-secret-do-not-use-in-prod";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD = "e2e-equipment-thread";
const VFD = "44444444-4444-4444-8444-444444444444";
const MLC = "77777777-7777-4777-8777-777777777777";

async function auth(context: BrowserContext, baseURL: string) {
  const trialExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const token = await encode({
    token: { uid: "e2e-equipment-nav", tid: TENANT_ID, status: "trial", trialExpiresAt, email: "e2e-equipment-nav@factorylm-test.com" },
    secret: AUTH_SECRET,
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
}

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const vfdRev = {
  componentId: VFD, revision: 3, rawLabel: "AutomationDirect GS10", inputKind: "typed",
  manufacturer: "AutomationDirect", family: "GS10", catalogNumber: null, serialNumber: null,
  hardwareRevision: null, localTag: "VFD1", identityStatus: "user_confirmed", unresolved: [],
  confirmedAt: "2026-11-14T03:00:00.000Z", createdAt: "2026-11-14T03:00:00.000Z",
};
const vfdView = {
  id: VFD, position: 0, kind: "VFD", origin: "device_schedule", status: "confirmed", statusLabel: "confirmed",
  label: "VFD1 · AutomationDirect GS10", current: vfdRev, documents: [], hasOwnDocument: false, evidence: "Confirmed by a technician.",
};
const bench = (selected: boolean) => ({
  components: [vfdView],
  selection: selected ? { componentId: VFD, revision: 3, selectedAt: "2026-11-18T12:00:00.000Z", selectedVia: "picker", version: 1, current: true } : null,
  selectionVersion: selected ? 1 : null,
  lastTurn: null,
  turnComponents: {},
  tallies: {},
  documentNumbers: [],
});

const rootPage = {
  items: [{
    kind: "notebook", id: NB, name: "GS10 — Line 3 conveyor", parent: { kind: "root", id: null }, childrenCount: 2,
    notebook: { displayName: "GS10 — Line 3 conveyor", model: "DURApulse GS10", locationLabel: "Line 3" },
  }],
  counts: { total: 1 }, hasMore: false, nextCursor: null,
};
const component = (id: string, name: string, revision: number, family: string) => ({
  kind: "notebook_component", id, name, parent: { kind: "notebook", id: NB }, childrenCount: 0,
  component: { retiredAt: null, kind: "drive", current: { revision, localTag: name, rawLabel: name, manufacturer: "AutomationDirect", family, catalogNumber: null } },
});
const notebookPage = {
  items: [component(VFD, "VFD1", 3, "GS10"), component(MLC, "Q1", 1, "MLC")],
  counts: { total: 2 }, hasMore: false, nextCursor: null,
};

type Seen = { resolves: URL[]; selectionPuts: Record<string, unknown>[] };

/** Fidelity surface first, then (registered later, so tried first) the routes under test. */
async function routes(page: Page, opts: { enabled: boolean; resolve: "resolved" | "stale_revision" }): Promise<Seen> {
  await installRoutes(page, "G");
  const seen: Seen = { resolves: [], selectionPuts: [] };
  let selected = false;

  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill(json(bench(selected)));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/selection\/?$/, (route) => {
    const req: Request = route.request();
    if (req.method() !== "PUT") return route.fallback();
    seen.selectionPuts.push(req.postDataJSON());
    selected = true;
    return route.fulfill(json({ ok: true }));
  });
  await page.route(/\/api\/equipment-browser\//, (route) => {
    const url = new URL(route.request().url());
    if (!opts.enabled) return route.fulfill(json({ error: "equipment_nav_disabled" }, 404));
    if (url.pathname.includes("/children")) {
      const parentKind = url.searchParams.get("parentKind");
      return route.fulfill(json(parentKind === "notebook" ? notebookPage : rootPage));
    }
    if (url.pathname.includes("/resolve")) {
      seen.resolves.push(url);
      if (opts.resolve === "stale_revision") return route.fulfill(json({ error: "stale_revision" }, 409));
      return route.fulfill(json({
        status: "resolved",
        notebook: { id: NB, displayName: "GS10 — Line 3 conveyor", locationLabel: "Line 3" },
        component: { id: VFD, kind: "drive", current: { localTag: "VFD1", rawLabel: "VFD1" } },
      }));
    }
    return route.fulfill(json({ items: [], counts: { total: 0 }, hasMore: false, nextCursor: null }));
  });
  return seen;
}

const panel = (page: Page) => page.getByTestId("equipment-nav");
const row = (page: Page, key: string) => panel(page).locator(`[role="tree"] [data-equipment-key="${key}"]`);

async function openToVfd(page: Page) {
  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, `notebook_component:${VFD}`)).toBeVisible();
  await row(page, `notebook_component:${VFD}`).click();
}

test("on: Ask about resolves once and the checklist selects the component", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openToVfd(page);
  await panel(page).locator('[role="tree"]').getByRole("button", { name: "Ask about VFD1" }).click();

  await expect.poll(() => seen.selectionPuts.length).toBe(1);
  expect(seen.resolves).toHaveLength(1);
  const q = seen.resolves[0].searchParams;
  expect(q.get("componentId")).toBe(VFD);
  expect(q.get("expectedRevision")).toBe("3");
  // The open conversation never had a selection: version "none", bound to this thread.
  expect(q.get("selectionVersion")).toBe("none");
  expect(q.get("threadKey")).toBe(THREAD);
  // The write is the checklist's own, version-checked against what it read.
  expect(seen.selectionPuts[0]).toMatchObject({ threadId: THREAD, componentId: VFD, via: "picker", expectedVersion: null });
});

test("a record that changed elsewhere is refused with a notice and nothing is selected", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "stale_revision" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openToVfd(page);
  await panel(page).locator('[role="tree"]').getByRole("button", { name: "Ask about VFD1" }).click();

  const notice = panel(page).getByRole("alert").filter({ hasText: "did not change" }).first();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-reason", "stale_revision");
  expect(seen.resolves).toHaveLength(1);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("off: the panel is not rendered", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  const probe = page.waitForResponse((r) => r.url().includes("/api/equipment-browser/children"));
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  expect((await probe).status()).toBe(404);
  await expect(page.getByTestId("notebook-actions")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

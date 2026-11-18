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
 *   - on: browse → Ask about sends one resolve carrying the revision on screen and no selection
 *     precondition (#5625 r1 F1), then the checklist (the only selection writer) selects that
 *     component through its own PUT, checked against the version and revision seen at the press.
 *   - switching from a saved component to another one works (#5625 r1 F1).
 *   - a record that changed elsewhere is refused at resolve (409) or at the write (409), with a
 *     notice, and nothing is selected (#5625 r1 F4).
 *   - an answer that arrives after another chat was opened moves nothing (#5625 r1 F3).
 *   - reopening a chat never replays a pick already applied there (#5625 r1 F2).
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
const mlcView = {
  ...vfdView, id: MLC, position: 1, kind: "MLC", label: "Q1 · MLC",
  current: { ...vfdRev, componentId: MLC, revision: 1, rawLabel: "MLC", family: "MLC", localTag: "Q1" },
};
type Selection = { componentId: string; version: number } | null;
const bench = (sel: Selection) => ({
  components: [vfdView, mlcView],
  selection: sel ? { componentId: sel.componentId, revision: sel.componentId === VFD ? 3 : 1, selectedAt: "2026-11-18T12:00:00.000Z", selectedVia: "picker", version: sel.version, current: true } : null,
  selectionVersion: sel?.version ?? null,
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

type Seen = {
  resolves: URL[];
  selectionPuts: Record<string, unknown>[];
  /** Per-conversation selection, as the server holds it. */
  selections: Map<string, Selection>;
  /** Lets a held resolve answer (opts.holdResolve). */
  release: () => void;
};
type RouteOpts = {
  enabled: boolean;
  resolve: "resolved" | "stale_revision";
  put?: "ok" | "stale_revision";
  holdResolve?: boolean;
  initial?: Record<string, Selection>;
};

/** Fidelity surface first, then (registered later, so tried first) the routes under test. */
async function routes(page: Page, opts: RouteOpts): Promise<Seen> {
  await installRoutes(page, "G");
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const seen: Seen = { resolves: [], selectionPuts: [], selections: new Map(Object.entries(opts.initial ?? {})), release };

  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const thread = new URL(route.request().url()).searchParams.get("threadId") ?? "";
    return route.fulfill(json(bench(seen.selections.get(thread) ?? null)));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/selection\/?$/, (route) => {
    const req: Request = route.request();
    if (req.method() !== "PUT") return route.fallback();
    const body = req.postDataJSON() as { threadId: string; componentId: string };
    seen.selectionPuts.push(body);
    if (opts.put === "stale_revision") return route.fulfill(json({ error: "stale_revision" }, 409));
    const before = seen.selections.get(body.threadId);
    seen.selections.set(body.threadId, { componentId: body.componentId, version: (before?.version ?? 0) + 1 });
    return route.fulfill(json({ status: "set" }));
  });
  await page.route(/\/api\/equipment-browser\//, async (route) => {
    const url = new URL(route.request().url());
    if (!opts.enabled) return route.fulfill(json({ error: "equipment_nav_disabled" }, 404));
    if (url.pathname.includes("/children")) {
      const parentKind = url.searchParams.get("parentKind");
      return route.fulfill(json(parentKind === "notebook" ? notebookPage : rootPage));
    }
    if (url.pathname.includes("/resolve")) {
      seen.resolves.push(url);
      if (opts.holdResolve) await released;
      if (opts.resolve === "stale_revision") return route.fulfill(json({ error: "stale_revision" }, 409)).catch(() => undefined);
      const id = url.searchParams.get("componentId");
      return route.fulfill(json({
        status: "resolved",
        notebook: { id: NB, displayName: "GS10 — Line 3 conveyor", locationLabel: "Line 3" },
        component: { id, kind: "drive", current: { localTag: id === MLC ? "Q1" : "VFD1", rawLabel: id === MLC ? "Q1" : "VFD1" } },
      })).catch(() => undefined);
    }
    return route.fulfill(json({ items: [], counts: { total: 0 }, hasMore: false, nextCursor: null }));
  });
  return seen;
}

const panel = (page: Page) => page.getByTestId("equipment-nav");
const row = (page: Page, key: string) => panel(page).locator(`[role="tree"] [data-equipment-key="${key}"]`);

async function openTo(page: Page, id: string) {
  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, `notebook_component:${id}`)).toBeVisible();
  await row(page, `notebook_component:${id}`).click();
}
const askAbout = (page: Page, label: string) =>
  panel(page).locator('[role="tree"]').getByRole("button", { name: `Ask about ${label}` }).click();
const pickNotice = (page: Page) => page.getByTestId("equipment-pick-notice");

test("on: Ask about resolves once and the checklist selects the component", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");

  await expect.poll(() => seen.selectionPuts.length).toBe(1);
  expect(seen.resolves).toHaveLength(1);
  const q = seen.resolves[0].searchParams;
  expect(q.get("componentId")).toBe(VFD);
  expect(q.get("expectedRevision")).toBe("3");
  // No selection precondition on resolve: the write below is the compare-and-set.
  expect(q.has("selectionVersion")).toBe(false);
  expect(q.has("threadKey")).toBe(false);
  // The open conversation never had a selection: expected version null, revision as seen.
  expect(seen.selectionPuts[0]).toMatchObject({ threadId: THREAD, componentId: VFD, via: "picker", expectedVersion: null, expectedRevision: 3 });
});

test("a saved component can be switched to another one (#5625 r1 F1)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 1 } } });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, MLC);
  await askAbout(page, "Q1");

  await expect.poll(() => seen.selectionPuts.length).toBe(1);
  expect(seen.resolves[0].searchParams.has("selectionVersion")).toBe(false);
  expect(seen.selectionPuts[0]).toMatchObject({ threadId: THREAD, componentId: MLC, expectedVersion: 1, expectedRevision: 1 });
  expect(seen.selections.get(THREAD)).toEqual({ componentId: MLC, version: 2 });
});

test("a record that changed elsewhere is refused with a notice and nothing is selected", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "stale_revision" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");

  const notice = panel(page).getByRole("alert").filter({ hasText: "did not change" }).first();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-reason", "stale_revision");
  expect(seen.resolves).toHaveLength(1);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("a record corrected between resolve and the write is refused at the write (#5625 r1 F4)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", put: "stale_revision" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");

  await expect(pickNotice(page)).toContainText("changed on another screen since you picked it");
  expect(seen.selectionPuts).toHaveLength(1);
  expect(seen.selections.get(THREAD)).toBeUndefined();
});

test("an answer that arrives after another chat was opened moves nothing (#5625 r1 F3)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", holdResolve: true });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  // Precondition: the press is still waiting on the server.
  expect(seen.selectionPuts).toHaveLength(0);
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page).not.toHaveURL(new RegExp(`thread=${THREAD}`));
  seen.release();

  await expect(pickNotice(page)).toContainText("opened another chat");
  expect(seen.selectionPuts).toHaveLength(0);
});

test("reopening a chat never replays a pick already applied there (#5625 r1 F2)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=legacy`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect.poll(() => seen.selectionPuts.length).toBe(1);
  await expect.poll(() => seen.selections.get("legacy")).toEqual({ componentId: VFD, version: 1 });

  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page).not.toHaveURL(/thread=legacy/);
  // Meanwhile another screen moves that chat to Q1.
  seen.selections.set("legacy", { componentId: MLC, version: 2 });
  await page.locator(`[data-item-id="notebook-${NB}:thread-legacy"]`).first().click();
  await expect(page).toHaveURL(/thread=legacy/);
  // The reopened checklist has loaded the moved selection; give a replay time to fire.
  await expect(page.getByTestId("bench-asking-about")).toContainText("Q1", { timeout: 10_000 });
  await page.waitForTimeout(1500);
  expect(seen.selectionPuts).toHaveLength(1);
  expect(seen.selections.get("legacy")).toEqual({ componentId: MLC, version: 2 });
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

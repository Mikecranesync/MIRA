/**
 * Equipment-first navigation in the Hub (#5625), flag on and off, end to end in a real
 * browser against the production build.
 *
 * Data: every /api/** request is answered here (the fidelity harness's declared surface,
 * plus the equipment-browser routes and a component checklist), so nothing reaches a
 * database. The panel's flag is MIRA_EQUIPMENT_NAV on the server; the browser only sees
 * what the routes answer, so "on" = the availability probe answers 200, "off" = 404.
 *
 * What is proved (#5625 r2, Mike's B: Ask about opens the checklist on the part; the technician
 * selects it there):
 *   - on: browse → Ask about sends one resolve with the revision on screen and no selection
 *     precondition, then opens the checklist with that part marked. Nothing is saved until the
 *     technician taps it; that write carries the version and revision the checklist shows.
 *   - switching from a saved component to another one works.
 *   - a record that changed elsewhere is refused at resolve or at the write, and nothing is selected.
 *   - an answer that arrives after leaving and returning to the chat moves nothing (r2 F3).
 *   - a destination checklist that fails to load ends the hand-off with a notice (r2 F11).
 *   - equipment in another notebook is only offered; the technician's Open tap opens it, and
 *     closing the panel cancels a lookup on its way so the chat and its draft stay (r3 F12).
 *   - a component added after the checklist was read is shown after one fresh read (r3 F13).
 *   - showing a part never saves it, and reopening the chat does not show it again.
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
const bench = (sel: Selection, without?: string) => ({
  components: [vfdView, mlcView].filter((c) => c.id !== without),
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
  benchReads: number;
};
type RouteOpts = {
  enabled: boolean;
  resolve: "resolved" | "stale_revision";
  put?: "ok" | "stale_revision";
  holdResolve?: boolean;
  benchFails?: boolean;
  /** The first checklist read predates this component (it was added on another screen). */
  firstBenchWithout?: string;
  /** The resolve answers with the component in this notebook instead of NB. */
  resolveNotebook?: string;
  initial?: Record<string, Selection>;
};

/** Fidelity surface first, then (registered later, so tried first) the routes under test. */
async function routes(page: Page, opts: RouteOpts): Promise<Seen> {
  await installRoutes(page, "G");
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const seen: Seen = { resolves: [], selectionPuts: [], selections: new Map(Object.entries(opts.initial ?? {})), release, benchReads: 0 };

  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (opts.benchFails) return route.fulfill(json({ error: "internal" }, 500));
    const thread = new URL(route.request().url()).searchParams.get("threadId") ?? "";
    seen.benchReads += 1;
    const without = seen.benchReads === 1 ? opts.firstBenchWithout : undefined;
    return route.fulfill(json(bench(seen.selections.get(thread) ?? null, without)));
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
        notebook: { id: opts.resolveNotebook ?? NB, displayName: opts.resolveNotebook ? "Packaging line" : "GS10 — Line 3 conveyor", locationLabel: "Line 3" },
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
const checklist = (page: Page) => page.getByTestId("bench-components-panel");
const checklistRow = (page: Page, id: string) => checklist(page).getByTestId(`bench-component-${id}`);
const offer = (page: Page) => page.getByTestId("equipment-offer");
const composer = (page: Page) => page.getByRole("textbox", { name: /ask mira/i });
const selectInChecklist = (page: Page, id: string) => checklistRow(page, id).getByRole("button", { name: "Ask about this" }).click();

test("on: Ask about opens the checklist on the part; the technician's tap selects it", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");

  await expect(checklistRow(page, VFD)).toHaveAttribute("data-found", "true");
  expect(seen.resolves).toHaveLength(1);
  const q = seen.resolves[0].searchParams;
  expect(q.get("componentId")).toBe(VFD);
  expect(q.get("expectedRevision")).toBe("3");
  expect(q.has("selectionVersion")).toBe(false);
  expect(q.has("threadKey")).toBe(false);
  // Showing is not selecting.
  expect(seen.selectionPuts).toHaveLength(0);

  await selectInChecklist(page, VFD);
  await expect.poll(() => seen.selectionPuts.length).toBe(1);
  expect(seen.selectionPuts[0]).toMatchObject({ threadId: THREAD, componentId: VFD, via: "picker", expectedVersion: null, expectedRevision: 3 });
});

test("a saved component can be switched to another one", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 1 } } });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  await selectInChecklist(page, MLC);

  await expect.poll(() => seen.selectionPuts.length).toBe(1);
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
  await expect(checklist(page)).toHaveCount(0);
});

test("a record corrected after the checklist was read is refused at the write (#5625 r2 F4)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", put: "stale_revision" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await selectInChecklist(page, VFD);

  await expect(checklist(page).getByTestId("bench-message")).toContainText("changed on another screen");
  expect(seen.selectionPuts).toHaveLength(1);
  expect(seen.selectionPuts[0]).toMatchObject({ componentId: VFD, expectedRevision: 3 });
  expect(seen.selections.get(THREAD)).toBeUndefined();
});

test("an answer that arrives after leaving and returning to the chat moves nothing (#5625 r2 F3)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", holdResolve: true });
  await page.goto(`/v3/?notebook=${NB}&thread=legacy`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page).not.toHaveURL(/thread=legacy/);
  await page.locator(`[data-item-id="notebook-${NB}:thread-legacy"]`).first().click();
  // Precondition: back on the chat the press came from, same IDs.
  await expect(page).toHaveURL(/thread=legacy/);
  seen.release();

  await expect(pickNotice(page)).toContainText("opened another chat");
  await expect(page).toHaveURL(/thread=legacy/);
  await expect(checklist(page)).toHaveCount(0);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("a destination checklist that fails to load ends the hand-off with a notice (#5625 r2 F11)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", benchFails: true });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");

  await expect(pickNotice(page)).toContainText("couldn't be read");
  expect(seen.selectionPuts).toHaveLength(0);
});

test("showing a part never saves it, and reopening the chat does not show it again", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=legacy`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect(checklistRow(page, VFD)).toHaveAttribute("data-found", "true");
  await checklist(page).getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page).not.toHaveURL(/thread=legacy/);
  await page.locator(`[data-item-id="notebook-${NB}:thread-legacy"]`).first().click();
  await expect(page).toHaveURL(/thread=legacy/);
  // The reopened checklist has loaded; give a replay time to show.
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(checklist(page)).toHaveCount(0);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("equipment in another notebook is offered and opens only on the technician's tap (#5625 r3 F12)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");

  await expect(offer(page)).toContainText("VFD1 is in GS10 — Line 3 conveyor");
  // Nothing opened by itself.
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/notebook=/);
  await expect(checklist(page)).toHaveCount(0);

  await offer(page).getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`notebook=${NB}`));
  await expect(checklistRow(page, VFD)).toHaveAttribute("data-found", "true");
  expect(seen.selectionPuts).toHaveLength(0);
});

test("closing Find equipment cancels a lookup on its way: the chat and the typed message stay (#5625 r3 F12)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const seen = await routes(page, { enabled: true, resolve: "resolved", holdResolve: true, resolveNotebook: OTHER });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();
  const url = page.url();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await panel(page).getByRole("button", { name: "Close equipment" }).click();
  await composer(page).fill("half-typed question");
  seen.release();

  await page.waitForTimeout(1500);
  expect(page.url()).toBe(url);
  await expect(composer(page)).toHaveValue("half-typed question");
  await expect(offer(page)).toHaveCount(0);
  await expect(checklist(page)).toHaveCount(0);

  // Control: with the panel left open the same answer arrives as an offer; still nothing moves.
  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect(offer(page)).toContainText("Packaging line");
  expect(page.url()).toBe(url);
  await expect(composer(page)).toHaveValue("half-typed question");
  expect(seen.selectionPuts).toHaveLength(0);
});

test("a component added after the checklist was read is still shown: one fresh read first (#5625 r3 F13)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", firstBenchWithout: MLC });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();
  // Precondition: the checklist on screen was read without Q1.
  await expect.poll(() => seen.benchReads).toBeGreaterThanOrEqual(1);

  await openTo(page, MLC);
  await askAbout(page, "Q1");

  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  expect(seen.benchReads).toBeGreaterThanOrEqual(2);
  await expect(pickNotice(page)).toHaveCount(0);
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

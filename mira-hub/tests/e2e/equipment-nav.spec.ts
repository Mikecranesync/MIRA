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
 *   - Close on the checklist drops a part waiting on an open label editor; it is not shown later (#5637).
 *   - a full page of 50 results scrolls inside the panel; Close equipment and the page stay put (#5639),
 *     also on a short landscape screen, where the checklist stays on screen too (#5643).
 *   - the open results sit on the panel's own surface in light and dark (#5654).
 *   - off: the panel is not rendered.
 *   - repeated serial (#5649), with Find equipment OFF as it ships: confirming a component whose serial
 *     number is already on other components says so where the card was and names each one; no match
 *     or an older server looks as it always did; a check that failed never hides the save's success;
 *     a match opens through this same hand-off, here or in another machine, and nothing is selected.
 *
 * Auth: a next-auth JWE signed with the SAME AUTH_SECRET the server boots with
 * (playwright.command-center.config.ts).
 */
import { test, expect, type BrowserContext, type Page, type Request } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { installRoutes, NB, oracle } from "../fidelity/harness";

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

const fullNotebookPage = (n: number) => ({
  items: Array.from({ length: n }, (_, i) => component(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `M${i + 1}`, 1, "MLC")),
  counts: { total: n + 10 }, hasMore: true, nextCursor: "next",
});

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
  /** 1-based checklist reads that answer 500. */
  failReads?: number[];
  /** The first checklist read predates this component (it was added on another screen). */
  firstBenchWithout?: string;
  /** The notebook's children page holds this many components (a full page, #5639). */
  fullPage?: number;
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
    if (opts.failReads?.includes(seen.benchReads)) return route.fulfill(json({ error: "internal" }, 500));
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
      if (parentKind === "notebook" && opts.fullPage) return route.fulfill(json(fullNotebookPage(opts.fullPage)));
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
const showFound = (page: Page) => offer(page).getByRole("button", { name: "Show in checklist" }).click();
const selectInChecklist = (page: Page, id: string) => checklistRow(page, id).getByRole("button", { name: "Ask about this" }).click();

test("on: Ask about offers the part; Show in checklist opens it there; the technician's tap selects it", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  // The answer is a button in the panel; nothing else moved (#5625 r4 F14).
  await expect(offer(page)).toContainText("Found VFD1");
  await expect(checklist(page)).toHaveCount(0);
  await showFound(page);
  await expect(offer(page)).toHaveCount(0);

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
  await showFound(page);
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
  await showFound(page);
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
  await showFound(page);

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
  await showFound(page);
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

for (const originKind of ["saved", "new"] as const) {
  test(`opening equipment in another notebook preserves the origin draft and photo from a ${originKind} chat (#5684)`, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    const destination = "99999999-9999-4999-8999-999999999999";
    const seen = await routes(page, { enabled: true, resolve: "resolved", resolveNotebook: destination });
    const originTitle = originKind === "saved" ? "Origin draft conversation" : "Unsent draft";
    const origin = oracle.list.notebooks[0];
    await page.route(/\/api\/equipment-notebooks\/?$/, (route) => route.fulfill(json({
      notebooks: [{
        ...origin,
        threads: originKind === "saved" ? [{ id: THREAD, notebookId: NB, title: originTitle, turnCount: 1, sharedLegacy: false,
          createdAt: origin.createdAt, updatedAt: origin.createdAt }] : [],
      }],
    })));
    await page.route(new RegExp(`/api/equipment-notebooks/${destination}/?(\\?.*)?$`), (route) => route.fulfill(json({
      ...oracle.detailEmpty,
      notebook: { ...oracle.detailEmpty.notebook, id: destination, displayName: "Packaging line" },
    })));

    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await openTo(page, VFD);
    await askAbout(page, "VFD1");
    await expect(offer(page)).toContainText("Packaging line");

    const draft = "Check the original drive before the next shift.";
    const photoName = "fixture-draft-photo.png";
    await composer(page).fill(draft);
    await page.getByRole("button", { name: "Add attachment" }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Photo", exact: true }).click(),
    ]);
    await chooser.setFiles({
      name: photoName,
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64"),
    });
    const attachment = page.getByRole("button", { name: `Remove ${photoName}` });
    await expect(attachment).toBeVisible();

    await offer(page).getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`notebook=${destination}`));
    await expect(checklistRow(page, VFD)).toHaveAttribute("data-found", "true");
    await checklist(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(composer(page)).toHaveValue("");
    await expect(attachment).toHaveCount(0);

    const originRow = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: originTitle });
    await expect(originRow).toBeVisible();
    await originRow.click();
    await expect(page).toHaveURL(new RegExp(`notebook=${NB}&thread=${THREAD}`));
    await expect(attachment).toBeVisible();
    await expect(composer(page)).toHaveValue(draft);
    expect(seen.selectionPuts).toHaveLength(0);
  });
}

test("a failed send that is aborted by navigation cannot put its question in another chat (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved" });
  await page.addInitScript(() => {
    const fetchNormally = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method !== "POST" || !String(input).includes("/chat/")) return fetchNormally(input, init);
      // The HTTP status arrives first. The error body is still streaming
      // when opening a fresh chat aborts the origin's request.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 500 }));
    };
  });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  await composer(page).fill("Only the origin may recover this question.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();

  const origin = page.url();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(origin);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue("");
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
  await showFound(page);

  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  expect(seen.benchReads).toBeGreaterThanOrEqual(2);
  await expect(pickNotice(page)).toHaveCount(0);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("an answer that arrives while a label is being edited never closes the editor (#5625 r4 F14)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", holdResolve: true });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await page.getByTestId("bench-asking-about").click();
  await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
  await page.getByTestId("bench-card-raw").fill("unsaved edit");
  seen.release();

  await expect(offer(page)).toContainText("Found Q1");
  await expect(page.getByTestId("bench-card-raw")).toHaveValue("unsaved edit");
  // Even the tap waits for the editor to be finished with, and says so.
  await showFound(page);
  await expect(offer(page)).toHaveCount(0);
  await expect(checklist(page).getByTestId("bench-focus-waiting")).toContainText("Q1 · MLC will be shown when you finish this label");
  await expect(page.getByTestId("bench-card-raw")).toHaveValue("unsaved edit");
  await checklist(page).getByRole("button", { name: "Cancel" }).click();
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  expect(seen.selectionPuts).toHaveLength(0);
});

test("closing Find equipment aborts the lookup: Ask is free again and a late refusal shows nothing (#5625 r4 F15)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "stale_revision", holdResolve: true });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await panel(page).getByRole("button", { name: "Close equipment" }).click();
  await openTo(page, MLC);
  // Nothing is still "checking": every Ask control is usable.
  await expect(panel(page).locator('[role="tree"]').getByRole("button", { name: "Ask about Q1" })).toBeEnabled();
  seen.release();

  await page.waitForTimeout(1000);
  await expect(panel(page).getByRole("alert").filter({ hasText: "did not change" })).toHaveCount(0);
  await expect(offer(page)).toHaveCount(0);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("a failed checklist read does not fail the next lookup: it gets its own fresh read (#5625 r4 F16)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", firstBenchWithout: MLC, failReads: [2] });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => seen.benchReads).toBeGreaterThanOrEqual(1);

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await showFound(page);
  // Precondition: the re-read for the first hand-off failed.
  await expect(pickNotice(page)).toContainText("couldn't be read");
  const before = seen.benchReads;

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await showFound(page);
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  expect(seen.benchReads).toBeGreaterThan(before);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("Close on the checklist drops a part waiting on an open label editor; it is not shown later (#5637)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", holdResolve: true });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await page.getByTestId("bench-asking-about").click();
  await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
  await page.getByTestId("bench-card-raw").fill("unsaved edit");
  seen.release();
  await showFound(page);
  await expect(checklist(page).getByTestId("bench-focus-waiting")).toContainText("Q1 · MLC will be shown when you finish this label");

  await checklist(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(checklist(page)).toHaveCount(0);
  // Nothing reopens it by itself, and opening it by hand does not replay the hand-off.
  await page.waitForTimeout(500);
  await expect(checklist(page)).toHaveCount(0);
  await page.getByTestId("bench-asking-about").click();
  await expect(checklistRow(page, MLC)).toBeVisible();
  await expect(checklistRow(page, MLC)).not.toHaveAttribute("data-found", "true");
  await expect(pickNotice(page)).toHaveCount(0);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("a full page of 50 results scrolls inside the panel; Close equipment and the page stay put (#5639)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  const region = page.getByTestId("equipment-scroll");
  const viewport = page.viewportSize()!;
  const box = (await region.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  const more = panel(page).getByRole("button", { name: /show more/i }).first();
  await more.scrollIntoViewIfNeeded();
  await expect(more).toBeInViewport();
  expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  await expect(panel(page).getByRole("button", { name: "Close equipment" })).toBeInViewport();
  await expect(page.getByTestId("bench-asking-about")).toBeInViewport();
});

test("on a short landscape screen the results still scroll inside the panel; Close equipment and the checklist stay on screen (#5643)", async ({ page, context, baseURL }) => {
  // 400 px: short, but tall enough for Close, a row of results and the checklist above the chat
  // composer (#5658). Below that the whole panel scrolls; the touch test for #5659 covers it.
  await page.setViewportSize({ width: 800, height: 400 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  const region = page.getByTestId("equipment-scroll");
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  const more = panel(page).getByRole("button", { name: /show more/i }).first();
  await more.scrollIntoViewIfNeeded();
  await expect(more).toBeInViewport();
  expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  await expect(panel(page).getByRole("button", { name: "Close equipment" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("bench-asking-about")).toBeInViewport({ ratio: 1 });
});

test("on a short landscape screen an offer above the results still leaves the checklist on screen (#5655 r1 F1)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 350 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000000")).toBeAttached();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000000").click();
  await askAbout(page, "M1");
  await expect(offer(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  await expect(offer(page)).toBeVisible();
  const region = page.getByTestId("equipment-scroll");
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(page.getByTestId("bench-asking-about")).toBeInViewport({ ratio: 1 });
});

test("on a short landscape screen an offer and a refusal together still leave the checklist on screen; the panel scrolls itself (#5655 r2 F1)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 350 });
  await auth(context, baseURL!);
  const opts: RouteOpts = { enabled: true, resolve: "resolved", fullPage: 50 };
  await routes(page, opts);
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000000").click();
  await askAbout(page, "M1");
  await expect(offer(page)).toBeVisible();

  opts.resolve = "stale_revision";
  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000001").click();
  await askAbout(page, "M2");
  await expect(panel(page).getByRole("alert").filter({ hasText: "did not change" }).first()).toBeAttached();
  await expect(offer(page)).toBeAttached();

  const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  await expect(page.getByTestId("bench-asking-about")).toBeInViewport({ ratio: 1 });
  const last = row(page, "notebook_component:00000000-0000-4000-8000-000000000049");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  await expect(page.getByTestId("bench-asking-about")).toBeInViewport({ ratio: 1 });
});

test("the open results sit on the panel's own surface in light and dark, so chat text never shows through (#5654)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "Find equipment" }).click();
    await row(page, `notebook:${NB}`).click();
    const surface = await page.getByTestId("equipment-scroll").evaluate((el) => {
      const probe = document.createElement("div");
      probe.style.background = "var(--fl-workspace-surface)";
      el.appendChild(probe);
      const token = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { background: getComputedStyle(el).backgroundColor, token };
    });
    expect(surface.background, colorScheme).not.toBe("rgba(0, 0, 0, 0)");
    expect(surface.background, colorScheme).toBe(surface.token);
  }
});

test("on a short landscape screen, Send still sends with a full equipment list open; the checklist stays shut (#5658)", async ({ page, context, baseURL }) => {
  // 300 px is where, before the fix, the checklist trigger sat over the middle of Send in this layout.
  await page.setViewportSize({ width: 800, height: 300 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  await composer(page).fill("does the drive have power");
  // Nothing else is on top of the middle of Send (before the fix the checklist trigger was).
  const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
  const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button[aria-label="Send"]') !== null, [send.x + send.width / 2, send.y + send.height / 2]);
  expect(onTop, "Send is on top at its own middle").toBe(true);
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/chat\/?$/.test(new URL(r.url()).pathname), { timeout: 5_000 });
  // Tap where Send is on screen, as a finger would: no scrolling it into view first, and whatever
  // is on top at that point takes the tap.
  await page.mouse.click(send.x + send.width / 2, send.y + send.height / 2);
  await sent;
  await expect(checklist(page)).toHaveCount(0);
});

/** Open a full list with an offer and a refusal above it at 800×350, so the panel itself must scroll. */
async function openCrowdedShortPanel(page: Page, context: BrowserContext, baseURL: string) {
  await page.setViewportSize({ width: 800, height: 350 });
  await auth(context, baseURL);
  const opts: RouteOpts = { enabled: true, resolve: "resolved", fullPage: 50 };
  await routes(page, opts);
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000000").click();
  await askAbout(page, "M1");
  await expect(offer(page)).toBeVisible();
  opts.resolve = "stale_revision";
  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000001").click();
  await askAbout(page, "M2");
  await expect(panel(page).getByRole("alert").filter({ hasText: "did not change" }).first()).toBeAttached();
}

const overscrollY = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => getComputedStyle(el).overscrollBehaviorY);

// Deterministic half of #5659, run everywhere including CI: while the panel itself scrolls, the
// results let a swipe carry on into it; the panel still stops at the page. The finger-level proof
// is the touch test below, which runs locally and on the device walk.
test("when the panel itself scrolls, the results hand an overscroll on to it; the panel never scrolls the page (#5659)", async ({ page, context, baseURL }) => {
  await openCrowdedShortPanel(page, context, baseURL!);
  expect(await panel(page).evaluate((el) => el.scrollHeight > el.clientHeight), "the panel scrolls").toBe(true);
  await expect.poll(() => overscrollY(page, "equipment-scroll")).toBe("auto");
  expect(await overscrollY(page, "equipment-nav")).toBe("contain");
});

test("when the panel fits, the results keep their overscroll to themselves (#5659 control)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Find equipment" }).click();
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  expect(await panel(page).evaluate((el) => el.scrollHeight > el.clientHeight + 1), "the panel fits").toBe(false);
  await expect.poll(() => overscrollY(page, "equipment-scroll")).toBe("contain");
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("on a very short screen a touch user can swipe into the results and back to the notices and Close equipment (#5659)", async ({ page, context, baseURL }) => {
    // Chromium's synthesized touch scrolls barely move the results on the GitHub Linux runner (about
    // one row in 40 swipes, PR #5666), while the same test passes locally at 800×330–380. CI runs
    // the deterministic overscroll tests above instead; this one runs locally and before device walks.
    test.skip(!!process.env.CI, "synthesized touch scrolling is unreliable on the CI runner");
    await openCrowdedShortPanel(page, context, baseURL!);
    expect(await panel(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    const cdp = await context.newCDPSession(page);
    const results = page.getByTestId("equipment-scroll");
    /** The part of `target` a finger can touch: inside the panel's scrollport and on screen. */
    const visible = async (target: typeof results) => {
      const t = (await target.boundingBox())!;
      const p = (await panel(page).boundingBox())!;
      const top = Math.max(t.y, p.y, 0);
      const bottom = Math.min(t.y + t.height, p.y + p.height, page.viewportSize()!.height);
      return { x: t.x + t.width / 2, top, bottom, height: bottom - top };
    };
    /** A touch swipe starting in the middle of the visible part of `target`. */
    const swipe = async (target: typeof results, yDistance: number) => {
      const v = await visible(target);
      expect(v.height, "the swipe starts on the visible target").toBeGreaterThan(8);
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(v.x), y: Math.round((v.top + v.bottom) / 2),
        yDistance, gestureSourceType: "touch", speed: 1500, repeatCount: 1,
      });
    };
    const panelScroll = () => panel(page).evaluate((el) => el.scrollTop);
    const panelMax = () => panel(page).evaluate((el) => el.scrollHeight - el.clientHeight);

    // Swipe the panel itself up as far as it goes, so the results take up as much of it as they can.
    for (let i = 0; i < 20 && (await panelScroll()) < (await panelMax()) - 1; i++) await swipe(panel(page), -150);
    expect((await visible(results)).height, "the results are visible in the panel").toBeGreaterThan(20);
    // Swipe the results to their end (how far one swipe travels depends on the machine).
    const atEnd = () => results.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
    for (let i = 0; i < 40 && !(await atEnd()); i++) await swipe(results, -300);
    expect(await atEnd(), "the results reached their end").toBe(true);
    const scrolledDown = await panelScroll();
    expect(scrolledDown).toBeGreaterThan(0);

    // The property (#5659): swipes that start on the results, once the results are back at their
    // top, carry on into the panel. With overscroll contained they never move the panel.
    for (let i = 0; i < 40 && (await panelScroll()) === scrolledDown && (await visible(results)).height > 8; i++) {
      await swipe(results, 300);
    }
    expect(await panelScroll(), "a swipe on the results moved the panel").toBeLessThan(scrolledDown);
    // Then the rest of the way back to Close, wherever the finger lands in the panel.
    for (let i = 0; i < 20 && (await panelScroll()) > 0; i++) await swipe(panel(page), 300);
    expect(await panelScroll()).toBe(0);
    await expect(panel(page).getByRole("button", { name: "Close equipment" })).toBeInViewport({ ratio: 1 });

    await page.touchscreen.tap(
      ...(await (async () => { const b = (await panel(page).getByRole("button", { name: "Close equipment" }).boundingBox())!; return [b.x + b.width / 2, b.y + b.height / 2] as const; })()),
    );
    await expect(panel(page).getByRole("button", { name: "Find equipment" })).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  });
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

// ---------------------------------------------------------------------------------------------
// Repeated serial number (#5649). The technician confirms a component; the save's reply says the
// same serial number is already on other components; the checklist says so where the card was.
// Find equipment is OFF in every case (as it ships): the warning needs no flag, and opening a
// match uses the hand-off proved above.
// ---------------------------------------------------------------------------------------------
const OTHER_NB = "99999999-9999-4999-8999-999999999999";
const AWAY = "88888888-8888-4888-8888-888888888888";
const GONE = "66666666-6666-4666-8666-666666666666";
const SERIAL = "E2E-SN-0042"; // made up

const here = { componentId: MLC, notebookId: NB, notebookName: "GS10 — Line 3 conveyor", label: "Q1 · MLC", retired: false };
const away = { componentId: AWAY, notebookId: OTHER_NB, notebookName: "Packaging line", label: "VFD1 · AutomationDirect GS10", retired: false };
const gone = { componentId: GONE, notebookId: OTHER_NB, notebookName: "Packaging line", label: "VFD7 · AutomationDirect GS10", retired: true };
const checked = (candidates: unknown[]) => ({ status: "checked", candidates, truncated: false });

/** The save route: it commits (201) and answers as the server does, with or without `sameSerial`. */
async function revisions(page: Page, reply: { sameSerial?: unknown; raw?: string }, opts: { hold?: Promise<void> } = {}) {
  const saves: Record<string, unknown>[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/[^/]+\/revisions\/?$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    saves.push(route.request().postDataJSON());
    if (opts.hold) await opts.hold; // the server has the save and has not answered yet
    if (reply.raw !== undefined) return route.fulfill({ status: 201, contentType: "text/html", body: reply.raw });
    return route.fulfill(json({ status: "created", current: { ...vfdRev, revision: 4, serialNumber: SERIAL }, changed: ["serialNumber"], selection: null, ...reply }, 201));
  });
  return saves;
}

/** A second machine the tenant owns, so a match there has somewhere to open. */
async function otherMachine(page: Page) {
  const asOther = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll(NB, OTHER_NB).replaceAll("GS10 — Line 3 conveyor", "Packaging line"));
  await page.route(/\/api\/equipment-notebooks(\/[^?]*)?(\?.*)?$/, (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/(.)\/$/, "$1");
    if (req.method() !== "GET") return route.fallback();
    if (p === "/api/equipment-notebooks") return route.fulfill(json({ notebooks: [...oracle.list.notebooks, ...asOther(oracle.list.notebooks)] }));
    if (!p.includes(OTHER_NB)) return route.fallback();
    if (p === `/api/equipment-notebooks/${OTHER_NB}`) return route.fulfill(json(asOther(oracle.detailEmpty)));
    if (p === `/api/equipment-notebooks/${OTHER_NB}/components`) {
      return route.fulfill(json({ ...bench(null), components: [{ ...vfdView, id: AWAY, current: { ...vfdRev, componentId: AWAY } }] }));
    }
    // Its other panels answer as the first machine's do (off).
    return route.fallback({ url: req.url().replace(OTHER_NB, NB) });
  });
}

async function confirmWithSerial(page: Page) {
  await page.getByTestId("bench-asking-about").click();
  await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
  await checklist(page).getByTestId("bench-card-serialNumber").fill(SERIAL);
  await checklist(page).getByTestId("bench-card-confirm").click();
}
const serialWarning = (page: Page) => checklist(page).getByRole("group", { name: "Repeated serial number" });
const notRunNote = (page: Page) => checklist(page).getByTestId("bench-same-serial-not-run");
const saved = (page: Page) => checklist(page).getByTestId("bench-message");
/** A proof screenshot, taken only when the run names a folder for it (MIRA_PROOF_SHOTS). */
async function proofShot(page: Page, viewport: "desktop" | "mobile") {
  const dir = process.env.MIRA_PROOF_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/2026-11-19_repeated-serial-warning_${viewport}.png` });
}

test("repeated serial: confirming names every other component with that serial number; Show in checklist marks the one here", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: false, resolve: "resolved" });
  const saves = await revisions(page, { sameSerial: checked([here, away, gone]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);

  // The save is reported as it always was, and the warning is where the card was.
  await expect(saved(page)).toContainText("Confirmed. Questions about it now use what you confirmed.");
  await expect(checklist(page).getByTestId("bench-card")).toHaveCount(0);
  const warning = serialWarning(page);
  await expect(warning.getByRole("status")).toHaveText("This serial number is already on 3 other components.");
  await expect(warning).toContainText("VFD1 · AutomationDirect GS10 is saved as confirmed. This may be the same unit. Nothing was blocked, changed or merged.");
  // Each match is named, and two components with the same label are told apart by where they are.
  await expect(warning.getByTestId(`bench-same-serial-match-${MLC}`)).toContainText("Q1 · MLC");
  await expect(warning.getByTestId(`bench-same-serial-match-${MLC}`)).toContainText("in this machine's checklist");
  await expect(warning.getByTestId(`bench-same-serial-match-${AWAY}`)).toContainText("VFD1 · AutomationDirect GS10");
  await expect(warning.getByTestId(`bench-same-serial-match-${AWAY}`)).toContainText("in Packaging line");
  await expect(warning.getByTestId(`bench-same-serial-match-${GONE}`)).toContainText("removed from the checklist");
  await expect(warning.getByTestId(`bench-same-serial-match-${GONE}`).getByRole("button")).toHaveCount(0);
  // The serial number went to the server once, in the save, and is not on the warning.
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ confirm: true, serialNumber: SERIAL, threadId: THREAD });
  await expect(warning).not.toContainText(SERIAL);

  // Confirm is at the bottom of the card and the result is at the top of the sheet: it is brought into view.
  await expect(saved(page)).toBeInViewport();
  await expect(warning.getByRole("status")).toBeInViewport();
  await proofShot(page, "desktop");

  // Find equipment is off, and a match here is still shown in the checklist. Nothing is selected.
  await expect(panel(page)).toHaveCount(0);
  await warning.getByRole("button", { name: "Show in checklist: Q1 · MLC" }).click();
  await expect(checklistRow(page, MLC)).toHaveAttribute("data-found", "true");
  await expect(warning).toBeVisible();
  expect(seen.selectionPuts).toHaveLength(0);

  // OK puts the warning away; the save's own line stays.
  await warning.getByRole("button", { name: "OK" }).click();
  await expect(serialWarning(page)).toHaveCount(0);
  await expect(saved(page)).toContainText("Confirmed.");
});

test("repeated serial: at phone width the warning is in view after the save and every button is a full touch target", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  await revisions(page, { sameSerial: checked([here, away, gone]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);

  const warning = serialWarning(page);
  await expect(saved(page)).toBeInViewport();
  await expect(warning.getByRole("status")).toBeInViewport();
  const buttons = await warning.getByRole("button").all();
  expect(buttons).toHaveLength(3); // Show in checklist, Open, OK: a removed component has none
  for (const button of buttons) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const box = (await warning.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(412);
  await proofShot(page, "mobile");
});

test("repeated serial: on a short screen, where Confirm is reached by scrolling the sheet, the result is brought back into view", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  await revisions(page, { sameSerial: checked([here, away, gone]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await page.getByTestId("bench-asking-about").click();
  await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
  await checklist(page).getByTestId("bench-card-serialNumber").fill(SERIAL);
  const confirm = checklist(page).getByTestId("bench-card-confirm");
  await confirm.scrollIntoViewIfNeeded();
  // The case this test is for: the sheet had to scroll to reach Confirm, so its top is out of view.
  expect(await checklist(page).evaluate((sheet) => sheet.scrollTop)).toBeGreaterThan(0);
  await confirm.click();

  await expect(serialWarning(page).getByRole("status")).toBeInViewport();
  await expect(saved(page)).toBeInViewport();
});

for (const [name, reply] of [
  ["no other component has it", { sameSerial: checked([]) }],
  ["a server that does not send the check", {}],
] as const) {
  test(`repeated serial: ${name}, so confirming looks as it always did`, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: false, resolve: "resolved" });
    const saves = await revisions(page, reply);
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await confirmWithSerial(page);

    await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
    await expect(checklist(page).getByTestId("bench-component-list")).toBeVisible();
    await expect(serialWarning(page)).toHaveCount(0);
    await expect(notRunNote(page)).toHaveCount(0);
    expect(saves).toHaveLength(1);
  });
}

for (const [name, reply] of [
  ["the check failed or timed out on the server", { sameSerial: { status: "not_checked", reason: "lookup_failed" } }],
  ["the save's reply could not be read", { raw: "<html>bad gateway</html>" }],
] as const) {
  test(`repeated serial: ${name}; the save is still reported as confirmed, with a quiet note`, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: false, resolve: "resolved" });
    await revisions(page, reply);
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await confirmWithSerial(page);

    await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
    await expect(notRunNote(page)).toHaveText("The check for this serial number on other components did not run this time. Your save is not affected.");
    await expect(serialWarning(page)).toHaveCount(0);
    await expect(checklist(page).getByTestId("bench-card")).toHaveCount(0);
  });
}

test("repeated serial: a match in another machine opens it on the technician's tap, in a new chat, with the component marked", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: false, resolve: "resolved" });
  await otherMachine(page);
  await revisions(page, { sameSerial: checked([away]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);

  const warning = serialWarning(page);
  await expect(warning.getByRole("status")).toHaveText("This serial number is already on another component.");
  // Nothing opens by itself.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`notebook=${NB}`));

  await warning.getByRole("button", { name: "Open Packaging line in a new chat: VFD1 · AutomationDirect GS10", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`notebook=${OTHER_NB}`));
  await expect(page).not.toHaveURL(new RegExp(`thread=${THREAD}`));
  await expect(checklistRow(page, AWAY)).toHaveAttribute("data-found", "true");
  expect(seen.selectionPuts).toHaveLength(0);
});

test("repeated serial: opening a label to edit takes the warning away, and cancelling does not bring it back", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  await revisions(page, { sameSerial: checked([away]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);
  await expect(serialWarning(page)).toBeVisible();

  await checklistRow(page, MLC).getByRole("button", { name: "Edit label" }).click();
  await expect(checklist(page).getByTestId("bench-card")).toBeVisible();
  await expect(serialWarning(page)).toHaveCount(0);
  await checklist(page).getByRole("button", { name: "Cancel" }).click();
  await expect(checklist(page).getByTestId("bench-component-list")).toBeVisible();
  await expect(serialWarning(page)).toHaveCount(0);
});

test("repeated serial: Save without Confirm shows no warning, whatever the reply carries", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  const saves = await revisions(page, { sameSerial: checked([away]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await page.getByTestId("bench-asking-about").click();
  await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
  await checklist(page).getByTestId("bench-card-serialNumber").fill(SERIAL);
  await checklist(page).getByTestId("bench-card-save").click();

  await expect(saved(page)).toHaveText("Saved — not confirmed yet.");
  await expect(serialWarning(page)).toHaveCount(0);
  await expect(notRunNote(page)).toHaveCount(0);
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ confirm: false, serialNumber: SERIAL });
});

test("repeated serial: a reply whose body never arrives does not hold the save's result back", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  await revisions(page, { sameSerial: checked([away]) });
  // The save answers 201, and then its body is never readable: only this route's replies are held.
  await page.addInitScript(() => {
    const readJson = Response.prototype.json;
    Response.prototype.json = function json(this: Response) {
      return /\/revisions\/?$/.test(new URL(this.url, location.href).pathname) ? new Promise(() => undefined) : readJson.call(this);
    };
  });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);

  // The save is reported while the check is still out, and the card is gone.
  await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
  await expect(notRunNote(page)).toHaveCount(0);
  await expect(serialWarning(page)).toHaveCount(0);
  await expect(checklist(page).getByTestId("bench-card")).toHaveCount(0);
  // The save is over, so the checklist can be used again without waiting for the check.
  await expect(checklistRow(page, MLC).getByRole("button", { name: "Edit label" })).toBeEnabled();
  // Then the check gives up, and says so quietly.
  await expect(notRunNote(page)).toBeVisible({ timeout: 10_000 });
  await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
});

for (const how of ["Close", "the pill"] as const) {
  test(`repeated serial: the sheet is closed with ${how} while the save is on its way; its warning is not shown when the sheet is opened again`, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: false, resolve: "resolved" });
    let answer!: () => void;
    const saves = await revisions(page, { sameSerial: checked([away]) }, { hold: new Promise<void>((resolve) => { answer = resolve; }) });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await page.getByTestId("bench-asking-about").click();
    await checklistRow(page, VFD).getByRole("button", { name: "Edit label" }).click();
    await checklist(page).getByTestId("bench-card-serialNumber").fill(SERIAL);
    const reply = page.waitForResponse((r) => r.request().method() === "POST" && /\/revisions\/?$/.test(new URL(r.url()).pathname));
    await checklist(page).getByTestId("bench-card-confirm").click();
    await expect.poll(() => saves.length).toBe(1); // the save has reached the server, which is holding its answer
    if (how === "Close") await checklist(page).getByRole("button", { name: "Close", exact: true }).click();
    else await page.getByTestId("bench-asking-about").press("Enter"); // by keyboard: the open sheet can cover the pill
    await expect(checklist(page)).toHaveCount(0);
    answer(); // only now does the save's reply leave the server
    await (await reply).finished();

    await page.getByTestId("bench-asking-about").click();
    // The save itself is reported as it always was; the warning it came with was closed with the sheet.
    await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
    await expect(serialWarning(page)).toHaveCount(0);
    await expect(notRunNote(page)).toHaveCount(0);
  });
}

test("repeated serial: a warning that is showing is ended by closing the sheet with the pill, as Close ends it", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  await revisions(page, { sameSerial: checked([away]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);
  await expect(serialWarning(page)).toBeVisible();

  await page.getByTestId("bench-asking-about").press("Enter");
  await expect(checklist(page)).toHaveCount(0);
  await page.getByTestId("bench-asking-about").click();
  await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
  await expect(serialWarning(page)).toHaveCount(0);
});

// The save's reply arrives (201) but its body can be read only when the test says so.
async function holdSaveReplyBody(page: Page) {
  await page.addInitScript(() => {
    const readJson = Response.prototype.json;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    (window as unknown as { readSaveReplyNow: () => void }).readSaveReplyNow = release;
    Response.prototype.json = function json(this: Response) {
      return /\/revisions\/?$/.test(new URL(this.url, location.href).pathname) ? held.then(() => readJson.call(this)) : readJson.call(this);
    };
  });
  return async () => {
    await page.evaluate(() => (window as unknown as { readSaveReplyNow: () => void }).readSaveReplyNow());
    // Long enough for the page to act on the reply it can now read; far short of the 3 s give-up.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
  };
}

test("repeated serial: a reply that can only be read late shows its warning then, under the save's result", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: false, resolve: "resolved" });
  await revisions(page, { sameSerial: checked([away]) });
  const readNow = await holdSaveReplyBody(page);
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);
  await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
  await expect(serialWarning(page)).toHaveCount(0);

  await readNow();
  await expect(serialWarning(page).getByTestId(`bench-same-serial-match-${AWAY}`)).toContainText("in Packaging line");
  await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
});

for (const when of ["while the label is open", "after the label was cancelled"] as const) {
  test(`repeated serial: a warning still on its way when a label is opened is not shown: its reply is read ${when}`, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: false, resolve: "resolved" });
    await revisions(page, { sameSerial: checked([away]) });
    const readNow = await holdSaveReplyBody(page);
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await confirmWithSerial(page);
    await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");

    await checklistRow(page, MLC).getByRole("button", { name: "Edit label" }).click();
    await expect(checklist(page).getByTestId("bench-card")).toBeVisible();
    if (when === "while the label is open") await readNow();
    await checklist(page).getByRole("button", { name: "Cancel" }).click();
    await expect(checklist(page).getByTestId("bench-component-list")).toBeVisible();
    if (when === "after the label was cancelled") await readNow();

    await expect(serialWarning(page)).toHaveCount(0);
    await expect(notRunNote(page)).toHaveCount(0);
  });
}

test("repeated serial: the warning is kept when the checklist cannot be re-read after the save", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  // Read 1 is the page load; read 2 is the re-read that follows the save.
  await routes(page, { enabled: false, resolve: "resolved", failReads: [2] });
  await revisions(page, { sameSerial: checked([away]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);

  await expect(serialWarning(page)).toContainText("VFD1 · AutomationDirect GS10 is saved as confirmed.");
  await expect(serialWarning(page).getByTestId(`bench-same-serial-match-${AWAY}`)).toContainText("in Packaging line");
});

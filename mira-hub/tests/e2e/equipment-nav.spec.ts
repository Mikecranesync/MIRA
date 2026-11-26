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
  await openEquipment(page);
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
async function attachDraftPhoto(page: Page, name: string) {
  await page.getByRole("button", { name: "Add attachment" }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Photo", exact: true }).click(),
  ]);
  await chooser.setFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64"),
  });
}
const showFound = (page: Page) => offer(page).getByRole("button", { name: "Show in checklist" }).click();
const selectInChecklist = (page: Page, id: string) => checklistRow(page, id).getByRole("button", { name: "Ask about this" }).click();
// The notebook's tools are behind one More button (Mike, 2026-11-20).
const more = (page: Page) => page.getByTestId("notebook-more");
async function openFromMore(page: Page, id: string) {
  await more(page).click();
  await page.getByTestId(`notebook-more-item-${id}`).click();
}
const openEquipment = (page: Page) => openFromMore(page, "equipment");
/** The checklist opens from the chip while a part is picked, otherwise from More → Pick a part. */
async function openChecklist(page: Page) {
  const chip = page.getByTestId("bench-asking-about");
  if (await chip.count()) await chip.click();
  else await openFromMore(page, "part");
}

test("on: Ask about offers the part; Show in checklist opens it there; the technician's tap selects it", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();

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
  await expect(page.getByTestId("notebook-more-item-part")).toBeAttached();
  await page.waitForTimeout(1500);
  await expect(checklist(page)).toHaveCount(0);
  expect(seen.selectionPuts).toHaveLength(0);
});

test("equipment in another notebook is offered and opens only on the technician's tap (#5625 r3 F12)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved" });
  await page.goto(`/v3/`);
  await expect(panel(page)).toBeAttached();

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

for (const originKind of ["saved", "new", "photo-only"] as const) {
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

    const draft = originKind === "photo-only" ? "" : "Check the original drive before the next shift.";
    const photoName = "fixture-draft-photo.png";
    await composer(page).fill(draft);
    await attachDraftPhoto(page, photoName);
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
    if (originKind === "photo-only") {
      await attachment.click();
      await page.getByRole("button", { name: "New chat", exact: true }).click();
      await expect(originRow).toHaveCount(0);
    }
  });
}

test("a held photo and target review are kept with the origin across equipment Open (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const destination = "99999999-9999-4999-8999-999999999999";
  const seen = await routes(page, {
    enabled: true, resolve: "resolved", resolveNotebook: destination,
    initial: { [THREAD]: { componentId: VFD, version: 2 } },
  });
  let looks = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => route.fulfill(json({
    fileId: `fixture-held-photo-${++looks}`, observation: { text: "Fixture drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
    attachment: { linkId: "fixture-link" }, observationPersisted: true,
  })));
  const requests: { message?: string; visualEvidence?: { fileId?: string }; componentSelection?: { componentId?: string | null } }[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      seen.selections.delete(THREAD);
      return route.fulfill(json({ error: "selection_changed" }, 409));
    }
    return route.fulfill(json({ error: "test_stop" }, 503));
  });

  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(page.getByTestId("bench-asking-about")).toContainText("VFD1");
  const question = "Check the drive photo";
  await attachDraftPhoto(page, "held-fixture.png");
  await composer(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const held = page.getByRole("status", { name: "Kept with this question" });
  await expect(held).toContainText(/photo is kept/i);
  expect(requests[0].visualEvidence?.fileId).toBe("fixture-held-photo-1");

  await openTo(page, VFD);
  await askAbout(page, "VFD1");
  await offer(page).getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`notebook=${destination}`));
  await expect(checklistRow(page, VFD)).toHaveAttribute("data-found", "true");
  await checklist(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(composer(page)).toHaveValue("");
  await expect(held).toHaveCount(0);

  const origin = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
  await expect(origin).toBeVisible();
  await origin.click();
  await expect(composer(page)).toHaveValue(question);
  await expect(page.getByText(/now the whole machine/i).first()).toBeVisible();
  await expect(held).toContainText(/photo is kept/i);
  expect(requests).toHaveLength(1);

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ message: question, visualEvidence: { fileId: "fixture-held-photo-1" }, componentSelection: { componentId: null } });
  expect(looks).toBe(1);
});

test("a rejected send is recoverable only in the origin after navigation (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  await page.addInitScript(() => {
    const fetchNormally = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method !== "POST" || !String(input).includes("/chat/")) return fetchNormally(input, init);
      const request = String(init.body);
      const data = document.documentElement.dataset;
      if (data.sentRequest) {
        data.retriedRequest = request;
        return Promise.resolve(new Response('{"error":"test_stop"}', { status: 503 }));
      }
      data.sentRequest = request;
      // The HTTP status arrives first. The error body is still streaming
      // when opening a fresh chat aborts the origin's request.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 409 }));
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
  const originDraft = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
  await expect(originDraft).toBeVisible();
  seen.selections.set(THREAD, { componentId: VFD, version: 3 });
  await originDraft.click();
  await expect(page).toHaveURL(origin);
  await expect(composer(page)).toHaveValue("Only the origin may recover this question.");

  await composer(page).fill("A different draft typed after recovery.");
  const sent = await page.locator("html").getAttribute("data-sent-request");
  expect(sent).toBeTruthy();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-retried-request", sent!);
  await expect(composer(page)).toHaveValue("A different draft typed after recovery.");
});

test("a progress-stream rejection survives switching while the stream closes (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  await page.addInitScript(() => {
    const fetchNormally = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method !== "POST" || !String(input).includes("/chat/")) return fetchNormally(input, init);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const frame = JSON.stringify({ kind: "http_error", status: 409, body: { error: "selection_changed" } });
          controller.enqueue(new TextEncoder().encode("data: " + frame + "\n\n"));
          init.signal?.addEventListener("abort", () => controller.close(), { once: true });
        },
      });
      const tee = body.tee.bind(body);
      body.tee = () => {
        const [chat, component] = tee();
        const getReader = chat.getReader.bind(chat);
        chat.getReader = (() => {
          const reader = getReader();
          const cancel = reader.cancel.bind(reader);
          reader.cancel = (reason) => {
            document.documentElement.dataset.refusalRead = "yes";
            return cancel(reason);
          };
          return reader;
        }) as typeof chat.getReader;
        return [chat, component];
      };
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    };
  });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(page.getByTestId("bench-asking-about")).toContainText("VFD1");
  const origin = page.url();
  const question = "Keep this refused VFD question.";
  await composer(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-refusal-read", "yes");
  seen.selections.delete(THREAD);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(origin);
  await expect(composer(page)).toHaveValue("");
  const originDraft = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
  await expect(originDraft).toBeVisible();
  await originDraft.click();
  await expect(page).toHaveURL(origin);
  await expect(composer(page)).toHaveValue(question);
  await expect(page.getByText(/now the whole machine/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
});

test("switching before a photo upload finishes parks the unsent question (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let uploadStarted = false;
  let chatPosts = 0;
  let finishUpload: () => void = () => {};
  const upload = new Promise<void>((resolve) => { finishUpload = resolve; });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, async (route) => {
    uploadStarted = true;
    await upload;
    await route.fulfill(json({ error: "upload_incomplete" }, 503)).catch(() => {});
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    chatPosts++;
    return route.fulfill(json({ error: "unexpected_send" }, 503));
  });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const origin = page.url();
  const question = "Wait for the drive photo.";
  await attachDraftPhoto(page, "interrupted-fixture.png");
  await composer(page).fill(question);
  try {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => uploadStarted).toBe(true);
    const nextDraft = "Separate question about the conveyor.";
    await composer(page).fill(nextDraft);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).not.toHaveURL(origin);
    await expect(composer(page)).toHaveValue("");
    const originDraft = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
    await expect(originDraft).toBeVisible();
    await originDraft.click();
    await expect(page).toHaveURL(origin);
    await expect(composer(page)).toHaveValue(nextDraft);
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await expect(page.getByText("The question was not sent. Attach the file again before sending.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    expect(chatPosts).toBe(0);
  } finally {
    finishUpload();
  }
});

test("a retry without terminal status keeps the original request recoverable (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  const requests: (string | null)[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postData());
    if (requests.length === 2) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    return route.fulfill(json({ error: "test_stop" }, 503));
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const origin = page.url();
  const question = "Preserve a send that was never confirmed.";
  await composer(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await retry.click();
  await expect(page.getByRole("alert", { name: "Send error" })).toContainText("didn't confirm");
  await expect(composer(page)).toHaveValue(question);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(origin);
  const originDraft = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
  await originDraft.click();
  await expect(page).toHaveURL(origin);
  await retry.click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests).toEqual([requests[0], requests[0], requests[0]]);
});

test("an initial photo send without terminal status keeps the original request recoverable (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let uploads = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => {
    uploads++;
    return route.fulfill(json({
      fileId: "unconfirmed-photo", observation: { text: "Drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
      attachment: { linkId: "link" }, observationPersisted: true,
    }));
  });
  const requests: (string | null)[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postData());
    if (requests.length <= 2) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    return route.fulfill(json({ error: "test_stop" }, 503));
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const origin = page.url();
  const question = "Preserve a send that was never confirmed.";
  await composer(page).fill(question);
  await attachDraftPhoto(page, "unconfirmed-photo.png");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(page.getByRole("alert", { name: "Send error" })).toContainText("didn't confirm");
  await expect(composer(page)).toHaveValue(question);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(origin);
  const originDraft = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
  await originDraft.click();
  await expect(page).toHaveURL(origin);
  await retry.click();
  await expect(page.getByRole("alert", { name: "Send error" })).toContainText("didn't confirm");
  await retry.click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests).toEqual([requests[0], requests[0], requests[0]]);
  expect(JSON.parse(requests[0]!).visualEvidence.fileId).toBe("unconfirmed-photo");
  expect(uploads).toBe(1);
});

test("F30 dismissing the banner keeps photo replay through a notebook switch", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  await otherMachine(page);
  let uploads = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => {
    uploads++;
    return route.fulfill(json({
      fileId: "dismissed-banner-photo", observation: { text: "Drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
      attachment: { linkId: "link" }, observationPersisted: true,
    }));
  });
  const requests: (string | null)[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postData());
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const question = "Keep the photo with its restored question.";
  await composer(page).fill(question);
  await attachDraftPhoto(page, "dismissed-banner.png");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  const error = page.getByRole("alert", { name: "Send error" });
  const dismiss = error.getByRole("button", { name: "Dismiss", exact: true });
  await expect(composer(page)).toHaveValue(question);
  await dismiss.click();
  await expect(error).toHaveCount(0);

  const projects = page.getByRole("region", { name: "Projects" });
  await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
  await projects.locator('[data-item-id="notebook-' + NB + ':thread-' + THREAD + '"]').click();
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  await expect(error).toHaveCount(0);
  await expect(composer(page)).toHaveValue(question);
  await send.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toBe(requests[0]);
  expect(JSON.parse(requests[1]!).visualEvidence.fileId).toBe("dismissed-banner-photo");
  expect(uploads).toBe(1);

  await dismiss.click();
  await page.getByRole("button", { name: "Discard saved question", exact: true }).click();
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("group", { name: "Saved question" })).toHaveCount(0);
  expect(requests).toHaveLength(2);
});

for (const settlement of ["terminal retry", "attachment added during retry", "detail hydration"]) {
  test("F33 an old request leaves the newer draft photo and its text after " + settlement, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
    await otherMachine(page);
    const question = "Keep this question with the replacement photo.";
    const persisted = settlement === "detail hydration";
    let release = () => {};
    const finish = new Promise<void>((resolve) => { release = resolve; });
    const requests: (string | null)[] = [];
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => route.fulfill(json({
      fileId: "original-f33-photo", observation: { text: "Drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
      attachment: { linkId: "link" }, observationPersisted: true,
    })));
    await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), async (route) => {
      if (!persisted || requests.length === 0 || new URL(route.request().url()).searchParams.get("threadId") !== THREAD) return route.fallback();
      await finish;
      return route.fulfill(json({ ...oracle.detailEmpty, turns: [{
        id: "f33-saved-turn", clientRequestId: JSON.parse(requests[0]!).clientRequestId, question,
        answerStatus: "answered", answerText: "Settled original answer.", evidence: [],
      }] }));
    });
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, async (route) => {
      requests.push(route.request().postData());
      if (requests.length === 1) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      await finish;
      const body = 'data: {"kind":"content","content":"Settled original answer."}\n\ndata: {"kind":"status","status":"answered"}\n\n';
      return route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });
    try {
      await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
      await expect(page.getByTestId("bench-asking-about")).toBeVisible();
      await composer(page).fill(question);
      await attachDraftPhoto(page, "f33-original.png");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(composer(page)).toHaveValue(question);
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await expect(retry).toBeEnabled();
      if (settlement === "attachment added during retry") {
        await retry.click();
        await expect.poll(() => requests.length).toBe(2);
      }
      await attachDraftPhoto(page, "f33-replacement.png");
      if (settlement === "terminal retry") await retry.click();
      if (!persisted) {
        await expect.poll(() => requests.length).toBe(2);
        expect(requests[1]).toBe(requests[0]);
        expect(JSON.parse(requests[1]!).visualEvidence.fileId).toBe("original-f33-photo");
      }
      release();
      await expect(page.getByText("Settled original answer.", { exact: true })).toBeVisible();
      await expect(retry).toHaveCount(0);
      await expect(composer(page)).toHaveValue(question);
      const chip = page.getByRole("button", { name: /Remove f33-replacement/ });
      await expect(chip).toBeVisible();
      const projects = page.getByRole("region", { name: "Projects" });
      await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
      await expect(chip).toHaveCount(0);
      await projects.locator('[data-item-id="notebook-' + NB + ':thread-' + THREAD + '"]').click();
      await expect(composer(page)).toHaveValue(question);
      await expect(chip).toBeVisible();
    } finally {
      release();
    }
  });
}

for (const interruption of [
  "navigation", "Stop", "navigation with clean close", "Stop with clean close",
  "retry Stop on abort", "retry Stop with clean close", "retry Discard",
  "retry Stop with stale detail", "retry Stop in a fresh chat",
]) {
  test("F31/F34/F37/F38 the correct recovery survives " + interruption, async ({ page, context, baseURL }) => {
    const explicitStop = interruption.startsWith("Stop");
    const cleanClose = interruption.endsWith("clean close");
    const holdRetry = interruption.startsWith("retry");
    const staleDetail = interruption.endsWith("stale detail");
    const fresh = interruption.endsWith("fresh chat");
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
    await otherMachine(page);
    let uploads = 0;
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => {
      uploads++;
      return route.fulfill(json({
        fileId: "stopped-request-photo", observation: { text: "Drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
        attachment: { linkId: "link" }, observationPersisted: true,
      }));
    });
    const question = "Resume the interrupted photo question.";
    let saved: "stopped" | "answered" | "unavailable" | "current stop" | undefined;
    let original = "";
    let retry = "";
    await page.route(/\/api\/equipment-notebooks\/?(\?.*)?$/, (route) => {
      const origin = { ...oracle.detailEmpty.notebook, threads: [{ id: THREAD, notebookId: NB,
        title: "Stopped turn fixture", createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false }].filter(() => !fresh) };
      return route.fulfill(json({ notebooks: [origin, { ...origin, id: OTHER_NB, displayName: "Packaging line", threads: [] }] }));
    });
    await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), (route) => {
      if (!saved || new URL(route.request().url()).searchParams.get("threadId") !== THREAD) return route.fallback();
      if (saved === "unavailable") return route.fulfill(json({ error: "fixture_detail_failure" }, 503));
      return route.fulfill(json({ ...oracle.detailEmpty,
        turns: [{ id: "saved-stopped-turn", clientRequestId: JSON.parse(original).clientRequestId, question,
          answerStatus: saved === "answered" ? "answered" : "error",
          answerText: saved === "current stop" ? "Retry partial answer. Extra saved text."
            : saved === "stopped" ? "Saved partial answer." : "Completed replay.",
          evidence: [{ kind: "stopped_attempt", attemptId: saved === "current stop" ? "retry-fixture-attempt" : "old-fixture-attempt" }] }],
      }));
    });
    await page.addInitScript(({ deferStop, cleanClose, holdRetry }) => {
      const fetchNormally = window.fetch.bind(window);
      let intercepted = 0;
      window.fetch = (input, init) => {
        if (intercepted >= (holdRetry ? 2 : 1) || init?.method !== "POST" || !String(input).includes("/chat/")) return fetchNormally(input, init);
        intercepted++;
        const retrying = intercepted === 2;
        const partial = retrying ? "Retry partial answer." : "Live partial answer.";
        document.documentElement.dataset[retrying ? "fixtureRetryRequest" : "stoppedRequest"] = String(init.body);
        const { componentId, selectionVersion } = JSON.parse(String(init.body)).componentSelection;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const component = JSON.stringify({ kind: "component", componentId, selectionVersion, label: "VFD1", actions: [] });
            const headers = JSON.stringify({ kind: "headers", headers: {
              "x-mira-turn-attempt": retrying ? "retry-fixture-attempt" : "old-fixture-attempt",
            } });
            controller.enqueue(new TextEncoder().encode(
              'data: ' + headers + '\n\ndata: ' + component + '\n\ndata: ' + JSON.stringify({ kind: "content", content: partial }) + '\n\n',
            ));
            init.signal?.addEventListener("abort", () => {
              const finish = () => {
                document.documentElement.dataset.requestStopped = "yes";
                if (cleanClose) controller.close();
                else controller.error(new DOMException("Stopped", "AbortError"));
              };
              if (deferStop) window.addEventListener("fixture-release-stop", finish, { once: true });
              else finish();
            }, { once: true });
          },
        });
        return Promise.resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
      };
    }, { deferStop: explicitStop, cleanClose, holdRetry });
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
      retry = route.request().postData() ?? "";
      const body = 'data: {"kind":"content","content":"Completed replay."}\n\ndata: {"kind":"status","status":"answered"}\n\n';
      return route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });

    await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
    await expect(page.getByTestId("bench-asking-about")).toBeVisible();
    await composer(page).fill(question);
    await attachDraftPhoto(page, "stopped-request.png");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-stopped-request", /stopped-request-photo/);
    original = (await html.getAttribute("data-stopped-request"))!;
    await expect(page.getByText("Live partial answer.", { exact: true })).toBeVisible();
    const projects = page.getByRole("region", { name: "Projects" });
    if (explicitStop) await page.getByRole("button", { name: "Stop", exact: true }).click();
    await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
    if (explicitStop) {
      await expect(page).toHaveURL(new RegExp("notebook=" + OTHER_NB));
      await page.evaluate(() => window.dispatchEvent(new Event("fixture-release-stop")));
    }
    await expect(html).toHaveAttribute("data-request-stopped", "yes");
    saved = fresh ? undefined : explicitStop && cleanClose ? "unavailable" : "stopped";
    const origin = projects.locator('[data-item-id="notebook-' + NB + ':thread-' + THREAD + '"]');
    await expect(origin).toBeVisible({ timeout: 4000 });
    await origin.click();
    const answers = page.locator('.fl-turn--aui[data-role="assistant"]');
    await expect(answers).toHaveCount(1);
    await expect(answers.first()).toContainText(fresh || saved === "unavailable" ? "Live partial answer." : "Saved partial answer.");
    const tryAgain = page.getByRole("button", { name: "Try again", exact: true });
    if (explicitStop) {
      await expect(tryAgain).toHaveCount(0);
      await expect(composer(page)).toHaveValue("");
      expect(retry).toBe("");
      return;
    }
    await expect(composer(page)).toHaveValue(question, { timeout: 6000 });
    await tryAgain.click({ timeout: 6000 });
    if (holdRetry) {
      await expect(html).toHaveAttribute("data-fixture-retry-request", original);
      await expect(page.getByText("Retry partial answer.", { exact: true })).toBeVisible();
      const discard = page.getByRole("button", { name: "Discard saved question", exact: true });
      if (interruption === "retry Discard") {
        await expect(discard.and(page.locator(":enabled"))).toHaveCount(0, { timeout: 3500 });
        await page.getByRole("button", { name: "Stop", exact: true }).click();
        return;
      }
      const preserved = cleanClose ? "A newer independent question." : "";
      if (preserved) await composer(page).fill(preserved);
      saved = staleDetail ? "stopped" : "unavailable";
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.getByText("Stopped before the answer completed.", { exact: true })).toBeVisible();
      await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
      if (fresh) await expect(origin).toHaveAccessibleName("Stopped conversation", { timeout: 4000 });
      await origin.click();
      if (staleDetail) {
        // More mounts after the old error response has been accepted.
        await expect(more(page)).toBeVisible();
        await expect(page.getByText("Retry partial answer.", { exact: true })).toBeVisible({ timeout: 4000 });
        saved = "unavailable";
        await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
        await origin.click();
      }
      await expect(page.getByText("Retry partial answer.", { exact: true })).toBeVisible({ timeout: 4000 });
      await expect(tryAgain).toHaveCount(0, { timeout: 3500 });
      await expect(discard).toHaveCount(0);
      await expect(composer(page)).toHaveValue(preserved);
      expect(retry).toBe("");
      expect(uploads).toBe(1);
      if (staleDetail) {
        saved = "current stop";
        await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
        await origin.click();
        await expect(page.getByText("Retry partial answer. Extra saved text.", { exact: true })).toBeVisible({ timeout: 4500 });
        await expect(answers).toHaveCount(1);
        await expect(answers.first()).toHaveAttribute("data-turn-id", "saved-stopped-turn-a");
        await expect(tryAgain).toHaveCount(0);
      }
      return;
    }
    await expect.poll(() => retry).toBe(original);
    expect(uploads).toBe(1);
    await expect(answers).toHaveCount(1);
    // The old stopped row can still be returned while the retry settles.
    await expect(answers.first()).toContainText("Completed replay.");
    saved = "answered";
    await page.getByRole("button", { name: "Refresh conversation" }).click();
    await expect(answers.first()).toHaveAttribute("data-turn-id", "saved-stopped-turn-a");
    await expect(answers).toHaveCount(1);
  });
}

test("F32 terminal error offers saved-turn refresh without announcing an answer", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved" });
  let postedId: string | undefined;
  let reads = 0;
  let posts = 0;
  const question = "Check provider failure refresh.";
  await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), (route) => {
    if (!postedId) return route.fallback();
    reads++;
    if (reads === 1) return route.fulfill(json({ error: "fixture_detail_failure" }, 503));
    return route.fulfill(json({ ...oracle.detailEmpty, turns: [{
      id: "saved-error-fixture", clientRequestId: postedId, question, answerStatus: "error", answerText: null, evidence: [],
    }] }));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    posts++;
    postedId = route.request().postDataJSON().clientRequestId;
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: 'data: {"kind":"status","status":"error"}\n\n' });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(more(page)).toBeVisible();
  await composer(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.locator('.fl-turn--aui[data-role="assistant"]');
  await expect(answer).toHaveAttribute("data-lifecycle", "failed");
  const refresh = page.getByRole("button", { name: "Refresh conversation" });
  await expect(refresh).toBeVisible();
  await expect(page.getByText("The answer is ready.", { exact: false })).toHaveCount(0);
  await refresh.click();
  await expect(answer).toHaveAttribute("data-turn-id", "saved-error-fixture-a");
  await expect(refresh).toHaveCount(0);
  expect(posts).toBe(1);
});

test("a blocked retry keeps its photo-backed request while the checklist loads (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  const requests: (string | null)[] = [];
  let holdOrigin = false;
  let resume = () => {};
  const held = new Promise<void>((resolve) => { resume = resolve; });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, async (route) => {
    if (holdOrigin && new URL(route.request().url()).searchParams.get("threadId") === THREAD) await held;
    return route.fallback();
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => route.fulfill(json({
    fileId: "blocked-retry-photo", observation: { text: "Photo", capturedAt: "2026-11-20T12:00:00.000Z" },
    attachment: { linkId: "link" }, observationPersisted: true,
  })));
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postData());
    return route.fulfill(json({ error: "test_stop" }, 503));
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  const origin = page.url();
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  await composer(page).fill("Retry my held photo question.");
  await attachDraftPhoto(page, "blocked-retry.png");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeEnabled();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(origin);
  holdOrigin = true;
  try {
    await page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ }).click();
    await expect(page).toHaveURL(origin);
    await expect(retry).toBeDisabled();
    expect(requests).toHaveLength(1);
  } finally {
    resume();
  }
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toBe(requests[0]);
  expect(JSON.parse(requests[0]!).visualEvidence.fileId).toBe("blocked-retry-photo");
});

test("a target-refused photo question survives sending a newer draft (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => route.fulfill(json({
    fileId: "reviewed-photo", observation: { text: "Photo", capturedAt: "2026-11-20T12:00:00.000Z" },
    attachment: { linkId: "link" }, observationPersisted: true,
  })));
  let resume = () => {};
  const held = new Promise<void>((resolve) => { resume = resolve; });
  const requests: { message: string; visualEvidence?: { fileId: string }; componentSelection?: { componentId: string; selectionVersion: number }; clientRequestId: string }[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await held;
      seen.selections.set(THREAD, { componentId: MLC, version: 3 });
      return route.fulfill(json({ error: "selection_changed" }, 409));
    }
    return route.fulfill(json({ error: "test_stop" }, 503));
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toContainText("VFD1");
  const original = "Check this drive photo.";
  const nextDraft = "Another question about the line.";
  await composer(page).fill(original);
  await attachDraftPhoto(page, "reviewed-photo.png");
  const send = page.getByRole("button", { name: "Send", exact: true });
  try {
    await send.click();
    await expect.poll(() => requests.length).toBe(1);
    await composer(page).fill(nextDraft);
  } finally {
    resume();
  }
  const saved = page.getByRole("group", { name: "Saved question" }).filter({ hasText: original });
  await expect(saved).toContainText("Photo kept with this question.");
  await expect(saved).toContainText("Current target is Q1");
  await expect(composer(page)).toHaveValue(nextDraft);
  await send.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].message).toBe(nextDraft);
  await saved.getByRole("button", { name: "Send saved question to current target" }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({
    message: original, visualEvidence: { fileId: "reviewed-photo" },
    componentSelection: { componentId: MLC, selectionVersion: 3 },
  });
  expect(requests[2].clientRequestId).not.toBe(requests[0].clientRequestId);
});

test("a confirmed retry stays answered when detail refresh fails (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let posts = 0;
  let retryRequestId: string | undefined;
  let failDetail = true;
  let refreshes = 0;
  await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), (route) => {
    if (posts < 2) return route.fallback();
    refreshes++;
    return failDetail ? route.fulfill(json({ error: "test_refresh_failed" }, 503)) : route.fulfill(json({
      ...oracle.detailEmpty,
      turns: [{ id: "persisted-answer", question: "Settle this question once.", answerStatus: "answered",
        answerText: "Confirmed answer text.", clientRequestId: retryRequestId, evidence: [] }],
    }));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    posts++;
    if (posts === 1) return route.fulfill(json({ error: "test_stop" }, 503));
    retryRequestId = route.request().postDataJSON().clientRequestId;
    const frames = [{ kind: "content", content: "Confirmed answer text." }, { kind: "status", status: "answered" }];
    return route.fulfill({ status: 200, contentType: "text/event-stream",
      body: frames.map((frame) => "data: " + JSON.stringify(frame) + "\n\n").join("") });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  await composer(page).fill("Settle this question once.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const refresh = page.getByRole("button", { name: "Refresh conversation" });
  await expect(refresh).toBeVisible();
  await expect(page.getByText("Confirmed answer text.", { exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
  failDetail = false;
  await refresh.click();
  await expect.poll(() => refreshes).toBe(2);
  await expect(refresh).toHaveCount(0);
  expect(posts).toBe(2);
});

test("a newer attachment validation error cannot retry the previous question (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let posts = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    posts++;
    return route.fulfill(json({ error: "test_stop" }, 503));
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  await composer(page).fill("The original rejected question.");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  const nextDraft = "The newer question with two photos.";
  await composer(page).fill(nextDraft);
  await attachDraftPhoto(page, "first-fixture.png");
  await attachDraftPhoto(page, "second-fixture.png");
  await send.click();
  await expect(page.getByRole("alert", { name: "Send error" })).toContainText(/one photo/i);
  await expect(retry).toHaveCount(0);
  await expect(composer(page)).toHaveValue(nextDraft);
  await expect(page.getByRole("button", { name: /Remove first-fixture/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove second-fixture/ })).toBeVisible();
  expect(posts).toBe(1);
});

test("a terminal retry refreshes only the still-visible conversation (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  const detailReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith("/equipment-notebooks/" + NB + "/")) {
      detailReads.push(url.searchParams.get("threadId") ?? "");
    }
  });
  await page.addInitScript(() => {
    const fetchNormally = window.fetch.bind(window);
    let posted = false;
    window.fetch = (input, init) => {
      if (init?.method !== "POST" || !String(input).includes("/chat/")) return fetchNormally(input, init);
      if (!posted) {
        posted = true;
        return Promise.resolve(new Response('{"error":"test_stop"}', { status: 503 }));
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const frame = JSON.stringify({ kind: "status", status: "answered" });
          controller.enqueue(new TextEncoder().encode("data: " + frame + "\n\n"));
          document.documentElement.dataset.terminalReady = "yes";
          init.signal?.addEventListener("abort", () => {
            setTimeout(() => { controller.close(); document.documentElement.dataset.terminalClosed = "yes"; }, 150);
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    };
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const origin = page.url();
  await composer(page).fill("Finish only in the original conversation.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-terminal-ready", "yes");
  const readsBeforeSwitch = detailReads.length;
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).not.toHaveURL(origin);
  await expect(page.locator("html")).toHaveAttribute("data-terminal-closed", "yes");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect.poll(() => detailReads.length).toBeGreaterThan(readsBeforeSwitch);
  expect(detailReads.slice(readsBeforeSwitch)).not.toContain(THREAD);
});

test("a scope refusal of an unscoped send requires review once a component is known (#5684)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved" });
  const requests: { componentSelection?: { componentId?: string; selectionVersion?: number } }[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, (route) => {
    if (!requests.length) return route.fulfill(json({ error: "test_unavailable" }, 503));
    return route.fulfill(json(bench({ componentId: VFD, version: 2 })));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postDataJSON());
    return requests.length === 1
      ? route.fulfill(json({ error: "selection_changed" }, 409))
      : route.fulfill(json({ error: "test_stop" }, 503));
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await composer(page).fill("Review the discovered component before resending.");
  await send.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].componentSelection).toBeUndefined();
  await expect(page.getByRole("alert", { name: "Send error" })).toContainText(/now VFD1/);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
  await send.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].componentSelection).toMatchObject({ componentId: VFD, selectionVersion: 2 });
});

test("closing Find equipment cancels a lookup on its way: the chat and the typed message stay (#5625 r3 F12)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const seen = await routes(page, { enabled: true, resolve: "resolved", holdResolve: true, resolveNotebook: OTHER });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeAttached();
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
  await expect(panel(page)).toBeAttached();
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
  await expect(panel(page)).toBeAttached();

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await openChecklist(page);
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
  await expect(panel(page)).toBeAttached();

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
  await expect(panel(page)).toBeAttached();
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
  await expect(panel(page)).toBeAttached();

  await openTo(page, MLC);
  await askAbout(page, "Q1");
  await expect.poll(() => seen.resolves.length).toBe(1);
  await openChecklist(page);
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
  await openChecklist(page);
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
  await expect(panel(page)).toBeAttached();

  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  const region = page.getByTestId("equipment-scroll");
  const viewport = page.viewportSize()!;
  const box = (await region.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  const showMore = panel(page).getByRole("button", { name: /show more/i }).first();
  await showMore.scrollIntoViewIfNeeded();
  await expect(showMore).toBeInViewport();
  expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  await expect(panel(page).getByRole("button", { name: "Close equipment" })).toBeInViewport();
  await expect(more(page)).toBeInViewport();
});

test("on a short landscape screen the results still scroll inside the panel; Close equipment and the checklist stay on screen (#5643)", async ({ page, context, baseURL }) => {
  // 400 px: short, but tall enough for Close, a row of results and the checklist above the chat
  // composer (#5658). Below that the whole panel scrolls; the touch test for #5659 covers it.
  await page.setViewportSize({ width: 800, height: 400 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeAttached();

  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  const region = page.getByTestId("equipment-scroll");
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  const showMore = panel(page).getByRole("button", { name: /show more/i }).first();
  await showMore.scrollIntoViewIfNeeded();
  await expect(showMore).toBeInViewport();
  expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  await expect(panel(page).getByRole("button", { name: "Close equipment" })).toBeInViewport({ ratio: 1 });
  await expect(more(page)).toBeInViewport({ ratio: 1 });
});

test("on a short landscape screen an offer above the results still leaves the checklist on screen (#5655 r1 F1)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 350 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeAttached();

  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000000")).toBeAttached();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000000").click();
  await askAbout(page, "M1");
  await expect(offer(page)).toBeVisible();

  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  await expect(offer(page)).toBeVisible();
  const region = page.getByTestId("equipment-scroll");
  expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(more(page)).toBeInViewport({ ratio: 1 });
});

test("on a short landscape screen an offer and a refusal together still leave the checklist on screen; the panel scrolls itself (#5655 r2 F1)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 800, height: 350 });
  await auth(context, baseURL!);
  const opts: RouteOpts = { enabled: true, resolve: "resolved", fullPage: 50 };
  await routes(page, opts);
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeAttached();

  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000000").click();
  await askAbout(page, "M1");
  await expect(offer(page)).toBeVisible();

  opts.resolve = "stale_revision";
  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000001").click();
  await askAbout(page, "M2");
  await expect(panel(page).getByRole("alert").filter({ hasText: "did not change" }).first()).toBeAttached();
  await expect(offer(page)).toBeAttached();

  const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  await expect(more(page)).toBeInViewport({ ratio: 1 });
  const last = row(page, "notebook_component:00000000-0000-4000-8000-000000000049");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(pageScroll);
  await expect(more(page)).toBeInViewport({ ratio: 1 });
});

test("the open results sit on the panel's own surface in light and dark, so chat text never shows through (#5654)", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(panel(page)).toBeAttached();
    await openEquipment(page);
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
  await expect(panel(page)).toBeAttached();

  await openEquipment(page);
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

test("on a tablet with the panel open, a tap on Send goes through the actions column's empty area; its rows still take taps (#5658, #5667)", async ({ page, context, baseURL }) => {
  // The Galaxy Tab S9 FE in landscape. On the device the rows below the panel (Whole machine, Prepare
  // job, Job sheet) stretch the actions column down over Send and its empty box took the tap. Those
  // rows need their own feature flags, so here the column is stretched to the bottom the same way.
  await page.setViewportSize({ width: 1316, height: 648 });
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", fullPage: 50 });
  let releaseChat = () => {};
  const heldChat = new Promise<void>((resolve) => { releaseChat = resolve; });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, async (route) => {
    await heldChat;
    await route.fulfill(json({ error: "test_finished" }, 503)).catch(() => {});
  });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  // Send is refused until the notebook detail and the component read are in. The grounding line shows the
  // detail is in; the checklist listing its rows shows the component read is in (then shut it).
  await expect(page.getByText(/Answers cite \d+ selected sources? for /)).toBeVisible();
  await openChecklist(page);
  await expect(checklistRow(page, VFD)).toBeVisible();
  await checklist(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(checklist(page)).toHaveCount(0);
  await expect(panel(page)).toBeAttached();
  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await expect(row(page, "notebook_component:00000000-0000-4000-8000-000000000049")).toBeAttached();
  await composer(page).fill("does the drive have power");
  const column = page.getByTestId("notebook-actions");
  await column.evaluate((el) => {
    (el as HTMLElement).style.minHeight = `${window.innerHeight - el.getBoundingClientRect().top}px`;
  });
  const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
  const [x, y] = [send.x + send.width / 2, send.y + send.height / 2];
  const col = (await column.boundingBox())!;
  expect(x > col.x && x < col.x + col.width && y > col.y && y < col.y + col.height, "the column's box covers Send").toBe(true);
  const onTop = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button[aria-label="Send"]') !== null, [x, y]);
  expect(onTop, "Send is on top at its own middle").toBe(true);
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/chat\/?$/.test(new URL(r.url()).pathname), { timeout: 5_000 });
  try {
    await page.mouse.click(x, y);
    await sent;
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    // Keep the response held so a recovery banner cannot move the target between measurement and tap.
    const close = (await panel(page).getByRole("button", { name: "Close equipment" }).boundingBox())!;
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
    await expect(panel(page).getByRole("button", { name: "Close equipment" })).toHaveCount(0);
  } finally {
    releaseChat();
  }
});

/** Open a full list with an offer and a refusal above it at 800×350, so the panel itself must scroll. */
async function openCrowdedShortPanel(page: Page, context: BrowserContext, baseURL: string) {
  await page.setViewportSize({ width: 800, height: 350 });
  await auth(context, baseURL);
  const opts: RouteOpts = { enabled: true, resolve: "resolved", fullPage: 50 };
  await routes(page, opts);
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await expect(panel(page)).toBeAttached();
  await openEquipment(page);
  await row(page, `notebook:${NB}`).click();
  await row(page, "notebook_component:00000000-0000-4000-8000-000000000000").click();
  await askAbout(page, "M1");
  await expect(offer(page)).toBeVisible();
  opts.resolve = "stale_revision";
  await openEquipment(page);
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
  await expect(panel(page)).toBeAttached();
  await openEquipment(page);
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
    await expect(panel(page).getByRole("button", { name: "Close equipment" })).toHaveCount(0);
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
  await openChecklist(page);
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
  await openChecklist(page);
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
  await openChecklist(page);
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
    // The pill is the chip beside More, which shows only while a part is picked (Mike, 2026-11-20).
    await routes(page, { enabled: false, resolve: "resolved", ...(how === "the pill" ? { initial: { [THREAD]: { componentId: MLC, version: 1 } } } : {}) });
    let answer!: () => void;
    const saves = await revisions(page, { sameSerial: checked([away]) }, { hold: new Promise<void>((resolve) => { answer = resolve; }) });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await openChecklist(page);
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

    await openChecklist(page);
    // The save itself is reported as it always was; the warning it came with was closed with the sheet.
    await expect(saved(page)).toHaveText("Confirmed. Questions about it now use what you confirmed.");
    await expect(serialWarning(page)).toHaveCount(0);
    await expect(notRunNote(page)).toHaveCount(0);
  });
}

test("repeated serial: a warning that is showing is ended by closing the sheet with the pill, as Close ends it", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  // The pill is the chip beside More, which shows only while a part is picked (Mike, 2026-11-20).
  await routes(page, { enabled: false, resolve: "resolved", initial: { [THREAD]: { componentId: MLC, version: 1 } } });
  await revisions(page, { sameSerial: checked([away]) });
  await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
  await confirmWithSerial(page);
  await expect(serialWarning(page)).toBeVisible();

  await page.getByTestId("bench-asking-about").press("Enter");
  await expect(checklist(page)).toHaveCount(0);
  await openChecklist(page);
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

// ── The More list (Mike, 2026-11-20): the notebook's tools behind one button at the top right. ──

const menu = (page: Page) => page.getByTestId("notebook-more-menu");
const menuOpen = (page: Page) => menu(page).evaluate((d) => (d as HTMLDialogElement).open);
const item = (page: Page, id: string) => page.getByTestId(`notebook-more-item-${id}`);
const fix = (n: number) => ({ id: `fix-${n}`, symptom: `Will not start ${n}`, faultCode: null, fix: `Reset the drive ${n}`, createdAt: "2026-11-19T12:00:00.000Z" });
async function savedFixes(page: Page, count: number, assetConfirmed: boolean | null = true) {
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/fixes\/(\?.*)?$/, (route) =>
    route.fulfill(json({ fixes: Array.from({ length: count }, (_, i) => fix(i + 1)), nextCursor: null, assetConfirmed })));
}

test.describe("More", () => {
  test("lists only the tools that are on, in job order; with nothing picked there is no chip", async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    await savedFixes(page, 2);
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(item(page, "saved-fixes")).toBeAttached();
    await expect(item(page, "part")).toBeAttached();
    await more(page).click();
    await expect(menu(page).getByRole("button")).toHaveText([/^Find equipment/, /^Pick a part/, /^Saved fixes/]);
    await expect(menu(page).getByRole("heading")).toHaveText(["Find", "Fix"]);
    await expect(item(page, "job-sheet")).toHaveCount(0);
    // The whole machine is the silent default: no "Asking about" pill and no Whole machine button.
    await expect(page.getByTestId("bench-asking-about")).toHaveCount(0);
    await expect(page.getByTestId("notebook-chip")).toHaveCount(0);
  });

  for (const [assetConfirmed, wording] of [[null, "Fixes saved in this project"], [true, "Fixes saved in this project for this machine"]] as const) {
    test(`Saved fixes says whose fixes they are (machine confirmed: ${assetConfirmed}) (#5698)`, async ({ page, context, baseURL }) => {
      await auth(context, baseURL!);
      await routes(page, { enabled: false, resolve: "resolved" });
      await savedFixes(page, 2, assetConfirmed);
      await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
      await expect(item(page, "saved-fixes")).toContainText(wording);
      if (assetConfirmed === null) await expect(item(page, "saved-fixes")).not.toContainText("for this machine");
    });
  }

  test("when the last tool goes while the list is open, More comes back closed and opens on the next tap (#5697)", async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: false, resolve: "resolved" });
    // Registered after routes(), so tried first: the checklist read waits, then says it is unavailable.
    let answerChecklist!: () => void;
    const checklistHeld = new Promise<void>((r) => (answerChecklist = r));
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await checklistHeld;
      return route.fulfill(json({ error: "unavailable" }, 503));
    });
    let answerFixes!: () => void;
    const fixesHeld = new Promise<void>((r) => (answerFixes = r));
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/fixes\/(\?.*)?$/, async (route) => {
      await fixesHeld;
      return route.fulfill(json({ fixes: [fix(1)], nextCursor: null, assetConfirmed: true }));
    });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);

    await expect(item(page, "part")).toBeAttached();
    await more(page).click();
    await expect.poll(() => menuOpen(page)).toBe(true);

    answerChecklist();
    await expect(item(page, "part")).toHaveCount(0);
    await expect(more(page)).toHaveCount(0);
    await expect.poll(() => menuOpen(page)).toBe(false);

    answerFixes();
    await expect(more(page)).toBeVisible();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await more(page).click();
    await expect.poll(() => menuOpen(page)).toBe(true);
    await expect(item(page, "saved-fixes")).toBeVisible();
  });

  test("a tool that is off is not in the list (Find equipment off, as it ships)", async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: false, resolve: "resolved" });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(item(page, "part")).toBeAttached();
    await expect(item(page, "equipment")).toHaveCount(0);
  });

  test("Pick a part opens the checklist; a picked part shows beside More, and its x goes back to the whole machine", async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    const seen = await routes(page, { enabled: false, resolve: "resolved" });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await openFromMore(page, "part");
    expect(await menuOpen(page), "the list closes when a tool is chosen").toBe(false);
    await selectInChecklist(page, VFD);
    await expect(page.getByTestId("bench-asking-about")).toHaveText("Asking about VFD1 · AutomationDirect GS10");
    if (await checklist(page).count()) await checklist(page).getByRole("button", { name: "Close", exact: true }).click();

    await page.getByTestId("notebook-chip-clear").click();
    await expect.poll(() => seen.selectionPuts.at(-1)?.componentId).toBe(null);
    await expect(page.getByTestId("notebook-chip")).toHaveCount(0);
  });

  test("Escape, a tap outside and Back close the list; focus goes back to More", async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(item(page, "part")).toBeAttached();

    await more(page).click();
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect.poll(() => menuOpen(page)).toBe(false);
    await expect(more(page)).toBeFocused();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");

    await more(page).click();
    await page.mouse.click(20, (page.viewportSize()!.height) / 2);
    await expect.poll(() => menuOpen(page)).toBe(false);

    await more(page).click();
    await page.evaluate(() => document.dispatchEvent(new Event("factorylm:back", { cancelable: true })));
    await expect.poll(() => menuOpen(page)).toBe(false);
    await expect(page).toHaveURL(new RegExp(`thread=${THREAD}`));
  });

  test("choosing Find equipment closes the list before the panel opens, so Back finds no list left open", async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await openEquipment(page);
    await expect(panel(page).getByRole("button", { name: "Close equipment" })).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll("dialog[open]").length)).toBe(0);
    await panel(page).getByRole("button", { name: "Close equipment" }).click();
    await expect(panel(page).getByRole("button", { name: "Close equipment" })).toHaveCount(0);
  });

  test("on a phone every item is fully on screen, and Send takes a tap once the list is closed", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    await savedFixes(page, 1);
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(page.getByText(/Answers cite \d+ selected sources? for /)).toBeVisible();
    await expect(item(page, "saved-fixes")).toBeAttached();
    await expect(item(page, "part")).toBeAttached();
    await more(page).click();
    for (const id of ["equipment", "part", "saved-fixes"]) {
      await expect(item(page, id)).toBeInViewport({ ratio: 1 });
      const box = (await item(page, id).boundingBox())!;
      expect(box.height, `${id} is a full-size touch target`).toBeGreaterThanOrEqual(56);
    }
    await page.keyboard.press("Escape");
    await expect.poll(() => menuOpen(page)).toBe(false);

    await composer(page).fill("does the drive have power");
    const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
    const [x, y] = [send.x + send.width / 2, send.y + send.height / 2];
    const sent = page.waitForRequest((r) => r.method() === "POST" && /\/chat\/?$/.test(new URL(r.url()).pathname), { timeout: 5_000 });
    await page.mouse.click(x, y);
    await sent;
  });

  test("on a tablet in landscape the list is two columns: Find and Job on the left, Fix on the right", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1316, height: 648 });
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    await savedFixes(page, 1);
    await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`);
    await expect(item(page, "saved-fixes")).toBeAttached();
    await more(page).click();
    const find = (await menu(page).getByRole("group", { name: "Find" }).boundingBox())!;
    const fixes = (await menu(page).getByRole("group", { name: "Fix" }).boundingBox())!;
    expect(fixes.x, "Fix sits to the right of Find").toBeGreaterThan(find.x + find.width - 1);
    expect(Math.abs(fixes.y - find.y), "side by side").toBeLessThan(2);
    // The wide layout must actually be wide: a 360px sheet split in two wraps every line (Codex F3).
    expect((await menu(page).boundingBox())!.width, "the two-column list uses the tablet width").toBeGreaterThan(600);
    await expect(menu(page)).toBeInViewport({ ratio: 1 });
  });
});

test("round 5 F18 retains an interrupted safety warning without evidence links", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved" });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    const frames = [
      { kind: "content", content: "Partial warning response." },
      { kind: "safety", trigger: "Synthetic safety fixture" },
      { kind: "sources", citations: [{ citationId: 1, sourceTitle: "Unconfirmed fixture", page: 1, fileId: null, quote: "Synthetic citation." }] },
    ];
    return route.fulfill({ status: 200, contentType: "text/event-stream",
      body: frames.map((frame) => "data: " + JSON.stringify(frame) + "\n\n").join("") });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(more(page)).toBeVisible();
  await composer(page).fill("Check the synthetic warning.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  await expect(page.getByText("Partial warning response.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-part-type="safety_notice"][data-severity="stop"]')).toBeVisible();
  await expect(page.getByText("Unconfirmed fixture", { exact: true })).toHaveCount(0);
});

test("round 5 F21 settles only the matching durable request after a cutoff", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved" });
  const question = "Check the delivered request.";
  let requestId: string | undefined;
  let revealActual = false;
  let posts = 0;
  await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), (route) => {
    if (new URL(route.request().url()).searchParams.get("threadId") !== THREAD) return route.fallback();
    const row = { question, answerStatus: "answered", evidence: [] };
    const turns = requestId ? [
      { ...row, id: "1385d53e-2779-4593-a204-32d697f6291e", clientRequestId: "0c631455-e06e-4379-a656-e71acc373f53", answerText: "Another request with the same words." },
      ...(revealActual ? [{ ...row, id: "d4fe8069-48e1-4f0d-ab53-1413873d9d03", clientRequestId: requestId, answerText: "One durable answer." }] : []),
    ] : [];
    return route.fulfill(json({ ...oracle.detailEmpty, turns }));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    posts++;
    requestId = route.request().postDataJSON().clientRequestId;
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(more(page)).toBeVisible();
  const origin = page.url();
  await composer(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeEnabled();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const row = page.getByRole("region", { name: "Projects" }).getByRole("button", { name: /Unsent draft/ });
  await row.click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByText("Another request with the same words.", { exact: true })).toBeVisible();
  await expect(retry).toBeEnabled();

  revealActual = true;
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await row.click();
  await expect(page.getByText("One durable answer.", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Another request with the same words.", { exact: true })).toHaveCount(1);
  await expect(retry).toHaveCount(0);
  await expect(composer(page)).toHaveValue("");
  expect(posts).toBe(1);
});

test("F19 keeps the uploaded photo recoverable when a checklist write blocks Chat", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let finishUpload = () => {};
  let finishSave = () => {};
  const heldUpload = new Promise<void>((resolve) => { finishUpload = resolve; });
  const heldSave = new Promise<void>((resolve) => { finishSave = resolve; });
  let adds = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/?(\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    adds++;
    await heldSave;
    return route.fulfill(json({ componentId: "66666666-6666-4666-8666-666666666666" }, 201));
  });
  const photoId = "blocked-after-upload-photo";
  let uploads = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, async (route) => {
    uploads++;
    await heldUpload;
    return route.fulfill(json({
      fileId: photoId, observation: { text: "Drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
      attachment: { linkId: "link" }, observationPersisted: true,
    }));
  });
  const requests: unknown[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill(json({ error: "test_stop" }, 503));
  });

  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toContainText("VFD1");
  const firstQuestion = "Check the uploaded drive photo.";
  const newerDraft = "Keep this newer checklist draft.";
  await composer(page).fill(firstQuestion);
  await attachDraftPhoto(page, "blocked-after-upload.png");
  const card = page.getByRole("group", { name: "Saved question" }).filter({ hasText: firstQuestion });
  const retry = card.getByRole("button", { name: "Retry saved question" });
  try {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => uploads).toBe(1);
    await composer(page).fill(newerDraft);
    await openChecklist(page);
    await checklist(page).getByTestId("bench-add-label").fill("New fixture component");
    await checklist(page).getByTestId("bench-add").click();
    await expect.poll(() => adds).toBe(1);
    await checklist(page).getByRole("button", { name: "Close", exact: true }).click();

    finishUpload();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await expect(composer(page)).toHaveValue(newerDraft);
    await expect(card).toContainText("Photo kept with this question.");
    await expect(retry).toBeDisabled();
    expect(requests).toHaveLength(0);
  } finally {
    finishUpload();
    finishSave();
  }
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ message: firstQuestion, visualEvidence: { fileId: photoId } });
  await expect(composer(page)).toHaveValue(newerDraft);
  expect(uploads).toBe(1);
});

test("F20 a whitespace edit keeps the refused photo on the saved question only", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  const photoId = "whitespace-review-photo";
  let uploads = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) => {
    uploads++;
    return route.fulfill(json({
      fileId: photoId, observation: { text: "Drive photo", capturedAt: "2026-11-20T12:00:00.000Z" },
      attachment: { linkId: "link" }, observationPersisted: true,
    }));
  });
  const requests: { message: string; visualEvidence?: { fileId: string }; componentSelection?: { componentId: string | null } }[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      seen.selections.delete(THREAD);
      return route.fulfill(json({ error: "selection_changed" }, 409));
    }
    return route.fulfill(json({ error: "test_stop" }, 503));
  });

  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toContainText("VFD1");
  const question = "Read the drive label.";
  await composer(page).fill(question);
  await attachDraftPhoto(page, "whitespace-review.png");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  await expect(page.getByRole("alert", { name: "Send error" })).toContainText("now the whole machine");
  await expect(composer(page)).toHaveValue(question);
  await composer(page).fill(question + " ");

  await expect(page.getByText(/photo.*goes with the next Send/i)).toHaveCount(0);
  const saved = page.getByRole("group", { name: "Saved question" }).filter({ hasText: question });
  await expect(saved).toContainText("Photo kept with this question.");
  await send.click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ message: question, componentSelection: { componentId: null } });
  expect(requests[1].visualEvidence).toBeUndefined();

  await saved.getByRole("button", { name: "Send saved question to current target" }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ message: question, visualEvidence: { fileId: photoId }, componentSelection: { componentId: null } });
  expect(uploads).toBe(1);
});

test("F22 a refused exact replay can be reviewed as a new general question", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  const seen = await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  await page.route(/\/api\/equipment-notebooks\/[^/?]+\/?(\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill(json({ ...oracle.detailEmpty, sources: [] }));
  });
  type ChatRequest = {
    clientRequestId: string;
    message: string;
    mode?: string;
    sourceDocIds: string[];
    componentSelection?: { componentId: string | null };
  };
  const requests: ChatRequest[] = [];
  const posted: (string | null)[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    posted.push(route.request().postData());
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    if (requests.length === 2) {
      seen.selections.delete(THREAD);
      return route.fulfill(json({ error: "selection_changed" }, 409));
    }
    return route.fulfill(json({ error: "test_stop" }, 503));
  });

  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toContainText("VFD1");
  const question = "What does the drive indicator mean?";
  await composer(page).fill(question);
  const send = page.getByRole("button", { name: "Send", exact: true });
  const banner = page.getByRole("alert", { name: "Send error" });
  await send.click();
  await expect(banner).toContainText("didn't confirm");
  expect(requests[0]).toMatchObject({ message: question, sourceDocIds: [], componentSelection: { componentId: VFD } });
  expect(requests[0].mode).toBeUndefined();

  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(banner).toContainText("now the whole machine");
  expect(posted[1]).toBe(posted[0]);
  await expect(composer(page)).toHaveValue(question);
  await send.click();

  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ message: question, mode: "general", sourceDocIds: [], componentSelection: { componentId: null } });
  expect(requests[2].clientRequestId).not.toBe(requests[0].clientRequestId);
});

test("F23 inline Retry replays the clicked answer's photo request", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let uploads = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, (route) =>
    route.fulfill(json({
      fileId: "retry-photo-" + ++uploads,
      observation: { text: "Synthetic photo", capturedAt: "2026-11-20T12:00:00.000Z" },
      attachment: { linkId: "link" }, observationPersisted: true,
    })));
  const requests: (string | null)[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postData());
    const frame = { kind: "content", content: "Partial reply " + requests.length };
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: "data: " + JSON.stringify(frame) + "\n\n" });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const answers = page.locator('.fl-turn--aui[data-role="assistant"]');
  for (const name of ["First", "Second"]) {
    await composer(page).fill(name + " photo question");
    await attachDraftPhoto(page, name + ".png");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(answers.filter({ hasText: "Partial reply " + (name === "First" ? 1 : 2) })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  }
  expect(JSON.parse(requests[0]!)).toMatchObject({
    message: "First photo question", visualEvidence: { fileId: "retry-photo-1" },
    componentSelection: { componentId: VFD, selectionVersion: 2 },
  });
  expect(JSON.parse(requests[1]!)).toMatchObject({
    message: "Second photo question", visualEvidence: { fileId: "retry-photo-2" },
  });
  const firstRetry = answers.filter({ hasText: "Partial reply 1" }).getByRole("button", { name: "Retry", exact: true });
  let finishWrite = () => {};
  const heldWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
  let writes = 0;
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/components\/(\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes++;
    await heldWrite;
    return route.fulfill(json({ componentId: "66666666-6666-4666-8666-666666666666" }, 201));
  });
  try {
    await openChecklist(page);
    await checklist(page).getByTestId("bench-add-label").fill("Concurrent fixture component");
    await checklist(page).getByTestId("bench-add").click();
    await expect.poll(() => writes).toBe(1);
    await checklist(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(firstRetry).toHaveCount(0);
    expect(requests).toHaveLength(2);
  } finally {
    finishWrite();
  }
  await firstRetry.click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toBe(requests[0]);
  await expect(composer(page)).toHaveValue("Second photo question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]).toBe(requests[1]);
  const second = answers.filter({ hasText: "Partial reply 4" });
  await expect(second.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await second.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => requests.length).toBe(5);
  expect(requests[4]).toBe(requests[1]);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => requests.length).toBe(6);
  expect(requests[5]).toBe(requests[1]);
  expect(uploads).toBe(2);
});

for (const interruption of [
  "navigation", "explicit Stop", "explicit Stop in a fresh chat", "progress headers cutoff", "direct header abort",
]) {
  test("F24/F39 safety stop survives failed origin hydration after " + interruption, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    await otherMachine(page);
    const fresh = interruption === "explicit Stop in a fresh chat";
    const progressHeader = interruption === "progress headers cutoff";
    const directHeader = interruption === "direct header abort";
    await page.route(/\/api\/equipment-notebooks\/?(\?.*)?$/, (route) => {
      const origin = { ...oracle.detailEmpty.notebook, threads: [{
        id: THREAD, notebookId: NB, title: "Safety fixture origin",
        createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false,
      }].filter(() => !fresh) };
      const other = { ...oracle.detailEmpty.notebook, id: OTHER_NB, displayName: "Packaging line" };
      return route.fulfill(json({ notebooks: [origin, other] }));
    });
    let detail: "initial" | "failed" | "unrelated" | "saved" = "initial";
    const question = "Check my synthetic warning.";
    const warning = "Partial safety response before leaving.";
    let failedReads = 0;
    await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), async (route) => {
      if (detail === "initial") return route.fallback();
      if (detail === "failed") {
        failedReads++;
        return route.fulfill(json({ error: "fixture_detail_failure" }, 503));
      }
      const id = detail === "saved"
        ? await page.locator("html").getAttribute("data-fixture-request")
        : "another-request";
      return route.fulfill(json({ ...oracle.detailEmpty,
        turns: [{ id: "saved-fixture", clientRequestId: id, question, answerStatus: "answered",
          answerText: "Saved fixture answer.", evidence: [] }],
      }));
    });
    await page.addInitScript(({ partial, progressHeader, directHeader }) => {
      const fetchNormally = window.fetch.bind(window);
      let first = true;
      window.fetch = (input, init) => {
        if (init?.method !== "POST" || !String(input).includes("/chat/")) return fetchNormally(input, init);
        const requestId = JSON.parse(String(init.body)).clientRequestId;
        document.documentElement.dataset.fixtureRequest = requestId;
        if ((progressHeader || directHeader) && first) {
          first = false;
          document.documentElement.dataset.firstFixtureRequest = requestId;
          return Promise.resolve(new Response("", { headers: { "Content-Type": "text/event-stream" } }));
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const frames = [
              // The progress wrapper writes the response headers before any answer bytes.
              ...(progressHeader ? [{ kind: "headers", headers: { "x-safety-stop": "Synthetic safety fixture" } }] : []),
              { kind: "content", content: partial },
              ...(!progressHeader && !directHeader ? [{ kind: "safety", trigger: "Synthetic safety fixture" }] : []),
              { kind: "sources", citations: [{ citationId: 1, sourceTitle: "Unconfirmed source", page: 1 }] },
              { kind: "followups", suggestions: ["Unconfirmed suggestion"] },
            ];
            controller.enqueue(new TextEncoder().encode(frames.map((frame) => "data: " + JSON.stringify(frame) + "\n\n").join("")));
            if (progressHeader) controller.close();
            else init.signal?.addEventListener("abort", () => controller.error(new DOMException("Navigation", "AbortError")), { once: true });
          },
        });
        const headers = new Headers({ "Content-Type": "text/event-stream" });
        if (directHeader) headers.set("X-Safety-Stop", "Synthetic safety fixture");
        return Promise.resolve(new Response(body, { headers }));
      };
    }, { partial: warning, progressHeader, directHeader });
    await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
    await expect(more(page)).toBeVisible();
    await composer(page).fill(question);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    if (progressHeader || directHeader) {
      const firstRequest = await page.locator("html").getAttribute("data-first-fixture-request");
      expect(firstRequest).toBeTruthy();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-fixture-request", firstRequest!);
    }
    await expect(page.getByText(warning, { exact: true })).toBeVisible();
    const projects = page.getByRole("region", { name: "Projects" });
    const other = projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]');
    const stop = page.locator('[data-part-type="safety_notice"][data-severity="stop"]');
    if (interruption.startsWith("explicit Stop")) {
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(stop).toBeVisible();
    }
    await other.click();
    await expect(page).toHaveURL(new RegExp("notebook=" + OTHER_NB));
    await expect(stop).toHaveCount(0);
    await expect(page.getByText(warning, { exact: true })).toHaveCount(0);

    const origin = projects.locator('[data-item-id="notebook-' + NB + ':thread-' + THREAD + '"]');
    detail = "failed";
    await expect(origin).toBeVisible({ timeout: 3000 });
    if (fresh) await expect(origin).toHaveAccessibleName("Stopped conversation");
    await origin.click();
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    await expect(stop).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(warning, { exact: true })).toBeVisible();
    await expect(page.getByText("Unconfirmed source", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Unconfirmed suggestion", { exact: true })).toHaveCount(0);

    detail = "unrelated";
    await other.click();
    await origin.click();
    await expect(page.getByText("Saved fixture answer.", { exact: true })).toBeVisible();
    await expect(stop).toBeVisible();

    detail = "saved";
    await other.click();
    await origin.click();
    await expect(page.getByText("Saved fixture answer.", { exact: true })).toHaveCount(1);
    await expect(stop).toHaveCount(0);
    await expect(page.getByText(warning, { exact: true })).toHaveCount(0);
  });
}

for (const files of ["photo", "photo and manual"]) {
  test("F35/F36 an edited recovered question keeps its " + files + " requirement", async ({ page, context, baseURL }) => {
    const withManual = files === "photo and manual";
    const attachManual = (name: string) => composer(page).evaluate((field, filename) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File(["Synthetic manual"], filename, { type: "text/plain" }));
      field.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, name);
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
    await otherMachine(page);
    await page.route(/\/api\/namespace\/node\/[^/]+\/files\/?$/, (route) =>
      route.fulfill(json({ indexed: true, uploadId: "f36-manual-doc" })));
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/sources\/?$/, (route) =>
      route.request().method() === "POST" ? route.fulfill(json({ ok: true })) : route.fallback());
    let uploads = 0;
    const requests: unknown[] = [];
    let release = () => {};
    const finish = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, async (route) => {
      if (++uploads === 1) {
        await finish;
        return route.fulfill(json({ error: "fixture_upload_cancelled" }, 503)).catch(() => {});
      }
      return route.fulfill(json({ fileId: "f35-reattached-photo", observation: { text: "Drive photo" },
        attachment: { linkId: "link" }, observationPersisted: true }));
    });
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: 'data: {"kind":"status","status":"answered"}\n\n' });
    });
    try {
      await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
      await expect(page.getByTestId("bench-asking-about")).toBeVisible();
      const question = "Wait for this question's photo.";
      const edited = withManual ? question : "Wait for the equipment photo.";
      await composer(page).fill(question);
      await attachDraftPhoto(page, "f35-original.png");
      if (withManual) await attachManual("original-manual.txt");
      const send = page.getByRole("button", { name: "Send", exact: true });
      await send.click();
      await expect.poll(() => uploads).toBe(1);
      const projects = page.getByRole("region", { name: "Projects" });
      await projects.locator('[data-item-id="notebook-' + OTHER_NB + ':thread-legacy"]').click();
      await projects.locator('[data-item-id="notebook-' + NB + ':thread-' + THREAD + '"]').click();
      await expect(page.getByTestId("bench-asking-about")).toBeVisible();
      await expect(composer(page)).toHaveValue(question);
      const card = page.getByRole("group", { name: "Interrupted attachment" });
      await card.getByRole("button", { name: "Dismiss attachment notice" }).click();
      await expect(card.getByRole("status")).toHaveCount(0);
      const error = page.getByRole("alert", { name: "Send error" });
      if (!withManual) {
        await composer(page).fill(edited);
        await send.click();
        await expect(error).toContainText("Attach the file again before sending.", { timeout: 4500 });
        expect(requests).toHaveLength(0);
        await expect(composer(page)).toHaveValue(edited);
      }
      if (withManual) {
        await attachManual("replacement-manual.txt");
        await expect(page.getByRole("button", { name: /Remove replacement-manual/ })).toBeVisible();
        await send.click();
        await expect(error).toContainText("Attach the missing photo before sending.", { timeout: 4500 });
        expect(requests).toHaveLength(0);
      }
      await attachDraftPhoto(page, "f35-replacement.png");
      await send.click();
      await expect.poll(() => requests.length).toBe(1);
      expect(requests[0]).toMatchObject({ message: edited, visualEvidence: { fileId: "f35-reattached-photo" } });
      await expect(card).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("F25 a second interrupted upload preserves both original questions", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let uploads = 0;
  const requests: unknown[] = [];
  let finish = () => {};
  const heldUpload = new Promise<void>((resolve) => { finish = resolve; });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/look\/?$/, async (route) => {
    if (++uploads === 1) await heldUpload;
    if (uploads < 4) return route.fulfill(json({ error: "fixture_upload_failure" }, 503)).catch(() => {});
    return route.fulfill(json({
      fileId: "reattached-drive-photo", observation: { text: "Synthetic reattachment" },
      attachment: { linkId: "link" }, observationPersisted: true,
    }));
  });
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "text/event-stream",
      body: 'data: {"kind":"status","status":"answered"}\n\n' });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(page.getByTestId("bench-asking-about")).toBeVisible();
  const first = "Keep the interrupted drive question.";
  const second = "Keep the newer conveyor question.";
  const send = page.getByRole("button", { name: "Send", exact: true });
  const origin = page.getByRole("region", { name: "Projects" })
    .locator('[data-item-id="notebook-' + NB + ':thread-' + THREAD + '"]');
  try {
    await composer(page).fill(first);
    await attachDraftPhoto(page, "first-interruption.png");
    await send.click();
    await expect.poll(() => uploads).toBe(1);
    await composer(page).fill(second);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(composer(page)).toHaveValue("");
    await origin.click();
    await expect(composer(page)).toHaveValue(second);
    await expect(page.getByText(first, { exact: true })).toBeVisible();
    await attachDraftPhoto(page, "second-interruption.png");
    await send.click();
    await expect.poll(() => uploads).toBe(2);
    await expect(composer(page)).toHaveValue(second);
    const dismissals = page.getByRole("button", { name: "Dismiss attachment notice", exact: true });
    await expect(dismissals).toHaveCount(2, { timeout: 6000 });
    const firstRecovery = page.getByRole("group", { name: "Interrupted attachment" }).filter({ hasText: first });
    const restore = firstRecovery.getByRole("button", { name: "Restore question" });
    await expect(restore).toBeDisabled();
    await composer(page).fill("");
    await restore.click();
    await expect(composer(page)).toHaveValue(first);
    await send.click();
    await expect(composer(page)).toHaveValue(first);
    expect(requests).toHaveLength(0);

    await attachDraftPhoto(page, "failed-reattachment.png");
    await send.click();
    await expect.poll(() => uploads).toBe(3);
    await expect(composer(page)).toHaveValue(first);
    await expect(dismissals).toHaveCount(2);
    expect(requests).toHaveLength(0);

    await attachDraftPhoto(page, "successful-reattachment.png");
    await send.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ message: first, visualEvidence: { fileId: "reattached-drive-photo" } });
    await expect(dismissals).toHaveCount(1);
    const remaining = page.getByRole("group", { name: "Interrupted attachment" });
    await expect(remaining).toContainText(second);
    await dismissals.click();
    await expect(remaining.getByRole("status")).toHaveCount(0);
    await expect(remaining).toContainText(second);
    await remaining.getByRole("button", { name: "Discard interrupted question" }).click();
    await expect(remaining).toHaveCount(0);
  } finally {
    finish();
  }
});

for (const settlement of ["early stream cutoff", "terminal retry"]) {
  test("F26 Projects keeps a saved first answer after " + settlement, async ({ page, context, baseURL }) => {
    await auth(context, baseURL!);
    await routes(page, { enabled: true, resolve: "resolved" });
    let catchUp = false;
    let listReads = 0;
    let requestId: string | undefined;
    let chatPosts = 0;
    let failedReads = 0;
    let detailOnline = false;
    const throughRetry = settlement === "terminal retry";
    const question = "Find the saved conversation.";
    const summary = { id: THREAD, notebookId: NB, title: "Saved conversation fixture",
      createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-20T12:00:01.000Z",
      turnCount: 1, sharedLegacy: false };
    await page.route(/\/api\/equipment-notebooks\/?(\?.*)?$/, (route) => {
      listReads++;
      const notebooks = catchUp
        ? oracle.list.notebooks.map((nb: { id: string }) => nb.id === NB ? { ...nb, threads: [summary] } : nb)
        : oracle.list.notebooks;
      return route.fulfill(json({ notebooks }));
    });
    await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), (route) => {
      if (!requestId || new URL(route.request().url()).searchParams.get("threadId") !== THREAD) return route.fallback();
      if (throughRetry && !detailOnline) {
        failedReads++;
        return route.fulfill(json({ error: "fixture_detail_failure" }, 503));
      }
      return route.fulfill(json({ ...oracle.detailEmpty, threads: [summary], turns: [{
        id: "saved-first-fixture", clientRequestId: requestId, question, answerStatus: "answered",
        answerText: "Confirmed first answer.", evidence: [],
      }] }));
    });
    await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
      chatPosts++;
      const postedId = route.request().postDataJSON().clientRequestId;
      if (requestId) expect(postedId).toBe(requestId);
      requestId = postedId;
      const body = throughRetry && chatPosts === 2 ? 'data: {"kind":"status","status":"answered"}\n\n' : "";
      return route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });
    await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
    await expect(more(page)).toBeVisible();
    const origin = page.url();
    await composer(page).fill(question);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const projects = page.getByRole("region", { name: "Projects" });
    if (throughRetry) {
      await expect.poll(() => failedReads).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect.poll(() => failedReads).toBeGreaterThan(1);
      const pendingRow = projects.getByRole("button", { name: "Saved conversation", exact: true });
      await page.getByRole("button", { name: "New chat", exact: true }).click();
      await expect(pendingRow).toBeVisible();
      detailOnline = true;
      await pendingRow.click();
      await expect(page).toHaveURL(origin);
    }
    await expect(page.getByText("Confirmed first answer.", { exact: true })).toBeVisible();
    const savedRow = projects.getByRole("button", { name: summary.title, exact: true });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(savedRow).toBeVisible({ timeout: 6000 });
    await expect.poll(() => listReads).toBeGreaterThan(1);
    await savedRow.click();
    await expect(page).toHaveURL(origin);
    await expect(page.getByText("Confirmed first answer.", { exact: true })).toBeVisible();
    expect(chatPosts).toBe(throughRetry ? 2 : 1);
    catchUp = true;
    await page.reload();
    await expect(savedRow).toHaveCount(1);
  });
}

test("F29 an older interrupted answer leaves the newer saved answer and its follow-ups last with browser clock offset", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved" });
  const oldQuestion = "Check the older fixture.";
  const newQuestion = "Check the newer fixture.";
  const suggestion = "Tell me more about the newer fixture";
  const priorAnswer = { id: "previous-fixture-answer", clientRequestId: "previous-fixture-request",
    question: "Check the prior fixture.", answerStatus: "answered", answerText: "Previously saved answer.",
    evidence: [], createdAt: new Date(Date.now() - 60_000).toISOString() };
  let saved: Record<string, unknown>[] = [priorAnswer];
  await page.route(new RegExp("/api/equipment-notebooks/" + NB + "/?(\\?.*)?$"), (route) =>
    route.fulfill(json({ ...oracle.detailEmpty, turns: saved })));
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, (route) => {
    const request = route.request().postDataJSON();
    const frames: unknown[] = [{ kind: "content", content: "Older partial answer." }];
    if (request.message === newQuestion) {
      const savedAt = new Date();
      saved = [
        priorAnswer,
        { id: "other-device-answer", clientRequestId: "other-device-request", question: newQuestion,
          answerStatus: "answered", answerText: "Saved from another device.", evidence: [],
          createdAt: new Date(savedAt.getTime() - 1).toISOString() },
        { id: "newer-fixture-answer", clientRequestId: request.clientRequestId, question: newQuestion,
          answerStatus: "answered", answerText: "Newer saved answer.", evidence: [], createdAt: savedAt.toISOString() },
      ];
      frames.splice(0, 1, { kind: "content", content: "Newer saved answer." },
        { kind: "followups", suggestions: [suggestion] }, { kind: "status", status: "answered" });
    }
    return route.fulfill({ status: 200, contentType: "text/event-stream",
      body: frames.map((frame) => "data: " + JSON.stringify(frame) + "\n\n").join("") });
  });
  await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
  await expect(more(page)).toBeVisible();
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  await composer(page).fill(oldQuestion);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  await composer(page).fill(newQuestion);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const answers = page.locator('.fl-turn--aui[data-role="assistant"]');
  const persisted = answers.filter({ hasText: "Newer saved answer." });
  await expect(persisted).toHaveAttribute("data-turn-id", "newer-fixture-answer-a");
  await expect(answers.nth(0)).toContainText("Previously saved answer.");
  await expect(answers.nth(1)).toContainText("Older partial answer.", { timeout: 6000 });
  await expect(answers.last()).toContainText("Newer saved answer.");
  await expect(persisted.getByRole("button", { name: suggestion, exact: true })).toBeVisible();
});

test("a late chat cutoff keeps a newer photo-only draft independent", async ({ page, context, baseURL }) => {
  await auth(context, baseURL!);
  await routes(page, { enabled: true, resolve: "resolved", initial: { [THREAD]: { componentId: VFD, version: 2 } } });
  let release = () => {};
  const finish = new Promise<void>((resolve) => { release = resolve; });
  const requests: Record<string, unknown>[] = [];
  await page.route(/\/api\/equipment-notebooks\/[^/]+\/chat\/?$/, async (route) => {
    requests.push(route.request().postDataJSON());
    await finish;
    const body = requests.length === 1 ? "" : 'data: {"kind":"status","status":"answered"}\n\n';
    return route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  try {
    await page.goto("/v3/?notebook=" + NB + "&thread=" + THREAD);
    await expect(page.getByTestId("bench-asking-about")).toBeVisible();
    const oldQuestion = "Keep this old question separate from the next photo.";
    await composer(page).fill(oldQuestion);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(composer(page)).toHaveValue("");
    await attachDraftPhoto(page, "reserved-new-photo.png");
    const removeNewPhoto = page.getByRole("button", { name: /Remove reserved-new-photo/ });
    await expect(removeNewPhoto).toBeVisible();
    release();
    await expect(page.getByRole("alert", { name: "Send error" })).toContainText("didn't confirm");
    await expect(composer(page)).toHaveValue("", { timeout: 3500 });
    await expect(removeNewPhoto).toBeVisible();
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await retry.click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect(composer(page)).toHaveValue("");
    await expect(removeNewPhoto).toBeVisible();
  } finally {
    release();
  }
});

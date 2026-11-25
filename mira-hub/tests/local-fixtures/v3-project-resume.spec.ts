/**
 * Reopening a project from the sidebar resumes its newest saved conversation (#4681),
 * in a real browser against the production build.
 *
 * LOCAL fixture (tests/local-fixtures, outside the production-targeting tests/e2e): the server is the
 * shared loopback-only, credential-free harness (#5731). Fixture, not acceptance: every /api/** request is answered here, so nothing reaches a
 * database or a provider. It proves the host's click policy and what the technician sees;
 * it is NOT staging, provider or device evidence.
 *
 * Three projects: A has three saved threads listed oldest-last-newest-in-the-middle (the
 * list order is not time order) plus a newer empty placeholder; B has only the legacy
 * conversation; C has only an empty placeholder.
 *
 *   - HOME → A opens A's newest saved thread with its answer on screen; → B opens the
 *     legacy conversation; → A again is back on A's newest. No chat POST and no other write.
 *   - clicking the project that is already open does not manufacture a blank conversation.
 *   - C (nothing saved) opens a fresh, empty chat.
 *   - New chat still mints a fresh thread; a deep link still opens exactly the thread it names.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { oracle } from "../fidelity/harness";
import { installSessionCookie } from "./harness/fixture-harness.cjs";

const PORT = 3941; // must match playwright.v3-project-resume.config.ts
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";
const NB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NB_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NB_CREATED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NEW_NAME = "Fresh project with a delayed Back";

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Thread = { id: string; turns: number; updatedAt: string; question?: string };
const THREADS: Record<string, Thread[]> = {
  // Deliberately not in time order; "a-new" is the newest SAVED one, "a-blank" is newer but empty.
  [NB_A]: [
    { id: "a-old", turns: 1, updatedAt: "2026-11-10T10:00:00.000Z", question: "A-OLD question about the conveyor" },
    { id: "a-blank", turns: 0, updatedAt: "2026-11-20T10:00:00.000Z" },
    { id: "a-new", turns: 2, updatedAt: "2026-11-18T10:00:00.000Z", question: "A-NEW question about the drive fault" },
    { id: "a-mid", turns: 1, updatedAt: "2026-11-14T10:00:00.000Z", question: "A-MID question about the sensor" },
  ],
  [NB_B]: [{ id: "legacy", turns: 1, updatedAt: "2026-11-05T10:00:00.000Z", question: "B-LEGACY question about the pump" }],
  [NB_C]: [{ id: "c-blank", turns: 0, updatedAt: "2026-11-19T10:00:00.000Z" }],
};
const NAMES: Record<string, string> = {
  [NB_A]: "Project Alpha",
  [NB_B]: "Project Bravo",
  [NB_C]: "Project Charlie",
  [NB_CREATED]: NEW_NAME,
};

function notebook(id: string) {
  const base = oracle.list.notebooks[0];
  return {
    ...base, id, displayName: NAMES[id], nodeId: null, sourceCount: 0, locationLabel: null,
    threads: (THREADS[id] ?? []).map((t) => ({
      id: t.id, notebookId: id, title: t.question ?? NAMES[id], createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: t.updatedAt, turnCount: t.turns, sharedLegacy: t.id === "legacy",
    })),
  };
}

function detail(id: string, threadId: string | null) {
  const t = THREADS[id]?.find((x) => x.id === threadId);
  const turns = t && t.turns > 0
    ? [{
        ...oracle.G.detailAfter.turns[0], id: `turn-${id}-${t.id}`, threadId: t.id === "legacy" ? null : t.id,
        question: t.question, answerText: `Saved reply ${t.id}`, evidence: [],
        createdAt: t.updatedAt, sharedLegacy: t.id === "legacy",
      }]
    : [];
  return { ...oracle.detailEmpty, notebook: notebook(id), sources: [], turns, threads: notebook(id).threads, photos: [] };
}

/** Every detail GET the page made, as `<notebook>?<thread>`. */
const detailGets: string[] = [];

type CreateFixture = { created: boolean; listFailures: number };

async function mount(context: BrowserContext, page: Page, baseURL: string, create?: CreateFixture) {
  // Origin check first, then the per-run secret: nothing is minted for any other origin.
  await installSessionCookie(context, baseURL, PORT, {
    uid: "e2e-project-resume", tid: TENANT, status: "trial",
    trialExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), email: "e2e-project-resume@factorylm-test.com",
  });
  const writes: string[] = [];
  detailGets.length = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/(.)\/$/, "$1");
    const m = req.method();
    if (m !== "GET" && p !== "/api/auth/_log") writes.push(`${m} ${p}`);
    if (m === "GET" && p === "/api/me") return route.fulfill(json({ id: USER, tenantId: TENANT, status: "active", name: "E2E", email: "e2e@example.invalid" }));
    if (m === "GET" && p === "/api/auth/session") return route.fulfill(json({ user: { name: "E2E", email: "e2e@example.invalid" }, expires: "2099-01-01T00:00:00.000Z" }));
    if (p === "/api/auth/_log") return route.fulfill(json({}));
    if (m === "GET" && p === "/api/equipment-notebooks") {
      if (create?.created) {
        create.listFailures += 1;
        return route.fulfill(json({ error: "injected_read_failure" }, 500));
      }
      return route.fulfill(json({ notebooks: [NB_A, NB_B, NB_C].map(notebook) }));
    }
    if (create && m === "POST" && p === "/api/equipment-notebooks") {
      expect(req.postDataJSON().displayName).toBe(NEW_NAME);
      create.created = true;
      return route.fulfill(json({ notebook: notebook(NB_CREATED) }, 201));
    }
    if (create && m === "GET" && p === "/api/namespace/tree") return route.fulfill(json({ nodes: [] }));
    if (create && m === "GET" && p === "/api/files") return route.fulfill(json({ files: [] }));
    const d = /^\/api\/equipment-notebooks\/([^/]+)$/.exec(p);
    if (m === "GET" && d && NAMES[d[1]]) {
      const thread = new URL(req.url()).searchParams.get("threadId");
      detailGets.push(`${d[1]}?${thread}`);
      return route.fulfill(json(detail(d[1], thread)));
    }
    if (m === "GET" && p === "/api/assets") return route.fulfill(json([]));
    return route.fulfill(json({ error: "not_in_fixture" }, 404));
  });
  return writes;
}

async function ensureDrawerOpen(page: Page) {
  const aside = page.locator('aside[aria-label="FactoryLM navigation"]');
  await expect(aside).toBeAttached();
  if (!(await aside.evaluate((el) => el.hasAttribute("inert"))) && (await aside.isVisible())) return;
  await page.locator('button[aria-label="Open navigation"]').click();
  await expect(aside).toBeVisible();
  await expect.poll(() => aside.evaluate((el) => el.hasAttribute("inert"))).toBe(false);
}
const clickProject = async (page: Page, id: string) => {
  await ensureDrawerOpen(page);
  await page.locator(`[data-project-id="project-${id}"]`).click();
};
const threadParam = (page: Page) => new URL(page.url()).searchParams.get("thread");
const notebookParam = (page: Page) => new URL(page.url()).searchParams.get("notebook");
const conversation = (page: Page) => page.locator('[aria-label="Conversation"]');

test.describe("sidebar project click resumes the newest saved conversation (#4681)", () => {
  test("A → B → A resumes each project's latest thread, never POSTs, New chat is still fresh", async ({ page, context, baseURL }) => {
    const writes = await mount(context, page, baseURL!);
    await page.goto("/v3/", { waitUntil: "domcontentloaded" });

    await clickProject(page, NB_A);
    await expect.poll(() => threadParam(page)).toBe("a-new");
    expect(notebookParam(page)).toBe(NB_A);
    await expect(conversation(page).getByText("A-NEW question about the drive fault")).toBeVisible();
    await expect(conversation(page).getByText("Saved reply a-new")).toBeVisible();

    await clickProject(page, NB_B);
    await expect.poll(() => notebookParam(page)).toBe(NB_B);
    expect(threadParam(page)).toBe("legacy");
    await expect(conversation(page).getByText("B-LEGACY question about the pump")).toBeVisible();

    await clickProject(page, NB_A);
    await expect.poll(() => notebookParam(page)).toBe(NB_A);
    expect(threadParam(page)).toBe("a-new");
    await expect(conversation(page).getByText("A-NEW question about the drive fault")).toBeVisible();

    // Clicking the project that is already open changes nothing: no second detail GET, no reset,
    // the saved conversation stays on screen, and no blank conversation is minted.
    await expect(conversation(page).getByText("Saved reply a-new")).toBeVisible();
    const getsBefore = detailGets.length;
    await clickProject(page, NB_A);
    await page.waitForTimeout(750);
    expect(detailGets.length).toBe(getsBefore);
    expect(threadParam(page)).toBe("a-new");
    await expect(conversation(page).getByText("A-NEW question about the drive fault")).toBeVisible();
    await expect(conversation(page).getByText("Saved reply a-new")).toBeVisible();
    await expect(page.getByText("What can I help you with?")).toHaveCount(0);

    // New chat still mints a fresh, empty thread.
    await ensureDrawerOpen(page);
    await page.locator("button.fl-shell__new-chat", { hasText: "New chat" }).click();
    const fresh = threadParam(page);
    expect(fresh).toBeTruthy();
    expect(["a-new", "a-old", "a-mid", "a-blank"]).not.toContain(fresh);
    await expect(page.getByText("What can I help you with?")).toBeVisible();
    await expect(page.locator("[data-role]")).toHaveCount(0);

    expect(writes, "no chat POST or any other write").toEqual([]);
  });

  test("a project with nothing saved opens a fresh empty chat; deep links name their exact thread", async ({ page, context, baseURL }) => {
    const writes = await mount(context, page, baseURL!);
    await page.goto("/v3/", { waitUntil: "domcontentloaded" });

    await clickProject(page, NB_C);
    await expect.poll(() => notebookParam(page)).toBe(NB_C);
    const minted = threadParam(page);
    expect(minted).toBeTruthy();
    expect(minted).not.toBe("c-blank");
    await expect(page.getByText("What can I help you with?")).toBeVisible();
    await expect(page.locator("[data-role]")).toHaveCount(0);

    // A deep link to an OLDER thread still opens exactly that thread, not the newest.
    await page.goto(`/v3/?notebook=${NB_A}&thread=a-old`, { waitUntil: "domcontentloaded" });
    await expect(conversation(page).getByText("A-OLD question about the conveyor")).toBeVisible();
    expect(threadParam(page)).toBe("a-old");

    // A notebook link with no thread is still a fresh chat (explicit-link policy, #4444).
    await page.goto(`/v3/?notebook=${NB_A}`, { waitUntil: "domcontentloaded" });
    await expect.poll(() => threadParam(page)).toBeTruthy();
    expect(["a-new", "a-old", "a-mid", "a-blank"]).not.toContain(threadParam(page));
    await expect(page.getByText("What can I help you with?")).toBeVisible();

    expect(writes, "no chat POST or any other write").toEqual([]);
  });
});


test("Create and Open uses its returned project even when the catalog refresh fails", async ({ page, context, baseURL }) => {
  const create = { created: false, listFailures: 0 };
  const writes = await mount(context, page, baseURL!, create);
  await page.goto("/v3/", { waitUntil: "domcontentloaded" });
  await ensureDrawerOpen(page);
  await page.getByRole("button", { name: "New project" }).click();
  const setup = page.getByRole("dialog", { name: "New project" });
  await setup.getByRole("button", { name: "General (no machine)" }).click();
  await setup.getByRole("textbox", { name: "Project name (required)" }).fill(NEW_NAME);
  await setup.getByRole("button", { name: "Next", exact: true }).click();
  await setup.getByRole("button", { name: "Review", exact: true }).click();
  await setup.getByRole("button", { name: "Create project", exact: true }).click();
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => history.state?.flLayerBack === true)).toBe(true);

  // Hold the native Back task until after the click. Opting into the new thread
  // before this task restores the old route lets Next handle that stale URL.
  await page.evaluate(() => {
    const back = history.back.bind(history);
    history.back = () => {
      document.documentElement.dataset.projectBackRequested = "true";
      document.addEventListener("release-project-back", () => back(), { once: true });
    };
  });
  await setup.getByRole("button", { name: "Open project", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-project-back-requested", "true");
  expect(notebookParam(page)).toBeNull();
  await page.evaluate(() => document.dispatchEvent(new Event("release-project-back")));

  await expect(setup).toBeHidden();
  await expect.poll(() => notebookParam(page)).toBe(NB_CREATED);
  const thread = threadParam(page);
  expect(thread).toBeTruthy();
  await expect(page.getByRole("heading", { name: NEW_NAME, exact: true })).toBeVisible();
  expect(detailGets).toContain(`${NB_CREATED}?${thread}`);
  expect(create.listFailures).toBeGreaterThan(0);
  await expect(conversation(page).getByText(/General question/)).toHaveCount(0);
  expect(writes).toEqual(["POST /api/equipment-notebooks"]);
});

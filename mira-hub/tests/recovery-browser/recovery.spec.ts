/**
 * Native round4 F9 / F10 / F11 in a real browser against the PRODUCTION BUILD of the Hub host.
 *
 * FIXTURE ONLY: every /api/** request is answered here and any other origin is refused, so no database, provider or
 * cloud resource is reached. The chat POST is answered by an in-page fetch shim that returns a stream the test pushes
 * chunks into (Playwright's route.fulfill delivers a body whole, so it cannot pause mid-answer). This proves what the
 * host does with those responses; it is NOT real HTTP/PostgreSQL evidence (see the vitest recovery profile for that).
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import fs from "node:fs";
import path from "node:path";

const oracle = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../fidelity/fixtures/oracle.json"), "utf8"));
const SECRET = process.env.R4_AUTH_SECRET!;
const SHOTS = process.env.R4_SHOTS ?? "/tmp/r4-shots";
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";
const NB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THREAD = "r4-thread";
const ASSET = "machine-A";
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pointerKey = (req: string) => `factorylm:pending-turn:${encodeURIComponent(`${TENANT}:${USER}`)}:${encodeURIComponent(NB)}:${encodeURIComponent(THREAD)}:${encodeURIComponent(req)}`;

const identity = { version: 1, manufacturer: "AutomationDirect", model: "DURApulse GS10", catalogNumber: null, serialNumber: null, equipmentType: "vfd", identityStatus: "user_confirmed" };
const notebook = () => ({
  ...oracle.list.notebooks[0], id: NB, displayName: "Project Alpha", nodeId: null, sourceCount: 0, locationLabel: null,
  asset: { entityId: ASSET, name: "Drive A", unsPath: "enterprise.a" },
  threads: [{ id: THREAD, notebookId: NB, title: "r4", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z", turnCount: 1, sharedLegacy: false }],
});
type Row = Record<string, unknown>;
const row = (id: string, req: string, extra: Row = {}): Row => ({
  id, threadId: THREAD, equipmentEntityId: ASSET, question: `Question ${id}`, answerStatus: "answered", answerText: `Saved answer ${id}`, evidence: [],
  basis: null, createdAt: "2026-11-20T10:00:00.000Z", ownerUserId: USER, sharedLegacy: false, clientRequestId: req, ...extra,
});
const status = (req: string, extra: Row = {}) => ({
  requestId: req, turnId: `turn-${req}`, threadId: THREAD, question: "What fuse should this drive use?", state: "interrupted", answerStatus: null, canRetry: true,
  target: { kind: "known", equipmentEntityId: ASSET }, currentEquipmentEntityId: ASSET, originalNotebookIdentity: identity, component: null,
  componentSelection: { threadId: THREAD, componentId: null, selectionVersion: null }, sourceDocIds: [], visualEvidence: null, pollAfterMs: null,
  createdAt: "2026-11-21T00:00:00.000Z", ...extra,
});

type Fixture = {
  turns: Row[]; posts: { body: Record<string, unknown> }[]; detailMode: "ok" | "500"; includeTurnMode: "ok" | "500";
  statuses: Record<string, Row | null>; pinned: Record<string, Row>; detailCalls: number;
};
async function mount(context: BrowserContext, page: Page, baseURL: string, fx: Fixture, seedPointers: { req: string; question: string }[] = []) {
  const origin = new URL(baseURL).origin;
  const token = await encode({ token: { uid: USER, tid: TENANT, status: "trial", trialExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), email: "e2e-r4@factorylm-test.com" }, secret: SECRET });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL }]);
  // One exact origin: everything else is refused before it leaves the browser.
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  await context.addInitScript(({ seeds, keyFor, notebookId, threadId }) => {
    for (const s of seeds) try { localStorage.setItem(keyFor[s.req], JSON.stringify({ notebookId, threadId, requestId: s.req, question: s.question })); } catch {}
    const written: string[] = []; (window as unknown as { __clip: string[] }).__clip = written;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { written.push(t); } }, configurable: true });
    // Controllable chat stream: the page's POST /chat/ gets a stream the test pushes frames into and can Stop (abort).
    const realFetch = window.fetch.bind(window);
    const enc = new TextEncoder();
    const chat = { calls: [] as unknown[], push: (() => {}) as (frame: string) => void, end: () => {}, fail: () => {}, refuseNext: null as null | { status: number; body: unknown } };
    (window as unknown as { __chat: typeof chat }).__chat = chat;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (init?.method === "POST" && /\/chat\/?$/.test(new URL(url, location.href).pathname)) {
        chat.calls.push(JSON.parse(String(init.body ?? "{}")));
        if (chat.refuseNext) { // fixture HTTP refusal (UI proof only; the same server behaviour is proven against real storage)
          const refusal = chat.refuseNext; chat.refuseNext = null;
          return Promise.resolve(new Response(JSON.stringify(refusal.body), { status: refusal.status, headers: { "content-type": "application/json" } }));
        }
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
        chat.push = (frame: string) => controller.enqueue(enc.encode(frame));
        chat.end = () => { try { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close(); } catch {} };
        init.signal?.addEventListener("abort", () => { try { controller.error(new DOMException("aborted", "AbortError")); } catch {} });
        return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
      }
      return realFetch(input, init);
    };
  }, { seeds: seedPointers, keyFor: Object.fromEntries(seedPointers.map((s) => [s.req, pointerKey(s.req)])), notebookId: NB, threadId: THREAD });
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace(/(.)\/$/, "$1"); const m = req.method();
    if (m === "GET" && p === "/api/me") return route.fulfill(json({ id: USER, tenantId: TENANT, status: "active", name: "E2E", email: "e2e@example.invalid" }));
    if (m === "GET" && p === "/api/auth/session") return route.fulfill(json({ user: { id: USER, tenantId: TENANT, name: "E2E", email: "e2e@example.invalid" }, expires: "2099-01-01T00:00:00.000Z" }));
    if (p === "/api/auth/_log") return route.fulfill(json({}));
    if (m === "GET" && p === "/api/equipment-notebooks") return route.fulfill(json({ notebooks: [notebook()] }));
    const rq = /^\/api\/equipment-notebooks\/[^/]+\/requests\/([^/]+)$/.exec(p);
    if (m === "GET" && rq) {
      const id = decodeURIComponent(rq[1]!);
      if (u.searchParams.get("includeTurn") === "1") {
        if (fx.includeTurnMode === "500") return route.fulfill(json({ error: "boom" }, 500));
        const value = fx.statuses[id];
        return route.fulfill(json(value ? { ...value, turn: fx.pinned[id] ?? null } : { error: "not_found" }, value ? 200 : 404));
      }
      const value = fx.statuses[id];
      return route.fulfill(json(value ?? { error: "not_found" }, value ? 200 : 404));
    }
    if (m === "GET" && p === `/api/equipment-notebooks/${NB}`) {
      fx.detailCalls++;
      if (fx.detailMode === "500") return route.fulfill(json({ error: "boom" }, 500));
      return route.fulfill(json({ ...oracle.detailEmpty, notebook: notebook(), sources: [], turns: fx.turns, threads: notebook().threads, photos: [] }));
    }
    if (m === "GET" && p === "/api/assets") return route.fulfill(json([]));
    if (m === "GET" && /\/api\/equipment-notebooks\/[^/]+\/components$/.test(p)) return route.fulfill(json({ error: "not_in_fixture" }, 404));
    return route.fulfill(json({ error: "not_in_fixture" }, 404));
  });
}
const fresh = (over: Partial<Fixture> = {}): Fixture => ({ turns: [], posts: [], detailMode: "ok", includeTurnMode: "ok", statuses: {}, pinned: {}, detailCalls: 0, ...over });
const open = async (page: Page) => { await page.goto(`/v3/?notebook=${NB}&thread=${THREAD}`, { waitUntil: "domcontentloaded" }); await expect(page.locator('[aria-label="Conversation"]')).toBeVisible(); };
const conv = (page: Page) => page.locator('[aria-label="Conversation"]');
const chat = (page: Page) => ({
  push: (frame: string) => page.evaluate((f) => (window as unknown as { __chat: { push: (x: string) => void } }).__chat.push(f), frame),
  end: () => page.evaluate(() => (window as unknown as { __chat: { end: () => void } }).__chat.end()),
  refuseNext: (status: number, body: unknown) => page.evaluate(([st, b]) => { (window as unknown as { __chat: { refuseNext: unknown } }).__chat.refuseNext = { status: st, body: b }; }, [status, body] as const),
  calls: () => page.evaluate(() => (window as unknown as { __chat: { calls: Record<string, unknown>[] } }).__chat.calls),
});
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const shot = async (page: Page, name: string, info: { project: { name: string } }) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}_${info.project.name}.png`) }); };
const pointerPresent = (page: Page, req: string) => page.evaluate((k) => localStorage.getItem(k) !== null, pointerKey(req));

const OLD_REQ = "99999999-9999-4999-8999-999999999999";
const QUESTION = "What fuse should this drive use?";

test.describe("round4 F9: a stale persisted failure never hides or retires the retry", () => {
  test("new retry text stays visible once over an old failure; HTTP 500 refresh keeps text + pointer until the fresh completed row", async ({ page, context, baseURL }, info) => {
    const failed = row("t-fail", OLD_REQ, { question: QUESTION, answerStatus: "error", answerText: null });
    const fx = fresh({ turns: [failed] });
    await mount(context, page, baseURL!, fx);
    await open(page);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
    await conv(page).getByRole("button", { name: "Retry" }).click();
    await expect.poll(async () => (await chat(page).calls()).length).toBe(1);
    expect((await chat(page).calls())[0]).toMatchObject({ retryRequestId: OLD_REQ });
    // Pause after the FIRST chunk: the live text must be on screen, exactly once, with the question once and no stale failure.
    await chat(page).push(frame({ kind: "content", content: "Use a 10 A fast-acting fuse " }));
    await expect(conv(page).getByText("Use a 10 A fast-acting fuse")).toHaveCount(1);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
    await expect(conv(page).getByRole("alert")).toHaveCount(0);
    await shot(page, "2026-11-21_round4-retry-over-old-failure-streaming", info);
    // First post-stream refresh fails (detail HTTP 500 and the exact-row read too): text and pointer must survive.
    fx.detailMode = "500"; fx.includeTurnMode = "500";
    await chat(page).push(frame({ kind: "content", content: "per the manual [1]." }));
    await chat(page).push(frame({ kind: "status", status: "answered" }));
    await chat(page).end();
    await expect.poll(() => fx.detailCalls).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    await expect(conv(page).getByText("Use a 10 A fast-acting fuse")).toHaveCount(1);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
    expect(await pointerPresent(page, OLD_REQ)).toBe(true);
    await shot(page, "2026-11-21_round4-retry-refresh-500-text-and-pointer-kept", info);
    // The fresh authoritative read arrives: the completed row replaces the live view; pointer retires; still exactly one of each.
    const completed = row("t-fail", OLD_REQ, { question: QUESTION, answerStatus: "answered", answerText: "Use a 10 A fast-acting fuse per the manual [1]." });
    fx.turns = [completed]; fx.detailMode = "ok"; fx.includeTurnMode = "ok";
    fx.statuses[OLD_REQ] = status(OLD_REQ, { state: "complete", answerStatus: "answered", canRetry: false, question: QUESTION });
    fx.pinned[OLD_REQ] = completed;
    await expect.poll(() => pointerPresent(page, OLD_REQ), { timeout: 20_000 }).toBe(false);
    await expect(conv(page).getByText("Use a 10 A fast-acting fuse per the manual")).toHaveCount(1);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
    expect((await chat(page).calls()).length).toBe(1);
  });
});

test.describe("round4 F10: Stop then interrupted offers Retry on that exchange", () => {
  test("partial text kept; zero automatic POST; one click = one original-id POST; other requests cannot control it", async ({ page, context, baseURL }, info) => {
    const OTHER = "88888888-8888-4888-8888-888888888888";
    const fx = fresh({ turns: [row("t-old", "77777777-7777-4777-8777-777777777777")] });
    await mount(context, page, baseURL!, fx, [{ req: OTHER, question: "Another pending question" }]);
    // The OTHER request reads interrupted + retryable the whole time; it must never become this exchange's Retry.
    fx.statuses[OTHER] = status(OTHER, { question: "Another pending question" });
    await open(page);
    await page.getByLabel("Ask MIRA").fill(QUESTION);
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await chat(page).calls()).length).toBe(1);
    const sent = (await chat(page).calls())[0] as { clientRequestId: string };
    expect(typeof sent.clientRequestId).toBe("string");
    const REQ = sent.clientRequestId;
    await chat(page).push(frame({ kind: "content", content: "Partial answer so far" }));
    await expect(conv(page).getByText("Partial answer so far")).toHaveCount(1);
    await page.waitForTimeout(700); // the host ignores a Stop tap within 400 ms of Send (#4924)
    await page.getByRole("button", { name: "Stop" }).click();
    // The server's lease on THIS request expires: its own status now reads interrupted + retryable.
    fx.statuses[REQ] = status(REQ, { question: QUESTION });
    await expect(conv(page).getByRole("button", { name: "Retry" })).toHaveCount(1, { timeout: 20_000 });
    await expect(conv(page).getByText("Partial answer so far")).toHaveCount(1);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
    await expect(conv(page).getByRole("alert")).toHaveCount(1); // one notice (the Stop notice is replaced, not doubled)
    await page.waitForTimeout(2500);
    expect((await chat(page).calls()).length).toBe(1); // zero automatic POST
    await shot(page, "2026-11-21_round4-stopped-exchange-retry-offered", info);
    await conv(page).getByRole("button", { name: "Retry" }).dblclick();
    await expect.poll(async () => (await chat(page).calls()).length).toBe(2);
    await page.waitForTimeout(800);
    const calls = await chat(page).calls();
    expect(calls.length).toBe(2); // double-click still sends exactly one
    expect(calls[1]).toMatchObject({ retryRequestId: REQ });
  });
});


test.describe("round4 F9b: the status follower cannot retire a live success with the old error row", () => {
  test("every read still returns the old failed row; the live answer and pointer stay until the committed row arrives", async ({ page, context, baseURL }, info) => {
    const failed = row("t-fail", OLD_REQ, { question: QUESTION, answerStatus: "error", answerText: null });
    // The server still reads the ORIGINAL failure everywhere (detail 200, status complete/error, exact row) while the retry streamed.
    const fx = fresh({ turns: [failed], pinned: { [OLD_REQ]: failed }, statuses: { [OLD_REQ]: status(OLD_REQ, { state: "complete", answerStatus: "error", question: QUESTION }) } });
    await mount(context, page, baseURL!, fx);
    await open(page);
    await conv(page).getByRole("button", { name: "Retry" }).click();
    await expect.poll(async () => (await chat(page).calls()).length).toBe(1);
    await chat(page).push(frame({ kind: "content", content: "Use a 10 A fast-acting fuse per the manual." }));
    await chat(page).push(frame({ kind: "status", status: "answered" }));
    await chat(page).end();
    await page.waitForTimeout(5000); // more than two follower polls, each reading complete/error
    await expect(conv(page).getByText("Use a 10 A fast-acting fuse per the manual.")).toHaveCount(1);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
    expect(await pointerPresent(page, OLD_REQ)).toBe(true);
    await shot(page, "2026-11-21_round4-follower-old-error-row-cannot-retire-live-answer", info);
    const completed = row("t-fail", OLD_REQ, { question: QUESTION, answerStatus: "answered", answerText: "Use a 10 A fast-acting fuse per the manual." });
    fx.turns = [completed]; fx.pinned[OLD_REQ] = completed;
    fx.statuses[OLD_REQ] = status(OLD_REQ, { state: "complete", answerStatus: "answered", canRetry: false, question: QUESTION });
    await expect.poll(() => pointerPresent(page, OLD_REQ), { timeout: 20_000 }).toBe(false);
    await expect(conv(page).getByText("Use a 10 A fast-acting fuse per the manual.")).toHaveCount(1);
    await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
  });
});

test.describe("round4 F10 negative: a moved target offers no Retry", () => {
  test("this request reads interrupted for a DIFFERENT machine: no Retry, zero POST", async ({ page, context, baseURL }) => {
    const fx = fresh({ turns: [row("t-old", "77777777-7777-4777-8777-777777777777")] });
    await mount(context, page, baseURL!, fx);
    await open(page);
    await page.getByLabel("Ask MIRA").fill(QUESTION);
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await chat(page).calls()).length).toBe(1);
    const REQ = ((await chat(page).calls())[0] as { clientRequestId: string }).clientRequestId;
    await chat(page).push(frame({ kind: "content", content: "Partial answer so far" }));
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Stop" }).click();
    fx.statuses[REQ] = status(REQ, { question: QUESTION, target: { kind: "known", equipmentEntityId: "machine-B" } });
    await expect(conv(page).getByText("Partial answer so far")).toHaveCount(1);
    await page.waitForTimeout(5000);
    await expect(conv(page).getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect((await chat(page).calls()).length).toBe(1);
  });
});

test.describe("round4 F11: an exact-recovered older answer keeps its inline citation and Copy number", () => {
  test("marker opens its original source and Copy keeps [1], before and after reload", async ({ page, context, baseURL }, info) => {
    const cited = row("t-old", OLD_REQ, {
      question: "What does F004 mean?", createdAt: "2026-10-01T10:00:00.000Z",
      answerText: "F004 is a DC bus undervoltage fault [1].",
      evidence: [{ citationId: "1", docId: "33333333-3333-4333-8333-333333333333", sourceTitle: "AutomationDirect GS10 manual", page: 87, fileId: "55555555-5555-4555-8555-555555555555", quote: "F004 — DC bus undervoltage.", originFileId: null }],
    });
    // 55 newer rows fill the window; the old answer is reachable only through exact recovery.
    const newer = Array.from({ length: 55 }, (_, i) => row(`t-new-${i}`, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, { createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), question: `Newer ${i}`, answerText: `Newer answer ${i}` }));
    const fx = fresh({ turns: newer, pinned: { [OLD_REQ]: cited }, statuses: { [OLD_REQ]: status(OLD_REQ, { state: "complete", answerStatus: "answered", canRetry: false, question: "What does F004 mean?" }) } });
    await mount(context, page, baseURL!, fx, [{ req: OLD_REQ, question: "What does F004 mean?" }]);
    for (const phase of ["first load", "after reload"]) {
      if (phase === "after reload") await page.reload({ waitUntil: "domcontentloaded" }); else await open(page);
      await expect(conv(page).getByText("F004 is a DC bus undervoltage fault")).toHaveCount(1);
      const chip = conv(page).getByRole("button", { name: /Open citation 1: AutomationDirect GS10 manual/ });
      await expect(chip, phase).toHaveCount(1);
      await chip.click();
      await expect(page.getByText("AutomationDirect GS10 manual").first(), phase).toBeVisible();
      await shot(page, `2026-11-21_round4-recovered-old-answer-citation-opens-source-${phase.replace(" ", "-")}`, info);
      await page.keyboard.press("Escape");
      await conv(page).getByText("F004 is a DC bus undervoltage fault").locator('xpath=ancestor::div[.//button[@aria-label="Copy"]][1]').getByRole("button", { name: "Copy" }).click();
    }
    const clip = await page.evaluate(() => (window as unknown as { __clip: string[] }).__clip);
    expect(clip.length).toBeGreaterThan(0);
    for (const text of clip) expect(text, text).toMatch(/Sources:\n\[1\] AutomationDirect GS10 manual/);
  });
});

const PHOTO_NOTE = "The photo changed since you asked this question, so this retry does not use it. Ask a new question to use the current photo.";
test.describe("human photo requirement: a changed photo Retry says so; one explicit POST; nothing automatic; a NEW question shows the current hazard", () => {
  for (const original of ["original photo had a hazard (warning kept)", "original photo had no hazard"] as const) {
    test(original, async ({ page, context, baseURL }, info) => {
      const withWarning = original.includes("had a hazard");
      const failed = row("t-fail", OLD_REQ, { question: QUESTION, answerStatus: "error", answerText: null });
      const fx = fresh({ turns: [failed] });
      await mount(context, page, baseURL!, fx);
      await open(page);
      await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
      // The technician has typed something else meanwhile: it must survive the refused Retry.
      const composer = page.getByRole("textbox", { name: "Ask MIRA" });
      await composer.fill("a newer question I am still typing");
      await chat(page).refuseNext(409, withWarning
        ? { error: `⚠️ **Possible active incident.** Get clear first.\n\n${PHOTO_NOTE}`, code: "retry_photo_changed", safetyWarning: `⚠️ **Possible active incident.** Get clear first.\n\n${PHOTO_NOTE}` }
        : { error: "retry_photo_changed" });
      await conv(page).getByRole("button", { name: "Retry" }).click();
      await expect.poll(async () => (await chat(page).calls()).length).toBe(1);
      expect((await chat(page).calls())[0]).toEqual({ retryRequestId: OLD_REQ, threadId: THREAD });
      // The message is plain words; no internal id, nothing of a replacement reading.
      await expect(page.getByText(PHOTO_NOTE).first()).toBeVisible();
      if (withWarning) await expect(page.getByText("Possible active incident").first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/retry_photo_changed|original_photo_changed/);
      await shot(page, `2026-11-26_changed-photo-retry-says-ask-new-question${withWarning ? "-with-original-warning" : ""}`, info);
      // No automatic retry: still exactly one POST after the page has had time to retry on its own.
      await page.waitForTimeout(3000);
      expect((await chat(page).calls()).length).toBe(1);
      // The old pointer, the old failed row and the typed draft are all preserved.
      expect(await pointerPresent(page, OLD_REQ)).toBe(true);
      await expect(conv(page).getByText(QUESTION)).toHaveCount(1);
      await expect(composer).toHaveValue("a newer question I am still typing");
      // An explicit NEW question: a new request id (not a retry), and the CURRENT hazard is shown.
      await composer.fill("Is it safe to open the cabinet?");
      await page.getByRole("button", { name: "Send" }).click();
      await expect.poll(async () => (await chat(page).calls()).length).toBe(2);
      const asked = (await chat(page).calls())[1]!;
      expect(asked.retryRequestId).toBeUndefined();
      expect(asked.clientRequestId).toBeTruthy(); expect(asked.clientRequestId).not.toBe(OLD_REQ);
      await chat(page).push(frame({ kind: "content", content: "⚠️ **Possible active incident.** If anything is smoking, get clear first.\n\nCheck the nameplate." }));
      await chat(page).push(frame({ kind: "status", status: "answered" }));
      await chat(page).end();
      await expect(conv(page).getByText("Possible active incident").first()).toBeVisible();
      await expect(conv(page).getByText(QUESTION)).toHaveCount(1);   // the old failed exchange was not rewritten or retired
      await shot(page, `2026-11-26_new-question-after-changed-photo-shows-current-hazard${withWarning ? "-with-original-warning" : ""}`, info);
    });
  }
});

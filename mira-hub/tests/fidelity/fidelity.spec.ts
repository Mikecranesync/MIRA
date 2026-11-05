/**
 * Behavioral-fidelity harness: classic notebook chat (reference) vs /v3
 * (clone), served the SAME oracle backend (ADR-0038, PRD 2026-10-14, #4439).
 *
 * Measures what each UI SENDS (chat request body) and SHOWS (rendered turn,
 * live and after reload, plus the citation it opens) — never response bytes,
 * which are identical by construction.
 *
 *   npx playwright test --config tests/fidelity/playwright.fidelity.config.ts
 *
 * Each `test` below is one named check; seeded clone defects (README, AC8)
 * must turn exactly their named checks red.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import { addSessionCookie, DOC, FILE, NB, installRoutes, oracle, type Scenario } from "./harness";
import { extractTurn, UI, type Surface, type TurnRecord } from "./surfaces";
import { REQUEST_ALLOWLIST } from "./allowlist";

type Run = {
  request: Record<string, unknown> | null;
  /** Every chat POST the surface made during the whole drive (one send is expected). */
  chatPosts: number;
  live: TurnRecord;
  hydrated: TurnRecord;
  /** First citation opened: file + page the viewer points at, and whether that file was actually fetched. */
  opened: { fileId: string | null; page: string | null; fetched: boolean } | null;
  unrecognized: string[];
  /** Requests to any origin other than the dev server (never routed, so listed here). */
  offsite: string[];
  /** Clone only: data-turn-id of the live and the hydrated assistant turn. */
  turnIds: { live: string | null; hydrated: string | null };
  /** Clone only (#4454): follow-up chips on the live turn, and after the in-page refetch swaps in the persisted row. */
  followups: { live: string[]; settled: string[] } | null;
};
const SURFACES: Surface[] = ["reference", "clone"];
const SCENARIOS: Scenario[] = ["G", "S"];
const runs = {} as Record<Surface, Record<Scenario, Run>>;

async function drive(browser: Browser, baseURL: string, surface: Surface, scenario: Scenario): Promise<Run> {
  const ui = UI[surface];
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    await addSessionCookie(context, baseURL);
    const page = await context.newPage();
    const cap = await installRoutes(page, scenario);
    const offsite: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).origin !== new URL(baseURL).origin && !r.url().startsWith("data:")) offsite.push(r.url());
    });

    await page.goto(ui.url);
    await ui.ready(page).waitFor({ timeout: 30_000 });
    await ui.composer(page).fill(oracle[scenario].message);
    await expect(ui.composer(page)).toHaveValue(oracle[scenario].message);
    await ui.composer(page).press("Enter");
    const liveTurn = await ui.settled(page);
    const live = await extractTurn(surface, liveTurn);
    const liveId = await liveTurn.getAttribute("data-turn-id");
    // Optional visual evidence (never committed): FIDELITY_SHOTS=<dir>.
    if (process.env.FIDELITY_SHOTS) await page.screenshot({ path: path.join(process.env.FIDELITY_SHOTS, `${surface}-${scenario}-live.png`) });

    // Reload (step 7): let the held post-turn detail GETs through first.
    const chips = '[data-part-type="followups"] button';
    const liveFollowups = surface === "clone" ? await liveTurn.locator(chips).allInnerTexts() : null;
    cap.release();
    // Settle (#4454): the clone swaps its streamed turn for the persisted row in
    // place, and that row never carries follow-ups. What shows after the swap is
    // what the technician keeps until the next send, so read it before reloading.
    // Wait for the live turn to LEAVE, not for the row to appear: the row renders
    // beside the live turn while the host still awaits the notebook list.
    let followups: Run["followups"] = null;
    if (surface === "clone") {
      const turnSel = '.fl-turn--aui[data-role="assistant"]';
      await page.locator(`${turnSel}[data-turn-id^="live-"]`).waitFor({ state: "detached", timeout: 30_000 });
      const swapped = page.locator(`${turnSel}[data-turn-id="turn-${scenario}-a"]`);
      await swapped.waitFor({ timeout: 30_000 });
      followups = { live: liveFollowups!, settled: await swapped.locator(chips).allInnerTexts() };
    }
    await page.goto(ui.url);
    const hydratedTurn = await ui.settled(page);
    const hydrated = await extractTurn(surface, hydratedTurn);
    const hydratedId = await hydratedTurn.getAttribute("data-turn-id");

    // Citation inspectable (step 6): open the first citation, read what loads.
    let opened: Run["opened"] = null;
    const chip = page.getByRole("button", { name: /^Open citation / }).first();
    if (await chip.count()) {
      const fetched = page
        .waitForRequest((r) => r.url().includes(`/api/namespace/files/${FILE}`), { timeout: 10_000 })
        .then(() => true, () => false);
      await chip.click();
      const frame = ui.viewerFrame(page);
      await frame.waitFor({ timeout: 10_000 }).catch(() => undefined);
      const src = (await frame.count()) ? await frame.getAttribute("src") : null;
      const m = src ? /\/api\/namespace\/files\/([^/#?]+)\/?(?:[^#]*)(?:#page=(\d+))?/.exec(src) : null;
      opened = { fileId: m?.[1] ?? null, page: m?.[2] ?? null, fetched: await fetched };
    }
    return {
      request: cap.chatBodies[0] ?? null, chatPosts: cap.chatBodies.length, live, hydrated, opened,
      unrecognized: [...cap.unrecognized], offsite, turnIds: { live: liveId, hydrated: hydratedId }, followups,
    };
  } finally {
    await context.close();
  }
}

function normalizeRequest(body: Record<string, unknown> | null) {
  if (!body) return null;
  const rest = { ...body };
  for (const k of Object.keys(REQUEST_ALLOWLIST)) delete rest[k];
  return rest;
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000);
  const baseURL = info.project.use.baseURL!;
  for (const s of SURFACES) {
    runs[s] = {} as Record<Scenario, Run>;
    for (const sc of SCENARIOS) runs[s][sc] = await drive(browser, baseURL, s, sc);
  }
  // Determinism evidence (AC7): one digest of every normalized record.
  const normalized = SURFACES.map((s) => SCENARIOS.map((sc) => ({
    s, sc, ...runs[s][sc], request: normalizeRequest(runs[s][sc].request),
    // The live id embeds a timestamp; keep only its shape.
    turnIds: { ...runs[s][sc].turnIds, live: runs[s][sc].turnIds.live?.replace(/\d+/g, "N") ?? null },
  })));
  const out = path.join(__dirname, ".out");
  mkdirSync(out, { recursive: true });
  const blob = JSON.stringify(normalized, null, 1);
  writeFileSync(path.join(out, "records.json"), blob);
  console.log(`[fidelity] records sha256 ${createHash("sha256").update(blob).digest("hex")}`);
});

test("network: every request served by a declared handler (AC2)", () => {
  for (const s of SURFACES) for (const sc of SCENARIOS) {
    expect.soft(runs[s][sc].unrecognized, `${s}/${sc} unrecognized /api`).toEqual([]);
    expect.soft(runs[s][sc].offsite, `${s}/${sc} off-site`).toEqual([]);
  }
});

// Precondition for AC6 on the clone: its "live" record must be the streamed
// render (partsFromStream), not the persisted row it swaps in after the
// post-turn detail refetch — which the harness holds until after extraction.
test("precondition: clone live record is the streamed turn, hydrated is the persisted row", () => {
  for (const sc of SCENARIOS) {
    expect.soft(runs.clone[sc].turnIds.live, `${sc} live`).toMatch(/^live-/);
    expect.soft(runs.clone[sc].turnIds.hydrated, `${sc} hydrated`).toBe(`turn-${sc}-a`);
  }
});

for (const sc of SCENARIOS) {
  test(`request: ${sc} — normalized chat body equal (AC3)`, () => {
    const ref = runs.reference[sc].request;
    const clone = runs.clone[sc].request;
    expect(ref, "reference sent a chat request").not.toBeNull();
    expect(clone, "clone sent a chat request").not.toBeNull();
    for (const [k, rule] of Object.entries(REQUEST_ALLOWLIST)) {
      for (const [s, b] of [["reference", ref], ["clone", clone]] as const) {
        expect(rule.valid(b![k], k in b!, s), `${s}.${k} (${rule.reason})`).toBe(true);
      }
    }
    expect(normalizeRequest(clone)).toEqual(normalizeRequest(ref));
  });
}

// Codex #4441 round 2 F1: a second (e.g. fire-and-forget) POST would be
// duplicate inference and a duplicate persisted turn, yet render identically.
test("request: exactly one chat POST per send (AC3)", () => {
  for (const s of SURFACES) for (const sc of SCENARIOS) {
    expect.soft(runs[s][sc].chatPosts, `${s}/${sc}`).toBe(1);
  }
});

test("request: clientRequestId is unique per send (AC3)", () => {
  const ids = SURFACES.flatMap((s) => SCENARIOS.map((sc) => runs[s][sc].request?.clientRequestId));
  expect(ids.every((id) => typeof id === "string"), "every send carries a clientRequestId").toBe(true);
  expect(new Set(ids).size, `distinct ids across ${ids.length} sends`).toBe(ids.length);
});

test("rendered turn: grounded answer (AC4, G)", () => {
  const ref = runs.reference.G.live;
  expect(ref.citations, "reference precondition: G renders its citation").toEqual([
    { n: "1", title: "AutomationDirect GS10 manual", page: "87" },
  ]);
  expect(runs.clone.G.live).toEqual(ref);
});

// AC4 names "safety notice present" and "first" separately; so do the checks,
// so a defect in one cannot hide behind a standing diff in the other.
const withoutOrder = (r: TurnRecord) => ({ ...r, safety: { ...r.safety, first: undefined } });

test("rendered turn: safety notice present (AC4, S)", () => {
  const ref = runs.reference.S.live;
  expect(ref.safety.present, "reference precondition: S renders a safety notice").toBe(true);
  expect(withoutOrder(runs.clone.S.live)).toEqual(withoutOrder(ref));
});

// Absolute, not just parity: a regression on BOTH surfaces must still fail (Codex #4441 F1).
test("rendered turn: safety notice first (AC4, S)", () => {
  for (const s of SURFACES) {
    expect.soft(runs[s].S.live.safety.first, `${s} live`).toBe(true);
    expect.soft(runs[s].S.hydrated.safety.first, `${s} hydrated`).toBe(true);
  }
});

test("citation inspectable: opens the cited doc + page (AC5)", () => {
  for (const s of SURFACES) {
    expect.soft(runs[s].G.opened, `${s} opened ${DOC}`).toEqual({ fileId: FILE, page: "87", fetched: true });
  }
});

// #4454: on staging the chips showed while /v3 streamed and were gone ~1–3 s
// after it finished. G streams one suggestion; S streams none (the control).
test("settle: follow-ups survive the post-turn refetch (clone, #4454)", () => {
  expect(runs.clone.G.followups?.live, "precondition: G's stream shows its follow-up").toEqual(["How do I clear fault F004?"]);
  expect.soft(runs.clone.G.followups?.settled, "G after the swap").toEqual(["How do I clear fault F004?"]);
  expect.soft(runs.clone.S.followups, "S streams none").toEqual({ live: [], settled: [] });
});

for (const sc of SCENARIOS) {
  test(`live ≡ hydrated: ${sc} (AC6)`, () => {
    for (const s of SURFACES) expect.soft(runs[s][sc].hydrated, s).toEqual(runs[s][sc].live);
  });
}


// #4753: exercise the actual Next-mounted host, not only its pure title helper.
// Existing fidelity fixtures supply API data; no model or shared DB is used.
for (const [label, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["desktop", 1280, 900]] as const) {
  test(`tab identity: project, thread, reload and busy state (${label}, #4753)`, async ({ browser, baseURL }, info) => {
    if (!baseURL) throw new Error("Fidelity baseURL required");
    const context = await browser.newContext({ baseURL, viewport: { width, height }, serviceWorkers: "block" });
    const secondNotebook = "22222222-2222-4222-8222-222222222223";
    const firstThread = "55555555-5555-4555-8555-555555555551";
    const secondThread = "55555555-5555-4555-8555-555555555552";
    const thread = (id: string, title: string) => ({ id, notebookId: NB, title, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", turnCount: 1, sharedLegacy: false });
    const list = structuredClone(oracle.list);
    // The list API caps summaries at20, detail at50: a deep link may only be named in detail.
    const detailThreads = [thread(firstThread, "Seal inspection"), thread(secondThread, "Motor vibration")];
    list.notebooks[0].threads = [detailThreads[1]];
    list.notebooks.push({ ...list.notebooks[0], id: secondNotebook, displayName: "Control conveyor", threads: [] });
    const checks: { name: string; title: string }[] = [];
    let releaseChat!: () => void;
    const heldChat = new Promise<void>((resolve) => { releaseChat = resolve; });
    let releaseDetail!: () => void;
    const heldDetail = new Promise<void>((resolve) => { releaseDetail = resolve; });
    try {
      await addSessionCookie(context, baseURL);
      const page = await context.newPage();
      await installRoutes(page, "G");
      let chatCalls = 0;
      await page.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname.replace(/^\/hub/, "").replace(/\/$/, "");
        const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        if (pathname === "/api/equipment-notebooks" && route.request().method() === "GET") return route.fulfill(json(list));
        if (pathname === `/api/equipment-notebooks/${NB}` && route.request().method() === "GET") {
          return route.fulfill(json({ ...oracle.detailEmpty, threads: detailThreads }));
        }
        if (pathname === `/api/equipment-notebooks/${secondNotebook}`) {
          await heldDetail;
          return route.fulfill(json({ ...oracle.detailEmpty, notebook: { ...oracle.detailEmpty.notebook, id: secondNotebook, displayName: "Control conveyor" } }));
        }
        if (pathname === `/api/equipment-notebooks/${NB}/chat`) {
          chatCalls += 1;
          await heldChat;
          return route.fulfill({ status: 200, contentType: "text/event-stream", body: oracle.G.sse });
        }
        return route.fallback();
      });
      const title = async (name: string, expected: string) => {
        await expect(page).toHaveTitle(expected);
        checks.push({ name, title: await page.title() });
      };
      const navigate = async () => {
        const open = page.getByRole("button", { name: "Open navigation", exact: true });
        if (await open.isVisible()) await open.click();
      };
      await page.goto("/hub/v3/");
      await UI.clone.composer(page).waitFor();
      await title("home", "FactoryLM Hub");
      const url = `/hub/v3/?notebook=${NB}&thread=${firstThread}`;
      await page.goto(url);
      await title("named thread", "Seal inspection — GS10 — Line 3 conveyor · FactoryLM Hub");
      await page.reload();
      await title("reload", "Seal inspection — GS10 — Line 3 conveyor · FactoryLM Hub");
      await navigate();
      await page.getByRole("region", { name: "Projects", exact: true }).getByRole("button", { name: "Motor vibration", exact: true }).click();
      await title("same-project thread switch", "Motor vibration — GS10 — Line 3 conveyor · FactoryLM Hub");
      await navigate();
      await page.locator(`button[data-project-id="project-${secondNotebook}"]`).click();
      // The old notebook's detail is still present: it must not name this tab.
      await title("project switch before detail returns", "Control conveyor · FactoryLM Hub");
      const detailReturned = page.waitForResponse((r) => new URL(r.url()).pathname.replace(/\/$/, "") === `/hub/api/equipment-notebooks/${secondNotebook}`);
      releaseDetail();
      await detailReturned;
      await page.goto(url);
      await title("return to named thread", "Seal inspection — GS10 — Line 3 conveyor · FactoryLM Hub");
      const sent = page.waitForRequest((r) => new URL(r.url()).pathname.replace(/\/$/, "") === `/hub/api/equipment-notebooks/${NB}/chat` && r.method() === "POST");
      await UI.clone.composer(page).fill("UI-only simulated question");
      await UI.clone.composer(page).press("Enter");
      await sent;
      await title("busy", "● Seal inspection — GS10 — Line 3 conveyor · FactoryLM Hub");
      releaseChat();
      await title("settled", "Seal inspection — GS10 — Line 3 conveyor · FactoryLM Hub");
      await page.goto("/hub/v3/");
      await UI.clone.composer(page).waitFor();
      await title("home clears previous identity", "FactoryLM Hub");
      expect(chatCalls).toBe(1);
      writeFileSync(info.outputPath("tab-title-record.json"), JSON.stringify({ label, width, height, checks, fixtureChatCalls: chatCalls, providerCalls: 0 }, null, 2));
      await page.screenshot({ path: info.outputPath("tab-title-home.png") });
    } finally {
      releaseChat();
      releaseDetail();
      await context.close();
    }
  });
}

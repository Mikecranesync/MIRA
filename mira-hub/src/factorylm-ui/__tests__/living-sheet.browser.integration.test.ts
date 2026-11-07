/**
 * #5212 real-browser proof: a rejected offline Living Sheet note survives
 * navigation and reload. A real Chromium renders the real LivingSheet
 * component (bundled from src/factorylm-ui/LivingSheet.tsx) and talks to a
 * small deterministic fake of the sheet API. The fake only lists two jobs,
 * serves their views, and rejects the replayed note with the exact 409
 * `job_finished` body the events route returns.
 *
 * Opt-in (needs a browser, no database):
 *   MIRA_BROWSER_PROOF=1 npx vitest run --config vitest.integration.config.ts src/factorylm-ui/__tests__/living-sheet.browser.integration.test.ts
 * Screenshots land in MIRA_PROOF_SHOTS (default: docs/promo-screenshots).
 */
import { readFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { SheetView } from "@/capabilities/living-sheet/reduce";

const RUN = process.env.MIRA_BROWSER_PROOF === "1";
const HUB = path.resolve(__dirname, "../../..");
const SHOTS = process.env.MIRA_PROOF_SHOTS ?? path.resolve(HUB, "../docs/promo-screenshots");
const MOBILE = { width: 412, height: 915 };
const DESKTOP = { width: 1440, height: 900 };
const REJECT_MESSAGE = "This job is finished. Start a new job to record more.";

const NB = uuid();
const JOB_A = uuid();
const JOB_B = uuid();
const NOTE = `rejected-note-${uuid().slice(0, 8)}`;
const REJECT_RE = new RegExp(`/sheets/${JOB_A}/events/$`);

let server: http.Server;
let base = "";
let bundle = "";
let unexpectedEvents = 0;

function viewFor(jobId: string, title: string): SheetView {
  return {
    jobId,
    seq: 1,
    title,
    machine: { entityId: "e-pump-07", name: "Pump-07" },
    templateRevisionId: null,
    templateStatus: null,
    template: {
      title, machineLabel: null, component: null, jobType: null, estHours: null,
      crewSize: null, isolationPoints: null, cautions: null, returnToService: [], items: [],
      torques: [], steps: [], author: null, notes: null,
    },
    steps: [], readings: [], parts: [], notes: [], questions: [], photos: [],
    handover: { current: null, history: [] },
    finished: null,
    openSteps: 0,
    openQuestions: 0,
    warnings: [],
  };
}

const JOBS = [
  { jobId: JOB_A, title: "Seal replacement A", startedAt: "2026-11-07T14:00:00.000Z", startedBy: "tech-a", finished: false, seq: 1 },
  { jobId: JOB_B, title: "Belt check B", startedAt: "2026-11-07T15:00:00.000Z", startedBy: "tech-a", finished: false, seq: 1 },
];

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/** Deterministic fake of the sheet API. Only the reads the page makes on open. */
function dispatch(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", base);
  const p = url.pathname;
  if (p === "/") {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/tokens.css"><style>body{margin:0;font-family:var(--fl-font);background:var(--fl-bg,#f6f7f9)}</style>
      </head><body><div style="position:relative;min-height:100vh"><div id="root"></div></div>
      <script src="/bundle.js"></script></body></html>`);
    return;
  }
  if (p === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); return; }
  if (p === "/tokens.css") {
    res.setHeader("content-type", "text/css");
    res.end(readFileSync(path.resolve(HUB, "../docs/design/factorylm-tokens.css")));
    return;
  }
  const listRe = new RegExp(`^/hub/api/equipment-notebooks/${NB}/sheets/$`);
  const jobRe = new RegExp(`^/hub/api/equipment-notebooks/${NB}/sheets/([^/]+)/$`);
  if (listRe.test(p) && req.method === "GET") { sendJson(res, 200, { jobs: JOBS }); return; }
  const jm = p.match(jobRe);
  if (jm && req.method === "GET") {
    const job = JOBS.find((j) => j.jobId === jm[1]);
    if (!job) { sendJson(res, 404, { error: "job_not_found" }); return; }
    sendJson(res, 200, { view: viewFor(job.jobId, job.title), seq: 1 });
    return;
  }
  if (/\/events\/$/.test(p)) unexpectedEvents += 1; // only the held replay may post; the page route answers it
  sendJson(res, 404, { error: "not_found" });
}

/** Rejected entries stored for job A (sum over every key ending in JOB_A). */
async function rejectedCount(page: Page): Promise<number> {
  return page.evaluate((jobId) => {
    let n = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("flm.sheetrej.v1.") && k.endsWith(jobId)) {
        const list = JSON.parse(window.localStorage.getItem(k) ?? "[]") as unknown[];
        n += list.length;
      }
    }
    return n;
  }, JOB_A);
}

/** Queued (not yet sent) entries for job A. */
async function queuedCount(page: Page): Promise<number> {
  return page.evaluate((jobId) => {
    let n = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("flm.sheetq") && k.endsWith(jobId)) {
        const list = JSON.parse(window.localStorage.getItem(k) ?? "[]") as unknown[];
        n += list.length;
      }
    }
    return n;
  }, JOB_A);
}

/** Poll a reader until it matches, then assert with a labelled message. */
async function eventually<T>(label: string, read: () => Promise<T>, want: T): Promise<void> {
  let last = await read();
  for (let i = 0; i < 150 && !Object.is(last, want); i++) {
    await new Promise((r) => setTimeout(r, 100));
    last = await read();
  }
  expect(last, label).toBe(want);
}

async function openJob(page: Page, jobId: string): Promise<void> {
  // The layer stays open across back-to-jobs; only the closed layer needs the pill.
  if (!(await page.getByTestId("living-sheet-job-list").isVisible())) {
    await page.getByTestId("living-sheet-pill").click();
  }
  await page.getByTestId(`living-sheet-job-${jobId}`).waitFor();
  await page.getByTestId(`living-sheet-job-${jobId}`).click();
  await page.getByTestId("living-sheet-sheet").waitFor();
}

async function backToJobs(page: Page): Promise<void> {
  await page.getByTestId("living-sheet-back-to-jobs").click();
  await page.getByTestId("living-sheet-job-list").waitFor();
}

async function shotBoth(page: Page, stem: string): Promise<void> {
  await page.setViewportSize(MOBILE);
  await page.getByTestId("living-sheet-not-accepted").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `2026-11-07_living-sheet-${stem}_mobile.png`), fullPage: true });
  await page.setViewportSize(DESKTOP);
  await page.getByTestId("living-sheet-not-accepted").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `2026-11-07_living-sheet-${stem}_desktop.png`), fullPage: true });
  await page.setViewportSize(MOBILE);
}

describe.skipIf(!RUN)("#5212 Living Sheet rejected note browser proof (real component, real Chromium)", () => {
  beforeAll(async () => {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: {
        contents: `import { createElement } from "react"; import { createRoot } from "react-dom/client";
          import { LivingSheet } from "@/factorylm-ui/LivingSheet";
          createRoot(document.getElementById("root")).render(
            createElement(LivingSheet, { notebookId: ${JSON.stringify(NB)}, onSheetOpenChange: () => {} }));`,
        resolveDir: HUB, loader: "tsx",
      },
      bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
      alias: { "@": path.join(HUB, "src") },
      define: { "process.env.NEXT_PUBLIC_API_BASE": '"/hub"', "process.env.NODE_ENV": '"production"' },
      banner: { js: `var process = { env: { NEXT_PUBLIC_API_BASE: "/hub", NODE_ENV: "production" } };` },
      logLevel: "silent",
    });
    bundle = built.outputFiles[0]!.text;

    server = http.createServer((req, res) => {
      try { dispatch(req, res); } catch (err) { res.statusCode = 500; res.end(String(err)); }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    mkdirSync(SHOTS, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  it("a rejected offline note stays under Not accepted across job switch, reload, Recover and Dismiss", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: MOBILE, timezoneId: "America/New_York" });
      const page = await ctx.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await page.goto(base);
      await page.getByTestId("living-sheet-pill").waitFor({ timeout: 15_000 });

      // a. open job A online, go offline, queue a note.
      await openJob(page, JOB_A);
      await ctx.setOffline(true);
      await page.getByLabel("Note", { exact: true }).fill(NOTE);
      await page.getByRole("button", { name: "Add note" }).click();
      await eventually("a: badge shows the note waiting", () => page.getByTestId("living-sheet-badge").innerText(), "Offline – 1 waiting");
      expect(await queuedCount(page), "a: exactly one queued entry for A before reconnect").toBe(1);

      // b. reconnect; hold the replayed POST; switch to B; release with job_finished.
      let heldHit = (): void => {};
      const held = new Promise<void>((r) => (heldHit = r));
      let release = (): void => {};
      const released = new Promise<void>((r) => (release = r));
      let replays = 0;
      await page.route(REJECT_RE, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        replays += 1;
        const body = route.request().postDataJSON() as { kind?: string; payload?: { text?: string } };
        expect(body.kind, "b: the held POST is the queued note").toBe("note_added");
        expect(body.payload?.text, "b: the held POST carries the unique text").toBe(NOTE);
        heldHit();
        await released;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "job_finished", message: REJECT_MESSAGE, seq: 1, view: viewFor(JOB_A, "Seal replacement A") }),
        });
      });
      await ctx.setOffline(false);
      await held;
      expect(replays, "b: exactly one replay is in flight").toBe(1);

      await backToJobs(page);
      await openJob(page, JOB_B);
      expect(await page.getByText("Belt check B").count(), "b: job B title rendered").toBeGreaterThan(0);

      // c. release the rejection; job B must show no Not accepted section.
      release();
      await eventually("c: rejection persisted under A's key", () => rejectedCount(page), 1);
      await eventually("c: A's queue drained", () => queuedCount(page), 0);
      await page.waitForTimeout(500);
      expect(await page.getByTestId("living-sheet-not-accepted").count(), "c: job B shows no Not accepted section").toBe(0);
      expect(await page.getByTestId("living-sheet-last-rejection").count(), "c: job B shows no last-rejection line").toBe(0);

      // d. reopen A: the original text and the rejection are both shown.
      await backToJobs(page);
      await openJob(page, JOB_A);
      const section = page.getByTestId("living-sheet-not-accepted");
      await section.waitFor();
      expect(await section.innerText(), "d: Not accepted shows the unique note text").toContain(NOTE);
      expect(await section.innerText(), "d: Not accepted shows the rejection message").toContain(REJECT_MESSAGE);
      await shotBoth(page, "not-accepted-reopened");

      // e. reload, reopen A: still shown.
      await page.reload();
      await openJob(page, JOB_A);
      await page.getByTestId("living-sheet-not-accepted").waitFor();
      expect(await page.getByTestId("living-sheet-not-accepted").innerText(), "e: after reload still shows the note").toContain(NOTE);
      expect(await page.getByTestId("living-sheet-not-accepted").innerText(), "e: after reload still shows the message").toContain(REJECT_MESSAGE);
      await shotBoth(page, "not-accepted-after-reload");

      // f. Recover puts the text into the note field; the row stays.
      await page.getByTestId("living-sheet-not-accepted").getByRole("button", { name: "Recover" }).click();
      expect(await page.getByLabel("Note", { exact: true }).inputValue(), "f: Recover fills the note field").toBe(NOTE);
      expect(await page.getByTestId("living-sheet-not-accepted").innerText(), "f: row stays after Recover").toContain(NOTE);

      // g. Dismiss removes the row; after reload it is gone.
      await page.getByTestId("living-sheet-not-accepted").getByRole("button", { name: "Dismiss" }).click();
      await eventually("g: row removed on screen", () => page.getByTestId("living-sheet-not-accepted").count(), 0);
      await eventually("g: stored record removed", () => rejectedCount(page), 0);
      await page.reload();
      await openJob(page, JOB_A);
      await page.getByTestId("living-sheet-sheet").waitFor();
      expect(await page.getByTestId("living-sheet-not-accepted").count(), "g: gone after reload").toBe(0);

      expect(pageErrors, "no page errors").toEqual([]);
      expect(unexpectedEvents, "no unexpected events POST reached the fake server").toBe(0);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 180_000);
});

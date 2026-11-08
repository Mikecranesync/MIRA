/**
 * #5212 real-browser proof: a rejected offline Living Sheet note survives
 * navigation and reload. A real Chromium renders the real LivingSheet
 * component (bundled from src/factorylm-ui/LivingSheet.tsx) and talks to a
 * small deterministic fake of the sheet API. The fake only lists two jobs,
 * serves their views, and rejects the replayed note with the exact 409
 * `job_finished` body the events route returns. #5282 adds an opt-in unbound
 * notebook with the existing namespace tree, asset binding and notebook-read contracts.
 *
 * Opt-in (needs a browser, no database):
 *   MIRA_BROWSER_PROOF=1 npx vitest run --config vitest.integration.config.ts src/factorylm-ui/__tests__/living-sheet.browser.integration.test.ts
 * Screenshots land in MIRA_PROOF_SHOTS (default: docs/promo-screenshots).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { SheetView } from "@/capabilities/living-sheet/reduce";
import type { EquipmentNotebook, NotebookAssetBinding } from "@/lib/equipment-notebooks";
import type { NamespaceNode } from "@/app/api/namespace/tree/route";

const RUN = process.env.MIRA_BROWSER_PROOF === "1";
const HUB = path.resolve(__dirname, "../../..");
const SHOTS = process.env.MIRA_PROOF_SHOTS ?? path.resolve(HUB, "../docs/promo-screenshots");
const MOBILE = { width: 412, height: 915 };
const DESKTOP = { width: 1440, height: 900 };
const REJECT_MESSAGE = "This job is finished. Start a new job to record more.";

const NB = uuid();
const UNBOUND_NB = uuid();
const UNBOUND_MESSAGE = "This notebook is not bound to a machine.";
const CREATED_JOB = uuid();
const MACHINE_ID = uuid();
const OTHER_MACHINE_ID = uuid();
const KG_MACHINE_NODE_ID = uuid();
const KG_MACHINE_ENTITY_ID = "conveyor_1";
const KG_MACHINE_NODE: NamespaceNode = {
  id: KG_MACHINE_NODE_ID, name: "Conveyor1", kind: "equipment",
  unsPath: "enterprise.home_garage.conveyor_lab.conveyor_1", filesCount: 0, status: null,
  counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 }, children: [],
};
const KG_ONLY_TREE: NamespaceNode[] = [{
  id: uuid(), name: "Conveyor lab", kind: "area", unsPath: "enterprise.home_garage.conveyor_lab",
  filesCount: 0, status: null, counts: { children: 1, proposalsPending: 0, proposalsVerified: 0 },
  children: [KG_MACHINE_NODE],
}];
const MACHINE = { id: MACHINE_ID, unsPath: "enterprise.garage.line1.cv101", tag: "CV-101", name: "CV-101 Garage conveyor", manufacturer: "FactoryLM", model: "Bench conveyor", location: "Garage" };
const ASSET_ROWS = [
  MACHINE,
  { id: uuid(), tag: "UNPLACED-01", name: "Unplaced machine", unsPath: null },
  { id: 42, tag: "MALFORMED-01", name: "Malformed machine", unsPath: "factorylm.garage.bad" },
];
const NAMESPACE_NODES = [{
  id: uuid(), name: "Garage", kind: "area", unsPath: "enterprise.garage.line1",
  filesCount: 0, status: null, counts: { children: 2, proposalsPending: 0, proposalsVerified: 0 },
  children: [
    { id: MACHINE_ID, name: MACHINE.name, kind: "equipment", unsPath: MACHINE.unsPath,
      filesCount: 0, status: null, counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 }, children: [] },
    { id: 42, name: "MALFORMED-01", kind: "equipment", unsPath: "enterprise.garage.line1.bad",
      filesCount: 0, status: null, counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 }, children: [] },
  ],
}, {
  id: uuid(), name: "UNPLACED-01", kind: "asset", unsPath: null,
  filesCount: 0, status: null, counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 }, children: [],
}];
type BindingFailure = { status: number; code: string; message: string };
type Readback = "confirmed" | "empty" | "mismatched" | "unconfirmed" | "invalid-stamp";
let bindingFixture: {
  asset: NotebookAssetBinding | null;
  failure: BindingFailure | null;
  readback: Readback;
  startConflict: boolean;
  assetRows: unknown[];
  namespaceBody: unknown;
  selectedBinding: NotebookAssetBinding;
  starts: Record<string, unknown>[];
  puts: Record<string, unknown>[];
  jobs: typeof JOBS;
  readsAfterPut: number;
  unexpectedWrites: string[];
};

function confirmedMachine(): NotebookAssetBinding {
  return { entityId: MACHINE_ID, name: MACHINE.name, assetTag: MACHINE.tag, selectedVia: "asset_picker", confirmedBy: "tech-fixture", confirmedAt: "2026-11-08T00:00:00.000Z" };
}

function resetBindingFixture(options: { bound?: boolean; failure?: BindingFailure; readback?: Readback; startConflict?: boolean; assetRows?: unknown[]; namespaceBody?: unknown; selectedBinding?: NotebookAssetBinding } = {}): void {
  bindingFixture = {
    asset: options.bound ? confirmedMachine() : null,
    failure: options.failure ?? null,
    readback: options.readback ?? "confirmed",
    startConflict: options.startConflict ?? false,
    assetRows: options.assetRows ?? ASSET_ROWS,
    namespaceBody: options.namespaceBody ?? { nodes: NAMESPACE_NODES, total: 4 },
    selectedBinding: options.selectedBinding ?? confirmedMachine(),
    starts: [], puts: [], jobs: [], readsAfterPut: 0, unexpectedWrites: [],
  };
}

function bindingNotebook(asset = bindingFixture.asset): EquipmentNotebook {
  return {
    id: UNBOUND_NB, displayName: "CV-101 maintenance", manufacturer: null, model: null,
    catalogNumber: null, serialNumber: null, equipmentType: null, assetTag: null,
    locationLabel: null, identityStatus: "unknown", identityConfidence: null,
    identitySourceType: null, nodeId: "notebook-cv101", sourceCount: 0,
    lastOpenedAt: null, createdAt: "2026-11-07T23:00:00.000Z", asset,
  };
}
const JOB_A = uuid();
const JOB_B = uuid();
const NOTE = `rejected-note-${uuid().slice(0, 8)}`;
const NOTE_B = "Belt tension checked on B while A replays";
const REJECT_RE = new RegExp(`/sheets/${JOB_A}/events/$`);

let server: http.Server;
let base = "";
const bundles = new Map<string, string>();
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

/** Deterministic local sheet and binding API; no remote database. */
function dispatch(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", base);
  const p = url.pathname;
  if (p === "/") {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/tokens.css"><style>body{margin:0;font-family:var(--fl-font);background:var(--fl-bg,#f6f7f9)}</style>
      </head><body><div style="position:relative;min-height:100vh"><div id="root"></div></div>
      <script src="/bundle.js?uiBasePath=${encodeURIComponent(url.searchParams.get("uiBasePath") ?? "/hub")}"></script></body></html>`);
    return;
  }
  if (p === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundles.get(url.searchParams.get("uiBasePath") ?? "/hub")); return; }
  if (p === "/tokens.css") {
    res.setHeader("content-type", "text/css");
    res.end(readFileSync(path.resolve(HUB, "../docs/design/factorylm-tokens.css")));
    return;
  }
  // #5282 opt-in notebook: the existing #5212 notebook/API remains unchanged.
  if (/^\/hub\/api\/assets\/?$/.test(p) && req.method === "GET") {
    sendJson(res, 200, bindingFixture.assetRows); return;
  }
  if (/^\/hub\/api\/namespace\/tree\/?$/.test(p) && req.method === "GET") {
    sendJson(res, 200, bindingFixture.namespaceBody); return;
  }
  const bindingRoot = `/hub/api/equipment-notebooks/${UNBOUND_NB}`;
  if ((p === bindingRoot || p === `${bindingRoot}/`) && req.method === "GET") {
    if (bindingFixture.puts.length) bindingFixture.readsAfterPut += 1;
    sendJson(res, 200, { notebook: bindingNotebook(), sources: [], turns: [], threads: [], photos: [], manualSearch: null });
    return;
  }
  if (p === `${bindingRoot}/asset/` && req.method === "PUT") {
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bindingFixture.puts.push(body);
      const failure = bindingFixture.failure;
      if (failure) {
        sendJson(res, failure.status, { error: failure.message, code: failure.code, ...(failure.code === "asset_already_bound" ? { boundNotebookId: NB } : {}) });
        return;
      }
      const acknowledged = bindingFixture.selectedBinding;
      // A 200 write response is not proof of the persisted machine. The GET
      // reflects the authoritative state, including the deliberately bad cases.
      bindingFixture.asset = bindingFixture.readback === "empty" ? null
        : bindingFixture.readback === "mismatched" ? { ...acknowledged, entityId: OTHER_MACHINE_ID }
        : bindingFixture.readback === "unconfirmed" ? { ...acknowledged, confirmedAt: null, confirmedBy: null }
        : bindingFixture.readback === "invalid-stamp" ? { ...acknowledged, confirmedAt: "not-a-timestamp" }
        : acknowledged;
      sendJson(res, 200, { ok: true, notebook: bindingNotebook(acknowledged) });
    });
    return;
  }
  if (p === `${bindingRoot}/sheets/`) {
    if (req.method === "GET") { sendJson(res, 200, { jobs: bindingFixture.jobs }); return; }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += String(chunk); });
      req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        bindingFixture.starts.push(body);
        if (bindingFixture.startConflict) {
          sendJson(res, 409, { error: "request_id_conflict", message: "That request id was already used for a different job." });
          return;
        }
        if (!bindingFixture.asset?.confirmedAt) {
          sendJson(res, 409, { error: "asset_not_bound", message: UNBOUND_MESSAGE }); return;
        }
        const title = String(body.title);
        bindingFixture.jobs.push({ jobId: CREATED_JOB, title, startedAt: String(body.occurredAt), startedBy: "tech-fixture", finished: false, seq: 1 });
        sendJson(res, 201, { jobId: CREATED_JOB, seq: 1, view: { ...viewFor(CREATED_JOB, title), machine: { entityId: bindingFixture.asset?.entityId ?? MACHINE_ID, name: bindingFixture.asset?.name ?? MACHINE.name } } });
      });
      return;
    }
  }
  if (p === `${bindingRoot}/sheets/${CREATED_JOB}/` && req.method === "GET") {
    const job = bindingFixture.jobs.find((j) => j.jobId === CREATED_JOB);
    if (job) { sendJson(res, 200, { view: { ...viewFor(job.jobId, job.title), machine: { entityId: bindingFixture.asset?.entityId ?? MACHINE_ID, name: bindingFixture.asset?.name ?? MACHINE.name } }, seq: 1 }); return; }
  }
  if (bindingFixture && req.method !== "GET" && !p.includes(`/equipment-notebooks/${NB}/`)) {
    bindingFixture.unexpectedWrites.push(`${req.method} ${p}`);
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
    // UI routing and API routing are independent: test both UI prefixes with /hub APIs.
    for (const uiBasePath of ["/hub", ""]) {
      const built = await build({
        stdin: {
          contents: `import { createElement } from "react"; import { createRoot } from "react-dom/client";
            import { LivingSheet } from "@/factorylm-ui/LivingSheet";
            createRoot(document.getElementById("root")).render(
              createElement(LivingSheet, { notebookId: new URLSearchParams(location.search).get("notebook") ?? ${JSON.stringify(NB)}, onSheetOpenChange: () => {} }));`,
          resolveDir: HUB, loader: "tsx",
        },
        bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
        alias: { "@": path.join(HUB, "src") },
        define: { "process.env.NEXT_PUBLIC_API_BASE": '"/hub"', "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(uiBasePath), "process.env.NODE_ENV": '"production"' },
        banner: { js: `var process = { env: { NEXT_PUBLIC_API_BASE: "/hub", NEXT_PUBLIC_BASE_PATH: ${JSON.stringify(uiBasePath)}, NODE_ENV: "production" } };` },
        logLevel: "silent",
      });
      bundles.set(uiBasePath, built.outputFiles[0]!.text);
    }

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

  it("#5282 offers existing-machine recovery after asset_not_bound and preserves the job title", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture();
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      await page.getByTestId("living-sheet-job-list").waitFor();
      expect(bindingFixture.starts.length, "opening an unbound notebook never starts a job").toBe(0);
      const title = "CV-101 belt alignment inspection";
      await page.getByTestId("living-sheet-new-title").fill(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      expect(bindingFixture.starts.length, "one deliberate Start reaches the real component's API call").toBe(1);
      expect(await page.getByTestId("living-sheet-new-title").inputValue(), "the rejected attempt retains the title").toBe(title);
      await page.screenshot({ path: path.join(SHOTS, "5282-unbound-job-recovery-mobile.png"), fullPage: true });
      expect(await page.getByRole("button", { name: "Choose an existing machine", exact: true }).count(), "asset_not_bound offers technician-visible machine-binding recovery").toBe(1);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("#5282 canonical: offers a KG-only namespace machine and preserves its server canonical binding key", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture({
      namespaceBody: { nodes: KG_ONLY_TREE, total: 2 },
      selectedBinding: { ...confirmedMachine(), entityId: KG_MACHINE_ENTITY_ID, name: KG_MACHINE_NODE.name, assetTag: null },
    });
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      expect(bindingFixture.assetRows.some((row) => (row as { id?: unknown }).id === KG_MACHINE_NODE_ID), "the canonical KG machine is absent from the CMMS assets list").toBe(false);
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      const title = "CV-101 canonical machine inspection";
      await page.getByTestId("living-sheet-new-title").fill(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Choose an existing machine", exact: true }).click();
      const machine = page.getByRole("combobox", { name: "Machine", exact: true });
      await machine.waitFor();
      const options = await machine.locator("option").evaluateAll((rows) => rows.map((row) => ({ value: (row as HTMLOptionElement).value, text: row.textContent })));
      await page.screenshot({ path: path.join(SHOTS, "5282-canonical-namespace-machine-mobile.png"), fullPage: true });
      expect(options.map((option) => option.value).filter(Boolean), "the canonical namespace machine must be selectable even without a CMMS asset row; areas are not machines").toEqual([KG_MACHINE_NODE_ID]);
      expect(options.some((option) => option.value === KG_MACHINE_NODE_ID && option.text?.includes("Conveyor1"))).toBe(true);
      expect(options.find((option) => option.value === KG_MACHINE_NODE_ID)?.text, "the namespace ancestor supplies visible location context").toMatch(/Conveyor lab|enterprise\.home_garage\.conveyor_lab/);
      await machine.selectOption(KG_MACHINE_NODE_ID);
      expect(bindingFixture.puts, "selection alone does not confirm the canonical machine").toHaveLength(0);
      await page.getByRole("button", { name: "Confirm this machine", exact: true }).click();
      await eventually("the saved canonical binding is read back", async () => bindingFixture.readsAfterPut > 0, true);
      await machine.waitFor({ state: "detached" });
      expect(bindingFixture.puts, "PUT addresses the selected KG node UUID, without client confirmation stamps").toEqual([{ assetRef: KG_MACHINE_NODE_ID, selectedVia: "asset_picker" }]);
      const persistedResponse = await page.request.get(`${base}/hub/api/equipment-notebooks/${UNBOUND_NB}/`);
      const persisted = await persistedResponse.json() as { notebook: EquipmentNotebook };
      expect(persisted.notebook.asset?.entityId, "the API resolves the UUID alias to the legacy canonical entity_id").toBe(KG_MACHINE_ENTITY_ID);
      expect(persisted.notebook.asset?.confirmedAt).toBeTruthy();
      expect(bindingFixture.starts, "confirmation does not automatically start the job").toHaveLength(1);
      expect(bindingFixture.jobs).toHaveLength(0);
      expect(await page.getByTestId("living-sheet-new-title").inputValue()).toBe(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByTestId("living-sheet-sheet").waitFor();
      expect(bindingFixture.starts).toHaveLength(2);
      expect(bindingFixture.starts[1], "a separate deliberate Start preserves the entire frozen attempt").toEqual(bindingFixture.starts[0]);
      expect(bindingFixture.jobs).toHaveLength(1);
      expect(bindingFixture.unexpectedWrites).toEqual([]);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("#5282 selecting and cancelling never binds; explicit confirmation persists before a deliberate job retry", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture();
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      await page.getByTestId("living-sheet-job-list").waitFor();
      expect(bindingFixture.starts).toHaveLength(0);
      expect(bindingFixture.puts).toHaveLength(0);
      const title = "CV-101 belt alignment inspection";
      await page.getByTestId("living-sheet-new-title").fill(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      const recovery = page.getByRole("button", { name: "Choose an existing machine", exact: true });
      await recovery.click();
      const machine = page.getByRole("combobox", { name: "Machine", exact: true });
      await machine.waitFor();
      await eventually("the existing assets endpoint supplies one eligible machine", () => machine.locator("option").evaluateAll((options) => JSON.stringify(options.map((o) => (o as HTMLOptionElement).value).filter(Boolean))), JSON.stringify([MACHINE_ID]));
      expect(await machine.innerText(), "an unplaced machine is not offerable").not.toContain("UNPLACED-01");
      expect(await machine.innerText(), "a malformed machine is not offerable").not.toContain("MALFORMED-01");
      expect(await machine.innerText(), "the canonical machine identity is visible").toContain("CV-101");
      await machine.selectOption(MACHINE_ID);
      expect(bindingFixture.puts, "selection alone sends no binding write").toHaveLength(0);
      expect(bindingFixture.starts, "selection alone starts no job").toHaveLength(1);

      const geometryMeasurements: Array<Record<string, unknown>> = [];
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, DESKTOP]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const layer = page.getByTestId("living-sheet-layer");
        const layout = await layer.evaluate((element) => ({
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          layerClientWidth: element.clientWidth,
          layerScrollWidth: element.scrollWidth,
          layerClientHeight: element.clientHeight,
          layerScrollHeight: element.scrollHeight,
        }));
        expect(layout.documentScrollWidth, `${viewport.width}x${viewport.height}: the document has no horizontal overflow`).toBeLessThanOrEqual(layout.documentClientWidth + 1);
        expect(layout.layerScrollWidth, `${viewport.width}x${viewport.height}: the recovery layer has no horizontal overflow`).toBeLessThanOrEqual(layout.layerClientWidth + 1);
        const controls: Array<Record<string, unknown>> = [];
        for (const [name, control] of [
          ["title", page.getByTestId("living-sheet-new-title")],
          ["machine", machine],
          ["confirm", page.getByRole("button", { name: "Confirm this machine", exact: true })],
          ["cancel", page.getByRole("button", { name: "Cancel", exact: true })],
          ["start", page.getByTestId("living-sheet-start")],
        ] as const) {
          await control.scrollIntoViewIfNeeded();
          const enabled = await control.isEnabled();
          if (enabled) await control.click({ trial: true });
          const measured = await control.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return {
              x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              right: rect.right, bottom: rect.bottom,
              centerHit: hit === element || element.contains(hit),
              layerScrollTop: element.closest('[data-testid="living-sheet-layer"]')?.scrollTop ?? null,
            };
          });
          const label = `${viewport.width}x${viewport.height}: ${name}`;
          expect(measured.x, `${label} is within the viewport left edge`).toBeGreaterThanOrEqual(-1);
          expect(measured.right, `${label} is within the viewport right edge`).toBeLessThanOrEqual(viewport.width + 1);
          expect(measured.y, `${label} is within the viewport top edge`).toBeGreaterThanOrEqual(-1);
          expect(measured.bottom, `${label} can scroll fully into the viewport`).toBeLessThanOrEqual(viewport.height + 1);
          expect(measured.height, `${label} retains a usable touch target`).toBeGreaterThanOrEqual(44);
          expect(measured.centerHit, `${label} receives pointer input`).toBe(true);
          controls.push({ name, enabled, ...measured });
          await page.screenshot({ path: path.join(SHOTS, `5282-binding-recovery-${viewport.width}x${viewport.height}-${name}.png`) });
        }
        expect(await page.getByTestId("living-sheet-new-title").inputValue(), "viewport changes preserve the title").toBe(title);
        expect(await machine.inputValue(), "viewport changes preserve the local selection").toBe(MACHINE_ID);
        expect(await page.getByTestId("living-sheet-start").isDisabled(), "Start remains guarded until persisted confirmation").toBe(true);
        expect(bindingFixture.puts, "geometry checks do not confirm the machine").toHaveLength(0);
        expect(bindingFixture.starts, "geometry checks do not start another job").toHaveLength(1);
        expect(bindingFixture.jobs).toHaveLength(0);
        geometryMeasurements.push({ viewport, ...layout, controls, titlePreserved: true, selectionPreserved: true, bindingWrites: bindingFixture.puts.length, startRequests: bindingFixture.starts.length, jobs: bindingFixture.jobs.length });
      }
      writeFileSync(path.join(SHOTS, "5282-binding-recovery-geometry.json"), JSON.stringify(geometryMeasurements, null, 2));
      await page.setViewportSize(MOBILE);

      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await machine.count(), "Cancel closes the picker").toBe(0);
      expect(bindingFixture.puts, "Cancel sends no binding write").toHaveLength(0);
      expect(bindingFixture.asset, "Cancel leaves the notebook unbound").toBeNull();
      expect(await page.getByTestId("living-sheet-new-title").inputValue()).toBe(title);

      await recovery.click();
      await machine.waitFor();
      await machine.selectOption(MACHINE_ID);
      await page.getByRole("button", { name: "Confirm this machine", exact: true }).click();
      await eventually("the component reads the persisted notebook after PUT", async () => bindingFixture.readsAfterPut > 0, true);
      await machine.waitFor({ state: "detached" });
      expect(bindingFixture.puts, "only an explicit confirmation writes the selected reference and method").toEqual([{ assetRef: MACHINE_ID, selectedVia: "asset_picker" }]);
      const persistedResponse = await page.request.get(`${base}/hub/api/equipment-notebooks/${UNBOUND_NB}/`);
      const persisted = await persistedResponse.json() as { notebook: EquipmentNotebook };
      expect(persisted.notebook.asset?.entityId, "a separate notebook read returns the selected machine").toBe(MACHINE_ID);
      expect(persisted.notebook.asset?.confirmedAt, "the server supplies the persisted confirmation").toBeTruthy();
      expect(bindingFixture.starts, "binding does not automatically retry the job").toHaveLength(1);
      expect(bindingFixture.jobs, "no job exists until the technician deliberately retries").toHaveLength(0);
      expect(await recovery.count(), "verified binding clears this recovery action").toBe(0);
      expect(await page.getByTestId("living-sheet-new-title").inputValue()).toBe(title);
      await page.screenshot({ path: path.join(SHOTS, "5282-binding-confirmed-before-retry-mobile.png"), fullPage: true });

      await page.getByTestId("living-sheet-start").click();
      await page.getByTestId("living-sheet-sheet").waitFor();
      expect(bindingFixture.starts).toHaveLength(2);
      expect(bindingFixture.jobs).toHaveLength(1);
      expect(bindingFixture.starts[1]?.title).toBe(title);
      expect(bindingFixture.starts[1], "409 preserves the entire frozen request, including id, occurredAt, title and template, for the deliberate retry").toEqual(bindingFixture.starts[0]);
      expect(bindingFixture.puts).toHaveLength(1);
      expect(bindingFixture.unexpectedWrites, "no asset creation or alternate write endpoint is used").toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, "5282-bound-job-started-mobile.png"), fullPage: true });
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it.each([
    { status: 422, code: "asset_not_verified", message: "That asset hasn't been approved yet, so it can't be used as a notebook's machine." },
    { status: 422, code: "asset_not_equipment", message: "That's a location, not a machine. Pick the equipment itself." },
    { status: 409, code: "asset_already_bound", message: "Another notebook is already using that machine." },
  ])("#5282 $code preserves the unconfirmed notebook and never retries the job", async (failure) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture({ failure });
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      const title = "CV-101 refused binding keeps this draft";
      await page.getByTestId("living-sheet-new-title").fill(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Choose an existing machine", exact: true }).click();
      const machine = page.getByRole("combobox", { name: "Machine", exact: true });
      await machine.selectOption(MACHINE_ID);
      await page.getByRole("button", { name: "Confirm this machine", exact: true }).click();
      await page.getByText(failure.message, { exact: true }).waitFor();
      expect(await machine.isVisible(), "a refused binding stays recoverable").toBe(true);
      expect(bindingFixture.puts).toEqual([{ assetRef: MACHINE_ID, selectedVia: "asset_picker" }]);
      expect(bindingFixture.asset).toBeNull();
      expect(bindingFixture.starts).toHaveLength(1);
      expect(bindingFixture.jobs).toHaveLength(0);
      expect(await page.getByTestId("living-sheet-new-title").inputValue()).toBe(title);
      expect(await page.getByText(UNBOUND_MESSAGE, { exact: true }).count(), "refusal never clears the original binding failure").toBe(1);
      expect(bindingFixture.unexpectedWrites).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `5282-${failure.code}-mobile.png`), fullPage: true });
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it.each(["/hub", ""] as const)("#5282 review: duplicate-binding recovery link preserves UI base path %j independently of API base", async (uiBasePath) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const failure = { status: 409, code: "asset_already_bound", message: "Another notebook is already using that machine." };
    resetBindingFixture({ failure });
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}&uiBasePath=${encodeURIComponent(uiBasePath)}`);
      await page.getByTestId("living-sheet-pill").click();
      await page.getByTestId("living-sheet-new-title").fill("CV-101 existing notebook recovery");
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Choose an existing machine", exact: true }).click();
      await page.getByRole("combobox", { name: "Machine", exact: true }).selectOption(MACHINE_ID);
      await page.getByRole("button", { name: "Confirm this machine", exact: true }).click();
      await page.getByText(failure.message, { exact: true }).waitFor();
      const existing = page.getByRole("link", { name: "Open this machine's existing notebook", exact: true });
      await existing.waitFor();
      await page.screenshot({ path: path.join(SHOTS, `5282-review-duplicate-binding-link-${uiBasePath ? "hub" : "root"}-mobile.png`), fullPage: true });
      expect(await existing.getAttribute("href"), "the recovery URL uses the UI base while API calls remain under /hub").toBe(`${uiBasePath}/v3/?notebook=${NB}`);
      expect(bindingFixture.jobs).toHaveLength(0);
      expect(bindingFixture.starts).toHaveLength(1);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it.each([
    { label: "malformed-only namespace nodes", body: { nodes: [{ id: 42, name: "Malformed machine", kind: "equipment", unsPath: "enterprise.garage.cv101", filesCount: 0, status: null, counts: { children: 0, proposalsPending: 0, proposalsVerified: 0 }, children: [] }], total: 1 } },
    { label: "missing namespace nodes", body: { total: 0 } },
  ])("#5282 review: $label is unreadable rather than an empty machine register", async ({ body }) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture({ namespaceBody: body });
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      await page.getByTestId("living-sheet-new-title").fill("CV-101 unreadable register recovery");
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      const treeResponse = page.waitForResponse((response) => response.url() === `${base}/hub/api/namespace/tree/`);
      await page.getByRole("button", { name: "Choose an existing machine", exact: true }).click();
      await (await treeResponse).finished();
      const chooser = page.getByRole("region", { name: "Confirm this notebook's machine", exact: true });
      await chooser.getByRole("status").waitFor({ state: "detached" });
      await page.screenshot({ path: path.join(SHOTS, `5282-review-${"nodes" in body ? "malformed-only" : "missing-nodes"}-register-mobile.png`), fullPage: true });
      expect.soft(await chooser.getByRole("alert").allTextContents(), "unreadable API 200 tree data is surfaced as a load failure").toEqual([expect.stringMatching(/load|unreadable|could not read/i)]);
      expect.soft(await chooser.getByRole("button", { name: "Try again", exact: true }).count(), "a data-load failure offers a retry").toBe(1);
      expect.soft(await chooser.getByText(/No machines with a registered location are available/).count(), "an unreadable response must not claim the machine register is empty").toBe(0);
      expect(bindingFixture.puts, "an unreadable list sends no confirmation write").toHaveLength(0);
      expect(bindingFixture.starts, "opening the unreadable list sends no further job request").toHaveLength(1);
      expect(bindingFixture.jobs, "the rejected initial attempt and unreadable list create no job").toHaveLength(0);
      expect(bindingFixture.asset).toBeNull();
      expect(bindingFixture.unexpectedWrites).toEqual([]);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it.each(["empty", "mismatched", "unconfirmed", "invalid-stamp"] as const)("#5282 a 200 PUT with %s persisted readback is not confirmation", async (readback) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture({ readback });
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      const title = "CV-101 binding must be read back";
      await page.getByTestId("living-sheet-new-title").fill(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByText(UNBOUND_MESSAGE, { exact: true }).waitFor();
      const recovery = page.getByRole("button", { name: "Choose an existing machine", exact: true });
      await recovery.click();
      const machine = page.getByRole("combobox", { name: "Machine", exact: true });
      await machine.selectOption(MACHINE_ID);
      const readResponse = page.waitForResponse((response) => response.url() === `${base}/hub/api/equipment-notebooks/${UNBOUND_NB}/` && bindingFixture.puts.length > 0);
      await page.getByRole("button", { name: "Confirm this machine", exact: true }).click();
      await (await readResponse).finished();
      const checkSaved = page.getByRole("button", { name: "Check saved selection", exact: true });
      await checkSaved.waitFor({ state: "visible" });
      await eventually("a failed persisted readback leaves an enabled read-only retry", () => checkSaved.isEnabled(), true);
      expect(bindingFixture.readsAfterPut).toBeGreaterThan(0);
      expect(bindingFixture.puts).toHaveLength(1);
      expect(await machine.isVisible(), "HTTP 200 alone does not dismiss the confirmation UI").toBe(true);
      expect(await machine.isDisabled(), "a saved selection cannot be changed while its readback is unresolved").toBe(true);
      expect(await page.getByTestId("living-sheet-start").isDisabled(), "unverified persisted confirmation cannot enable Start").toBe(true);
      expect(await page.getByText(UNBOUND_MESSAGE, { exact: true }).count()).toBe(1);
      const reads = bindingFixture.readsAfterPut;
      await checkSaved.click();
      await eventually("Check saved selection repeats the persisted GET", async () => bindingFixture.readsAfterPut > reads, true);
      await eventually("the readback retry completes", () => checkSaved.isEnabled(), true);
      expect(bindingFixture.puts, "readback retry does not write the binding again").toHaveLength(1);
      expect(await page.getByTestId("living-sheet-new-title").inputValue()).toBe(title);
      expect(bindingFixture.starts, "an invalid readback never starts a job").toHaveLength(1);
      expect(bindingFixture.jobs).toHaveLength(0);
      expect(bindingFixture.unexpectedWrites).toEqual([]);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("#5282 unrelated job 409 does not offer machine-binding recovery", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture({ bound: true, startConflict: true });
    try {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      const title = "CV-101 unrelated conflict";
      await page.getByTestId("living-sheet-new-title").fill(title);
      await page.getByTestId("living-sheet-start").click();
      await page.getByText("That request id was already used for a different job.", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Choose an existing machine", exact: true }).count()).toBe(0);
      expect(bindingFixture.puts).toHaveLength(0);
      expect(bindingFixture.starts).toHaveLength(1);
      expect(bindingFixture.jobs).toHaveLength(0);
      expect(await page.getByTestId("living-sheet-new-title").inputValue()).toBe(title);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("#5282 an already confirmed machine retains direct bound-job creation with zero automatic jobs", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    resetBindingFixture({ bound: true });
    try {
      const ctx = await browser.newContext({ viewport: DESKTOP });
      const page = await ctx.newPage();
      await page.goto(`${base}/?notebook=${UNBOUND_NB}`);
      await page.getByTestId("living-sheet-pill").click();
      await page.getByTestId("living-sheet-job-list").waitFor();
      expect(bindingFixture.starts).toHaveLength(0);
      expect(bindingFixture.jobs).toHaveLength(0);
      expect(await page.getByRole("button", { name: "Choose an existing machine", exact: true }).count()).toBe(0);
      await page.getByTestId("living-sheet-new-title").fill("CV-101 bound maintenance");
      await page.getByTestId("living-sheet-start").click();
      await page.getByTestId("living-sheet-sheet").waitFor();
      expect(bindingFixture.starts).toHaveLength(1);
      expect(bindingFixture.jobs).toHaveLength(1);
      expect(bindingFixture.puts).toHaveLength(0);
      expect(bindingFixture.unexpectedWrites).toEqual([]);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

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

      await page.waitForTimeout(500);
      expect(await page.getByTestId("living-sheet-badge").innerText(), "b: job B does not inherit A's Saving…").not.toBe("Saving…");

      // b2. Codex #5276 F2: a note on B while A's replay holds the device-wide
      // drain. B's own replay cannot start, so B must not show "Saving…".
      await page.getByLabel("Note", { exact: true }).fill(NOTE_B);
      await page.getByRole("button", { name: "Add note" }).click();
      await eventually(
        "b2: B's note is queued on the phone",
        () => page.evaluate((jobId) => {
          let n = 0;
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("flm.sheetq") && k.endsWith(jobId)) n += (JSON.parse(window.localStorage.getItem(k) ?? "[]") as unknown[]).length;
          }
          return n;
        }, JOB_B),
        1,
      );
      await page.waitForTimeout(500);
      expect(await page.getByTestId("living-sheet-badge").innerText(), "b2: job B is not stuck on Saving… behind A's replay").not.toBe("Saving…");

      // c. release the rejection; job B must show no Not accepted section.
      release();
      await eventually("c: rejection persisted under A's key", () => rejectedCount(page), 1);
      await eventually("c: A's queue drained", () => queuedCount(page), 0);
      await page.waitForTimeout(500);
      expect(await page.getByTestId("living-sheet-not-accepted").count(), "c: job B shows no Not accepted section").toBe(0);
      expect(await page.getByTestId("living-sheet-last-rejection").count(), "c: job B shows no last-rejection line").toBe(0);
      // Codex #5276 F2: A's replay ending off screen must not leave B on "Saving…".
      expect(await page.getByText("Saving…").count(), "c: job B is not stuck on Saving…").toBe(0);

      // d. reopen A: the original text and the rejection are both shown.
      await backToJobs(page);
      await openJob(page, JOB_A);
      const section = page.getByTestId("living-sheet-not-accepted");
      await section.waitFor();
      expect(await section.innerText(), "d: Not accepted shows the unique note text").toContain(NOTE);
      expect(await section.innerText(), "d: Not accepted shows the rejection message").toContain(REJECT_MESSAGE);
      await page.waitForTimeout(500);
      expect(await page.getByText("Saving…").count(), "d: reopened A is not stuck on Saving…").toBe(0);
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

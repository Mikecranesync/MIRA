/**
 * Mission 001 customer-facing proof: a real Chromium renders the real Machine
 * state panel (src/factorylm-ui/MachineObservations.tsx) and talks to the real
 * observation route handlers, which run the real store and projection against
 * a disposable Postgres. Only the session is stubbed (who is signed in).
 *
 * Opt-in (needs a browser and a disposable DB), so CI's integration jobs skip it:
 *   MIRA_BROWSER_PROOF=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/m001 \
 *     npx vitest run --config vitest.integration.config.ts src/capabilities/observations/__tests__/observations.browser.integration.test.ts
 * Screenshots land in MIRA_PROOF_SHOTS (default: docs/promo-screenshots).
 */
import { readFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const RUN = process.env.MIRA_BROWSER_PROOF === "1" && !!process.env.TEST_DATABASE_URL;

const { testPool, who } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool,
    who: { tenantId: "", userId: "" },
  };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: who.tenantId, userId: who.userId })),
}));

import { NextRequest } from "next/server";
import { GET as readState, POST as recordObservation } from "@/app/api/equipment-notebooks/[id]/observations/route";
import { POST as previewRoute } from "@/app/api/equipment-notebooks/[id]/observations/preview/route";
import { loadObservedStateForTurn } from "../turn-context";

const HUB = path.resolve(__dirname, "../../../..");
const MIGRATION = path.join(HUB, "db/proposed/113_asset_observations.sql");
const SHOTS = process.env.MIRA_PROOF_SHOTS ?? path.resolve(HUB, "../docs/promo-screenshots");
const TENANT = uuid();
const OTHER_TENANT = uuid();
const PUMP_07 = `pump-07-${uuid().slice(0, 8)}`;
const PUMP_08 = `pump-08-${uuid().slice(0, 8)}`;
let notebookId = "";
let server: http.Server;
let base = "";
let bundle = "";
let strictBundle = "";

async function seedAsset(tenantId: string, entityId: string, name: string, uns: string): Promise<void> {
  await testPool.query(
    `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, approval_state, uns_path)
     VALUES ($1::uuid, 'equipment', $2, $3, 'verified', $4::ltree)`,
    [tenantId, entityId, name, uns],
  );
}

async function seedNotebook(tenantId: string, entityId: string): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, equipment_entity_id, asset_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'Pump-07', $3, now()) RETURNING id::text AS id`,
    [tenantId, uuid(), entityId],
  );
  return res.rows[0]!.id;
}

async function dbCounts(): Promise<{ obs: number; events: number }> {
  const o = await testPool.query<{ n: string }>(`SELECT count(*)::text AS n FROM asset_observations WHERE tenant_id = $1::uuid`, [TENANT]);
  const e = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM notebook_domain_events WHERE tenant_id = $1::uuid AND event_type = 'observation_recorded'`,
    [TENANT],
  );
  return { obs: Number(o.rows[0]!.n), events: Number(e.rows[0]!.n) };
}

/** Route the panel's /hub/api/... calls to the real handlers. */
async function dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/tokens.css"><style>body{margin:0;font-family:var(--fl-font);background:var(--fl-bg,#f6f7f9)}</style>
      </head><body><div style="position:relative;min-height:100vh"><div id="root"></div></div>
      <script>window.__NB__=${JSON.stringify(notebookId)}</script><script src="${url.searchParams.get("strict") ? "/strict.js" : "/bundle.js"}"></script></body></html>`);
    return;
  }
  if (url.pathname === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); return; }
  if (url.pathname === "/strict.js") { res.setHeader("content-type", "text/javascript"); res.end(strictBundle); return; }
  if (url.pathname === "/tokens.css") {
    res.setHeader("content-type", "text/css");
    res.end(readFileSync(path.resolve(HUB, "../docs/design/factorylm-tokens.css")));
    return;
  }
  const m = url.pathname.match(/^\/hub\/api\/equipment-notebooks\/([^/]+)\/observations\/(preview\/)?$/);
  if (!m) { res.statusCode = 404; res.end(); return; }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const nreq = new NextRequest(url.toString(), {
    method: req.method,
    headers: { "content-type": "application/json" },
    body: req.method === "GET" ? undefined : Buffer.concat(chunks).toString("utf8"),
  });
  const params = { params: Promise.resolve({ id: m[1]! }) };
  const out = m[2] ? await previewRoute(nreq, params) : req.method === "GET" ? await readState(nreq, params) : await recordObservation(nreq, params);
  res.statusCode = out.status;
  res.setHeader("content-type", "application/json");
  res.end(await out.text());
}

describe.skipIf(!RUN)("Mission 001 browser proof (real panel, real routes, real Postgres)", () => {
  beforeAll(async () => {
    process.env.MIRA_OBSERVATION_STATE = "1";
    const sql = readFileSync(MIGRATION, "utf8");
    await testPool.query(sql);
    await seedAsset(TENANT, PUMP_07, "Pump-07", "enterprise.lake_wales.utilities.pump_07");
    await seedAsset(TENANT, PUMP_08, "Pump-08", "enterprise.lake_wales.utilities.pump_08");
    await seedAsset(OTHER_TENANT, PUMP_07, "Pump-07", "enterprise.other_plant.utilities.pump_07");
    notebookId = await seedNotebook(TENANT, PUMP_07);
    await seedNotebook(TENANT, PUMP_08);

    const { build } = await import("esbuild");
    // strict: a development React build under <StrictMode>, which replays effects
    // (setup, cleanup, setup) the way `next dev` does (#5091 Codex r2 F3).
    const bundleFor = async (strict: boolean) => {
      const env = strict ? "development" : "production";
      const el = strict
        ? `createElement(StrictMode, null, createElement(MachineObservations, { notebookId: window.__NB__ }))`
        : `createElement(MachineObservations, { notebookId: window.__NB__ })`;
      const built = await build({
        stdin: {
          contents: `import { createElement, StrictMode } from "react"; import { createRoot } from "react-dom/client";
            import { MachineObservations } from "@/factorylm-ui/MachineObservations";
            createRoot(document.getElementById("root")).render(${el});`,
          resolveDir: HUB, loader: "tsx",
        },
        bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
        alias: { "@": path.join(HUB, "src") },
        define: { "process.env.NEXT_PUBLIC_API_BASE": '"/hub"', "process.env.NODE_ENV": `"${env}"` },
        // Next defines process.env for client code; a plain page needs the same shape.
        banner: { js: `var process = { env: { NEXT_PUBLIC_API_BASE: "/hub", NODE_ENV: "${env}" } };` },
        logLevel: "silent",
      });
      return built.outputFiles[0]!.text;
    };
    bundle = await bundleFor(false);
    strictBundle = await bundleFor(true);

    server = http.createServer((req, res) => {
      dispatch(req, res).catch((err) => { res.statusCode = 500; res.end(String(err)); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
    mkdirSync(SHOTS, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    await testPool.end();
  });

  it("technician A previews, confirms through a lost reply, and B reads the state and gets it in the next answer", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const shot = (page: import("playwright").Page, name: string) =>
      page.screenshot({ path: path.join(SHOTS, `2026-11-01_machine-state-${name}_mobile.png`), fullPage: true });
    try {
      // --- Technician A on Pump-07 --------------------------------------------------
      who.tenantId = TENANT;
      who.userId = "tech-a";
      const ctxA = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "America/New_York" });
      const page = await ctxA.newPage();
      page.on("pageerror", (e) => console.log("[pageerror]", e.message));
      await page.goto(base);
      await page.getByTestId("machine-state-pill").click();
      await expect.poll(() => page.getByTestId("machine-state-empty").isVisible()).toBe(true);
      await shot(page, "01-empty");

      await page.getByTestId("observation-text").fill("seal leaking, observed at 09:10");
      await page.getByTestId("observation-preview").click();
      await page.getByTestId("observation-review").waitFor();
      expect(await page.getByTestId("observation-fact").inputValue()).toBe("seal_leak");
      expect(await page.getByTestId("observation-value").inputValue()).toBe("present");
      const leakTime = await page.getByTestId("observation-time").inputValue();
      expect(leakTime).toMatch(/T09:10$/);
      expect(await dbCounts()).toEqual({ obs: 0, events: 0 }); // preview wrote nothing
      await shot(page, "02-review");

      // Correct the interpretation before confirming: the technician changes "What" and back,
      // proving the fields are editable and what is sent is what they confirmed.
      await page.getByTestId("observation-fact").selectOption("vibration");
      await page.getByTestId("observation-fact").selectOption("seal_leak");

      // First confirm: the server commits, but the reply is lost (timeout) → UI shows failed, not saved.
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      let lostOnce = false;
      await page.route("**/hub/api/equipment-notebooks/*/observations/", async (route) => {
        if (route.request().method() !== "POST" || lostOnce) return route.continue();
        lostOnce = true;
        await held; // pending is visible while the request is in flight
        await route.fetch(); // the server DID store it…
        await route.abort("timedout"); // …but the technician's phone never heard back
      });
      await page.getByTestId("observation-confirm").click();
      await expect.poll(() => page.getByTestId("observation-status").getAttribute("data-phase")).toBe("pending");
      await shot(page, "03-pending");
      release();
      await expect.poll(() => page.getByTestId("observation-status").getAttribute("data-phase")).toBe("failed");
      expect(await dbCounts()).toEqual({ obs: 1, events: 1 });
      await shot(page, "04-failed-reply-lost");

      // Retry reuses the request id: the server returns the stored row, no duplicate.
      await page.getByTestId("observation-confirm").click();
      await expect.poll(() => page.getByTestId("observation-status").getAttribute("data-phase")).toBe("confirmed");
      expect(await dbCounts()).toEqual({ obs: 1, events: 1 });
      expect(await page.getByTestId("observed-fact-seal_leak").getAttribute("data-state")).toBe("leak_reported");
      await shot(page, "05-confirmed");
      await ctxA.close();

      // --- Technician B, same tenant, same machine, own session --------------------
      who.userId = "tech-b";
      const ctxB = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "America/New_York" });
      const pageB = await ctxB.newPage();
      await pageB.goto(base);
      await pageB.getByTestId("machine-state-pill").click();
      const fact = pageB.getByTestId("observed-fact-seal_leak");
      await fact.waitFor();
      expect(await fact.getAttribute("data-state")).toBe("leak_reported");
      expect(await fact.innerText()).toMatch(/reported by tech-a/);
      expect(await fact.innerText()).toMatch(/self-reported, not verified/);
      expect(await pageB.getByTestId("machine-state-limits").innerText()).toMatch(/not established/);
      await shot(pageB, "06-technician-b-readback");

      // B's readback carries asset facts, never A's thread.
      const raw = await (await fetch(`${base}/hub/api/equipment-notebooks/${notebookId}/observations/`)).text();
      expect(raw).not.toMatch(/sourceTurnId|source_turn_id|threadId|thread_id|notebookId|notebook_id|request_fingerprint/);

      // B's next MIRA answer on Pump-07 is grounded in the persisted observation (same function the chat route calls).
      const turn = await loadObservedStateForTurn(TENANT, PUMP_07, new Date());
      expect(turn.section).toMatch(/seal_leak: leak_reported — seal_leak=present by tech-a, observed /);
      expect(turn.section).toMatch(/verification self_reported, unverified/);
      expect(turn.section).toMatch(/NOT established/);
      expect(turn.frame?.observationIds).toHaveLength(1);
      // Another asset and another tenant are unchanged.
      expect((await loadObservedStateForTurn(TENANT, PUMP_08, new Date())).section).toBe("");
      expect((await loadObservedStateForTurn(OTHER_TENANT, PUMP_07, new Date())).section).toBe("");

      // B reports the repair: maintenance history changes, health/safety do not.
      await pageB.getByTestId("observation-text").fill("replaced the seal");
      await pageB.getByTestId("observation-preview").click();
      await pageB.getByTestId("observation-review").waitFor();
      expect(await pageB.getByTestId("observation-value").inputValue()).toBe("repaired");
      // #5092: pin the repair 5 minutes after the leak, inside the 60-minute contest window,
      // so this never depends on the wall clock. A leak then a repair is a sequence, not a dispute.
      const [d, hm] = leakTime.split("T") as [string, string];
      const [y, mo, da] = d.split("-").map(Number) as [number, number, number];
      const [h, mi] = hm.split(":").map(Number) as [number, number];
      const repairAt = new Date(y, mo - 1, da, h, mi + 5);
      const pad = (n: number) => String(n).padStart(2, "0");
      await pageB.getByTestId("observation-time").fill(
        `${repairAt.getFullYear()}-${pad(repairAt.getMonth() + 1)}-${pad(repairAt.getDate())}T${pad(repairAt.getHours())}:${pad(repairAt.getMinutes())}`,
      );
      await pageB.getByTestId("observation-confirm").click();
      await expect.poll(() => pageB.getByTestId("observation-status").getAttribute("data-phase")).toBe("confirmed");
      expect(await pageB.getByTestId("observed-fact-seal_leak").getAttribute("data-state")).toBe("repair_reported");
      await shot(pageB, "07-repair-reported");
      const after = (await (await fetch(`${base}/hub/api/equipment-notebooks/${notebookId}/observations/`)).json()) as {
        state: { safeToOperate: string; health: string; rootCause: null; history: unknown[] };
      };
      expect(after.state).toMatchObject({ safeToOperate: "not_established", health: "not_established", rootCause: null });
      expect(after.state.history).toHaveLength(2);
      const afterTurn = await loadObservedStateForTurn(TENANT, PUMP_07, new Date());
      expect(afterTurn.section).toMatch(/seal_leak: repair_reported/);
      expect(afterTurn.section).not.toMatch(/contested/);

      // Desktop viewport of the final state (screenshot rule: both viewports).
      await pageB.setViewportSize({ width: 1440, height: 900 });
      await pageB.screenshot({ path: path.join(SHOTS, "2026-11-01_machine-state-07-repair-reported_desktop.png"), fullPage: true });
      await ctxB.close();
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("the panel survives StrictMode effect replay, and a bare time is read on a Los Angeles device's own clock", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      who.tenantId = TENANT;
      who.userId = "tech-c";
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "America/Los_Angeles" });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/?strict=1`);
      // F3: under StrictMode the readback must still enable the panel.
      await page.getByTestId("machine-state-pill").waitFor({ timeout: 15_000 });
      await page.getByTestId("machine-state-pill").click();
      // F2: the device zone travels with the preview, so "09:10" stays 09:10 in review.
      const before = await dbCounts();
      await page.getByTestId("observation-text").fill("seal leaking, observed at 09:10");
      await page.getByTestId("observation-preview").click();
      await page.getByTestId("observation-review").waitFor();
      expect(await page.getByTestId("observation-time").inputValue()).toMatch(/T09:10$/);
      expect(await dbCounts()).toEqual(before); // preview never writes
      expect(errors).toEqual([]);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);
});

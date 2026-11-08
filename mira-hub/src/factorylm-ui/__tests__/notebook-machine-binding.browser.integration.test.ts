/** Real chooser, deterministic local API, real Chromium. No DB or device claim.
 * MIRA_BROWSER_PROOF=1 bun run test:integration -- src/factorylm-ui/__tests__/notebook-machine-binding.browser.integration.test.ts
 * Optional MIRA_CHOOSER_METRICS writes allocation/responsiveness receipts.
 */
import http from "node:http";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const HUB = path.resolve(__dirname, "../../..");
const MACHINE = { id: "machine-1", name: "CV-101", kind: "equipment", unsPath: "enterprise.site.cv101" };
let tree = "";
let bundle = "";
let base = "";
let server: http.Server;
let browser: Browser;
let writes: unknown[] = [];
let reads = 0;
let confirmed = false;
let readbackValid = true;
const metrics: unknown[] = [];

// Construct the wire response without recursive JSON.stringify's stack limit.
function chain(depth: number): string {
  return '{"nodes":[' + Array.from({ length: depth - 1 }, (_, i) =>
    `{"kind":"namespace","name":"Level ${i}","children":[`).join("") +
    JSON.stringify(MACHINE) + "]}".repeat(depth - 1) + "]}";
}

async function open(page: Page, payload: string) {
  tree = payload; writes = []; reads = 0; confirmed = false; readbackValid = true;
  await page.goto(base);
  await page.getByRole("button", { name: "Choose an existing machine" }).click();
}

describe.skipIf(process.env.MIRA_BROWSER_PROOF !== "1")("#5291 real machine chooser browser proof", () => {
  beforeAll(async () => {
    const { build } = await import("esbuild");
    const built = await build({
      stdin: { resolveDir: HUB, loader: "tsx", contents: `
        import { createElement } from "react";
        import { createRoot } from "react-dom/client";
        import { NotebookMachineBinding } from "@/factorylm-ui/NotebookMachineBinding";
        createRoot(document.getElementById("root")).render(createElement(NotebookMachineBinding, {
          notebookId: "notebook-1", buttonStyle: {}, fieldStyle: {},
          onConfirmed: () => { document.getElementById("confirmed").textContent = "Confirmed"; }
        }));` },
      bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
      alias: { "@": path.join(HUB, "src") },
      define: { "process.env.NEXT_PUBLIC_API_BASE": '"/hub"', "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_BASE_PATH": '"/hub"' },
      banner: { js: 'var process = { env: {} };' },
    });
    bundle = built.outputFiles[0]!.text;
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end('<div id="root"></div><p id="confirmed"></p><script src="/bundle.js"></script>');
      } else if (url.pathname === "/bundle.js") {
        res.setHeader("content-type", "text/javascript"); res.end(bundle);
      } else {
        res.setHeader("content-type", "application/json");
        if (url.pathname === "/hub/api/namespace/tree/") { res.end(tree); return; }
        if (req.method === "PUT" && url.pathname.endsWith("/asset/")) {
          let body = "";
          for await (const chunk of req) body += chunk;
          writes.push(JSON.parse(body)); confirmed = true;
          res.end(JSON.stringify({ ok: true, notebook: { asset: { entityId: "canonical-cv101" } } }));
        } else if (url.pathname === "/hub/api/equipment-notebooks/notebook-1/") {
          reads++;
          res.end(JSON.stringify({ notebook: { asset: confirmed && readbackValid ? {
            entityId: "canonical-cv101", confirmedAt: "2026-11-08T00:00:00Z",
          } : null } }));
        } else { res.statusCode = 404; res.end("{}"); }
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    if (process.env.MIRA_CHOOSER_METRICS) writeFileSync(process.env.MIRA_CHOOSER_METRICS, JSON.stringify(metrics, null, 2));
    await browser?.close();
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  });

  for (const workload of ["deep", "broad"] as const) {
    it(`loads the actual ${workload} chooser with bounded allocations and exact labels`, async () => {
      const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
      try {
        const payload = workload === "deep" ? chain(8_000) : JSON.stringify({ nodes: [{
          kind: "area", name: "Garage", children: Array.from({ length: 1_000 }, (_, i) => ({ ...MACHINE, id: `machine-${i}`, name: `CV-${i}` })),
        }] });
        await page.goto(base);
        tree = payload; writes = []; reads = 0;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("HeapProfiler.startSampling", { samplingInterval: 16_384,
          includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        const started = performance.now();
        await page.getByRole("button", { name: "Choose an existing machine" }).click();
        const select = page.getByRole("combobox", { name: "Machine", exact: true });
        await select.waitFor();
        const elapsedMs = performance.now() - started;
        const { profile } = await cdp.send("HeapProfiler.stopSampling");
        const allocatedBytes = profile.samples.reduce((sum, sample) => sum + sample.size, 0);
        metrics.push({ workload, nodes: workload === "deep" ? 8_000 : 1_001, allocatedBytes, elapsedMs });
        expect(allocatedBytes, "includes allocations collected during traversal; ancestor copies must not grow quadratically").toBeLessThan(64 * 1024 * 1024);
        expect(await select.locator("option").count()).toBe(workload === "deep" ? 2 : 1_001);
        if (workload === "deep") {
          const location = Array.from({ length: 7_999 }, (_, i) => `Level ${i}`).join(" / ");
          expect(await select.locator('option[value="machine-1"]').textContent()).toBe(`CV-101 · ${location}`);
        } else {
          expect(await select.locator('option[value="machine-42"]').textContent()).toBe("CV-42 · Garage");
        }
        await select.selectOption("machine-1");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        expect(writes).toEqual([]);
        expect(reads).toBe(0);
      } finally { await page.close(); }
    }, 30_000);
  }

  it("accepts the exact node limit and restores truthful ancestry across siblings and roots", async () => {
    const page = await browser.newPage();
    try {
      const machine = (id: string) => ({ ...MACHINE, id, name: id });
      await open(page, JSON.stringify({ nodes: [
        { kind: "area", name: "Plant A", children: [
          { kind: "namespace", name: "Line 1", children: [machine("a")] }, machine("b"),
        ] },
        { kind: "area", name: "Plant B", children: [machine("c")] }, machine("root"),
        ...Array.from({ length: 9_993 }, () => ({ kind: "namespace", name: "Empty" })),
      ] }));
      const select = page.getByRole("combobox", { name: "Machine", exact: true });
      await select.waitFor();
      expect(await select.locator("option").allTextContents()).toEqual([
        "Choose a machine", "root", "c · Plant B", "b · Plant A", "a · Plant A / Line 1",
      ]);
      expect(writes).toEqual([]);
    } finally { await page.close(); }
  });

  it.each<[string, () => string]>([
    ["too many roots", () => JSON.stringify({ nodes: Array.from({ length: 10_001 }, () => MACHINE) })],
    ["too many children", () => JSON.stringify({ nodes: [{ kind: "area", name: "Garage", children: Array.from({ length: 10_000 }, () => MACHINE) }] })],
    ["too much location text", () => JSON.stringify({ nodes: [{ kind: "area", name: "x".repeat(2_000), children: Array.from({ length: 1_000 }, (_, i) => ({ ...MACHINE, id: `m-${i}` })) }] })],
    ["a machine at every level", () => '{"nodes":[' + Array.from({ length: 999 }, (_, i) =>
      JSON.stringify({ ...MACHINE, id: `ancestor-${i}`, name: `Machine ${i}` }).slice(0, -1) + ',"children":[').join("") + JSON.stringify(MACHINE) + "]}".repeat(999) + "]}"],
    ["malformed descendants", () => JSON.stringify({ nodes: [{ ...MACHINE, children: {} }] })],
  ])("fails closed for %s and can retry without writing", async (_name, payload) => {
    const page = await browser.newPage();
    try {
      await open(page, payload());
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("combobox").count()).toBe(0);
      expect(writes).toEqual([]);
      tree = JSON.stringify({ nodes: [{ kind: "area", name: "Garage", children: [MACHINE] }] });
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      const select = page.getByRole("combobox", { name: "Machine", exact: true });
      await select.selectOption(MACHINE.id);
      expect(writes).toEqual([]);
      readbackValid = false;
      await page.getByRole("button", { name: "Confirm this machine", exact: true }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.locator("#confirmed").textContent()).toBe("");
      expect(writes).toEqual([{ assetRef: MACHINE.id, selectedVia: "asset_picker" }]);
      readbackValid = true;
      await page.getByRole("button", { name: "Check saved selection", exact: true }).click();
      await page.getByText("Confirmed", { exact: true }).waitFor();
      expect(writes).toHaveLength(1);
      expect(reads).toBe(2);
    } finally { await page.close(); }
  }, 15_000);
});

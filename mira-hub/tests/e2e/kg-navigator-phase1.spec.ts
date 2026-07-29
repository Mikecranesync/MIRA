/**
 * Phase 1 proof — KG Navigator cross-link UX  (/knowledge/map)
 *
 * Roadmap: ~/.claude/plans/ok-study-the-knowledge-reactive-marble.md (Phase 1)
 * Branch:  feat/kg-navigator-phase1
 *
 * Hermetic by design: this spec route-mocks GET /api/kg/graph, so the proof does
 * NOT depend on the test tenant happening to own a verified edge that carries an
 * evidence_summary. The mock IS the deterministic evidence; the data plumbing
 * (entity_id + evidence_summary → payload) is proven separately by the unit suite
 * (src/lib/knowledge-graph/__tests__/graph-view.test.ts). Read-only — never POSTs
 * a proposal decision, so it is safe to run against any authed hub instance.
 *
 * The graph itself renders to a <canvas> (react-force-graph-2d); clicking a
 * specific node/edge by pixel is non-deterministic headless. The node detail
 * panel — which carries the headline "Add documents" deep-link — is opened
 * deterministically via the "Key assets" (godNode) button that the analysis
 * layer renders in the DOM, no canvas click required.
 *
 * Run locally / against staging / prod:
 *   cd mira-hub
 *   HUB_URL=https://app.factorylm.com \
 *   E2E_HUB_EMAIL=playwright@factorylm.com E2E_HUB_PASSWORD=TestPass123 \
 *   npx playwright test tests/e2e/kg-navigator-phase1.spec.ts --reporter=list
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { HUB_URL, ensureUserRegistered, loginWithPassword } from "./fixtures/auth";

const SCREENSHOTS_DIR = path.resolve(__dirname, "../../../docs/promo-screenshots");
const DATE = "2026-06-20";

// Deterministic mocked graph: one VERIFIED edge (with evidence_summary) and one
// PROPOSED edge, over three nodes. The equipment node carries entity_id.
const NODES = [
  { id: "kg-vfd-07", type: "equipment", label: "VFD-07", degree: 2, unsPath: "enterprise.site.line.vfd_07", entityId: "EQ-VFD-07" },
  { id: "kg-manual-pf525", type: "manual", label: "PowerFlex 525 Manual", degree: 1, unsPath: null },
  { id: "kg-fan-01", type: "component", label: "Cooling Fan", degree: 1, unsPath: null },
];
const LINKS = [
  {
    source: "kg-vfd-07",
    target: "kg-manual-pf525",
    type: "HAS_DOCUMENT",
    confidence: 1,
    state: "verified",
    evidenceSummary: "PowerFlex 525 manual, p.4 — drive matches VFD-07 nameplate",
  },
  {
    source: "kg-vfd-07",
    target: "kg-fan-01",
    type: "HAS_COMPONENT",
    confidence: 0.72,
    state: "proposed",
    proposalId: "00000000-0000-0000-0000-0000000000aa",
    reasoning: "Cooling Fan listed in VFD-07 BOM",
  },
];
// Analysis summary returned only on the ?analysis=true refetch — gives us a
// "Key assets" (godNode) button to open the node panel without a canvas click.
const ANALYSIS = {
  available: true,
  edgeCount: 2,
  minEdges: 20,
  communityCount: 1,
  godNodes: [{ id: "kg-vfd-07", label: "VFD-07", centrality: 1 }],
};

async function mockGraph(page: Page): Promise<void> {
  await page.route("**/api/kg/graph**", async (route) => {
    const withAnalysis = route.request().url().includes("analysis=true");
    const nodes = withAnalysis
      ? NODES.map((n) => ({ ...n, centrality: n.id === "kg-vfd-07" ? 1 : 0.2, community: 0 }))
      : NODES;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ nodes, links: LINKS, capped: false, ...(withAnalysis ? { analysis: ANALYSIS } : {}) }),
    });
  });
}

test.describe("KG Navigator Phase 1 — cross-link UX", () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureUserRegistered(request);
    await loginWithPassword(page);
  });

  test("node panel exposes Add-documents deep-link; graph renders mocked payload", async ({ page }) => {
    await mockGraph(page);
    await page.goto(`${HUB_URL}/knowledge/map`, { waitUntil: "domcontentloaded" });

    // Control panel reflects the mocked payload (1 verified + 1 proposed edge).
    await expect(page.getByText(/1 verified · 1 proposed/)).toBeVisible({ timeout: 20_000 });

    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${DATE}_kg-navigator_graph_desktop.png`) });

    // Deterministic, no-canvas path to the node detail panel:
    // toggle "Size by influence" → analysis refetch → "Key assets" godNode button.
    await page.getByText("Size by influence").click();
    await page.getByRole("button", { name: "VFD-07" }).click();

    const addDocs = page.getByTestId("kg-node-add-documents");
    await expect(addDocs).toBeVisible();
    // Headline Phase-1 cross-link: jumps to this node in the namespace to attach docs.
    // Tolerate basePath ('/hub') + trailingSlash normalization (→ /hub/namespace/?node=...).
    await expect(addDocs).toHaveAttribute("href", /\/namespace\/?\?node=kg-vfd-07$/);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${DATE}_kg-navigator_node-add-documents_desktop.png`) });
  });

  test("mobile viewport renders the graph", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await mockGraph(page);
    await page.goto(`${HUB_URL}/knowledge/map`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/1 verified · 1 proposed/)).toBeVisible({ timeout: 20_000 });
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${DATE}_kg-navigator_graph_mobile.png`) });
  });
});

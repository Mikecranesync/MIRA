/**
 * Equipment Notebook — full source → question → cited answer → source loop,
 * plus the reproducible-bug regressions found during the parity pass. Runs on
 * desktop against a local production build with a real authenticated session.
 *
 * Deterministic fixture: a fixed text PDF (fixtures/diagnostic-fixture.pdf).
 * Content dedup makes re-runs idempotent — the second run attaches the same
 * bytes instead of chunking a duplicate.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";

// Safe disposable dev notebook (Conveyor 4). Overridable per environment.
const NB = process.env.NOTEBOOK_ID ?? "39f36b8a-0303-4d85-a9aa-db63c4341172";
const FIXTURE = path.join(__dirname, "fixtures", "diagnostic-fixture.pdf");

// Deterministic source state: enable every non-rejected source via the API so
// a grounding test never depends on state another test left behind (the
// zero-source test toggles global source state). Returns the source count.
type ApiCtx = import("@playwright/test").APIRequestContext;
type Src = { docId: string; filename: string | null; matchState: string };

async function listSources(request: ApiCtx): Promise<Src[]> {
  const res = await request.get(`api/equipment-notebooks/${NB}/`);
  const { sources = [] } = await res.json();
  return sources as Src[];
}

async function enableAllSources(request: ApiCtx): Promise<number> {
  const sources = await listSources(request);
  for (const s of sources) {
    if (s.matchState === "rejected") continue;
    await request.patch(`api/equipment-notebooks/${NB}/sources/${s.docId}/`, { data: { enabledByDefault: true } });
  }
  return sources.filter((s) => s.matchState !== "rejected").length;
}

// Enable ONLY the source whose filename matches; disable the rest. Makes a
// grounding assertion deterministic (single small source → one fast, uniquely
// attributable citation instead of retrieval variance across the corpus).
async function enableOnly(request: ApiCtx, filenameSubstr: string): Promise<string> {
  const sources = await listSources(request);
  const target = sources.find((s) => (s.filename ?? "").includes(filenameSubstr));
  if (!target) throw new Error(`enableOnly: no source matching "${filenameSubstr}"`);
  for (const s of sources) {
    if (s.matchState === "rejected") continue;
    await request.patch(`api/equipment-notebooks/${NB}/sources/${s.docId}/`, {
      data: { enabledByDefault: s.docId === target.docId },
    });
  }
  return target.docId;
}

test.describe("Equipment Notebook loop", () => {
  test("list → notebook renders without console/hydration errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      // The mock data-provider warning is a known prod-config log unrelated to
      // this surface; everything else is a real regression.
      if (m.type() === "error" && !m.text().includes("NEXT_PUBLIC_PIPELINE_API_URL")) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto("equipment/");
    await expect(page.getByRole("heading", { name: "Equipment Notebooks" })).toBeVisible();
    await page.getByRole("link", { name: /Conveyor 4/ }).click();
    await expect(page).toHaveURL(new RegExp(`/equipment/${NB}/`));
    await expect(page.getByRole("button", { name: /^Sources · / })).toBeVisible();
    expect(errors, `unexpected console/page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("sources sheet opens ABOVE the tab bar and its controls are hit-testable", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await page.getByRole("button", { name: /^Sources · / }).click();
    const dialog = page.getByRole("dialog", { name: "Sources" });
    await expect(dialog).toBeVisible();
    // The upload button and every source row must actually receive taps — the
    // z-index bug made them present-but-covered. trial:true asserts hittability.
    await dialog.getByRole("button", { name: /Upload PDF/ }).click({ trial: true });
    const firstRow = dialog.locator("ul li button").first();
    await firstRow.click({ trial: true });
    // Escape closes it (dialog semantics).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("inline upload → indexed → attached → immediately askable", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await page.getByRole("button", { name: /^Sources · / }).click();
    const dialog = page.getByRole("dialog", { name: "Sources" });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      dialog.getByRole("button", { name: /Upload PDF/ }).click(),
    ]);
    await chooser.setFiles(FIXTURE);
    // Honest status line resolves to a success/dedup message (not "Processing…").
    const status = dialog.getByRole("status");
    await expect(status).toHaveText(/Source added|Already in the cabinet/, { timeout: 60_000 });
    await expect(dialog.getByText("diagnostic-fixture.pdf")).toBeVisible();
  });

  test("known-answer question returns a grounded, correctly-targeted citation", async ({ page }) => {
    // Fixture-only via the API (the inline-upload test already attached it) →
    // the answer can only cite the fixture (deterministic + fast, single small
    // source). enableOnly throws clearly if the fixture isn't attached.
    await enableOnly(page.request, "diagnostic-fixture");
    await page.goto(`equipment/${NB}/`);
    await expect(page.getByRole("button", { name: /^Sources · 1\// })).toBeVisible();

    await page.getByLabel("Ask this machine anything").fill(
      "What parameter resets the fixture device and what value?",
    );
    await page.getByRole("button", { name: "Send" }).click();

    // The fixture must be the CITED source (grounding correctness) — target the
    // chip by its source, not by position (older history has other citations).
    const chip = page.getByRole("button", { name: /Open citation \d+: diagnostic-fixture/ }).last();
    await expect(chip).toBeVisible({ timeout: 60_000 });

    // Grounded answer must reference the fixture's actual reset parameter.
    await expect(page.locator("main")).toContainText(/Q141/);

    // Clicking the chip opens the correct source at a page anchor.
    const label = await chip.getAttribute("aria-label");
    await chip.click();
    await expect(page).toHaveURL(/\/source\/[0-9a-f-]{36}\/(\?page=\d+)?/);
    // Target correctness: the viewer resolved to THE fixture document (not a
    // stale/missing/other source). Only the viewer header carries this text.
    await expect(page.getByText("diagnostic-fixture.pdf")).toBeVisible();
    // The citation's page (if any) matches the viewer's cited-page header AND
    // the iframe anchor — proving the page target, not just "a citation opened".
    const pageMatch = label?.match(/page (\d+)/);
    if (pageMatch) {
      await expect(page.getByText(`Cited page ${pageMatch[1]}`)).toBeVisible();
      await expect(page.locator("iframe")).toHaveAttribute("src", new RegExp(`#page=${pageMatch[1]}`));
    }
  });

  test("conversation persists across a reload (Gate I client hydration)", async ({ page }) => {
    // Fixture-only → a fast, deterministic grounded turn to persist.
    await enableOnly(page.request, "diagnostic-fixture");
    await page.goto(`equipment/${NB}/`);
    // Wait for the source list to load, else the send races the async load and
    // hits the zero-source client guard (never reaches the server → never
    // persists). This is exactly the race the header count makes observable.
    await expect(page.getByRole("button", { name: /^Sources · 1\// })).toBeVisible();
    const q = `What resets the fixture device? (probe ${Date.now()})`;
    await page.getByLabel("Ask this machine anything").fill(q);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main")).toContainText(q);
    // Wait for the turn to be genuinely persisted server-side (not a fixed
    // sleep, not a citation — the turn persists once the answer finishes,
    // whether it cites or honestly abstains) before reloading.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`api/equipment-notebooks/${NB}/`);
          if (!r.ok()) return false;
          const j = await r.json();
          return (j.turns ?? []).some((t: { question: string }) => t.question === q);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await page.reload();
    // The persisted user turn re-renders after async history load — this is the
    // client hydration fix (turns state was previously frozen at []).
    await expect(page.locator("main")).toContainText(q, { timeout: 20_000 });
    await enableAllSources(page.request); // restore for downstream tests/projects
  });

  test("zero selected sources → honest guard, no fabricated answer", async ({ page }) => {
    await page.goto(`equipment/${NB}/`);
    await page.getByRole("button", { name: /^Sources · / }).click();
    const dialog = page.getByRole("dialog", { name: "Sources" });
    // Uncheck every enabled source row.
    const rows = dialog.locator("ul li button:not([disabled])");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      // Only click rows that are currently on (checkbox filled).
      await row.click();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Sources · 0\// })).toBeVisible();
    await page.getByLabel("Ask this machine anything").fill("Anything at all?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main")).toContainText(/Select at least one source/);
    // Restore deterministically via the API so no other test/run inherits the
    // all-off state (UI toggling was unreliable — the isolation-bleed we fixed).
    await enableAllSources(page.request);
  });

  test("foreign/guessed notebook id is not accessible", async ({ page }) => {
    const res = await page.request.get("api/equipment-notebooks/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/");
    expect([403, 404]).toContain(res.status());
    await page.goto("equipment/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/");
    await expect(page.getByText(/doesn.t exist or isn.t yours/)).toBeVisible();
  });
});

/**
 * Upload flow probe against https://app.factorylm.com/hub/
 *
 * Verifies end-to-end that:
 *   1. Login works and sets session cookie
 *   2. /hub/api/connections reports which channels are bound
 *   3. /hub/api/picker/google/token — token-refresh path works, or reports why not
 *   4. /hub/api/picker/dropbox/key — DROPBOX_APP_KEY env is present
 *   5. Knowledge page Upload button opens the UploadPicker modal
 *   6. Picker buttons (Google / Dropbox) enable/disable matches API reality
 *   7. Cloud-pick POST /hub/api/uploads round-trips to ingest (dropbox-shape
 *      payload with a public PDF url → should reach parsed or failed with a
 *      specific reason we can surface to the user)
 *   8. Local file upload still works (regression guard)
 *
 * Output is a single structured console report you can paste back.
 */
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://app.factorylm.com";
const HUB = `${BASE}/hub`;
const EMAIL = "mike@factorylm.com";
const PASSWORD = "admin123";

// Public test PDF used only to simulate a Dropbox cloud pick through the
// streamFromSignedUrl adapter. Mozilla's sample PDF is tiny, public, and
// Apache 2.0 licensed.
const PUBLIC_TEST_PDF =
  "https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/basicapi.pdf";

type Report = {
  step: string;
  ok: boolean;
  detail: unknown;
};
const report: Report[] = [];
const push = (step: string, ok: boolean, detail: unknown) =>
  report.push({ step, ok, detail });

test("upload flow — full probe", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) =>
    networkFailures.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`),
  );

  // ── 1. Login ─────────────────────────────────────────────────────────────
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign In")');
  try {
    await page.waitForURL(/\/hub\/feed/, { timeout: 15_000 });
    push("1. login", true, { url: page.url() });
  } catch (e) {
    push("1. login", false, { url: page.url(), error: String(e) });
  }

  // ── 2. /hub/api/connections ──────────────────────────────────────────────
  {
    const r = await page.request.get(`${HUB}/api/connections`);
    const body = await r.json().catch(() => ({ parseError: true }));
    push("2. /api/connections", r.ok(), {
      status: r.status(),
      providersBound: Object.keys(body ?? {}),
      bindings: body,
    });
  }

  // ── 3. /hub/api/picker/google/token ──────────────────────────────────────
  {
    const r = await page.request.get(`${HUB}/api/picker/google/token`);
    const body = await r.json().catch(() => ({ parseError: true }));
    // Strip the access token from the report so we never log secrets
    if (body && typeof body === "object" && "accessToken" in body) {
      body.accessToken = `<${(body.accessToken as string).length} chars redacted>`;
    }
    push("3. /api/picker/google/token", r.ok(), {
      status: r.status(),
      body,
    });
  }

  // ── 4. /hub/api/picker/dropbox/key ───────────────────────────────────────
  {
    const r = await page.request.get(`${HUB}/api/picker/dropbox/key`);
    const body = await r.json().catch(() => ({ parseError: true }));
    if (body && typeof body === "object" && "appKey" in body) {
      body.appKey = `<${(body.appKey as string).length} chars redacted>`;
    }
    push("4. /api/picker/dropbox/key", r.ok(), {
      status: r.status(),
      body,
    });
  }

  // ── 5. Knowledge page: click Upload, verify modal ────────────────────────
  await page.goto(`${HUB}/knowledge`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: "test-results/upload-probe-knowledge-page.png",
    fullPage: false,
  });

  const uploadBtn = page.locator('button:has-text("Upload")').first();
  const uploadBtnVisible = await uploadBtn.isVisible().catch(() => false);
  push("5a. Upload button visible on /hub/knowledge", uploadBtnVisible, {
    count: await page.locator('button:has-text("Upload")').count(),
  });

  if (uploadBtnVisible) {
    await uploadBtn.click();
    // Modal renders "Add to Knowledge" header
    const modalVisible = await page
      .locator('h3:has-text("Add to Knowledge")')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    push("5b. Modal opens after click", modalVisible, {});

    if (modalVisible) {
      // Let the modal's effect fetch picker config (re-renders disabled state)
      await page.waitForTimeout(1500);

      const googleBtn = page.locator('button:has-text("From Google Drive")');
      const dropboxBtn = page.locator('button:has-text("From Dropbox")');
      const googleDisabled = await googleBtn.isDisabled().catch(() => true);
      const dropboxDisabled = await dropboxBtn.isDisabled().catch(() => true);
      const googleTitle = await googleBtn.getAttribute("title").catch(() => null);
      const dropboxTitle = await dropboxBtn.getAttribute("title").catch(() => null);
      push("5c. Google Drive picker button state", !googleDisabled, {
        disabled: googleDisabled,
        titleTooltip: googleTitle,
      });
      push("5d. Dropbox picker button state", !dropboxDisabled, {
        disabled: dropboxDisabled,
        titleTooltip: dropboxTitle,
      });

      await page.screenshot({
        path: "test-results/upload-probe-modal-open.png",
        fullPage: false,
      });

      // Probe Google Picker click if enabled — capture any JS errors it throws
      if (!googleDisabled) {
        const preClickErrors = consoleErrors.length;
        await googleBtn.click();
        await page.waitForTimeout(2500);
        const newErrors = consoleErrors.slice(preClickErrors);
        // Google Picker renders in a separate iframe with id starting with "picker"
        const pickerIframe = await page.locator('iframe[src*="docs.google.com/picker"]').count();
        push("5e. Google Picker iframe launched", pickerIframe > 0, {
          iframeCount: pickerIframe,
          consoleErrorsDuringClick: newErrors,
        });
        // Close the picker by pressing Escape or re-opening our modal
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }

      // Probe Dropbox click if enabled
      if (!dropboxDisabled) {
        const preClickErrors = consoleErrors.length;
        // Re-open our modal if it was closed
        const stillOpen = await page
          .locator('h3:has-text("Add to Knowledge")')
          .isVisible()
          .catch(() => false);
        if (!stillOpen) {
          await uploadBtn.click();
          await page.waitForTimeout(800);
        }
        await page.locator('button:has-text("From Dropbox")').click();
        await page.waitForTimeout(2500);
        const newErrors = consoleErrors.slice(preClickErrors);
        const dbxIframe = await page
          .locator('iframe[src*="dropbox.com"]')
          .count();
        push("5f. Dropbox Chooser iframe launched", dbxIframe > 0, {
          iframeCount: dbxIframe,
          consoleErrorsDuringClick: newErrors,
        });
        await page.keyboard.press("Escape");
      }
    }
  }

  // ── 6. Round-trip local PDF ──────────────────────────────────────────────
  {
    const fixture = path.join(__dirname, "fixtures/sample.pdf");
    let ok = false;
    let info: unknown = {};
    try {
      const pdf = await readFile(fixture);
      const uploadRes = await page.request.post(`${HUB}/api/uploads/local`, {
        multipart: {
          file: {
            name: `probe-local-${Date.now()}.pdf`,
            mimeType: "application/pdf",
            buffer: pdf,
          },
        },
      });
      if (!uploadRes.ok()) {
        info = { status: uploadRes.status(), body: await uploadRes.text() };
      } else {
        const created = await uploadRes.json();
        let terminal: string | null = null;
        let lastDetail: string | null = null;
        for (let i = 0; i < 20 && !terminal; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const list = await page.request.get(`${HUB}/api/uploads`);
          const rows = (await list.json()) as Array<{
            id: string;
            status: string;
            statusDetail: string | null;
          }>;
          const me = rows.find((r) => r.id === created.id);
          if (me && ["parsed", "failed", "cancelled"].includes(me.status)) {
            terminal = me.status;
            lastDetail = me.statusDetail ?? null;
          }
        }
        ok = terminal === "parsed";
        info = {
          uploadId: created.id,
          terminal,
          failureDetail: lastDetail,
        };
      }
    } catch (e) {
      info = { error: String(e) };
    }
    push("6. local PDF round-trip to parsed", ok, info);
  }

  // ── 7. Simulated Dropbox cloud-pick round-trip ───────────────────────────
  {
    let ok = false;
    let info: unknown = {};
    try {
      const payload = {
        provider: "dropbox",
        externalDownloadUrl: PUBLIC_TEST_PDF,
        filename: `probe-dropbox-sim-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 8958, // basicapi.pdf is ~8.7 KB
        externalCreatedAt: new Date().toISOString(),
      };
      const res = await page.request.post(`${HUB}/api/uploads`, {
        data: payload,
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok()) {
        info = { status: res.status(), body: await res.text() };
      } else {
        const created = await res.json();
        let terminal: string | null = null;
        let lastDetail: string | null = null;
        for (let i = 0; i < 20 && !terminal; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const list = await page.request.get(`${HUB}/api/uploads`);
          const rows = (await list.json()) as Array<{
            id: string;
            status: string;
            statusDetail: string | null;
          }>;
          const me = rows.find((r) => r.id === created.id);
          if (me && ["parsed", "failed", "cancelled"].includes(me.status)) {
            terminal = me.status;
            lastDetail = me.statusDetail ?? null;
          }
        }
        ok = terminal === "parsed";
        info = {
          uploadId: created.id,
          terminal,
          failureDetail: lastDetail,
          note: "Simulates Dropbox Chooser payload; exercises streamFromSignedUrl + forwardToIngest",
        };
      }
    } catch (e) {
      info = { error: String(e) };
    }
    push("7. simulated dropbox cloud-pick round-trip", ok, info);
  }

  // ── Final report ─────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  UPLOAD FLOW PROBE REPORT                                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  for (const r of report) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.step}`);
    console.log(`       ${JSON.stringify(r.detail, null, 2).replace(/\n/g, "\n       ")}`);
  }
  if (consoleErrors.length) {
    console.log("\n── Browser console errors ──");
    for (const e of consoleErrors) console.log(" *", e);
  }
  if (networkFailures.length) {
    console.log("\n── Network failures ──");
    for (const e of networkFailures) console.log(" *", e);
  }
  console.log("\n── Cookies present ──");
  console.log(
    ` * ${cookies.length} cookies (session-bearing names: ${cookies
      .map((c) => c.name)
      .join(", ")})`,
  );

  // Soft-assert: login + API probes should all succeed even if pickers are
  // mis-configured — we want the report, not a red test.
  expect(report.find((r) => r.step === "1. login")?.ok).toBe(true);

  await ctx.close();
});

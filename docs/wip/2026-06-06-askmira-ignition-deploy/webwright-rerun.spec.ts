/**
 * AskMira 10-Question Re-Test
 *
 * Drives the AskMira Perspective view via Playwright (also runs under
 * Webwright unchanged — Webwright wraps Playwright). Reads each question
 * from QUESTIONS[], types it into the AskMira text-area, clicks the
 * "Ask MIRA" button, waits for the answer to render, captures answer
 * text + screenshot, and emits a JSON report.
 *
 * Mike: fill in QUESTIONS[] with the 10 questions from your 2026-06-01
 * /garage-conveyor test reports (verbatim — wording parity matters for
 * regression diff). Then:
 *
 *   1. cd to the dir containing this file
 *   2. npm i -D playwright @playwright/test  (one-time)
 *   3. npx playwright install chromium  (one-time; ~700 MB)
 *   4. npx playwright test webwright-rerun.spec.ts --headed
 *
 * Or via Webwright after Phase 0 install:
 *   /webwright:run "execute docs/wip/2026-06-06-askmira-ignition-deploy/webwright-rerun.spec.ts against http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira"
 *
 * Output:
 *   - rerun-results-<timestamp>.json (raw answers + latencies)
 *   - rerun-q<N>-<timestamp>.png  (per-question screenshot)
 *
 * Drop the rendered numbers into docs/demos/_audit/askmira-rerun-2026-06-06.md.
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const ASKMIRA_URL =
  process.env.ASKMIRA_URL ||
  "http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira";

const ANSWER_TIMEOUT_MS = 95_000;
const STARTUP_PLACEHOLDER = "Ask me about the garage conveyor";

// ------- FILL IN MIKE'S 10 QUESTIONS HERE -------
const QUESTIONS: string[] = [
  // example shape — replace with verbatim text from prior reports
  "current status?",
  "is the e-stop OK?",
  "why isn't the motor running?",
  "what's the VFD fault code mean?",
  "show me the lubrication schedule for this conveyor",
  "what's the full-load amp rating for this drive?",
  "what's the normal-running frequency for the motor?",
  "is the photo eye blocked?",
  "if I press reset will it run?",
  "what does MLC stand for?",
];
// ------------------------------------------------

interface QuestionResult {
  q: string;
  answer: string;
  latencyMs: number;
  screenshotPath: string;
  // Heuristic R-signal checks. Mike's audit is the source of truth — these
  // are best-effort hints, not pass/fail authority.
  r1NoCotLeak: boolean; // R1: no "1. Yes 2. No 3. Unknown" leak pattern
  r2VendorMentions: string[]; // R2: which vendors got cited
  r4EstopMentioned: boolean; // R4: did answer reference E-stop
  r5UnderTargetMs: boolean; // R5: < 15 s
  r6HasSource: boolean; // R6: contains "[Source:" marker
}

function classify(q: string, answer: string, latencyMs: number): Omit<QuestionResult, "q" | "answer" | "latencyMs" | "screenshotPath"> {
  const cotPattern = /1\.\s*Yes\s*2\.\s*No\s*3\.\s*Unknown/i;
  const knownVendors = ["AutomationDirect", "Allen-Bradley", "Rockwell", "PowerFlex", "ABB", "ACS355", "Yaskawa", "GA500", "Siemens", "Schneider"];
  const vendorMentions = knownVendors.filter((v) =>
    new RegExp(v.replace(/-/g, "[-\\s]?"), "i").test(answer)
  );
  return {
    r1NoCotLeak: !cotPattern.test(answer),
    r2VendorMentions: vendorMentions,
    r4EstopMentioned: /e[-\s]?stop|emergency stop/i.test(answer),
    r5UnderTargetMs: latencyMs < 15_000,
    r6HasSource: /\[Source:/i.test(answer),
  };
}

async function askOne(page: Page, q: string, qIdx: number, outDir: string): Promise<QuestionResult> {
  // Wait for the AskMira view chrome to settle — placeholder text in markdown panel.
  await page.waitForSelector("text=ASK MIRA", { timeout: 30_000 });

  // The text-area is the only ia.input.text-area on the view. Perspective renders
  // input.text-area as <textarea>. We target the textarea inside the view.
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(""); // clear any prior value
  await textarea.fill(q);

  // The button has text "Ask MIRA" — but so does the title label. Title is a
  // label not a button, so scoping to button role disambiguates.
  const askButton = page.getByRole("button", { name: /^Ask MIRA$/i });
  const startedAt = Date.now();
  await askButton.click();

  // Wait for the busy indicator to appear AND then disappear, with grace.
  // "MIRA is thinking…" is bound to view.custom.busy; it shows during the
  // httpClient.post.
  try {
    await page.waitForSelector("text=MIRA is thinking", { timeout: 5_000 });
  } catch {
    // Busy indicator may flash too briefly. Don't fail the test on this.
  }
  await page.waitForSelector("text=MIRA is thinking", { state: "hidden", timeout: ANSWER_TIMEOUT_MS });

  const latencyMs = Date.now() - startedAt;

  // Answer rendered into the ia.display.markdown panel (the last large panel).
  // Pull all visible text inside the view body that's not the title/placeholder.
  const bodyText = await page.locator("body").innerText();
  // Strip everything except the answer block: best effort find the markdown panel.
  const answerCandidate = bodyText.replace(/.*ASK MIRA\s*/s, "").trim();
  const answer = answerCandidate.length > 0 ? answerCandidate : "(empty)";

  const screenshotPath = path.join(outDir, `rerun-q${qIdx + 1}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const flags = classify(q, answer, latencyMs);
  return { q, answer, latencyMs, screenshotPath, ...flags };
}

test("AskMira 10-question re-test", async ({ page }) => {
  test.setTimeout(QUESTIONS.length * (ANSWER_TIMEOUT_MS + 10_000));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, `rerun-results-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto(ASKMIRA_URL);
  await page.setViewportSize({ width: 1024, height: 768 });

  const results: QuestionResult[] = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const r = await askOne(page, QUESTIONS[i], i, outDir);
    results.push(r);
    console.log(`Q${i + 1}: ${r.latencyMs} ms, R1=${r.r1NoCotLeak} R5=${r.r5UnderTargetMs} R6=${r.r6HasSource} vendors=[${r.r2VendorMentions.join(", ")}]`);
    // Small pause between questions so we don't pile up requests against the engine
    await page.waitForTimeout(2_000);
  }

  // Compute summary stats
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)];
  const pass = (k: keyof QuestionResult) => results.filter((r) => r[k] === true).length;
  const summary = {
    timestamp: stamp,
    url: ASKMIRA_URL,
    n: results.length,
    medianLatencyMs: median,
    r1Pass: pass("r1NoCotLeak"),
    r5Pass: pass("r5UnderTargetMs"),
    r6Pass: pass("r6HasSource"),
    r4EstopMentions: results.filter((r) => r.r4EstopMentioned).length,
    distinctVendors: Array.from(new Set(results.flatMap((r) => r.r2VendorMentions))).sort(),
  };

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ summary, results }, null, 2));
  console.log("SUMMARY:", JSON.stringify(summary, null, 2));
  console.log(`Output dir: ${outDir}`);

  // Soft asserts so the test never *fails* — we want the report, not a green/red.
  // The audit doc is the verdict.
  expect(results.length).toBe(QUESTIONS.length);
});

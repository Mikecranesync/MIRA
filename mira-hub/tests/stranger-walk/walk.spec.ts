/**
 * The Stranger Walk (#4460): a brand-new technician on STAGING, through the
 * real /v3 UI. Sign up → per manual: new project, attach the manual to the
 * first question → for every question: a fresh chat, wait until the project's
 * source is "Ready to ask", ask, wait for the answer, open the first citation.
 *
 *   doppler run --project factorylm --config stg -- \
 *     npx playwright test --config tests/stranger-walk/playwright.stranger-walk.config.ts
 *
 * Extraction is the fidelity harness's (`surfaces.ts`, the `/v3` = "clone"
 * surface), so the two harnesses read a turn identically. No retries: a row
 * that settles is recorded as it settled (flakes are listed by the repeat run).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Page, type Response } from "@playwright/test";
import { extractTurn, UI } from "../fidelity/surfaces";
import corpusJson from "./corpus.json";
import { fixtureFor, markdownScorecard, scoreAll, scorecard, type Corpus, type Observation, type Question } from "./score";
import { identity, manualBytes, MAX_TURNS, BUDGET, stagingBase, teardownTenant } from "./staging";

const corpus = corpusJson as Corpus;
const RUN_ID = process.env.STRANGER_WALK_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.resolve(process.env.STRANGER_WALK_OUT ?? path.join(__dirname, ".out", RUN_ID));
const ONLY = process.env.STRANGER_WALK_ONLY ? new Set(process.env.STRANGER_WALK_ONLY.split(",")) : null;
/** $0 mode for debugging the walk itself (zero-token rule): every chat POST is aborted before it reaches inference. */
const DRY = process.env.STRANGER_WALK_DRY === "1";
const ANSWER_TIMEOUT = DRY ? 15_000 : 180_000;

const turnSel = '.fl-turn--aui[data-role="assistant"]';
const brokenObs = (id: string, why: string | null, elapsedMs = 0): Observation =>
  ({ id, broken: why, rendered: null, cards: [], streamStatus: null, errorPart: null, viewerOpened: null, sse: null, elapsedMs });
const sseStatus = (sse: string | null) => {
  let status: string | null = null;
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try { const f = JSON.parse(line.slice(6)); if (f?.kind === "status") status = String(f.status); } catch { /* [DONE] etc. */ }
  }
  return status;
};

async function signUp(page: Page, base: string): Promise<string> {
  await page.goto(`${base}/signup/`);
  await page.locator("#signup-email").fill(`strangerwalk-${RUN_ID.toLowerCase()}@factorylm.com`);
  await page.locator("#signup-password").fill(`Sw!${crypto.randomUUID()}Aa1`);
  await page.getByRole("button", { name: /create|sign up/i }).first().click();
  await page.waitForURL(/\/v3\/?/, { timeout: 60_000 });
  const me = await page.evaluate(async () => (await (await fetch("/api/me/")).json()) as { tenantId?: string });
  if (!me.tenantId) throw new Error("signed up but /api/me has no tenantId");
  return me.tenantId;
}

async function newProject(page: Page, name: string) {
  page.once("dialog", (d) => void d.accept(name));
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("heading", { level: 1, name }).waitFor({ timeout: 30_000 });
}

/** The open project's source for this manual, as the page itself fetches it (null: not attached). */
async function sourceReadiness(page: Page, filename: string): Promise<{ label?: string; canChat?: boolean } | null> {
  const nb = new URL(page.url()).searchParams.get("notebook");
  const sources = await page.evaluate(async (id) => {
    const r = await fetch(`/api/equipment-notebooks/${id}/`, { cache: "no-store" });
    return r.ok ? ((await r.json()).sources as { filename: string; readiness?: { label?: string; canChat?: boolean } }[]) : [];
  }, nb);
  const s = sources.find((x) => x.filename === filename);
  return s ? (s.readiness ?? {}) : null;
}

/** Wait until the manual's readiness label says it can be asked ("Ready to ask"). */
async function waitReady(page: Page, filename: string): Promise<string> {
  const deadline = Date.now() + 120_000;
  let label = "no source yet";
  while (Date.now() < deadline) {
    const r = await sourceReadiness(page, filename);
    label = r?.label ?? label;
    if (r?.canChat) return label;
    await page.waitForTimeout(2_000);
  }
  throw new Error(`source never became ready (last label: ${label})`);
}

async function ask(page: Page, q: Question, attach: { name: string; buffer: Buffer } | null): Promise<Observation> {
  const t0 = Date.now();
  const before = await page.locator(turnSel).count();
  if (attach) {
    await page.getByRole("button", { name: "Add attachment" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 30_000 }), page.getByRole("button", { name: "File" }).click()]);
    await chooser.setFiles({ name: attach.name, mimeType: "application/pdf", buffer: attach.buffer });
  }
  await UI.clone.composer(page).fill(q.question);
  const chat = page.waitForResponse((r: Response) => r.request().method() === "POST" && /\/chat\/?$/.test(new URL(r.url()).pathname), { timeout: ANSWER_TIMEOUT });
  await page.getByRole("button", { name: "Send" }).click();
  const broken = (why: string): Observation => {
    void page.screenshot({ path: path.join(OUT, "shots", `${q.id}.png`) }).catch(() => undefined);
    return brokenObs(q.id, why, Date.now() - t0);
  };

  const res = await chat.catch(() => null);
  if (!res) {
    const err = await page.getByRole("alert", { name: "Send error" }).innerText().catch(() => "");
    return broken(`no chat response${err ? `: ${err.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  }
  if (res.status() !== 200) return broken(`chat POST ${res.status()}`);
  const sse = await res.text().catch(() => null);
  const turn = page.locator(turnSel).nth(before);
  try {
    await turn.and(page.locator(':not([data-lifecycle="running"])')).waitFor({ timeout: ANSWER_TIMEOUT });
  } catch {
    return { ...broken("answer never settled"), sse };
  }
  await page.waitForTimeout(1_500); // the post-turn detail refetch swaps live → persisted; read what then stays on screen
  const settled = await UI.clone.settled(page);
  const rendered = await extractTurn("clone", settled);
  const errorPart = await settled.locator('[data-part-type="error"]').first().getAttribute("data-error-code").catch(() => null);

  const cards = await settled.locator('[data-part-type="source"]').evaluateAll((els) => els.map((e) => ({
    title: (e.querySelector(".fl-source__title")?.textContent ?? "").trim(),
    page: /\bp\.\s*(\d+)/.exec(e.querySelector(".fl-source__locator")?.textContent ?? "")?.[1] ?? null,
  })));

  // Open the first citation the way a technician would: the inline chip, else the first source card.
  let viewerOpened: boolean | null = null;
  const inline = settled.getByRole("button", { name: /^Open citation / }).first();
  const chip = (await inline.count()) ? inline : settled.locator('[data-part-type="source"]').first();
  if (await chip.count()) {
    await chip.click();
    viewerOpened = await UI.clone.viewerFrame(page).waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    await page.keyboard.press("Escape");
  }
  return { id: q.id, broken: null, rendered, cards, streamStatus: sseStatus(sse), errorPart, viewerOpened, sse, elapsedMs: Date.now() - t0 };
}

test("stranger walk", async ({ page }) => {
  test.setTimeout(150 * 60_000);
  const base = stagingBase();
  mkdirSync(path.join(OUT, "fixtures"), { recursive: true });
  mkdirSync(path.join(OUT, "shots"), { recursive: true });
  if (DRY) await page.route(/\/chat\/?$/, (r) => r.request().method() === "POST" ? r.abort() : r.fallback());
  const start = await identity(base);
  const obs: Observation[] = [];
  const notes: string[] = [`budget $${BUDGET.usdPerRun} at ≤$${BUDGET.usdCeilingPerTurn}/turn → hard stop after ${MAX_TURNS} turns`];
  let tenantId: string | null = null;
  let turns = 0;
  try {
    tenantId = await signUp(page, base);
    writeFileSync(path.join(OUT, "tenant.txt"), tenantId); // teardown reads this on every exit path
    for (const m of corpus.manuals) {
      const qs = corpus.questions.filter((q) => q.manual === m.id && (!ONLY || ONLY.has(q.id)));
      if (!qs.length) continue;
      const pdf = await manualBytes(m, process.env.STRANGER_WALK_CACHE ?? path.join(__dirname, ".out", "manuals"));
      if (!pdf.bytes) { for (const q of qs) obs.push(brokenObs(q.id, pdf.problem)); continue; }
      let uploaded = false;
      try { await newProject(page, `${m.oem} ${m.id}`); } catch (e) {
        for (const q of qs) obs.push(brokenObs(q.id, `project create failed: ${(e as Error).message.split("\n")[0]}`));
        continue;
      }
      for (const [i, q] of qs.entries()) {
        if (turns >= MAX_TURNS) { obs.push(brokenObs(q.id, "budget stop")); continue; }
        try {
          if (i > 0) {
            await page.getByRole("button", { name: "New chat" }).click();
            await page.waitForTimeout(1_000);
            // The upload rode the first question; whether it landed is the project's own source list.
            uploaded ||= (await sourceReadiness(page, m.filename)) !== null;
            if (uploaded) notes.push(`${q.id}: readiness "${await waitReady(page, m.filename)}"`);
          }
          turns++;
          obs.push(await ask(page, q, uploaded ? null : { name: m.filename, buffer: pdf.bytes }));
        } catch (e) {
          await page.screenshot({ path: path.join(OUT, "shots", `${q.id}.png`) }).catch(() => undefined);
          obs.push(brokenObs(q.id, `walker: ${(e as Error).message.split("\n")[0].slice(0, 200)}`));
        }
        writeFileSync(path.join(OUT, "observations.json"), JSON.stringify(obs, null, 2));
      }
    }
  } catch (e) {
    notes.push(`run aborted: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    const end = await identity(base).catch(() => null);
    const superseded = !end || end.gitSha !== start.gitSha || end.builtAt !== start.builtAt;
    if (superseded) notes.push(`SUPERSEDED: staging changed during the run (${start.gitSha.slice(0, 9)}@${start.builtAt} → ${end ? `${end.gitSha.slice(0, 9)}@${end.builtAt}` : "unreadable"})`);
    const td = tenantId ? teardownTenant(tenantId) : { ok: true, detail: "no tenant was created" };
    notes.push(`teardown: ${td.ok ? "OK" : "FAILED"} — ${td.detail}`);
    const asked = ONLY ? { ...corpus, questions: corpus.questions.filter((q) => ONLY.has(q.id)) } : corpus;
    const rows = scoreAll(asked, obs);
    const card = scorecard(rows);
    const meta = { ...start, runId: RUN_ID };
    for (const r of rows.filter((x) => x.classification !== "CORRECT" || x.safetyRedLine)) {
      const q = corpus.questions.find((x) => x.id === r.id)!;
      const o = obs.find((x) => x.id === r.id) ?? brokenObs(r.id, r.reason);
      writeFileSync(path.join(OUT, "fixtures", `${r.id}.json`), JSON.stringify(fixtureFor(q, corpus.manuals.find((x) => x.id === q.manual)!, o, r, meta, corpus.tolerance), null, 2));
    }
    writeFileSync(path.join(OUT, "observations.json"), JSON.stringify(obs, null, 2));
    writeFileSync(path.join(OUT, "scored.json"), JSON.stringify({ meta, turns, notes, card, rows }, null, 2));
    writeFileSync(path.join(OUT, "scorecard.md"), `${markdownScorecard(rows, card, meta)}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n`);
    console.log(`stranger walk ${card.headline} · ${JSON.stringify(card.counts)} · red lines ${card.safetyRedLines.length} · ${OUT}`);
    if (!td.ok) throw new Error(`tenant teardown failed: ${td.detail}`);
  }
});

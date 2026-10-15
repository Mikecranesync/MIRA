/**
 * Stranger Walk replay (#4460) — $0, no staging, no inference.
 *
 * Serves every recorded staging chat stream from a walk (observations.json)
 * to the REAL /v3 code on `next dev`, through the fidelity harness's declared
 * network (harness.ts), extracts the turn with the same surfaces.ts, and
 * scores it with the same score.ts. Two uses:
 *  - control: the replayed classification must equal the live one, row by row
 *    (proves extraction + scoring read what staging rendered);
 *  - seeded defects (mutations.mjs): with /v3 code mutated, every row must
 *    land exactly where `predict()` says (prove-the-test-fails).
 * A failure fixture's `message` + `sse` replays the same way, so a fix can be
 * written test-first against it.
 *
 *   STRANGER_WALK_REPLAY_FROM=<walk out dir> [STRANGER_WALK_MUTATION=control|strip-sources|page-offset] \
 *     npx playwright test --config tests/stranger-walk/playwright.replay.config.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { addSessionCookie, DOC, FILE, installRoutes, oracle, type Scenario } from "../fidelity/harness";
import { extractTurn, UI } from "../fidelity/surfaces";
import corpusJson from "./corpus.json";
import { classify, predict, type Classification, type Corpus, type Mutation, type Observation, type Scored } from "./score";

const corpus = corpusJson as Corpus;
const FROM = process.env.STRANGER_WALK_REPLAY_FROM ?? "";
const MUTATION = (process.env.STRANGER_WALK_MUTATION ?? "control") as "control" | Mutation;

/** Staging ids → the oracle's notebook source, so the replayed notebook owns the cited document. */
function rehome(sse: string): string {
  return sse.split("\n").map((line) => {
    if (!line.startsWith("data: ")) return line;
    try {
      const f = JSON.parse(line.slice(6));
      if (f?.kind === "sources" && Array.isArray(f.citations)) {
        f.citations = f.citations.map((c: Record<string, unknown>) => ({ ...c, docId: DOC, fileId: c.fileId ? FILE : c.fileId, originFileId: null }));
        return `data: ${JSON.stringify(f)}`;
      }
    } catch { /* [DONE] */ }
    return line;
  }).join("\n");
}

const sseStatus = (sse: string) => {
  let s: string | null = null;
  for (const l of sse.split("\n")) if (l.startsWith("data: ")) { try { const f = JSON.parse(l.slice(6)); if (f?.kind === "status") s = String(f.status); } catch { /* */ } }
  return s;
};

test("replay recorded staging turns through /v3", async ({ browser, baseURL }) => {
  test.setTimeout(60 * 60_000);
  expect(FROM, "STRANGER_WALK_REPLAY_FROM must point at a walk's out dir").not.toBe("");
  const observed = JSON.parse(readFileSync(path.join(FROM, "observations.json"), "utf8")) as Observation[];
  const live = new Map((JSON.parse(readFileSync(path.join(FROM, "scored.json"), "utf8")).rows as Scored[]).map((r) => [r.id, r]));
  const rows: { id: string; live: Classification; expected: Classification; replayed: Classification; reason: string }[] = [];

  for (const o of observed.filter((x) => x.sse && live.get(x.id)?.classification !== "BROKEN")) {
    const q = corpus.questions.find((x) => x.id === o.id)!;
    const m = corpus.manuals.find((x) => x.id === q.manual)!;
    const liveRow = live.get(o.id)!;
    const sse = rehome(o.sse!);
    (oracle as Record<string, unknown>).R = { message: q.question, sse, detailAfter: oracle.G.detailAfter };

    const context = await browser.newContext();
    await addSessionCookie(context, baseURL!);
    const page = await context.newPage();
    const cap = await installRoutes(page, "R" as Scenario);
    try {
      await page.goto(UI.clone.url);
      await UI.clone.ready(page).waitFor({ timeout: 60_000 });
      await UI.clone.composer(page).fill(q.question);
      await page.getByRole("button", { name: "Send" }).click();
      const turn = await UI.clone.settled(page);
      const rendered = await extractTurn("clone", turn);
      const cards = await turn.locator('[data-part-type="source"]').evaluateAll((els) => els.map((e) => ({
        title: (e.querySelector(".fl-source__title")?.textContent ?? "").trim(),
        page: /\bp\.\s*(\d+)/.exec(e.querySelector(".fl-source__locator")?.textContent ?? "")?.[1] ?? null,
      })));
      const errorPart = await turn.locator('[data-part-type="error"]').first().getAttribute("data-error-code", { timeout: 500 }).catch(() => null);
      const replayObs: Observation = { ...o, rendered, cards, errorPart, streamStatus: sseStatus(sse) };
      const scored = classify(q, m, replayObs, corpus.tolerance);
      const expected = MUTATION === "control" ? liveRow.classification : predict(liveRow, MUTATION, corpus.tolerance);
      rows.push({ id: o.id, live: liveRow.classification, expected, replayed: scored.classification, reason: scored.reason });
    } finally {
      cap.release();
      await context.close();
    }
  }

  const count = (k: "expected" | "replayed") => rows.reduce((acc, r) => ({ ...acc, [r[k]]: (acc[r[k]] ?? 0) + 1 }), {} as Record<string, number>);
  const mismatches = rows.filter((r) => r.expected !== r.replayed);
  const summary = { mutation: MUTATION, replayed: rows.length, expected: count("expected"), got: count("replayed"), mismatches, rows };
  writeFileSync(path.join(FROM, `replay-${MUTATION}.json`), JSON.stringify(summary, null, 2));
  console.log(`replay ${MUTATION}: ${rows.length} rows · expected ${JSON.stringify(summary.expected)} · got ${JSON.stringify(summary.got)} · ${mismatches.length} mismatch(es)`);
  expect(mismatches, `rows not where ${MUTATION} predicts`).toEqual([]);
});

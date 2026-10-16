#!/usr/bin/env node
/**
 * Stranger Walk seeded defects (#4460, .claude/rules/prove-the-test-fails.md).
 *
 * For each mutation: mutate the real /v3 mapping code, replay every recorded
 * staging turn of a walk through it (replay.spec.ts, $0), and require each row
 * to land exactly where score.ts `predict()` says. Then restore. A control run
 * (no mutation) must reproduce the live classification row for row.
 *
 *   node tests/stranger-walk/mutations.mjs <walk out dir>
 *
 * Refuses a dirty target file, restores with `git checkout` in `finally`, and
 * exits 1 if any run's rows differ from the prediction.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const FROM = path.resolve(process.argv[2] ?? "");
const TI = "src/factorylm-ui/to-interaction.ts";

const MUTATIONS = {
  control: [],
  // Every source part dropped (live + persisted mappers): no inline chip, no card.
  "strip-sources": [
    { find: '    for (const c of result.citations) parts.push({ type: "source", source: sourceFor(c, opts.turnId) });\n', replace: "" },
    { find: '    for (const c of citations) parts.push({ type: "source", source: sourceFor(c, answerId) });\n', replace: "" },
  ],
  // Every page moved by +5, consistently: the inline chip (citation index), the card locator and
  // the viewer's #page anchor — a citation that is wrong everywhere, not a display mismatch.
  "page-offset": [
    { find: "  const page = citation.page ? `#page=${citation.page}` : \"\";", replace: "  const page = citation.page ? `#page=${citation.page + 5}` : \"\";" },
    { find: "    for (const c of splitEvidence(row.evidence).citations) index.set(sourceIdFor(turnId, c.citationId), c);", replace: "    for (const c of splitEvidence(row.evidence).citations) index.set(sourceIdFor(turnId, c.citationId), { ...c, page: typeof c.page === \"number\" ? c.page + 5 : c.page });" },
    { find: "  if (liveTurnId) for (const c of live) index.set(sourceIdFor(liveTurnId, c.citationId), c);", replace: "  if (liveTurnId) for (const c of live) index.set(sourceIdFor(liveTurnId, c.citationId), { ...c, page: typeof c.page === \"number\" ? c.page + 5 : c.page });" },
    { find: "  const page = citation.page ?? null;", replace: "  const page = typeof citation.page === \"number\" ? citation.page + 5 : citation.page ?? null;" },
  ],
  // The viewer opens 3 pages away from the page the chip shows (citationHref's #page anchor).
  "viewer-page": [
    { find: "  const page = citation.page ? `#page=${citation.page}` : \"\";", replace: "  const page = citation.page ? `#page=${citation.page + 3}` : \"\";" },
  ],
};

if (!FROM || FROM === path.resolve("")) { console.error("usage: node tests/stranger-walk/mutations.mjs <walk out dir>"); process.exit(2); }
if (execFileSync("git", ["status", "--porcelain", "--", TI], { encoding: "utf8" }).trim()) throw new Error(`${TI} is dirty — refusing to mutate`);

const results = [];
for (const [name, edits] of Object.entries(MUTATIONS)) {
  const original = readFileSync(TI, "utf8");
  try {
    let src = original;
    for (const e of edits) {
      const n = src.split(e.find).length - 1;
      if (n !== 1) throw new Error(`${name}: expected exactly 1 match, found ${n}: ${e.find.slice(0, 80)}`);
      src = src.replace(e.find, e.replace);
    }
    writeFileSync(TI, src);
    const out = path.join(FROM, `replay-${name}.json`);
    rmSync(out, { force: true }); // never read a previous run's summary as this run's result
    const run = spawnSync("npx", ["playwright", "test", "--config", "tests/stranger-walk/playwright.replay.config.ts"], {
      env: { ...process.env, STRANGER_WALK_REPLAY_FROM: FROM, STRANGER_WALK_MUTATION: name }, encoding: "utf8",
    });
    const summary = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { eligible: null, replayed: 0, expected: {}, got: {}, mismatches: [{ error: "replay wrote no summary" }] };
    results.push({ name, exit: run.status, eligible: summary.eligible, replayed: summary.replayed, expected: summary.expected, got: summary.got, mismatches: summary.mismatches.length });
  } finally {
    execFileSync("git", ["checkout", "--", TI]);
    execFileSync("git", ["checkout", "--", "AGENTS.md"]); // next dev rewrites it
  }
}

let bad = 0;
for (const r of results) {
  // A run that replayed nothing (or fewer rows than were eligible) proves nothing.
  const ok = r.exit === 0 && r.mismatches === 0 && r.replayed > 0 && r.replayed === r.eligible;
  if (!ok) bad++;
  console.log(`${ok ? "EXACT   " : "MISMATCH"} ${r.name.padEnd(13)} rows=${r.replayed} expected=${JSON.stringify(r.expected)} got=${JSON.stringify(r.got)} mismatches=${r.mismatches}`);
}
writeFileSync(path.join(FROM, "mutations.json"), JSON.stringify(results, null, 2));
process.exit(bad ? 1 : 0);

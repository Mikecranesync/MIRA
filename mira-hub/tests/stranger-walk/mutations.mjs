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
import { readFileSync, writeFileSync } from "node:fs";
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
  // Every rendered page moved by +5: the inline chip (citation index) and the card locator.
  "page-offset": [
    { find: "    for (const c of splitEvidence(row.evidence).citations) index.set(sourceIdFor(turnId, c.citationId), c);", replace: "    for (const c of splitEvidence(row.evidence).citations) index.set(sourceIdFor(turnId, c.citationId), { ...c, page: typeof c.page === \"number\" ? c.page + 5 : c.page });" },
    { find: "  if (liveTurnId) for (const c of live) index.set(sourceIdFor(liveTurnId, c.citationId), c);", replace: "  if (liveTurnId) for (const c of live) index.set(sourceIdFor(liveTurnId, c.citationId), { ...c, page: typeof c.page === \"number\" ? c.page + 5 : c.page });" },
    { find: "  const page = citation.page ?? null;", replace: "  const page = typeof citation.page === \"number\" ? citation.page + 5 : citation.page ?? null;" },
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
    const run = spawnSync("npx", ["playwright", "test", "--config", "tests/stranger-walk/playwright.replay.config.ts"], {
      env: { ...process.env, STRANGER_WALK_REPLAY_FROM: FROM, STRANGER_WALK_MUTATION: name }, encoding: "utf8",
    });
    const summary = JSON.parse(readFileSync(path.join(FROM, `replay-${name}.json`), "utf8"));
    results.push({ name, exit: run.status, replayed: summary.replayed, expected: summary.expected, got: summary.got, mismatches: summary.mismatches.length });
  } finally {
    execFileSync("git", ["checkout", "--", TI]);
    execFileSync("git", ["checkout", "--", "AGENTS.md"]); // next dev rewrites it
  }
}

let bad = 0;
for (const r of results) {
  const ok = r.exit === 0 && r.mismatches === 0;
  if (!ok) bad++;
  console.log(`${ok ? "EXACT   " : "MISMATCH"} ${r.name.padEnd(13)} rows=${r.replayed} expected=${JSON.stringify(r.expected)} got=${JSON.stringify(r.got)} mismatches=${r.mismatches}`);
}
writeFileSync(path.join(FROM, "mutations.json"), JSON.stringify(results, null, 2));
process.exit(bad ? 1 : 0);

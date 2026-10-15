#!/usr/bin/env node
/**
 * AC8 seeded-defect proof (ADR-0038, #4439): mutate the CLONE's code (never
 * the fixture, never a module both surfaces share), run the harness, and
 * check that exactly the predicted checks turn red. Every mutated file is
 * restored with `git checkout` on every exit path.
 *
 *   node tests/fidelity/mutations.mjs            # control + M1..M4
 *   node tests/fidelity/mutations.mjs M2         # one
 *
 * Expected red sets are written BEFORE the run (prove-the-test-fails.md); the
 * control's standing red ("safety notice first") is part of every baseline.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TI = "src/factorylm-ui/to-interaction.ts";
const LOGIC = "src/factorylm-ui/hub-host-logic.ts";
const BASELINE = ["rendered turn: safety notice first (AC4, S)"];

const MUTATIONS = {
  control: { what: "unchanged clone", edits: [], red: [] },
  M1: {
    what: "drop citations (no source parts, so no chips) in both mappers",
    edits: [
      { file: TI, find: 'parts.push({ type: "source", source: sourceFor(c, opts.turnId) });', replace: "void c;", count: 1 },
      { file: TI, find: 'parts.push({ type: "source", source: sourceFor(c, answerId) });', replace: "void c;", count: 1 },
    ],
    red: ["rendered turn: grounded answer (AC4, G)", "citation inspectable: opens the cited doc + page (AC5)"],
  },
  M2: {
    what: "suppress every safety part (stream + persisted)",
    edits: [{ file: TI, find: "parts.push(safetyNoticePart(", replace: "void (safetyNoticePart(", count: 4 }],
    red: ["rendered turn: safety notice present (AC4, S)"],
  },
  M3: {
    what: "hydrated turns lose the evidence label (persisted mapper only)",
    edits: [{
      file: TI, find: "if (row.basis) parts.push(basisPart(row.basis, citations, meta.notebookDocIds));",
      replace: "void basisPart;", count: 1,
    }],
    red: ["live ≡ hydrated: G (AC6)", "live ≡ hydrated: S (AC6)"],
  },
  M4: {
    what: "omit sourceDocIds from the chat request",
    edits: [{
      file: LOGIC, find: "const base = buildChatBody(question, [...docIds], history);",
      replace: "const { sourceDocIds: _m4, ...base } = buildChatBody(question, [...docIds], history);", count: 1,
    }],
    red: ["request: G — normalized chat body equal (AC3)", "request: S — normalized chat body equal (AC3)"],
  },
};

function apply(edits) {
  for (const f of new Set(edits.map((e) => e.file))) {
    if (execFileSync("git", ["status", "--porcelain", "--", f], { encoding: "utf8" }).trim()) {
      throw new Error(`${f} is dirty — refusing to mutate`);
    }
  }
  for (const e of edits) {
    const src = readFileSync(e.file, "utf8");
    const n = src.split(e.find).length - 1;
    if (n !== e.count) throw new Error(`${e.file}: expected ${e.count} match(es) of ${JSON.stringify(e.find)}, found ${n}`);
    writeFileSync(e.file, src.split(e.find).join(e.replace));
  }
}

function restore(edits) {
  const files = [...new Set(edits.map((e) => e.file))];
  if (files.length) execFileSync("git", ["checkout", "--", ...files]);
}

function run() {
  const r = spawnSync("npx", ["playwright", "test", "--config", "tests/fidelity/playwright.fidelity.config.ts", "--reporter=json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const report = JSON.parse(r.stdout);
  const results = [];
  const walk = (suite) => {
    for (const s of suite.specs ?? []) for (const t of s.tests) results.push({ title: s.title, status: t.results.at(-1)?.status });
    for (const c of suite.suites ?? []) walk(c);
  };
  for (const s of report.suites) walk(s);
  return results;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTATIONS);
let ok = true;
for (const id of ids) {
  const m = MUTATIONS[id];
  let results;
  try { apply(m.edits); results = run(); } finally { restore(m.edits); }
  const red = results.filter((r) => r.status !== "passed").map((r) => r.title).sort();
  const expected = [...BASELINE, ...m.red].sort();
  const exact = JSON.stringify(red) === JSON.stringify(expected);
  ok &&= exact;
  console.log(`${id} (${m.what}): ${results.length - red.length} passed, ${red.length} red — ${exact ? "EXACT" : "MISMATCH"}`);
  for (const t of red) console.log(`    red: ${t}`);
  if (!exact) console.log(`    expected red: ${JSON.stringify(expected)}`);
}
process.exit(ok ? 0 : 1);

/**
 * Citation-integrity checker for multi-turn battery runs.
 *
 * Answer correctness alone is insufficient: a response that says the right
 * number but cites a page that doesn't contain it is a FAIL. For each
 * cite-oracle.json check this verifies, against a battery-<label>.json run:
 *   1. required answer markers present (answer_all / answer_any) and
 *      forbidden phrasings absent (answer_none);
 *   2. at least one CITED page's chunk text (fetched from the notebook DB)
 *      matches the check's `support` regex — the citation must itself prove
 *      the claim, not merely be a nearby page;
 *   3. `abstain` checks: refusal status/phrasing with ZERO citations.
 *
 * Usage (dev): doppler run -p factorylm -c dev -- \
 *   node tests/equipment/benchmark/cite-check.mjs runs/battery-<label>.json
 * Requires NEON_DATABASE_URL (chunk-text lookups). Exit code = failures.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const runFile = process.argv[2];
if (!runFile) {
  console.error("usage: cite-check.mjs <battery-run.json>");
  process.exit(2);
}
const run = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, runFile), "utf8"));
const oracle = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "cite-oracle.json"), "utf8"));

const cs = (process.env.NEON_DATABASE_URL || "")
  .replace(/[?&](sslmode|ssl|channel_binding)=[^&]*/g, "")
  .replace(/\?$/, "");
if (!cs) {
  console.error("NEON_DATABASE_URL not set — run under doppler (factorylm/dev)");
  process.exit(2);
}
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

async function pageText(file, page) {
  const { rows } = await pool.query(
    `SELECT content FROM knowledge_entries
      WHERE (metadata->>'filename') = $1 AND source_page = $2 LIMIT 20`,
    [file, page],
  );
  return rows.map((r) => String(r.content)).join("\n");
}

const norm = (s) => (s || "").normalize("NFKC").replace(/[‐-―−]/g, "-");
let failures = 0;
const report = [];

for (const check of oracle.checks) {
  const conv = (run.conversations || []).find((c) => c.id === check.conv);
  const turn = conv?.turns?.[check.turn - 1];
  const label = `${check.conv} T${check.turn}`;
  if (!turn) {
    report.push(`SKIP ${label} — turn not present in run`);
    continue;
  }
  const answer = norm(turn.answer);
  const problems = [];

  if (check.abstain) {
    const refused =
      turn.status === "insufficient_evidence" ||
      /\b(do(es)? not|don'?t|couldn'?t|cannot|not (specified|provided|listed|contained?|covered))\b/i.test(answer);
    if (!refused) problems.push("expected an abstention, got a substantive answer");
    if ((turn.citations || []).length > 0) problems.push("refusal ships citations");
  } else {
    for (const m of check.answer_all ?? []) {
      if (!answer.includes(norm(m))) problems.push(`missing required marker "${m}"`);
    }
    if (check.answer_any && !check.answer_any.some((m) => answer.toLowerCase().includes(norm(m).toLowerCase()))) {
      problems.push(`none of [${check.answer_any}] present`);
    }
    for (const m of check.answer_none ?? []) {
      if (answer.toLowerCase().includes(norm(m).toLowerCase())) problems.push(`forbidden phrasing "${m}"`);
    }
    const cites = turn.citations || [];
    if (cites.length === 0) {
      problems.push("grounded claim with zero citations");
    } else if (check.support) {
      const re = new RegExp(check.support, "i");
      let supported = false;
      for (const c of cites) {
        const text = norm(await pageText(c.file, c.page));
        if (re.test(text)) {
          supported = true;
          break;
        }
      }
      if (!supported) {
        problems.push(
          `no cited page (${cites.map((c) => `${c.file} p.${c.page}`).join(", ")}) matches support regex`,
        );
      }
    }
  }

  if (problems.length) {
    failures++;
    report.push(`FAIL ${label} — ${problems.join("; ")}\n     A: ${answer.slice(0, 160)}`);
  } else {
    report.push(`pass ${label}`);
  }
}

console.log(report.join("\n"));
console.log(`\ncitation-integrity: ${oracle.checks.length - failures}/${oracle.checks.length} pass`);
await pool.end();
process.exit(failures);

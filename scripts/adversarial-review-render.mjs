#!/usr/bin/env node
// Validate a Codex adversarial-review JSON envelope and render the PR comment.
//
// Usage:
//   node scripts/adversarial-review-render.mjs <envelope.json> \
//        --sha <reviewed_sha> --base <base_sha> --iteration <n> [--check-only]
//
// Exit codes: 0 = valid (comment on stdout unless --check-only; then a status
// line), 3 = malformed envelope. Fail-safe: malformed output is NEVER GREEN.
//
// Status is RE-DERIVED from the findings: any BLOCKER/HIGH/MEDIUM/LOW forces
// ISSUES_FOUND regardless of what the model claimed. A claimed GREEN with real
// findings is downgraded; a claimed ISSUES_FOUND with none is kept (never
// upgrade toward GREEN).

import { readFileSync } from "node:fs";

const SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "FALSE_POSITIVE"];
const COUNTED = ["BLOCKER", "HIGH", "MEDIUM", "LOW"];
const CONFIDENCES = ["observed", "supported", "speculative"];
const MAX_BODY = 60000; // GitHub comment hard limit is 65536

function fail(msg) {
  process.stderr.write(`envelope invalid: ${msg}\n`);
  process.exit(3);
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

const file = process.argv[2];
if (!file || file.startsWith("--")) fail("usage: render.mjs <envelope.json> --sha S --base B --iteration N");
const sha = arg("--sha");
const baseSha = arg("--base", "(unknown)");
const iteration = Number(arg("--iteration", "1"));
const checkOnly = process.argv.includes("--check-only");
// Post-cap human authorization (Mike, 2026-08-17): stamped INTO the durable
// record so a post-cap review is visibly authorized, never silent. The line
// sits AFTER review_iteration so the strict ledger envelope is unaffected.
const humanAuthorized = process.argv.includes("--human-authorized");
// Reservation binding (Codex iteration-4 F1): the review record carries the
// run_id + reservation comment id it executed under, after the strict-parsed
// prefix lines so the ledger envelope is unaffected.
const runId = arg("--run-id", null);
const reservationId = arg("--reservation-id", null);
if (runId !== null && !/^[0-9a-f]{32}$/.test(runId)) fail("--run-id must be 32 lowercase hex chars");
if (reservationId !== null && !/^[0-9]+$/.test(reservationId)) fail("--reservation-id must be numeric");
if (!sha) fail("--sha is required");
if (!Number.isInteger(iteration) || iteration < 1) fail("--iteration must be a positive integer");

let env;
try {
  env = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  fail(`not parseable JSON: ${e.message}`);
}
if (typeof env !== "object" || env === null || Array.isArray(env)) fail("top level must be an object");
if (!["GREEN", "ISSUES_FOUND"].includes(env.status)) fail(`bad status: ${JSON.stringify(env.status)}`);
if (typeof env.summary !== "string" || env.summary.length === 0) fail("summary missing");
if (!Array.isArray(env.findings)) fail("findings must be an array");
if (!Array.isArray(env.files_reviewed) || env.files_reviewed.some((f) => typeof f !== "string")) {
  fail("files_reviewed must be an array of strings");
}

for (const [i, f] of env.findings.entries()) {
  if (typeof f !== "object" || f === null) fail(`finding[${i}] not an object`);
  for (const k of ["id", "severity", "title", "file", "confidence", "failure_scenario", "evidence", "remediation", "test_to_prove"]) {
    if (typeof f[k] !== "string" || f[k].length === 0) fail(`finding[${i}].${k} missing`);
  }
  if (!SEVERITIES.includes(f.severity)) fail(`finding[${i}].severity ${f.severity} not in ${SEVERITIES}`);
  if (!CONFIDENCES.includes(f.confidence)) fail(`finding[${i}].confidence ${f.confidence} not in ${CONFIDENCES}`);
}

const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
for (const f of env.findings) counts[f.severity] += 1;
const realCount = COUNTED.reduce((n, s) => n + counts[s], 0);
// Never upgrade toward GREEN. Downgrade a claimed GREEN that carries findings.
const status = realCount > 0 ? "ISSUES_FOUND" : env.status;

if (checkOnly) {
  process.stdout.write(`${status} blocker=${counts.BLOCKER} high=${counts.HIGH} medium=${counts.MEDIUM} low=${counts.LOW}\n`);
  process.exit(0);
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + "\n…(truncated)" : s);

const lines = [];
lines.push("[CODEX-ADVERSARIAL-REVIEW]");
lines.push("");
lines.push("```");
lines.push(`reviewed_sha: ${sha}`);
lines.push(`base_sha: ${baseSha}`);
lines.push(`status: ${status}`);
lines.push(`review_iteration: ${iteration}`);
if (humanAuthorized) lines.push("post_cap_human_authorized: true");
if (runId) lines.push(`run_id: ${runId}`);
if (reservationId) lines.push(`reservation_comment_id: ${reservationId}`);
lines.push("");
lines.push(`BLOCKER: ${counts.BLOCKER}`);
lines.push(`HIGH: ${counts.HIGH}`);
lines.push(`MEDIUM: ${counts.MEDIUM}`);
lines.push(`LOW: ${counts.LOW}`);
lines.push(`FALSE_POSITIVE: ${counts.FALSE_POSITIVE}`);
lines.push("```");
lines.push("");
if (status === "GREEN") {
  lines.push("```");
  lines.push("ADVERSARIAL GATE: GREEN");
  lines.push(`reviewed_sha: ${sha}`);
  lines.push("```");
  lines.push("");
}
lines.push(`**Summary:** ${clip(env.summary, 2000)}`);
lines.push("");
lines.push(`**Files reviewed (${env.files_reviewed.length}):** ${clip(env.files_reviewed.map((f) => `\`${f}\``).join(", "), 2000)}`);
lines.push("");

const order = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3, FALSE_POSITIVE: 4 };
const sorted = [...env.findings].sort((a, b) => order[a.severity] - order[b.severity]);
for (const f of sorted) {
  lines.push(`---`);
  lines.push(`### ${f.id} · ${f.severity} · ${clip(f.title, 200)}`);
  lines.push("");
  lines.push(`- **File:** \`${f.file}\`${f.line != null ? `:${f.line}` : ""}${f.symbol ? ` (\`${f.symbol}\`)` : ""}`);
  lines.push(`- **Confidence:** ${f.confidence}`);
  lines.push(`- **Failure scenario:** ${clip(f.failure_scenario, 1500)}`);
  lines.push(`- **Evidence:** ${clip(f.evidence, 2000)}`);
  lines.push(`- **Remediation:** ${clip(f.remediation, 1500)}`);
  lines.push(`- **Test to prove:** ${clip(f.test_to_prove, 800)}`);
  lines.push("");
}
lines.push("---");
lines.push("_Posted by `scripts/adversarial-review.sh` — Codex CLI adversarial lane. See `docs/adversarial-review-workflow.md`._");

let body = lines.join("\n");
if (body.length > MAX_BODY) {
  body = body.slice(0, MAX_BODY) + "\n\n…(comment truncated — full envelope in the runner's artifact file)";
}
process.stdout.write(body);

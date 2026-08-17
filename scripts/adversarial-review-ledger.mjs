#!/usr/bin/env node
// Parse the PR-comment review ledger — the ONE place validated review records
// are recognized and counted. Both adversarial-review.sh and
// adversarial-review-loop.sh consume this; neither may re-implement it.
//
// Usage:
//   node scripts/adversarial-review-ledger.mjs <comments.json> <viewer_login> [--sha <head_sha>]
//
// stdout: one JSON object:
//   {
//     "next_iteration": N,   // max validated review_iteration + 1 (>= 1)
//     "consumed": N,         // DISTINCT validated (reviewed_sha, iteration) records
//     "already": 0|1,        // a validated record exists at --sha
//     "prior_status": "NONE" | "GREEN" | "ISSUES_FOUND" | "MALFORMED"
//   }
//
// Trust boundary (Codex F1, PR #3279 round 2): anyone who can comment can type
// the marker. A record counts ONLY if (a) authored by the SAME GitHub account
// this runner posts as, and (b) the metadata envelope parses STRICTLY (marker
// line, blank line, fenced block opening with exact reviewed_sha / base_sha /
// status / review_iteration lines). Malformed or forged comments are ignored —
// they can never mint a GREEN, and they never move the iteration counter.
//
// Iteration + budget rules (Mike's 2026-08-17 hardening):
//   - next_iteration derives from the MAX validated review_iteration, never a
//     raw comment count — duplicate posts of the same record cannot inflate it.
//   - consumed counts DISTINCT (reviewed_sha, review_iteration) pairs — the
//     durable cross-restart review budget. A restarted loop resumes the same
//     budget instead of minting three fresh autonomous rounds.
//
// Exit codes: 0 ok · 3 unusable input (callers must treat as tooling failure,
// never as an empty ledger).

import { readFileSync } from "node:fs";

const MARKER = "[CODEX-ADVERSARIAL-REVIEW]";
// Strict envelope. render.mjs emits exactly this shape; order is load-bearing.
const HEAD_RE =
  /^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\nreview_iteration: ([0-9]+)\r?\n/;

function fail(msg) {
  process.stderr.write(`ledger unusable: ${msg}\n`);
  process.exit(3);
}

const [file, viewer] = process.argv.slice(2);
if (!file || !viewer || viewer.startsWith("--")) {
  fail("usage: adversarial-review-ledger.mjs <comments.json> <viewer_login> [--sha <head_sha>]");
}
const shaIdx = process.argv.indexOf("--sha");
const headSha = shaIdx !== -1 ? process.argv[shaIdx + 1] : null;
if (shaIdx !== -1 && (!headSha || !/^[0-9a-f]{40}$/.test(headSha))) {
  fail("--sha requires a full 40-char lowercase hex SHA");
}

let raw;
try {
  raw = readFileSync(file, "utf8");
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}
let arr;
try {
  // `gh api --paginate` can emit concatenated arrays: "][" — normalize.
  arr = JSON.parse("[" + raw.replace(/\]\s*\[/g, ",").replace(/^\s*\[|\]\s*$/g, "") + "]");
} catch (e) {
  fail(`comments file is not parseable JSON: ${e.message}`);
}

const mine = arr.filter(
  (c) => typeof c.body === "string" && c.body.startsWith(MARKER) && c.user && c.user.login === viewer,
);
const validated = [];
let sawMalformedAtSha = false;
for (const c of mine) {
  const m = c.body.match(HEAD_RE);
  if (m) {
    validated.push({ sha: m[1], status: m[2], iteration: Number(m[3]) });
  } else if (headSha && c.body.includes(`reviewed_sha: ${headSha}`)) {
    sawMalformedAtSha = true;
  }
}

const nextIteration = validated.length ? Math.max(...validated.map((r) => r.iteration)) + 1 : 1;
const consumed = new Set(validated.map((r) => `${r.sha}#${r.iteration}`)).size;

let already = 0;
let priorStatus = "NONE";
if (headSha) {
  const atSha = validated.filter((r) => r.sha === headSha);
  if (atSha.length) {
    already = 1;
    priorStatus = atSha[atSha.length - 1].status;
  } else if (sawMalformedAtSha) {
    priorStatus = "MALFORMED";
  }
}

process.stdout.write(
  JSON.stringify({ next_iteration: nextIteration, consumed, already, prior_status: priorStatus }) + "\n",
);

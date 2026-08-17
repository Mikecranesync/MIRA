#!/usr/bin/env node
// Parse the PR-comment review ledger — the ONE place validated review records,
// round reservations, and remediation completions are recognized and counted.
// Both adversarial-review.sh and adversarial-review-loop.sh consume this;
// neither may re-implement it.
//
// Usage:
//   node scripts/adversarial-review-ledger.mjs <comments.json> <viewer_login> \
//        [--sha <head_sha>] [--run-id <32-hex>]
//
// stdout: one JSON object:
//   {
//     "next_iteration": N,        // max validated review_iteration + 1 (>= 1)
//     "consumed": N,              // durable autonomous rounds consumed (see below)
//     "already": 0|1,             // a validated review record exists at --sha
//     "prior_status": "NONE" | "GREEN" | "ISSUES_FOUND" | "MALFORMED",
//     "reservations": N,          // valid reservation records (post-collapse)
//     "canonical_full": N,        // canonical FULL reservations (budget slots)
//     // with --sha:
//     "canonical_run_id_for_sha": "<32-hex>" | null,
//     // with --run-id:
//     "mine_found": 0|1,          // my reservation exists (earliest comment wins)
//     "mine_comment_id": N|null,
//     "mine_is_canonical_for_its_sha": 0|1,
//     "canonical_full_before_mine": N,  // budget slots consumed AHEAD of mine
//     "remediation_completed_for_run_id": 0|1
//   }
//
// Trust boundary (Codex F1, PR #3279 round 2): anyone who can comment can type
// a marker. A record counts ONLY if (a) authored by the SAME GitHub account
// this runner posts as, and (b) its metadata envelope parses STRICTLY.
// Malformed or forged comments are ignored — they can never mint a GREEN,
// move the iteration counter, or create/steal a reservation.
//
// Round reservations (Codex iteration-4 F1, 2026-08-17): the durable budget
// was check-then-act — two concurrent invocations could both observe a free
// slot, and their identical (sha, iteration) review records later collapsed
// into one consumed slot. Reservations make the round acquisition atomic at
// the GitHub ledger:
//   - A runner POSTS a reservation (unique 128-bit run_id) BEFORE running
//     Codex, then re-reads the ledger and proceeds only if its reservation is
//     CANONICAL for the reserved head.
//   - Canonical = the earliest valid reservation for a given head_sha by
//     immutable numeric comment id (creation time is advisory only). Later
//     reservations for the same head LOSE, deterministically, forever — a
//     crashed winner conservatively keeps the slot consumed; work continues
//     only on a NEW head (or by explicit human-authorized review-only).
//   - Distinct run_ids never collapse. Duplicate posts of the SAME run_id
//     collapse to the earliest comment id (idempotent retry), and a caller
//     whose own comment id is not that earliest must fail closed.
//   - consumed is a PER-HEAD union (round-5 F1, 2026-08-17): for each head,
//     max(validated review rounds at that head, 1 if it holds the canonical
//     FULL reservation), summed across heads. A completed reservation-era
//     round (reservation + review record at the SAME head) is one slot — no
//     double count — while a crashed FULL reservation at a NEW head and
//     legacy review rounds at OTHER heads are ADDITIVE. The former global
//     max(reviewRounds, canonicalFull) let a crashed reservation vanish
//     behind the legacy count, undercounting the consume-at-reservation
//     contract. The per-head union is >= the global max on every ledger, so
//     it can only close that undercount, never relax an existing count.
//
// Exit codes: 0 ok · 3 unusable input (callers must treat as tooling failure,
// never as an empty ledger).

import { readFileSync } from "node:fs";

const REVIEW_MARKER = "[CODEX-ADVERSARIAL-REVIEW]";
const RESERVATION_MARKER = "[ADVERSARIAL-ROUND-RESERVATION]";
const REMEDIATION_MARKER = "[CLAUDE-REMEDIATION]";

// Strict envelopes. The renderers/templates emit exactly these shapes; order
// is load-bearing. Anything that does not match is not a record.
const REVIEW_RE =
  /^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\nreview_iteration: ([0-9]+)\r?\n/;
const RESERVATION_RE =
  /^\[ADVERSARIAL-ROUND-RESERVATION\]\r?\n\r?\n```\r?\nrun_id: ([0-9a-f]{32})\r?\nhead_sha: ([0-9a-f]{40})\r?\nmode: (full|review_only)\r?\nhuman_authorized: (true|false)\r?\nrequested_at: [0-9TZz:.+-]+\r?\n```/;
const REMEDIATION_RE =
  /^\[CLAUDE-REMEDIATION\]\r?\n\r?\n```\r?\nremediated_review_sha: [0-9a-f]{40}\r?\nnew_head_sha: (?:[0-9a-f]{40}|none)\r?\nrun_id: ([0-9a-f]{32})\r?\n/;

function fail(msg) {
  process.stderr.write(`ledger unusable: ${msg}\n`);
  process.exit(3);
}

const [file, viewer] = process.argv.slice(2);
if (!file || !viewer || viewer.startsWith("--")) {
  fail(
    "usage: adversarial-review-ledger.mjs <comments.json> <viewer_login> [--sha <head_sha>] [--run-id <32-hex>]",
  );
}
function optArg(name, re) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || !re.test(v)) fail(`${name} requires a value matching ${re}`);
  return v;
}
const headSha = optArg("--sha", /^[0-9a-f]{40}$/);
const runId = optArg("--run-id", /^[0-9a-f]{32}$/);

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
// Immutable ordering: numeric GitHub comment id. A comment without a numeric
// id cannot participate in ordering-sensitive records (reservations).
for (const c of arr) {
  if (c && typeof c.id !== "undefined" && !Number.isInteger(c.id)) c.id = Number(c.id) || null;
}
arr.sort((a, b) => (a?.id ?? Infinity) - (b?.id ?? Infinity));

const own = (c) => typeof c.body === "string" && c.user && c.user.login === viewer;

// ── Reviews ──────────────────────────────────────────────────────────────────
const reviewComments = arr.filter((c) => own(c) && c.body.startsWith(REVIEW_MARKER));
const reviews = [];
let sawMalformedAtSha = false;
for (const c of reviewComments) {
  const m = c.body.match(REVIEW_RE);
  if (m) reviews.push({ sha: m[1], status: m[2], iteration: Number(m[3]) });
  else if (headSha && c.body.includes(`reviewed_sha: ${headSha}`)) sawMalformedAtSha = true;
}
const nextIteration = reviews.length ? Math.max(...reviews.map((r) => r.iteration)) + 1 : 1;

let already = 0;
let priorStatus = "NONE";
if (headSha) {
  const atSha = reviews.filter((r) => r.sha === headSha);
  if (atSha.length) {
    already = 1;
    priorStatus = atSha[atSha.length - 1].status;
  } else if (sawMalformedAtSha) {
    priorStatus = "MALFORMED";
  }
}

// ── Reservations ─────────────────────────────────────────────────────────────
const rawReservations = [];
for (const c of arr) {
  if (!own(c) || !c.body.startsWith(RESERVATION_MARKER) || !Number.isInteger(c.id)) continue;
  const m = c.body.match(RESERVATION_RE);
  if (!m) continue; // malformed — never a reservation
  rawReservations.push({
    runId: m[1],
    sha: m[2],
    mode: m[3],
    humanAuthorized: m[4] === "true",
    commentId: c.id,
  });
}
// Duplicate posts of the SAME run_id collapse to the earliest comment id
// (idempotent retry); DISTINCT run_ids are never collapsed.
const byRunId = new Map();
for (const r of rawReservations) if (!byRunId.has(r.runId)) byRunId.set(r.runId, r);
const reservations = [...byRunId.values()].sort((a, b) => a.commentId - b.commentId);

// Canonical reservation per head: earliest valid reservation by comment id.
const canonicalBySha = new Map();
for (const r of reservations) if (!canonicalBySha.has(r.sha)) canonicalBySha.set(r.sha, r);
const canonicalFull = [...canonicalBySha.values()]
  .filter((r) => r.mode === "full")
  .sort((a, b) => a.commentId - b.commentId);

// Per-head union (round-5 F1): budget is consumed AT RESERVATION, so a
// crashed FULL reservation must stay charged even when legacy review records
// exist at other heads. Per head: a reservation-era round that completed
// (reservation + review record, same head) is ONE slot; heads with records
// but no reservation are legacy slots; a reserved head with no record is a
// crashed-but-consumed slot. Sum — never a global max that lets one side
// hide the other.
const reviewRoundsBySha = new Map();
for (const r of reviews) {
  if (!reviewRoundsBySha.has(r.sha)) reviewRoundsBySha.set(r.sha, new Set());
  reviewRoundsBySha.get(r.sha).add(r.iteration);
}
const reservedFullShas = new Set(canonicalFull.map((r) => r.sha));
let consumed = 0;
for (const [sha, iterations] of reviewRoundsBySha) {
  consumed += Math.max(iterations.size, reservedFullShas.has(sha) ? 1 : 0);
}
for (const sha of reservedFullShas) {
  if (!reviewRoundsBySha.has(sha)) consumed += 1;
}

// ── Remediation completions (run_id-bound) ───────────────────────────────────
const completedRunIds = new Set();
for (const c of arr) {
  if (!own(c) || !c.body.startsWith(REMEDIATION_MARKER)) continue;
  const m = c.body.match(REMEDIATION_RE);
  if (m) completedRunIds.add(m[1]);
}

// ── Output ───────────────────────────────────────────────────────────────────
const out = {
  next_iteration: nextIteration,
  consumed,
  already,
  prior_status: priorStatus,
  reservations: reservations.length,
  canonical_full: canonicalFull.length,
};
if (headSha) {
  const canon = canonicalBySha.get(headSha) || null;
  out.canonical_run_id_for_sha = canon ? canon.runId : null;
}
if (runId) {
  const mine = byRunId.get(runId) || null;
  out.mine_found = mine ? 1 : 0;
  out.mine_comment_id = mine ? mine.commentId : null;
  out.mine_is_canonical_for_its_sha = mine && canonicalBySha.get(mine.sha)?.runId === runId ? 1 : 0;
  out.canonical_full_before_mine = mine
    ? canonicalFull.filter((r) => r.commentId < mine.commentId).length
    : canonicalFull.length;
  out.remediation_completed_for_run_id = completedRunIds.has(runId) ? 1 : 0;
}
process.stdout.write(JSON.stringify(out) + "\n");

#!/usr/bin/env node
// Parse the PR-comment review ledger — the ONE place validated review records,
// round reservations, and remediation completions are recognized and counted.
// Both adversarial-review.sh and adversarial-review-loop.sh consume this;
// neither may re-implement it.
//
// Usage:
//   node scripts/adversarial-review-ledger.mjs <comments.json> <viewer_login> \
//        [--sha <head_sha>] [--body-sha256 <64-hex>] [--run-id <32-hex>]
//
// stdout: one JSON object:
//   {
//     "next_iteration": N,        // max validated review_iteration + 1 (>= 1)
//     "consumed": N,              // durable autonomous rounds consumed (see below)
//     "already": 0|1,             // newest v2 review matches --sha/--body-sha256
//     "prior_status": "NONE" | "GREEN" | "ISSUES_FOUND" | "STALE_BODY" | "MALFORMED",
//     "reservations": N,          // valid legacy + v2 reservations (post-collapse)
//     "canonical_full": N,        // canonical FULL reservations (budget inputs)
//     // with --sha + --body-sha256:
//     "canonical_run_id_for_snapshot": "<32-hex>" | null,
//     // with --run-id:
//     "mine_found": 0|1,          // my reservation exists (earliest duplicate wins)
//     "mine_comment_id": N|null,
//     "mine_is_canonical_for_its_snapshot": 0|1,
//     "canonical_full_before_mine": N,  // budget slots consumed AHEAD of mine
//     "remediation_completed_for_run_id": 0|1
//   }
//
// Trust boundary (Codex F1, PR #3279 round 2): anyone who can comment can type
// a marker. A review record counts ONLY if (a) authored by the repository
// owner account this runner posts as, (b) GitHub identifies that author as a
// User, (c) the review comment has an immutable numeric id, and (d) its
// metadata envelope parses STRICTLY. Malformed or forged comments are ignored
// — they can never mint a GREEN or move the iteration/budget counters.
// Reservation/remediation accounting retains its separately documented
// same-login contract below.
//
// Round reservations (Codex iteration-4 F1, 2026-08-17): the durable budget
// was check-then-act — two concurrent invocations could both observe a free
// slot, and their identical (sha, iteration) review records later collapsed
// into one consumed slot. Reservations make the round acquisition atomic at
// the GitHub ledger:
//   - A runner POSTS a reservation (unique 128-bit run_id) BEFORE running
//     Codex, then re-reads the ledger and proceeds only if its reservation is
//     CANONICAL for the reserved (head_sha, body_sha256) snapshot.
//   - V2 canonical = the earliest valid reservation for one exact snapshot by
//     immutable numeric comment id (creation time is advisory only). Later
//     reservations for that same snapshot LOSE deterministically; a crashed
//     winner conservatively keeps the slot consumed and there is no takeover.
//     A body edit at the same head is a new reviewable snapshot, not a retry of
//     the old one.
//   - Legacy digest-less reservations remain budget evidence, canonicalized
//     per head exactly as before migration. They cannot authorize ownership or
//     block a v2 reservation because they do not identify an exact body.
//   - Distinct run_ids never collapse. Duplicate posts of the SAME run_id
//     collapse to the earliest comment id (idempotent retry), and a caller
//     whose own comment id is not that earliest must fail closed.
//   - consumed preserves every validated review iteration and adds one slot
//     for each crashed canonical v2 FULL reservation whose exact snapshot has
//     no review. A legacy canonical FULL reservation supplies the historical
//     per-head floor of one. Thus completed rounds are not double-counted,
//     body-specific crashed rounds cannot disappear behind another body at
//     the same head, and all heads/bodies share the same durable cap.
//
// Exit codes: 0 ok · 3 unusable input (callers must treat as tooling failure,
// never as an empty ledger).

import { readFileSync } from "node:fs";

const REVIEW_MARKER = "[CODEX-ADVERSARIAL-REVIEW]";
const RESERVATION_MARKER = "[ADVERSARIAL-ROUND-RESERVATION]";
const REMEDIATION_MARKER = "[CLAUDE-REMEDIATION]";

// Strict envelopes. The v2 digest line binds a record to the exact body
// snapshot. Legacy records remain valid for iteration/budget accounting only.
// Order is load-bearing; anything that does not match is not a record.
const V2_REVIEW_RE =
  /^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\nreviewed_body_sha256: ([0-9a-f]{64})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\nreview_iteration: ([0-9]+)\r?\n/;
const LEGACY_REVIEW_RE =
  /^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\nreview_iteration: ([0-9]+)\r?\n/;
const V2_RESERVATION_RE =
  /^\[ADVERSARIAL-ROUND-RESERVATION\]\r?\n\r?\n```\r?\nrun_id: ([0-9a-f]{32})\r?\nhead_sha: ([0-9a-f]{40})\r?\nbody_sha256: ([0-9a-f]{64})\r?\nmode: (full|review_only)\r?\nhuman_authorized: (true|false)\r?\nrequested_at: [0-9TZz:.+-]+\r?\n```/;
const LEGACY_RESERVATION_RE =
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
    "usage: adversarial-review-ledger.mjs <comments.json> <viewer_login> [--sha <head_sha>] [--body-sha256 <64-hex>] [--run-id <32-hex>]",
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
const bodySha256 = optArg("--body-sha256", /^[0-9a-f]{64}$/);
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
// Preserve whether GitHub supplied a numeric id before the legacy reservation
// normalizer converts number-like values. Review trust must match the guard:
// a missing or string id cannot participate in the review ledger.
const reviewIdWasNumeric = new WeakSet();
for (const c of arr) {
  if (c && typeof c === "object" && Number.isInteger(c.id)) reviewIdWasNumeric.add(c);
  if (c && typeof c.id !== "undefined" && !Number.isInteger(c.id)) c.id = Number(c.id) || null;
}
arr.sort((a, b) => (a?.id ?? Infinity) - (b?.id ?? Infinity));

const sameLogin = (c) => typeof c.body === "string" && c.user && c.user.login === viewer;
const trustedReview = (c) =>
  sameLogin(c) && c.user.type === "User" && reviewIdWasNumeric.has(c);

// ── Reviews ──────────────────────────────────────────────────────────────────
const reviewComments = arr.filter((c) => trustedReview(c) && c.body.startsWith(REVIEW_MARKER));
const reviews = [];
let sawMalformedAtSha = false;
for (const c of reviewComments) {
  const v2 = c.body.match(V2_REVIEW_RE);
  const legacy = c.body.match(LEGACY_REVIEW_RE);
  if (v2) {
    reviews.push({ sha: v2[1], bodySha256: v2[2], status: v2[3], iteration: Number(v2[4]) });
  } else if (legacy) {
    reviews.push({ sha: legacy[1], bodySha256: null, status: legacy[2], iteration: Number(legacy[3]) });
  }
  else if (headSha && c.body.includes(`reviewed_sha: ${headSha}`)) sawMalformedAtSha = true;
}
const nextIteration = reviews.length ? Math.max(...reviews.map((r) => r.iteration)) + 1 : 1;

let already = 0;
let priorStatus = "NONE";
if (headSha) {
  const atSha = reviews.filter((r) => r.sha === headSha);
  const v2Reviews = reviews.filter((r) => r.bodySha256 !== null);
  const latestV2 = v2Reviews.length ? v2Reviews[v2Reviews.length - 1] : null;
  if (
    bodySha256 !== null &&
    latestV2 !== null &&
    latestV2.sha === headSha &&
    latestV2.bodySha256 === bodySha256
  ) {
    already = 1;
    priorStatus = latestV2.status;
  } else if (atSha.length) {
    priorStatus = "STALE_BODY";
  } else if (sawMalformedAtSha) {
    priorStatus = "MALFORMED";
  }
}

// ── Reservations ─────────────────────────────────────────────────────────────
const rawReservations = [];
for (const c of arr) {
  if (!sameLogin(c) || !c.body.startsWith(RESERVATION_MARKER) || !Number.isInteger(c.id)) continue;
  const v2 = c.body.match(V2_RESERVATION_RE);
  const legacy = c.body.match(LEGACY_RESERVATION_RE);
  if (v2) {
    rawReservations.push({
      runId: v2[1],
      sha: v2[2],
      bodySha256: v2[3],
      mode: v2[4],
      humanAuthorized: v2[5] === "true",
      commentId: c.id,
    });
  } else if (legacy) {
    rawReservations.push({
      runId: legacy[1],
      sha: legacy[2],
      bodySha256: null,
      mode: legacy[3],
      humanAuthorized: legacy[4] === "true",
      commentId: c.id,
    });
  }
}
// Duplicate posts of the SAME run_id collapse to the earliest comment id
// (idempotent retry); DISTINCT run_ids are never collapsed.
const byRunId = new Map();
for (const r of rawReservations) if (!byRunId.has(r.runId)) byRunId.set(r.runId, r);
const reservations = [...byRunId.values()].sort((a, b) => a.commentId - b.commentId);

const snapshotKey = (sha, digest) => `${sha}:${digest}`;

// V2 ownership is exact-snapshot only. Digest-less records are retained in a
// separate per-head map solely for historical budget compatibility.
const canonicalBySnapshot = new Map();
const canonicalLegacyBySha = new Map();
for (const r of reservations) {
  if (r.bodySha256 !== null) {
    const key = snapshotKey(r.sha, r.bodySha256);
    if (!canonicalBySnapshot.has(key)) canonicalBySnapshot.set(key, r);
  } else if (!canonicalLegacyBySha.has(r.sha)) {
    canonicalLegacyBySha.set(r.sha, r);
  }
}
const canonicalReservations = [
  ...canonicalBySnapshot.values(),
  ...canonicalLegacyBySha.values(),
].sort((a, b) => a.commentId - b.commentId);
const canonicalFull = canonicalReservations
  .filter((r) => r.mode === "full")
  .sort((a, b) => a.commentId - b.commentId);

// Per-head union with exact-snapshot crash charging. Every validated review
// iteration is a durable slot. A canonical v2 FULL reservation adds a slot
// only when no review exists for its exact snapshot; a legacy FULL reservation
// retains the historical one-slot floor when its head has no review at all.
// This is never lower than the old per-head union, while separate bodies at a
// shared head can no longer hide one another's crashed reservations.
const reviewRoundsBySha = new Map();
const reviewedSnapshots = new Set();
for (const r of reviews) {
  if (!reviewRoundsBySha.has(r.sha)) reviewRoundsBySha.set(r.sha, new Set());
  reviewRoundsBySha.get(r.sha).add(r.iteration);
  if (r.bodySha256 !== null) reviewedSnapshots.add(snapshotKey(r.sha, r.bodySha256));
}
const allHeads = new Set([
  ...reviewRoundsBySha.keys(),
  ...canonicalFull.map((reservation) => reservation.sha),
]);
let consumed = 0;
for (const sha of allHeads) {
  const reviewCount = reviewRoundsBySha.get(sha)?.size ?? 0;
  const crashedV2 = canonicalFull.filter(
    (reservation) =>
      reservation.sha === sha &&
      reservation.bodySha256 !== null &&
      !reviewedSnapshots.has(snapshotKey(reservation.sha, reservation.bodySha256)),
  ).length;
  const hasLegacyFull = canonicalFull.some(
    (reservation) => reservation.sha === sha && reservation.bodySha256 === null,
  );
  consumed += reviewCount + crashedV2 + (hasLegacyFull && reviewCount === 0 ? 1 : 0);
}

// ── Remediation completions (run_id-bound) ───────────────────────────────────
const completedRunIds = new Set();
for (const c of arr) {
  if (!sameLogin(c) || !c.body.startsWith(REMEDIATION_MARKER)) continue;
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
  const canon =
    bodySha256 === null ? null : canonicalBySnapshot.get(snapshotKey(headSha, bodySha256)) || null;
  out.canonical_run_id_for_snapshot = canon ? canon.runId : null;
  // Compatibility alias for older consumers. Its semantics are intentionally
  // narrowed: without --body-sha256 it is null and can never prove ownership.
  out.canonical_run_id_for_sha = canon ? canon.runId : null;
}
if (runId) {
  const mine = byRunId.get(runId) || null;
  const mineIsCanonical =
    mine &&
    mine.bodySha256 !== null &&
    canonicalBySnapshot.get(snapshotKey(mine.sha, mine.bodySha256))?.runId === runId;
  out.mine_found = mine ? 1 : 0;
  out.mine_comment_id = mine ? mine.commentId : null;
  out.mine_is_canonical_for_its_snapshot = mineIsCanonical ? 1 : 0;
  out.mine_is_canonical_for_its_sha = mineIsCanonical ? 1 : 0;
  out.canonical_full_before_mine = mine
    ? canonicalFull.filter((r) => r.commentId < mine.commentId).length
    : canonicalFull.length;
  out.remediation_completed_for_run_id = completedRunIds.has(runId) ? 1 : 0;
}
process.stdout.write(JSON.stringify(out) + "\n");

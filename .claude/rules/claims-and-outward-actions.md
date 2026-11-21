# Claims and Outward Actions

**Before you tell Mike, a PR, or an issue what something will do or did, prove it.
Before you take an outward action, check that the action has the effect you claimed.**

`session-discipline.md` §1 covers premises before *implementing*. This rule covers
what an agent **asserts to others**, and what it **writes outside the repo**:
prod calls, GitHub comments, and authorization requests. Those are the places
where a wrong claim costs Mike an approval or reaches a stranger.

## Trigger keywords

Apply this rule whenever you are about to:

- write "GO?", "approve", "authorize", or "(Recommended)" for a prod, staging, or
  external action;
- post `gh pr comment`, `gh issue comment`, `gh issue create`, or a PR body;
- write "will", "would", "can never", "always", "every", "fails because", or
  "returns X" about code you have not run;
- record "created", "uploaded", "re-indexed", "re-proved", or "fresh" in an
  evidence file or report.

## The rules

1. **Trace every exit before you predict an effect.** A claim such as "action A
   will cause effect E" must name **every** early-return or short-circuit in the
   handler between A and E. One helper is not the handler. Measurable: list the
   returns by `file:line` in your notes before the claim leaves your session.
   If you can't, say "unverified" in the question itself.
2. **Ask Mike for the effect, not the mechanism.** "GO to re-upload the fixture"
   hides the real goal ("fresh chunks on prod"). Phrase every authorization as
   *mechanism → intended effect → how I will prove the effect happened*. If you
   don't know a mechanism that produces the effect, say so and don't offer one.
3. **Assert the effect in the runner, don't just record it.** Any script that
   writes to staging or prod must `assert` the response proves the intended
   effect, and stop otherwise. For MIRA uploads, `duplicate: true` or a reused
   `uploadId` means **nothing was chunked**. That is a failed re-proof, not a run.
4. **Evidence ledgers name what really happened.** A reused object is `reused`,
   not `created`. A file called `results_*.json` must not list an object the run
   didn't create as if it had.
5. **Never @-mention a name that isn't a verified GitHub collaborator.** This
   repo is **public**. Agent names (Grok, Codex, Cursor, Claude, BRAVO, CHARLIE,
   Gemini) are not our GitHub logins, and `@Grok` notifies the stranger `grok`.
   Run `python3 scripts/check_gh_mentions.py BODY_FILE` before every comment, issue,
   or PR body; it exits 1 on a non-collaborator. Write the agent name without `@`.
6. **Label every review finding as run or read.** Each finding in a review
   comment carries either "red repro: <command/result>" or "(read, not run)".
   Inferences about environments you didn't touch ("on the prod DB…") say
   "not verified". Don't give exact failure values ("returns IDLE") unless a run
   printed them.
7. **The edit you make to fix a claim is also a claim.** A correction must meet
   the same bar. Don't swap one guess for another.

## Why this exists (evidence, 2026-10-27, BRAVO)

All of these happened in one session:

- **Rule 1 and 2:** BRAVO told Mike that PDF upload dedupe was per
  `(tenant, sha256, node)`, after reading only `findDuplicateUpload`. Mike approved
  a "new notebook" prod run based on that. The upload route
  (`mira-hub/src/app/api/namespace/node/[id]/files/route.ts`) also dedupes
  **tenant-wide**, through `parkOrReuseFile` (canonical Files) and
  `claimIngest(...).already_ingested`, so that run could never re-chunk. The
  earlier GO ("re-upload the fixture") had the same hidden assumption. Result:
  two prod writes, two approvals, and zero re-chunks. See #4842 comment
  6440440294 and #4859.
- **Rule 3:** both prod runners logged `200 duplicate:true uploadId b28a0960`
  and carried on to score six questions against the old chunks.
- **Rule 4:** the runner's `created` list recorded the reused `b28a0960` as an
  `upload`.
- **Rule 5:** BRAVO's #4570 comment 6440048801 opened with `@Grok`, which tagged
  the unrelated GitHub user `grok` on a public repo. It has been edited since,
  but a notification can't be unsent.
- **Rule 6:** BRAVO's #4852 review (comment 6440113071) stated as fact that the
  eval harness "returns IDLE" and described prod-DB behavior without running
  either. A later run showed `'UNKNOWN'` on a fresh DB and `'IDLE'` only when the
  legacy table exists. The prod DB is still unverified (correction 6453435346).
- **Rule 7:** while removing `@Grok`, BRAVO first rewrote it as "via the
  `cursor` account", which was another unverified claim. It was removed.

Same failure class as subagent over-claims on 2026-10-27 (vacuous A2 test,
save-to-empty-tenant, "pending" items): **asserting before running.** This is
the second occurrence in a day, so Cluster Law 6 applies.

## Known facts that would have prevented this

- **Re-uploading identical bytes never re-chunks in MIRA**, whatever the
  notebook or node. Re-chunking an existing document needs #4859.
  `DELETE /api/uploads/:id` removes only the `hub_uploads` row (not chunks, not
  the canonical file). `POST /api/uploads/:id/retry` only accepts `failed`.
- `timeout` is not installed on BRAVO (macOS, checked 2026-10-27). A command prefixed with it
  prints "command not found" and **runs nothing**. Check the test count in the
  output (`prove-the-test-fails.md` rule 2), not the exit of the pipeline.

## When this applies

- Every authorization request, every outward write (prod, staging, GitHub,
  Slack), and every review finding or evidence file.

## When this does NOT apply

- Private notes and scratch files that nobody else reads, as long as they don't
  feed a claim made to others.

## Cross-references

- `.claude/rules/session-discipline.md` §1: premise verification before implementing
- `.claude/rules/prove-the-test-fails.md`: red before green; check the counts
- `.claude/rules/karpathy-principles.md` §4: evidence beats assertion
- `.claude/rules/multi-session-protocol.md`: claiming, isolation, review, handoff
- Cluster Law 1 (evidence-only completion), Law 6 (pattern rule creation)

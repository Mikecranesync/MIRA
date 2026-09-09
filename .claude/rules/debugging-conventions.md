# Debugging & Verification Conventions

Two recurring failure modes, codified from the 2026-06-08 /insights review.
These complement `karpathy-principles.md` (behavior) — they govern *diagnosis
discipline*, not syntax.

## 1. Performance problems are multi-cause by default

Do NOT declare a latency or slowness fix done after killing one bottleneck.
After every fix, **re-measure**, then look for the next compounding layer.

- State the dominant layer, fix it, re-measure, repeat until a numeric target
  is met — not until the first fix lands.
- Layers stack and hide each other: the AskMira `/ask` 45s→2.3s work took four
  PRs (#1775/#1780/#1784/#1785) because BM25, fault/product extraction,
  embedding, and an ILIKE scan each surfaced only *after* the previous fix.
  A single-cause "it was BM25" call would have shipped a still-slow endpoint.
- A status spike or one slow query is evidence of *a* cause, not *the* cause.
  An HNSW index was a red herring there; the real cost was an ILIKE scan.

**Rule:** for any perf task, report the per-layer reduction (p50/p95 before →
after at each layer), not a single before/after number.

## 2. Verify schema and API paths from the codebase before guessing

Wrong table/column names produce **false negatives** (a db-inspect check
reported `MISSING` because the table name was wrong, not because data was
absent). Wrong auth paths waste cycles (`/api/auth/signin` vs `/auth/signin`,
bcrypt prefix guesses on the Atlas signin work).

- Resolve exact table/column names from migrations (`docs/migrations/`,
  `mira-*/migrations/`) or CodeGraph before writing a query or asserting a row
  is missing.
- Resolve exact API auth paths from the route definitions (NextAuth subpath is
  `/<base>/api/auth/...`; see the hub auth memory) — don't infer from the app
  base URL.
- A "MISSING" / 404 / 401 result against an unverified name or path is
  **inconclusive**, not a finding. Confirm the name first, then trust the result.

## 3. Positive-control every instrument before believing what it says

**Before treating any red or green as evidence, prove the instrument can produce
the other answer.** A check that cannot express failure has not been run — it has
been *assumed*. The failure looks identical to success, which is why this needs a
rule rather than care.

Concretely, before citing a result:

- **A mutation is only "caught" if the UNMUTATED run first FINDS the tests and
  PASSES.** Confirm the test count. `vitest run "src/app/api/foo/\[id\]/bar"`
  matches nothing, prints `No test files found`, and exits **1** — indistinguishable
  from a caught mutation. So does a typo in a path filter.
- **Confirm the mutation actually landed**, e.g. `git diff --numstat` shows the
  expected insertions/deletions at the expected line — not appended after a
  trailing `exit 0`, not in a comment, not in a sibling copy of the string.
- **Confirm the mutation fails the RIGHT assertion, by name.** A red at a different
  test means the mutation exercised something else and the target is still
  undefended.
- **A clean scan is only clean if you know what it could not see.** State the
  exclusions. `git for-each-ref 'refs/remotes/origin/*' --contains <sha>` cannot
  match two-level branch names (`origin/fix/my-branch`) and returns 0 for a commit
  provably on one — use unglobbed `refs/remotes/`. `git grep -E "\bword\b"` matches
  nothing in this repo. Nested worktrees inflate or invent results for any scanner
  that walks the tree.
- **Never `cmd | tail` or `cmd | grep` a gate** — `$?` is the pipe's. Use
  `if cmd > log 2>&1; then rc=0; else rc=$?; fi`, or `PIPESTATUS`.
- **`&&` chains silently truncate on a zero-count `grep -c`** (exit 1), swallowing
  every later check in the chain. Separate verification steps with `;` or run them
  individually.
- **Two interpreters, two answers.** `/usr/bin/python3` is 3.9 here and raises
  `TypeError` on `X | None` annotations *before doing any work*; Homebrew's 3.14
  lacks `markdown_it`. A traceback from the wrong interpreter is not a policy
  failure. Print `sys.executable` before blaming code.

**The trap has two directions, and the second erodes trust between people.**
A non-landing mutation produces **false accusation** as readily as false
confidence: the run goes green and you conclude *someone else's* guard is
decorative, or their fix is unverified. On 2026-09-08 one reviewer nearly filed
defects against two other sessions' work from mutations that had never landed —
each time it was `git diff --numstat` printing nothing, not judgement, that
stopped it. "Be careful with other people's work" is an attitude and attitudes
go first under deadline; **"read the diff before the result"** survives.

**A near neighbour: counting prose about the mechanism instead of the
mechanism.** A `grep -c 'role="status"'` that returns 2 before and 3 after looks
like a behaviour change; two of the three were *comments about* `role="status"`.
The same defect flags a button whose only `onClick` appears in a neighbouring
comment. Strip comments, or assert on parsed structure, before counting.

**Why this is a rule.** On 2026-09-08/09 a single session hit eight distinct
instances in one night — a broken `&&` chain, a path filter that ran zero tests
and exited 1, a reachability glob blind to two-level names, a local reproduction
that "confirmed" a different failure, a `tsc` delta misread as baseline, an
eslint exit-2 read as a lint state, a mutation batch voided by a shell-collapsed
argument, and a review "dispatched" to an idle session that never started. Every
one returned the shape the reader expected. **The positive control caught every
instance it was applied to, and nothing else caught any of them.**

## When this applies

- Any perf/latency/slowness diagnosis in `mira-bots/`, `mira-hub/`,
  `mira-pipeline/`, `mira-web/`, or infra.
- Any db-inspect / row-existence check, any new SQL, any auth-path probe.
- **Any mutation test, guard verification, CI-failure reproduction, or repo-wide
  scan whose result you intend to state as a fact.**

## When this does NOT apply

- A genuinely single-step fix from a stack trace you already have open.
- A perf change with one obvious cause already measured end-to-end.

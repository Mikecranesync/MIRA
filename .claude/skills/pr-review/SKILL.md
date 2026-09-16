---
name: pr-review
description: Independent read-only PR review pinned to an exact SHA
---
Args: $PR_NUMBER $SHA

1. PREFLIGHT: report which of Bash/git/gh are available. If gh is missing, say BLOCKED and stop.
2. `git fetch origin pull/$PR_NUMBER/head && git rev-parse FETCH_HEAD` — if it != $SHA, report SUPERSEDED and stop.
3. `git diff $(git merge-base origin/main $SHA)..$SHA` — enumerate every changed file. Use `origin/main`, not local `main` — a stale local `main` produces a false diff against every commit main is behind on.
4. Verify each user-stated claim against the diff. Cite file:line for every finding.
5. Run tests/type-checks; record exit codes verbatim.
6. Emit verdict: PASS / FAIL / PARTIAL with a STATIC-ONLY tag if step 5 was impossible. Write it to `verdict.md`.
7. Re-run `git rev-parse FETCH_HEAD` (do not reuse step 2's value). If it no longer equals $SHA, report SUPERSEDED and stop — do not post.
8. Post via `gh pr comment $PR_NUMBER --body-file verdict.md` and echo the returned URL as proof.

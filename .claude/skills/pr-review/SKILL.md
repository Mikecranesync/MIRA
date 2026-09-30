---
name: pr-review
description: Independent read-only PR review pinned to an exact SHA, with a claim table and a read-back-verified posted verdict
---
Args: $PR_NUMBER $SHA [claims]

1. PREFLIGHT in your first reply: report which of Bash/git/gh/test-runner are available (`gh auth status`, `git rev-parse HEAD`). Map each requested criterion to ACHIEVABLE or BLOCKED. If gh is missing and a posted verdict is required, say BLOCKED and stop.
2. `git fetch origin pull/$PR_NUMBER/head && git rev-parse FETCH_HEAD`. If it != $SHA, report SUPERSEDED and stop.
3. `git diff $(git merge-base origin/main $SHA)..$SHA`, and enumerate every changed file. Use `origin/main`, not local `main`: a stale local `main` produces a false diff against every commit main is behind on.
4. Verify each user-stated claim against the diff. Cite file:line for every finding.
5. Run tests/type-checks, and record commands and exit codes verbatim. Grep the output for the new test names, because a green suite that never ran them proves nothing.
6. Write `verdict.md`:
   - `PR #<n> @ <full 40-char sha>`, and how the SHA was confirmed (step 2 command)
   - a table: `claim | evidence (file:line or command + exit code) | PASS / FAIL / UNVERIFIED`
   - overall PASS / FAIL / PARTIAL, tagged STATIC-ONLY if step 5 was impossible
   - `Limitations:`, listing what was not checked and why
7. Re-run `git fetch origin pull/$PR_NUMBER/head && git rev-parse FETCH_HEAD`, and don't reuse step 2's value. If it no longer equals $SHA, report SUPERSEDED and stop without posting.
8. Post via `gh pr comment $PR_NUMBER --body-file verdict.md`.
9. READ BACK: `gh api repos/Mikecranesync/MIRA/issues/$PR_NUMBER/comments --jq '.[-3:][] | {id, html_url, head: .body[0:80]}'`. Quote the URL of your comment in the final message. If it is not there, say POST UNCONFIRMED; retry at most once. Never report "posted" from the fact that the command ran.

Never modify source files, push, merge, or label.

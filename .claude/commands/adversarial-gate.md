# /adversarial-gate — run the Codex adversarial review loop on the current PR

Run the automated Claude ↔ Codex adversarial review loop for the pull request
of the current branch (or the PR number given as an argument).

## What to do

1. Confirm preconditions yourself first — the scripts fail closed on all of
   these, but check so the user gets one clear answer instead of a script
   error:
   - the current branch has an open PR (`gh pr view`);
   - the working tree is clean (tracked files) and local HEAD equals the PR
     head (push first if not);
   - `codex` and `gh` are available and authenticated.
2. Run the loop from the repo root:

   ```bash
   bash scripts/adversarial-review-loop.sh $ARGUMENTS
   ```

   - Use `--review-only` when the user only wants the Codex verdict posted,
     without autonomous remediation.
   - The loop is capped at 3 cycles and posts `[ADVERSARIAL-ESCALATION]` when
     it stops without GREEN.
3. Report the outcome honestly: GREEN with the reviewed SHA, or the unresolved
   findings summary with a link to the PR comments. A tooling failure (exit 2)
   is NEVER "green" — say the gate did not run to completion.

Full workflow, review format, and failure recovery:
`docs/adversarial-review-workflow.md`.

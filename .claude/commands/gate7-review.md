# /gate7-review

Run the convergence program's **Gate 7 independent adversarial review** on a PR or branch
diff, and produce the evidence block a convergence unit record cites. This is the real
lane CU-11 wired (doctrine `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`
§ Gate 7); it replaces the never-wired "GPT-5.6 Sol / Codex" reviewer (owner decision,
PR #3261 — **no OpenAI**).

## What "independent" means here (say it honestly)

Without a dedicated second frontier vendor, independence comes from **process, not
vendor**:

1. **Fresh context** — the reviewer sees ONLY the disprove brief + the diff. The cascade
   lane has this by construction (stateless API calls). An agent reviewer must be a
   freshly dispatched sub-agent, never the implementing session.
2. **Isolated worktree** — an agent reviewer runs in its own worktree
   (`Agent` tool `isolation: "worktree"`), never the implementing checkout.
3. **A brief to disprove** — the reviewer's job is to prove the change WRONG along the
   §Gate 7 axes, not to summarize or approve it.

A unit record must state which lane ran and must never imply a cross-vendor check that
did not happen.

## Procedure

### 1. Finalize the diff

Push the branch (or open the PR) so the diff under review is the diff that will merge.
Re-running after any subsequent commit is a NEW round.

### 2. Run the cascade lane (always)

```bash
# Local (keys from Doppler dev — free-tier cascade, PRD §4):
doppler run --project factorylm --config dev -- \
  py tools/gate7_review.py --pr <N> --unit docs/architecture/convergence/units/CU-XX.md \
  --effort high --round 1 --out /tmp/gate7-cu-xx-r1.md
```

- `--effort high` (default): first available provider reviews.
- `--effort xhigh`: EVERY available provider reviews and **all must PASS** — required for
  the §Gate 7 auto-xhigh triggers (DB/schema, tenancy, authn/z, identity, cross-repo
  contracts, deletion, concurrency, production deployment).
- Exit codes: `0` PASS, `1` BLOCK, `2` indeterminate, `3` lane unavailable. **Exit 3 is
  not a pass** — fix keys/providers or fall back to step 3 with the deviation recorded.

### 3. Add fresh-context agent reviewers (xhigh units, or when the lane is unavailable)

Dispatch 1–3 read-only reviewer sub-agents (fresh context, isolated worktree if they must
run commands), each with a distinct disprove axis (e.g. contract-bypass construction /
security-tenancy / record honesty). Their briefs must include: the diff or branch, the
unit record, the §Gate 7 refutation axes, and the instruction that PASS is only "my
refutation attempts failed."

### 4. Record the evidence in the unit record

Paste into `units/CU-XX.md` § "Adversarial reviewer effort", per round:

- the lane's evidence block (from `--out`), or for agent reviewers: reviewer identity,
  axes, findings with severity, verdict;
- disposition of every finding — fixed (commit SHA) or recorded-accepted (with reason);
- **BLOCK is stop-the-line**: no merge until a later round passes or a human explicitly
  overrides (record the override and who gave it).

### 5. Re-run after fixes

Fixing a blocking/important finding changes the diff → run the next round (step 2) and
record it. The final recorded round must be a PASS (or a recorded human override).

## Notes

- **A lane PASS alone never authorizes a merge.** The diff under review is untrusted text
  inside the reviewer prompt (prompt-injection limitation, recorded in `units/CU-11.md`);
  Gate 9's human GO is the backstop.
- Keys: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHERAI_API_KEY` — Doppler-managed
  (`factorylm/dev` locally; repo secrets in CI). Never paste keys into a shell.
- The lane is deliberately fail-loud, unlike the advisory `code-review.yml` comment bot:
  a gate that soft-skips is not a gate.
- Cross-references: `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`
  § Gate 7 · `docs/architecture/convergence/units/CU-11.md` ·
  `.claude/rules/zero-token-architecture.md` (free-tier cascade = allowed runtime).

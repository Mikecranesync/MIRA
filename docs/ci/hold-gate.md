# hold-gate — enforceable "HELD / DO NOT MERGE"

## Why this exists

A PR label or a `[HELD / DO NOT MERGE]` string in the title is **not** a merge
gate. GitHub's merge machinery (manual merge, and especially armed **auto-merge**)
reads neither label names nor title text. The only things that block a merge are:
required status checks, required reviews, and branch-protection/ruleset rules.

**Post-mortem (#3189):** a PR titled `feat(hub): Equipment Notebook V1 [HELD / DO
NOT MERGE]` carried **zero labels**; auto-merge was armed by the author; it
squash-merged the instant required checks went green. Nothing machine-enforced
the hold. `hold-gate` closes exactly that gap.

## What it does

`.github/workflows/hold-gate.yml` runs on every PR `opened / edited / labeled /
unlabeled / synchronize / reopened / ready_for_review` and calls
`tools/ci/hold_gate.py`, which **fails the check (red)** when either:

- a **label** (case-insensitive) is one of: `do-not-merge`, `do not merge`,
  `hold`, `held`, `wip`, `blocked`; or
- the **title** contains a word-bounded marker (case-insensitive): `HELD`,
  `DO NOT MERGE` / `DO-NOT-MERGE`, `WIP`, `DRAFT`.

Otherwise it passes (green). The decision function `is_held(title, labels)` is
pure and unit-tested (`tests/test_hold_gate.py`, 9 cases incl. the `upheld`
substring trap and case-insensitive labels).

Editing the title or removing the label re-runs the check (the `edited` /
`unlabeled` triggers) and flips it green, so clearing a hold needs no re-push.

## Activation — making it actually block (requires a human with admin)

Adding this workflow **does not** make it required; by itself it only reports.
To make it enforce a hold, add `hold-gate` to main's **required status checks**.
Do this only with explicit authorization — it is a branch-protection change.

**Option A — classic branch protection (gh CLI):**

```bash
# Show current required contexts first (do not clobber them):
gh api repos/Mikecranesync/MIRA/branches/main/protection/required_status_checks \
  --jq '.contexts'

# Add hold-gate to the existing list (replace the array with current + "hold-gate"):
gh api -X PATCH repos/Mikecranesync/MIRA/branches/main/protection/required_status_checks \
  -F 'contexts[]=staging-gate' \
  -F 'contexts[]=Hub E2E (command-center + onboarding)' \
  -F 'contexts[]=mira-web pack tests' \
  -F 'contexts[]=CI Gate' \
  -F 'contexts[]=hold-gate'
```

**Option B — ruleset (`main-branch-protection`, id 17097034):** add `hold-gate`
to the `required_status_checks` rule's `required_status_checks[]` array via the
GitHub UI (Settings → Rules → Rulesets) or `gh api repos/.../rulesets/17097034`.

**Recommended complementary hardening (each would have independently stopped
#3189; all require authorization):**

- Require **≥1 approving review** (`required_pull_request_reviews.required_approving_review_count: 1`), ideally with **CODEOWNERS** — no PR merges unattended.
- Enable **`enforce_admins: true`** so protection binds admins too (it was `false`).

## Verifying before you require it

1. Open a throwaway PR with `[HELD]` in the title → `hold-gate` should be **red**.
2. Remove `HELD` from the title → the check re-runs and goes **green**.
3. Add a `do-not-merge` label → **red**; remove it → **green**.

Only after that behaves as expected should `hold-gate` be added to required checks.

## Files

- `.github/workflows/hold-gate.yml` — the workflow (reports only until required).
- `tools/ci/hold_gate.py` — `is_held()` decision + Actions entrypoint.
- `tests/test_hold_gate.py` — unit tests for the decision function.

<!-- hold-gate enforcement smoke check a45c67b00 -->

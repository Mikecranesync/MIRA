# PR completion workflow

One command takes a PR from "pushed" to an evidence-backed verdict: **GREEN**, **BLOCKED** or
**NEEDS_APPROVAL**. It replaces the hand relay between Claude, Codex, GitHub CI, the lifecycle
guard and the follow-up record. It adds no service, workflow, schedule or dependency. It drives the
gates that already exist, and it never merges.

## Usage

Load the controller from the PR's base, the same way as the trusted review entrypoint, so a
candidate cannot rewrite its own judge:

```bash
PR=1234
BASE_SHA="$(gh pr view "$PR" --json baseRefOid --jq .baseRefOid)"
git fetch -q origin main
git show "${BASE_SHA}:tools/pr_completion.py" > /tmp/pr_completion.py
python3 -I /tmp/pr_completion.py "$PR"                 # review-only rounds
python3 -I /tmp/pr_completion.py "$PR" --mode full     # trusted loop may remediate BLOCKER/HIGH
python3 -I /tmp/pr_completion.py "$PR" --read-only     # evaluate and report, take no action
```

Run it from any clean checkout of the repository: the trusted entrypoint builds its own detached
worktrees. Options:

| Option | Effect |
|---|---|
| `--mode review` (default) | Codex rounds are review-only. A BLOCKER or HIGH ends the run BLOCKED with the findings for a Claude session to fix. |
| `--mode full` | One trusted-loop action of up to two cycles (`--max-iter 2`): Codex review, Claude remediation in the trusted loop for BLOCKER/HIGH only, then a review of the new head. The loop stops before remediation once it reaches `--max-iter`, so one cycle could never fix anything. With one round left in the budget it asks for `--max-iter 1`, a review only. Used only when the base loop has the CONVERGED stop (exit 5). Otherwise it falls back to review-only. |
| `--allow-paid-push` | Allows full mode when the PR touches the `pull_request.paths` of a paid workflow (Beta Gate), since each remediation push fires it again. |
| `--no-followups` | On CONVERGED, report instead of filing issues. |
| `--max-cycles N` | Hard bound on cycles (default 4). |
| `--ci-timeout S`, `--poll S` | Bound on the CI wait (default 3600 s, polled every 60 s). |
| `--post-status` | Also post the report as a `[PR-COMPLETION-STATUS]` comment. |
| `--out DIR` | Where the JSON and markdown reports go (default `.pr-completion/`). |

Exit codes: 0 GREEN, 3 NEEDS_APPROVAL, 1 BLOCKED (including any tooling failure).

## What one cycle does

Every gate is re-derived from primary sources at the exact head and body each cycle. Nothing is
carried over from an earlier cycle or read back from a status comment.

1. **Snapshot**: head SHA, base SHA, body SHA-256, changed files. The file list comes from the
   paginated REST files endpoint, counts both sides of a rename, and must match `changedFiles`
   (and stay under 3000), or the run is BLOCKED. The head must not move unless
   this controller's own full-mode round moved it. Anything else is a competing writer: BLOCKED.
2. **CI at that SHA**: check runs and commit statuses for the SHA itself, not `gh pr checks`
   (which follows whatever the head is now). The run waits until every check is terminal.
   - A failed, cancelled or timed-out check is BLOCKED.
   - So is a required branch-protection context that is absent, skipped or not `success`.
   - The one exception is `Legacy UI Lifecycle Guard`, and only while the base guard's Missing
     list is exactly the Codex review item.
3. **Lifecycle guard**: the guard from the base object runs on the exact body. Any Missing item
   other than the Codex review is BLOCKED.
4. **Review ledger**: the budget and the exact-snapshot verdict come from the base
   `adversarial-review-ledger.mjs` over owner-authored comments. The controller cross-checks the
   counts against the strict envelope and fails closed if the two disagree.
   - **No verdict:** one round through the trusted entrypoint, unless the budget is spent, which
     is BLOCKED.
   - **BLOCKER or HIGH:** in full mode the round already ran remediation, and the next cycle
     reviews the new head. Otherwise BLOCKED.
   - **CONVERGED:** one issue per MEDIUM (one aggregate issue when only LOWs remain), the
     `[REVIEW-FOLLOWUPS]` record, and a guard dispatch. Each issue body carries a
     `pr-completion-followup:` marker for the PR, head, body digest and finding; a rerun after a
     partial filing reuses the owner issue with that marker instead of filing a duplicate.
5. **Guard status**: a guarded PR also needs a `success` guard status at the exact head.
6. **Risk policy**: once every gate passes, the changed paths decide the verdict.

A final re-snapshot runs before reporting. If the head or body changed, the report is BLOCKED,
because the evidence is stale.

## Risk policy

| Paths | Verdict when every gate passes | Why |
|---|---|---|
| docs, tests, screenshots, `factorylm-ui` adapters | GREEN, low risk | eligible for automated merge once Mike approves that policy |
| other code (backend, usually behind a disabled flag) | GREEN, "activation stays separately gated" | merge-ready; turning it on is a separate approval |
| the SDLC v1 section 2.1 R3 list: migrations, `.github/**`, compose, deployment, nginx, Dockerfiles, secrets/Doppler/env, auth, sessions and middleware, `guardrails.py`, Ignition; the governance floor (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.githooks/**`, hooks, review producers, this controller, the lifecycle guard, `tools/ci/**`, registries, test config and guard tests, process docs and runbooks) | NEEDS_APPROVAL | needs explicit owner approval |
| PLC, Modbus, ladder, interlock, lockout, safety | NEEDS_APPROVAL | needs a separate human safety authorization |

These are the patterns in `NEEDS_AUTH`, `HUMAN_SAFETY` and `LOW_RISK` in `tools/pr_completion.py`.
The tiers are checked in that order, so a governance doc or a guard test is NEEDS_APPROVAL even
though it sits under `docs/` or `tests/`. A path that matches no list is treated as other code
(GREEN only with activation gated), never as low risk. The R2 behavioral class (answer path,
retrieval, eval fixtures) has no tier of its own here: it lands in "other code", and its staging
gate stays the owner's.

## What happens automatically vs what Mike approves

| Automatic, under existing standing rules | Always Mike |
|---|---|
| CI wait and classification, guard run, ledger reads | merge (this tool has no merge call and never enables auto-merge, although the repository setting allows it) |
| Codex rounds within the durable 3-round budget | any round past the budget (`ADV_REVIEW_HUMAN_AUTHORIZED`, set by a human) |
| trusted-loop remediation of BLOCKER/HIGH in `--mode full` | migrations, staging or production deploys, flags, Doppler, credentials |
| CONVERGED follow-up issues, `[REVIEW-FOLLOWUPS]`, guard dispatch | paid runs beyond what a PR push already fires (full mode on paid paths needs `--allow-paid-push`) |
| the status report | branch protection, release controls, PLC or safety-critical behavior |

## Safety properties

- **No merge, deploy or API write:** every `gh` call passes an allowlist. The allowed calls are
  `pr view`, `pr comment`, `issue create`, `api` without any write flag, and
  `workflow run ui-lifecycle-guard.yml --ref main -f pr_number=N`. Anything else raises before
  `gh` runs.
- **No stale approval:** a verdict counts only for the exact head and body SHA-256. A push or a
  body edit means a fresh review.
- **No second remediation path:** fixes run only inside the trusted loop. Its prompt comes from
  the runner's own artifact, never from PR comments.
- **Bounded:** the cycle count, the CI timeout, the budget read from the ledger every cycle, and
  a 90-minute cap per review round.
- **Spend:** Codex runs on the operator's existing CLI login. The only metered cost a cycle can
  cause is a push into paid workflow paths, which is refused without the flag.
- **Competing writers:** a per-PR lock in the git common dir (one controller per machine).
  Across machines, the reservation ledger decides who gets a review round. A head that moves
  under the controller ends the run. Follow-up filing is idempotent on rerun (the issue marker),
  but two controllers on two machines filing the same verdict at the same moment can still
  both file; run one controller per PR.
- **Missing or skipped is not success:** an unreadable ledger, guard, protection or CI read, or a
  review exit code outside 0, 1 and 5, is BLOCKED. It is never GREEN.

## Limits

- The controller cannot remediate a verdict another run already posted, because the trusted loop
  refuses deduplicated ISSUES_FOUND. That case ends BLOCKED with the findings for a Claude session.
- `tests/test_pr_completion.py` and `tests/test_adversarial_review_scripts.py` run in no CI job
  today. Adding them to `ci.yml` is a guarded change for the owner.
- This PR is the bootstrap: it cannot authorize itself. The controller's first trusted run is on
  a later PR, after this file is on `main`.

---
name: ship
description: Use when taking a merged-or-ready feature branch live end-to-end — rebase on main, merge the PR, deploy the affected VPS service, and verify the live endpoint before reporting success. The cross-service ship loop. For visible mira-web changes delegate to design-ship-routine; for mira-ask/kiosk follow the kiosk runbook. Triggers on "ship it", "deploy this", "take it live", "merge and deploy".
---

# ship

The end-to-end loop for taking a change live: rebase → merge → deploy → verify-200. Thin wrapper — it delegates the surface-specific parts to the skills/runbooks that already own them, and adds the cross-service deploy + live-verify discipline plus the branch-safety guard.

## First: route to the right owner

- **Visible mira-web change** (`/`, `/cmms`, `/pricing`, views, CSS) → use `design-ship-routine` instead. It owns snapshot→PR→deploy→`verify:live`. Don't reimplement it here.
- **mira-ask / kiosk / `ask_api` / engine kiosk fast-path** → follow `docs/runbooks/kiosk-askmira-deploy-and-verify.md`. Critical: `mira-ask` is NOT in the deploy-vps default targets — dispatch explicitly.
- **Engine / RAG / FSM / classifier change** → must pass the staging gate (`smoke-test.yml` + relevant `tests/eval/` regime) BEFORE merge. No exceptions.
- **Anything else (backend service, infra)** → continue below.

## Branch safety (non-negotiable — see issue #1810)

- **Never auto-switch branches mid-sequence.** Print `git rev-parse --abbrev-ref HEAD` before any write and confirm it's the branch you intend.
- **Never force-push a branch with an open PR** without explicit OK (rewrite invalidates in-progress reviews).
- A git hook that auto-commits/auto-branches during this loop is a known hazard — if HEAD moves unexpectedly, STOP and re-orient, don't push.

## The loop

1. **Pre-flight.** `git fetch origin`. Confirm HEAD branch. `git log origin/main..HEAD --oneline` — know exactly what's shipping.
2. **Rebase on main.** `git rebase origin/main`. Resolve conflicts; if a conflict is non-trivial, surface it — don't guess a merge.
3. **Gate.** Engine/RAG/retrieval change? Confirm the staging gate passed. UI? screenshots committed. Otherwise the merge is premature.
4. **Merge** (only with explicit user approval — merges + deploys each need their own one-word OK). Squash, conventional title, delete branch after.
5. **Deploy** the affected service via `deploy-vps.yml`:
   ```
   gh workflow run deploy-vps.yml --repo Mikecranesync/MIRA -f services="<service>"
   ```
   Default targets: `mira-pipeline mira-ingest mira-mcp mira-hub mira-cmms-sync mira-bot-telegram mira-bot-slack`. **`mira-ask` and `mira-web` are NOT defaults** — name them explicitly. Never `docker compose` the VPS directly (prod-guard blocks it).
6. **Verify live — 200 + behaviour, not "deploy ran".** Confirm the new commit is actually live (image age / behavioural probe), then:
   ```
   bash install/smoke_test.sh        # affected routes
   curl -sS -o /dev/null -w '%{http_code}' https://<host>/<route>   # expect 200
   ```
   "No error from the deploy step" is NOT verification (see verify-before-done feedback). Read back the live state.
7. **If verify fails** → rollback to prev sha, fix on a new branch, re-run the loop. Don't paper over.
8. **If verify passes** → close the issue with the live evidence (status code / screenshot / probe output).

## Done-when

Live endpoint returns 200 AND the new behaviour is observed on prod — not on merge alone.

## What NOT to do

- ❌ Report "shipped" on merge. Not shipped until verified live (completion-vocabulary feedback).
- ❌ Auto-switch/force-push a branch with an open PR.
- ❌ Rely on the auto-deploy default targets for `mira-ask` / `mira-web`.
- ❌ Skip the staging gate for engine/RAG/FSM/classifier changes.
- ❌ Duplicate the mira-web ship steps here — delegate to `design-ship-routine`.

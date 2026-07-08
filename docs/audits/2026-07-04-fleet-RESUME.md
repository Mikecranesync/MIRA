# RESUME POINT — Cohesion-audit fix fleet (2026-07-04)

## Context
Cohesion audit + 18 drafted GitHub issues live in `docs/audits/2026-07-04-cohesion-audit.md` and `docs/audits/2026-07-04-create-issues.sh` (not yet run — needs `gh` on Mike's machine).

## Worktrees (all created, all branched from `main` @ 038263ae)
Located at `.audit-worktrees/<name>`, branch `audit/<name>`:

| Worktree | Job | Status |
|---|---|---|
| deploy-targets | Add mira-web to deploy-vps.yml default TARGETS | pending |
| poller-schema | Fix tools/demo_plc_poller.py live_signal_cache shape (or route via ingest_contract) | pending |
| doppler-drift | tools/check_env_drift.py + CI step (compose vs env-vars.md/.env.template) | pending |
| root-cleanup | Delete mira_copy/err.txt; archive HANDOFF*/competitor*/nginx confs/ish_*.png | pending |
| modules-manifest | MODULES.md lifecycle manifest + tests/test_modules_manifest.py guard | pending |
| decision-specs | ADRs: unified identity, single engine; fault-detective disposition; MVP rescope proposal | pending |
| pipeline-tests | Offline unit tests for mira-pipeline (chat route, cascade, ignition uns_required) | pending |
| stripe-retry | Transactional Stripe→Hub provisioning w/ retry + idempotency (mira-web) | pending |
| quota-gate | Tenant plan/quota check at Supervisor entry (mira-bots/shared/quota.py, fail-open) | pending |
| cmms-evidence | recall_work_orders() into engine evidence, flag-gated, fail-safe | pending |

## STATUS: COMPLETE (2026-07-04)
All 10 branches built, tested green in isolated sandbox clones, delivered as
patches in `docs/audits/fleet/patches/<name>/`. Apply guide: `docs/audits/fleet/README.md`.
Nothing pushed; working tree untouched. Next: review + `git am` the branches you want,
run `docs/audits/2026-07-04-create-issues.sh`, merge the 3 GitHub fix branches, approve decision docs.

## Execution mode (per Mike, 2026-07-04)
ONE agent at a time; verify its worktree (git log/status + run its tests) before starting the next. Order: deploy-targets → poller-schema → doppler-drift → root-cleanup → modules-manifest → decision-specs → pipeline-tests → stripe-retry → quota-gate → cmms-evidence (smallest/safest first).

## Rules for every agent
Work ONLY in its worktree; conventional commits; stage only touched files; NEVER push; offline tests only; ruff for Python; no prod/staging DB access; no new deps.

## Not agent-doable (for Mike)
- Merge existing fix branches on GitHub: `fix/ctx-zipbomb-cap` (security P0), `fix/publish-gate-integration-test`, `fix/ctx-signals-verified-only` (staging gate required).
- Run `bash docs/audits/2026-07-04-create-issues.sh` to file the 18 issues.
- mira-sidecar sunset (needs prod/staging DB), interlock flywheel (live WIP), MVP rescope decision (proposal will be drafted by decision-specs agent).

## Cleanup when done
`git worktree remove .audit-worktrees/<name>` after merging/discarding each branch; branches are local-only.

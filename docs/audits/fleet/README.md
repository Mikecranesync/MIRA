# Fleet output — cohesion-audit fixes (2026-07-04)

10 isolated agents each produced ONE branch of changes off `main` (@ 038263ae).
Nothing was pushed and nothing in your working tree was modified. Each change is
delivered as a `git format-patch` series under `patches/<name>/`. Apply the ones
you want, review, then commit/PR as normal.

## How to apply one

```bash
cd ~/MIRA
git checkout main && git pull            # optional, get current
git checkout -b audit/deploy-targets     # a branch to review on
git am docs/audits/fleet/patches/deploy-targets/*.patch
# review, run tests, then merge/PR — or `git am --abort` to bail
```

`git am` replays the exact commits (message + author + diff). If a patch doesn't
apply cleanly because `main` moved since 2026-07-04, use:
`git apply --3way docs/audits/fleet/patches/<name>/*.patch` instead.

## What each branch does (apply order = safest first)

| # | Branch / patch dir | Commits | Scope | Notes |
|---|---|---|---|---|
| 1 | deploy-targets | 1 | `.github/workflows/deploy-vps.yml` | Adds mira-web to default deploy TARGETS. Trivial, safe. |
| 2 | poller-schema | 1 | `tools/demo_plc_poller.py` (+known-issues) | Routes demo poller through the one-pipeline ingest contract; deletes its rival DDL. Contract-5 test passes. |
| 3 | doppler-drift | 2 | `tools/check_env_drift.py`, allowlist, `ci.yml` | New static env-var drift checker + CI step. Seeds 171 pre-existing offenders into an allowlist to burn down. |
| 4 | root-cleanup | 1 | 146 files | **Deletes `mira_copy/`** (stale marketing tool) and archives root handoffs/competitor reports/screenshots into `docs/archive/` + `docs/promo-screenshots/`. Leaves referenced nginx confs in place. Review the file list before merging. |
| 5 | modules-manifest | 1 | `MODULES.md`, `tests/test_modules_manifest.py` | New lifecycle manifest (26 modules classified) + CI guard so orphans can't hide. |
| 6 | decision-specs | 4 | 4 docs | ADR-0024 unified identity, ADR-0025 single diagnostic engine, fault-detective disposition, MVP rescope proposal. **Docs = decisions for you to approve, not code.** |
| 7 | pipeline-tests | 1 | `tests/pipeline/` (5 files) | 17 offline unit tests for the live chat path (was graded F / "zero tests"). Note: found 5 pre-existing pipeline tests → the "zero tests" premise was stale. |
| 8 | stripe-retry | 1 | `mira-web/src` (4 files) | Durable Stripe→Hub provisioning: pending-queue + reconcile on login/register + admin cron endpoint. Idempotent on Stripe event id. Verified with `bun test` (15/15 new). |
| 9 | quota-gate | 1 | `mira-bots/shared/{quota.py,engine.py}` + test | Plan/quota check at the Supervisor entry so ALL surfaces inherit it. **Flag-gated `ENFORCE_PLAN_QUOTA` (default OFF)**, fail-open. 344 passed regression sweep. |
| 10 | cmms-evidence | 1 | `mira-bots/shared/{wo_evidence.py,engine.py}` + test | Work-order history as citable evidence for a confirmed asset. **Flag-gated `ENABLE_WO_EVIDENCE` (default OFF)**, fail-safe. 64-test regression clean. |

## Flags shipped OFF (turn on after staging verify)

- `ENFORCE_PLAN_QUOTA` (quota-gate) — enforce plan limits on every chat surface.
- `ENABLE_WO_EVIDENCE` (cmms-evidence) — inject CMMS work orders into diagnosis.

Both are off so the branches merge with zero behavior change; flip them in
Doppler staging, run the eval regime, then prod — per your environments doctrine.

## Verification per branch

Every agent ran offline tests in an isolated sandbox clone and reported green:
deploy-targets (YAML valid), poller-schema (Contract-5 pass), doppler-drift
(exit 0 after allowlist), modules-manifest (3 pass), pipeline-tests (17 pass),
stripe-retry (15/15 new, full suite baseline-identical), quota-gate (344 pass),
cmms-evidence (64 pass regression). root-cleanup + decision-specs are file
moves/docs (no tests). Re-run against current `main` before merging — these were
built on 038263ae and `main` may have advanced.

## Still yours to do (not agent-doable)

- Merge existing GitHub fix branches: `fix/ctx-zipbomb-cap` (security P0),
  `fix/publish-gate-integration-test`, `fix/ctx-signals-verified-only`.
- Run `bash docs/audits/2026-07-04-create-issues.sh` to file the 18 issues.
- Approve/adjust the decision-specs docs (identity, engine, fault-detective, rescope).
- mira-sidecar sunset + interlock flywheel (need live DB / are active WIP).

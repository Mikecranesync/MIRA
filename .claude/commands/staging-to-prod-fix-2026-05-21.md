# /staging-to-prod-fix-2026-05-21

End-to-end remediation for the staging→prod readiness gap surfaced
2026-05-21. All testing happens in STAGING. No prod writes without an
explicit one-word OK from Mike at the gate.

## Goal

Close the gap between staging and prod so the hub-overhaul batch + #1418
KG schema work can deploy safely:

1. Apply the two missing prod schema migrations (019, 020) via
   `apply-migrations.yml`, dev → staging → prod, with each step verified.
2. Re-run the bot benchmark + hub E2E audit against STAGING to confirm
   nothing regressed.
3. Surface the result as a single artifact Mike approves before any prod
   write.

This command is a runbook. Each step has a verify line. Don't claim done
until verify passes.

## Inputs (assumed)

- Working tree on `main` (or the latest checkpoint branch).
- `gh` CLI authenticated, repo write.
- `DOPPLER_TOKEN` GitHub secret present for prod workflows.
- Staging stack reachable: `app.factorylm.com` (hub), `:4101` staging hub,
  `@Mira_stagong_bot` Telegram bot.

## Definition of done

A PR titled `ops(prod-readiness): close 019/020 gap + staging verification`
is open with:

- `db-inspect.yml` re-run output (post-apply) showing all 10 artifact
  presence rows = `t`.
- `tests/golden_staging_benchmark_<date>.csv` regenerated against staging
  pipeline (avg score ≥ 3.5/5 — match or beat the 2026-05-20 baseline of
  3.64/5).
- Playwright `audit-staging-*.spec.ts` 12/12 green against staging.
- A one-line verdict — `READY TO DEPLOY` or `BLOCKED: <reason>`.
- Mike's explicit one-word OK (`go` / `deploy` / `merge`) recorded in the
  PR thread before any prod migration run or VPS deploy.

Anything short of all 5 = NOT done.

---

## Step 1 — Confirm the gap (already done, but re-verify on resume)

Read-only. Establishes baseline.

```bash
gh workflow run db-inspect.yml --ref main
# Wait for completion, then:
gh run view --log <RUN_ID> | grep -A 15 "migrations 019-026 artifact"
```

**Verify:** output shows `sessions (019)`, `signals (019)`,
`signal_cache (020)`, `signal_trends (020)` all `f`. Others all `t`. If
that's not the picture, the gap moved — re-baseline before continuing.

## Step 2 — Read the migrations before applying

```bash
cat mira-hub/db/migrations/019_sessions_and_signals.sql
cat mira-hub/db/migrations/020_signal_cache_and_trends.sql
```

**Verify your own understanding of:**

- What tables/columns each migration adds.
- Whether either drops/renames anything (should be additive only — both
  are post-018 in the hub-001 schema shape).
- Whether either depends on data from earlier migrations being present.

**If either migration looks destructive or non-idempotent, STOP and
escalate.** The plan assumes additive + idempotent.

## Step 3 — Apply on STAGING first

Staging Neon branch is the gate per `docs/environments.md`. Even though
the hub-overhaul work already shipped on staging, 019/020 may have been
applied implicitly by an earlier run — verify, don't assume.

```bash
gh workflow run apply-migrations.yml \
  -f migrations="019,020" \
  -f mode=dry-run \
  -f run_backfill=false
```

**Verify dry-run output:** SQL statements printed match the files in
step 2. No unexpected DROP/ALTER.

Then apply:

```bash
gh workflow run apply-migrations.yml \
  -f migrations="019,020" \
  -f mode=apply \
  -f run_backfill=false
```

Wait for green. `apply-migrations.yml` currently runs against the env
configured by the `production` GitHub environment, so this DOES touch
prod — **do not run apply mode in this step**. If the workflow lacks a
staging target, see Step 3b.

### Step 3b — If apply-migrations only targets prod (likely)

The current `apply-migrations.yml` resolves `NEON_DATABASE_URL` from
Doppler `factorylm/prd`. There's no `factorylm/stg` switch in the
workflow.

Two options:

1. **Add a `target` input** (`staging | prod`) that flips Doppler config
   between `factorylm/stg` and `factorylm/prd`. Ship as a separate small
   PR. Verify with `dry-run` against staging.
2. **Manual apply via Doppler from a local shell** for staging only:
   ```bash
   doppler run --project factorylm --config stg -- \
     psql "$NEON_DATABASE_URL" --single-transaction \
     -f mira-hub/db/migrations/019_sessions_and_signals.sql
   doppler run --project factorylm --config stg -- \
     psql "$NEON_DATABASE_URL" --single-transaction \
     -f mira-hub/db/migrations/020_signal_cache_and_trends.sql
   ```
   `prod-guard.sh` blocks `psql` against `factorylm/prd`, NOT
   `factorylm/stg`. Confirm the guard allows the stg path before
   running. If it doesn't, fall back to option 1.

Pick option 1 if there's time; the workflow gap is real tech debt.

**Verify staging after apply:** run a staging-equivalent of
`db-inspect.yml` (add a `target` input there too, OR add a one-off
GHA step that runs the same SELECTs against `factorylm/stg`). All 10
rows should now read `t`.

## Step 4 — Staging benchmark replay

The 2026-05-20 readiness doc captured `avg 3.64/5` on the 10-question
golden set. Re-run after the migration to confirm no regression.

```bash
bash tools/bench-staging-pipeline.sh
# Output: tests/golden_staging_benchmark_<today>.csv
```

**Verify:** average score ≥ 3.5/5. Diff vs `tests/golden_staging_benchmark_2026-05-20.csv`
to spot any answer that newly fails. Commit the new CSV.

If the score drops, root-cause before continuing. Likely culprits:
- ollama-embed-sidecar-down (the 2026-05-18 pattern in
  `.claude/skills/bot-grounding-tests/SKILL.md`)
- A 019/020 migration that broke the engine's session lookup path

## Step 5 — Hub E2E audit on staging

```bash
cd mira-hub
E2E_HUB_URL=https://app.factorylm.com \
E2E_WEB_URL=https://factorylm.com \
E2E_HUB_EMAIL=playwright@factorylm.com \
E2E_HUB_PASSWORD=TestPass123 \
  npx playwright test tests/e2e/audit-staging-2026-05-20.spec.ts \
  --config=tests/e2e/audit-staging.config.ts
```

**Verify:** 12/12 pass. Save the HTML report + new screenshot per the
Screenshot Rule (`docs/promo-screenshots/YYYY-MM-DD_staging-audit_*.png`).

If anything fails, STOP. Don't push to prod.

## Step 6 — Verify Stripe price parity with /pricing

Readiness doc flagged this as a medium-risk regression check. NOT a
staging-only test — it's a config sanity check.

```bash
# Read the rendered /pricing and /upgrade tier amounts from staging:
curl -sS https://app.factorylm.com/pricing | grep -E 'price|tier|97|297' | head -20
# Compare against Stripe products (read-only):
doppler run --project factorylm --config prd -- \
  stripe products list --limit 10 --active=true
```

**Verify:** every visible tier amount on `/pricing` matches the
corresponding Stripe product's recurring price. If a mismatch exists,
either fix the hardcoded display amount OR update Stripe (the second
needs Mike's explicit OK).

## Step 7 — Write the readiness verdict

Create `docs/evaluations/staging-to-prod-readiness-<today>.md` mirroring
the 2026-05-20 doc. Cover:

- 019/020 apply status on staging (with run IDs)
- Benchmark score + delta vs baseline
- E2E pass/fail count + link to artifact
- Stripe / pricing check verdict
- Risk-ordered changelog of any new merges since 2026-05-20
- One-line verdict: `READY TO DEPLOY` / `BLOCKED: <reason>`

## Step 8 — Ship the verification PR

Branch: `ops/staging-readiness-<today>`.

Includes:
- The new readiness doc
- The new benchmark CSV
- Any workflow-target-input changes from Step 3b
- The new screenshot(s)

Title: `ops(prod-readiness): close 019/020 gap + staging verification`

**DO NOT** add prod migrations to this PR — apply happens via
`apply-migrations.yml`, gated by Mike's OK.

## Step 9 — Gate

Comment on the PR with the one-line verdict. Stop. Wait for Mike's OK
(`go` / `deploy` / `merge`). Per
`feedback_merge_needs_explicit_ok.md`, this is required even if
everything looks green.

## Step 10 — On OK, apply on prod (separate session ideally)

```bash
gh workflow run apply-migrations.yml \
  -f migrations="019,020" \
  -f mode=dry-run
# Verify, then:
gh workflow run apply-migrations.yml \
  -f migrations="019,020" \
  -f mode=apply
# Re-run db-inspect.yml; confirm all 10 rows = t.
```

Then trigger `deploy-vps.yml` for the hub-overhaul services. Then run
the post-deploy smoke + E2E from the readiness doc.

---

## Out of scope (deliberately)

- Pre-existing bot citation regression (0/10 sources cited). Tracked
  separately. Not a 019/020 problem.
- Ollama-embed-sidecar-down pattern. If it recurs during Step 4, fix is
  in `.claude/skills/bot-grounding-tests/SKILL.md`.
- The `021_*.sql` filename collision (two migrations both numbered 021).
  Note it in the readiness doc as follow-up tech debt.
- Anything outside the marketplace plan (monday.com Phase 1 / UpKeep
  Phase 2). If a side quest looks tempting, log it in `docs/ideation/`
  and come back to the plan.

## Hard rules (do not violate)

- Never `psql` prod NeonDB from this session (CLAUDE.md §Environments).
- Never `docker compose` on the VPS directly (use `deploy-vps.yml`).
- Never test feature-branch builds against `@FactoryLM_Diagnose` — use
  `@Mira_stagong_bot`.
- Stop and ask the human if a migration looks destructive or
  non-idempotent.
- One-word OK from Mike required before Step 10.

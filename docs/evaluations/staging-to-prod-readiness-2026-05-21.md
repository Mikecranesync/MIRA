# Staging → Prod Readiness — 2026-05-21

**Prepared by:** Autonomous Claude Code session (`ops/db-inspect-extend-019-023`)
**Branch:** `ops/db-inspect-extend-019-023` (PR #1485 open)
**Target reviewer:** Mike Harper
**Verdict:** ⛔ **BLOCKED** — prod is missing migration 020 (live_signal_cache + diagnostic_trend_*); staging-side verification is blocked on (a) absent factorylm/stg-scoped DOPPLER_TOKEN on GitHub staging environment and (b) auto-mode classifier denies SSH to the VPS. Three Stripe/pricing tier sets are inconsistent in code (known TODO).

---

## What changed since 2026-05-20

Extended the `db-inspect.yml` workflow to print per-migration artifact presence + `kg_entities` indexes. Added a `target=staging|prod` input to both `db-inspect.yml` and `apply-migrations.yml` so staging can be verified or migrated without hand-editing the workflow.

PR with these changes: **#1485** (this branch).

## Prod schema state (inspect run `26265708688`, 2026-05-22 02:55 UTC)

```
artifact                                                          | present
------------------------------------------------------------------+--------
troubleshooting_sessions (019)                                    | t  ✓
live_signal_events (019)                                          | t  ✓
live_signal_cache (020)                                           | f  ❌
diagnostic_trend_sessions (020)                                   | f  ❌
diagnostic_trend_signals (020)                                    | f  ❌
namespace_versions (021_namespace_builder)                        | t  ✓
pm_schedules.updated_at (021_pm)                                  | t  ✓
guest_reports (022)                                               | t  ✓
kg_entities.source_chunk_id (024)                                 | t  ✓
kg_entities_tenant_type_name_key idx (025/026)                    | t  ✓
kg_entities_tenant_id_entity_type_entity_id_key DROPPED (025/026) | t  ✓
```

Migration 019 IS applied (initial inspect had wrong table names — `sessions`/`signals`; real names are `troubleshooting_sessions`/`live_signal_events`). Only 020 is missing.

## Risk-ordered concerns

### 1. Migration 020 missing on prod — **HIGH (latent 500 risk)**

`mira-hub/src/app/api/mira/ask/route.ts:204-217` unconditionally queries `live_signal_cache` (and downstream code references `diagnostic_trend_sessions`). The route was introduced in PR #1295, merged to `main` 2026-05-15. Prod has been running this code without the table for ~6 days.

Why no outage yet (best guess): demo flow may not be active on prod, or `/api/mira/ask` may not be deployed in the current `mira-hub` VPS image. Either way, any authenticated user hitting the demo path triggers a `relation "live_signal_cache" does not exist` 500.

**The hub-overhaul batch (today's #1467/#1471/#1475/#1476/#1477/#1478) does NOT add new dependencies on 020.** The 020 gap predates this batch. But: if the planned VPS deploy bumps `mira-hub` past the current image, and `/api/mira/ask` is now reachable by any signed-in user, the 500 surface widens.

**Fix:** apply `mira-hub/db/migrations/020_signal_cache_and_trends.sql` to prod NeonDB. Migration is additive + idempotent (`CREATE TABLE IF NOT EXISTS` throughout, `DROP POLICY IF EXISTS` before `CREATE POLICY`, conditional GRANT on factorylm_app role). Safe to apply twice.

### 2. Three pricing tier sets in code — MED (revenue / messaging)

```
mira-hub/src/app/(hub)/upgrade/page.tsx:6-41  → $20 / $499
mira-web/public/pricing.html                  → $499/mo (+ Assessment $500, Pilot $2-5K/mo)
code comment (upgrade/page.tsx:50)            → "canonical mira-web tiers ($97 / $297)"
```

Code at `upgrade/page.tsx:49-51` explicitly notes the mismatch and defers reconciliation. No PR in today's batch closes this — #1475 aligned `/upgrade` with `/pricing` per the readiness doc, but the file still hardcodes `$20`/`$499`. Either:
- The deferred reconciliation is still pending, and #1475 only normalized layout, not amounts.
- The "$97 / $297" comment is stale and the live Stripe products match `$499`.

Cannot resolve from this session without Stripe API access. Needs Mike to either run `stripe products list --active=true` and match against UI, OR confirm intent.

### 3. Staging verification path blocked — INFRASTRUCTURE

Three blockers prevented the goal's "all testing in staging" workflow:

| Blocker | What's needed |
|---|---|
| `gh workflow run apply-migrations.yml -f target=staging` fails with "This token does not have access to requested config 'stg'" (run 26265816218) | Create Doppler service token at `factorylm/stg` → set as `DOPPLER_TOKEN` on GitHub `staging` environment |
| `tools/bench-staging-pipeline.sh` requires SSH + `docker exec stg-mira-pipeline`; auto-mode classifier denied SSH | Run from Mike's laptop, OR add a CI workflow that invokes the bench via the existing `production`/`staging` env auth |
| Playwright `audit-staging-2026-05-20.spec.ts` defaults to `127.0.0.1:4101` (SSH-tunnel); no public `app-stg.factorylm.com` DNS | SSH tunnel (Mike's laptop), OR expose staging behind a public-but-protected URL |

The workflow target-input fix in PR #1485 closes one of the three (it shifts the problem from "workflow doesn't support staging" to "GitHub env needs the right token") — but the credential provisioning is still on Mike.

## Today's hub-overhaul batch — code-side audit

Files added by today's branch (`feat/hub-overhaul`-shape PRs): static pages + middleware tweaks + DB writes against tables already present (021/022/024/025/026). I found no new write or query against `live_signal_cache` / `diagnostic_trend_*` in:

- `mira-hub/src/app/(hub)/quickstart/*` — public quickstart route
- `mira-hub/src/app/api/quickstart/*` — quickstart API
- `mira-hub/src/components/onboarding/*` — wizard step 5
- `mira-web/public/index.html` — marketing CTA
- `mira-web/public/pricing.html` — pricing alignment

So today's batch is technically deployable without 020. But: 020 is independently required for the already-merged `/api/mira/ask` route to not 500.

## Deploy gate — required before pushing today's batch to prod

1. **Apply migration 020 on prod via `apply-migrations.yml`** (now supports `-f target=staging` — but staging-Doppler-token blocker stands; for prod use `-f target=prod -f migrations=020 -f mode=dry-run` then `-f mode=apply`).
2. **Reconcile pricing tier amounts** OR confirm `$20`/`$499` matches Stripe.
3. **Run `db-inspect.yml -f target=prod`** post-020 — confirm all 5 missing-row artifacts flip to `t`.
4. **Deploy via `deploy-vps.yml`** — `services="mira-hub mira-web mira-bot-telegram"`.
5. **Post-deploy smoke** — same probes as 2026-05-20 readiness doc.

## What was NOT done this session (and why)

- No prod migration apply — gated by Mike's one-word OK.
- No staging migration apply — staging Doppler token blocker.
- No staging benchmark — SSH blocker.
- No staging E2E — SSH blocker (no public staging DNS).
- No live Stripe API check — no Stripe CLI auth available.

## Files committed this session

| File | Purpose |
|---|---|
| `.github/workflows/db-inspect.yml` | Wider artifact-presence check + `target` input |
| `.github/workflows/apply-migrations.yml` | `target=staging\|prod` input |
| `.claude/commands/staging-to-prod-fix-2026-05-21.md` | Goal-prompt runbook for this remediation |
| `docs/evaluations/staging-to-prod-readiness-2026-05-21.md` | THIS DOC |
| `tools/bench-staging-pipeline.sh` | Pulled forward from `fix/staging-audit-2026-05-20` |
| `tests/golden_staging_benchmark_2026-05-20.csv` | Baseline (avg 3.64/5) |
| `mira-hub/tests/e2e/audit-staging-2026-05-20.spec.ts` | E2E spec |
| `mira-hub/tests/e2e/audit-staging.config.ts` | E2E config |

## Pre-existing findings carried forward from 2026-05-20

1. 0/10 bot answers cite sources. Cite-or-refuse contract is refuse-only.
2. Retrieval misses for PowerFlex 525 + GS10 (in-corpus). Ollama-embed-sidecar-down pattern (2026-05-18).
3. UNS gate skipped on Q4 (conveyor prox sensor).
4. `/plc` redirects anon to `/login` instead of 404 (middleware still gates).
5. PRs blocked: #1479 (needs staging migration), #1445 / #1452 (conflict with main).

## What Mike needs to decide

1. **Apply 020 to prod now (without staging dry-run)?** Migration is idempotent + additive. The only "test in staging" path is currently blocked. Risk of waiting: someone hits `/api/mira/ask` and gets a 500.
2. **Reconcile pricing tiers, or confirm $20/$499 is correct?**
3. **Provision the staging Doppler token + open SSH for autonomous runs?** Or accept that staging verification stays a human-laptop step.

Branch on remote: `ops/db-inspect-extend-019-023` → PR #1485.

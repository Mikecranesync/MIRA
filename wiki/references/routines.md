# MIRA Routines — Scheduled Async Work

Routines are higher-order Claude Code prompts triggered by schedule, GitHub events, or API calls. They run in the cloud asynchronously — wake up to PRs ready to merge.

Configure at: https://code.claude.com (Routines tab)

## Recommended MIRA Routines

### Daily — KB ingest health check (07:00 UTC)
**Trigger:** cron, daily 07:00 UTC
**Prompt:** "Check `tools/google_drive_ingest.py` last run timestamp in NeonDB. If > 36h stale, run the ingest pipeline. If errors found in `mira-crawler/logs/`, open an issue with the diagnostic."
**Why:** Manual ingest currently relies on Mike triggering Celery tasks. This catches drift.
**Reference:** `project_manuals_ingest.md` memory (29/47 PDFs done, 17 remaining)

### Hourly — Hub KG sync per tenant
**Trigger:** cron, hourly (`0 * * * *`)
**Prompt:** "For each tenant in NeonDB `tenants` (or the active subset in `tenant_id` settings), POST `/hub/api/kg/sync` with the tenant session bearer. The endpoint runs `syncCmmsToKg` — idempotent, pulls cmms_equipment + work_orders + pm_schedules + Atlas parts AND mirrors knowledge_entries manufacturers/models into `kg_entities` with `uns_path` populated. Log the SyncResult per tenant. If any tenant returns 5xx, post to the ops issue tracker with the duration + error."
**Why:** `/namespace` renders only what's in `kg_entities`. Equipment + manuals live in `cmms_equipment` and `knowledge_entries`; without this Routine the tree silently goes stale relative to Assets / Knowledge pages.
**Reference:** `mira-hub/src/app/api/kg/sync/route.ts`, `mira-hub/src/lib/knowledge-graph/cmms-sync.ts` (extended with `uns_path` + knowledge-entries mirror in PR landing 2026-05-17).

### Daily — Lead hunter status (08:00 UTC)
**Trigger:** cron, daily 08:00 UTC
**Prompt:** "Read `marketing/prospects/hardening-alerts.jsonl`. Summarize last 24h of new leads. If `mira-crawler/Dockerfile.celery` still missing `tools/lead-hunter/` COPY, post a reminder to the issue tracker."
**Why:** The COPY-missing gap is logged in `project_celery_lead_hunter_gap.md` memory — Routines can keep nagging until fixed.

### Per-PR — Ultrareview on hot paths
**Trigger:** GitHub event — PR opened touching `mira-bots/shared/`, `mira-pipeline/`, `mira-mcp/`, `mira-web/`
**Prompt:** "Run a thorough review on this PR. Focus on: PII sanitization, error handling on LLM calls, hardcoded IPs/secrets, breaking changes to engine.py public API. Post findings as a single PR comment with 🔴 IMPORTANT / 🟡 WARNING / 🔵 SUGGESTION sections."
**Why:** The current `code-review.yml` cascade is a single-shot review. Ultrareview's agent fleet finds more issues for the same wallclock.

### Per-PR — Auto-fix on label
**Trigger:** GitHub event — `auto-fix` label added to a PR
**Prompt:** "Read 🔴 IMPORTANT review comments on this PR. Apply minimal targeted fixes. Commit and push. Loop up to 3 times."
**Why:** Replaces manual `bash scripts/pr_self_fix.sh <PR>` invocations.
**Note:** This duplicates the local cascade script — pick one. Native is faster; the cascade keeps the provider trail.

### Weekly — MIRA-vs-LLM grounded-answer benchmark (Wednesdays 05:00 UTC)
**Trigger:** cron, Wednesday 05:00 UTC (`0 5 * * 3`)
**Preconditions:** `tests/mira_bench.py` + scoring loop landed (see `docs/evaluations/mira-vs-llm-benchmark-evaluation-2026-05-23.md` §10). Until then this routine has nothing to run.
**Prompt:**
> Run the MIRA-vs-LLM grounded-answer benchmark on the staging NeonDB branch only.
>
> 1. Assert `NEON_DATABASE_URL` ends in the staging branch hostname — abort otherwise.
> 2. Verify GS10/GS11 coverage: `kb_has_pair_coverage('AutomationDirect', 'GS11', $MIRA_BENCH_TENANT_ID)`. If `(False, 0)`, open a GitHub issue titled "Benchmark blocked: no GS11 coverage in bench tenant" and stop.
> 3. Run `doppler run --project factorylm --config stg -- python tests/mira_bench.py --question-set tests/benchmark/mira_vs_llm_questions.json --modes A,B,C`.
> 4. Run `python tests/eval/score_mira_bench.py --run-dir docs/evaluations/runs/$(date -u +%Y-%m-%d)`.
> 5. Open a PR titled `docs(eval): mira-vs-llm benchmark $(date -u +%Y-%m-%d)` containing only the new files under `docs/evaluations/runs/`. PR body = the `report.md` contents.
> 6. If `mean(B) < mean(C) - 0.3` OR `mean(B) < mean(A) + 1.0`, add label `benchmark-regression` and `@`-mention `@mikeharper` in the PR body.
> 7. If the embedding sidecar was unreachable during the run (per the report's `embedding_available` field), add label `embedding-sidecar-down` — do not treat the regression as real until that is resolved.

**Why:** Pinned regression net for "does grounding still beat copy-pasting the manual into Claude." Drift here is the single most important signal for the product wedge.

**Kill-switch:** Disable from the Routines tab. Fallback: rename `tests/mira_bench.py` — the routine will fail-fast on the next run.

**Cost cap:** Limit to 50 questions × 3 modes × cascade-cheapest-provider. Hard-fail if total LLM tokens exceed 1M per run.

**Reference:** `docs/evaluations/mira-vs-llm-benchmark-evaluation-2026-05-23.md`.

### Weekly — Dependency audit (Mondays 06:00 UTC)
**Trigger:** cron, Monday 06:00 UTC
**Prompt:** "Run `dependency-check.yml` workflow. Open a PR if any high-severity CVEs are found in mira-bots, mira-mcp, mira-pipeline, or atlas-api. Summarize impact in PR body."
**Why:** Currently only fires on PR diff. Weekly cadence catches transitive CVEs.

### Weekly — Wiki freshness sweep (Sundays 22:00 UTC)
**Trigger:** cron, Sunday 22:00 UTC
**Prompt:** "Read `wiki/hot.md`. If any pinned items are >14 days old, propose archiving. Check `wiki/index.md` for broken links to deleted files. Open a PR with the cleanup."
**Why:** The Karpathy-pattern wiki rots if nobody sweeps it.

### Pre-deploy — Smoke check (on `main` push)
**Trigger:** GitHub event — push to main
**Prompt:** "Run `bash install/smoke_test.sh`. If failures, post to the deploy issue tracker before VPS deploy fires."
**Why:** Currently the deploy-vps workflow ships even if smoke is yellow. Routines can short-circuit.

## Setup checklist

For each Routine you enable:
- [ ] Verify the trigger fires in a sandbox first (use a dummy schedule, watch Routines tab)
- [ ] Confirm Doppler secrets (Groq/Cerebras/Gemini keys) are accessible to the cloud agent
- [ ] Add a `routines/` log line to `wiki/hot.md` so manual ops know what's running
- [ ] Set a kill-switch — every Routine should have a `disable` command in case it goes rogue

## What NOT to put in Routines

- Anything touching prod containers (VPS, atlas-api, mira-pipeline live). Use the deploy-vps workflow with manual approval.
- Anything that writes to `main`/`develop`/`dev` directly. Routines open PRs, never merge.
- Anything requiring secrets not in Doppler `factorylm/prd`. No new secret stores.
- Anything that costs real money per run (Stripe API, paid third-party scrapers) without a per-run budget cap.

## References
- [Claude Code Routines docs](https://code.claude.com/docs/en/whats-new) — search "Routines"
- `wiki/references/claude-code-v2.1.md` — broader feature catalog
- `autonomous-run` skill — discipline for any unattended Claude run

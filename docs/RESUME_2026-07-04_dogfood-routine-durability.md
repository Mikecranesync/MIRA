# RESUME 2026-07-04 — Dogfood judge as a durable autonomous QA routine

Self-contained resume point. Everything below is **on `main`** unless noted.
Companion plan: `docs/plans/2026-07-03-dogfood-routine-durability.md`.
Memory: `project_dogfood_judge_schedule`.

## TL;DR

The **dogfood judge** (human-journey product tester — logs into the staging Hub
as QA personas, walks the core product paths, grades GREEN/YELLOW/RED in business
language) now runs as a **self-running, self-watching, self-filing routine**:

- Runs **every 4h** on Bravo via launchd (`com.factorylm.dogfood-judge`).
- Each run reseeds + re-mints sessions (self-heals), runs the judge, and **posts
  its verdict to GitHub issue #2417** (`<!-- dogfood-heartbeat -->` marker).
- A GitHub **dead-man's-switch** (`dogfood-judge-heartbeat.yml`, every 6h) reads
  #2417 and **fails/emails on STALE (>9h) or RED**. Runs on GitHub, so a Bravo
  reboot can't kill it.
- **Auto-files** confirmed, two-persona-verified, deduped REDs as issues
  (`DOGFOOD_FILE_ISSUES=1`). A persistent RED files **exactly once**.
- A **weekly digest** (`dogfood-weekly-digest.yml`, Mondays) posts a 7-day
  green/yellow/red trend to #2417.
- The safety machinery is CI-guarded (`crew-tests.yml`, 36 hermetic tests).

Current verdict: **YELLOW** (2 green incl. beta-gate + work-order; 3 empty-test-
tenant yellow; 0 red). `main` at v3.59.0.

## What shipped in this thread (the arc)

Started from "test it like a human and make sure it does what we say" →

1. **Beta-gate journey** (PR #2400) — proved GREEN live: a stranger uploads a
   manual through the real folder=brain door → gets a **cited answer from that
   manual** (node-scoped chat, un-fakeable). Our #1 claim, now tested every 4h.
2. **QA-seeder fix** (PR #2400) — the synthetic seeder didn't mirror tenants into
   the data-side `tenants` table (#1899b), so every QA-persona upload 23503'd
   ("Server storage error"). Fixed → beta-gate can run on QA tenants.
3. **`/context` fix** (PR #2402) — `GET /api/assets/[id]/context` looked the id up
   in `kg_entities` but it's a `cmms_equipment.id`; 404'd for real assets. Fixed
   (resolve from cmms_equipment, enrich uns_path from kg via the chat-route
   bridge). 3 regression tests.
4. **4-hour schedule** (PR #2405) — `scheduled_run.sh` + plist on Bravo launchd.
5. **Durability arc** (`docs/plans/2026-07-03-dogfood-routine-durability.md`):
   - Phase 1 (PR #2411) — CI guard: `crew-tests.yml` runs the runner/judge/gate
     hermetic suites (36 tests) on any `tools/crew/**` change.
   - Phase 2 (PR #2418) — observability + heartbeat (issue #2417 + heartbeat wf).
   - Phase 3 (PR #2420) — guard the seeder mirror
     (`mira-hub/src/lib/seed-synthetic-tenants-mirror.test.ts`).
   - Phase 4 (PR #2434) — autonomous filing + RED escalation + weekly digest.
   - Phase 5 — **blocked**: move execution off Bravo, needs a public staging URL.

## Current live state / key coordinates

| Thing | Where |
|---|---|
| Scheduled runner (4h) | `tools/crew/dogfood/scheduled_run.sh` + `com.factorylm.dogfood-judge.plist` (installed `~/Library/LaunchAgents/`, `DOGFOOD_FILE_ISSUES=1`) |
| The judge + checks | `tools/crew/dogfood/judge.sh`, `checks/*.check` (incl. `beta-gate.check`) |
| Bug-filing runner | `tools/crew/run_synthetic_workers.sh` (retries + `--until-find`) |
| Gated filer | `tools/qa/create_issue.sh` (two-persona verify + dedupe; declines silently on dup in non-interactive mode) |
| Status / heartbeat issue | **#2417** (`Dogfood judge — rolling status`) |
| Heartbeat (stale+RED) | `.github/workflows/dogfood-judge-heartbeat.yml` (6h) |
| Weekly digest | `.github/workflows/dogfood-weekly-digest.yml` (Mon 13:00 UTC) |
| CI guard | `.github/workflows/crew-tests.yml` |
| Verdict ledger | `qa/dogfood/history.log`; latest report `qa/dogfood/latest-report.md` |
| Staging Hub | `http://100.68.120.99:4101` (Tailscale, from Bravo only) |
| stg secrets | Doppler `factorylm/stg`; launchd token `~/.doppler/rbac-weekly-stg.token` |

## How to operate / verify

- **See status:** watch issue #2417 (verdict every 4h) or `tail qa/dogfood/history.log`.
- **Run now:** `launchctl start com.factorylm.dogfood-judge` (full path) or
  `QA_BASE_URL=http://100.68.120.99:4101 bash tools/crew/dogfood/judge.sh` (judge only).
- **Trigger monitors:** `gh workflow run dogfood-judge-heartbeat.yml` /
  `gh workflow run dogfood-weekly-digest.yml`.
- **Turn filing off:** set `DOGFOOD_FILE_ISSUES` to `0` in the plist + reload.
- **Hermetic tests:** `bash tools/crew/test_run_synthetic_workers.sh` (19),
  `bash tools/crew/dogfood/test_judge.sh` (10), `bash tools/qa/test_create_issue_gate.sh` (7).

## What's left / next

- **Phase 5 (blocked):** move the judge to a scheduled GH Action so it doesn't
  depend on Bravo. Blocked until a **public staging URL** (`stg.factorylm.com` or
  equivalent) exists — GH runners can't reach the Tailscale Hub. Same blocker the
  RBAC weekly job documents (`tools/qa/rbac/weekly_inspect.sh`).
- **Product YELLOWs (not bugs):** 3 paths are YELLOW because the synthetic test
  tenant has no live signals + sparse customer docs, and the demo tenant needs
  `DEMO_API_TOKEN`. Seeding a live signal + a customer doc, or wiring the demo
  tenant, would turn those into real GREEN/RED instead of "untested."
- **Optional cleanup:** several merged local feature branches linger
  (`feat/dogfood-*`, `fix/hub-asset-context-id-space`, …) — safe to delete.

## Gotchas learned (so the next session doesn't relearn them)

- **Multi-PR VERSION/CHANGELOG churn:** concurrent PRs collide on `/VERSION` +
  the top of `docs/CHANGELOG.md` (both edit the same lines). Expect to merge main
  in and re-bump on the second PR. **Gate the merge commit on a marker check** —
  a stray `=======` shipped once here before I caught it.
- **vitest only runs `src/**`** — a test under `mira-hub/scripts/` never runs in
  CI. Put guards under `src/` and read the script file from there.
- **`cmms_equipment.tenant_id` is TEXT, `kg_entities.tenant_id` is UUID** — never
  compare them as columns (uuid = text error); use separate param-bound queries.
- **`create_issue.sh` declines silently on a dedupe match in non-interactive
  mode** — that's why auto-filing a persistent RED doesn't spam.

# Dogfood Routine Durability Plan

**Date:** 2026-07-03
**Goal:** turn the dogfood / synthetic-worker system into a durable, observable,
self-sustaining **routine** — so it cannot silently break (its safety gate
regresses) *or* silently die (the Bravo schedule stops and nobody notices).

## Current state (verified 2026-07-03)

| Piece | Durable? | Where |
|---|---|---|
| Beta-gate **claim** (upload → cited answer) | ✅ CI-enforced | `beta-gate.yml` (weekly cron + on-push, dev Neon) |
| `/context` fix | ✅ CI-enforced | 3 regression tests under **Hub Unit Tests** (`ci.yml` → `vitest run`) |
| Versioning / rollback | ✅ | `version-gate.yml` + `version-tag.yml` |
| 4h dogfood judge run | ⚠️ Bravo-only | `com.factorylm.dogfood-judge` launchd; **definition** committed (`scheduled_run.sh` + plist) |
| Crew/dogfood hermetic tests (runner 19 / judge 10 / gate 7) | ❌ **no CI** | fixed by **Phase 1** |
| Schedule observability (silent-death) | ✅ shipped | verdict → issue #2417 + `dogfood-judge-heartbeat.yml` dead-man's-switch (**Phase 2**) |
| Seeder `tenants` mirror | ✅ shipped | `seed-synthetic-tenants-mirror.test.ts` (**Phase 3**) |
| Auto-filing + RED escalation | ✅ shipped | `DOGFOOD_FILE_ISSUES=1` + heartbeat fails on RED + weekly digest (**Phase 4**) |
| Move execution off Bravo | ⛔ blocked (no public staging URL) | **Phase 5** |

## Phase 1 — CI guard for the safety machinery ✅ SHIPPED

`.github/workflows/crew-tests.yml` — path-filtered on `tools/crew/**` +
`tools/qa/create_issue.sh`. Runs `shellcheck -S warning` on the four crew scripts
plus the three hermetic suites (36 tests, `gh` shimmed, no network, ~1 min):
`test_run_synthetic_workers.sh`, `test_judge.sh`, `test_create_issue_gate.sh`.

- **Why first:** these suites are the *only* thing that keeps the verify-before-file
  gate honest (independent reproduction + distinct verifier + dedupe). With no CI
  they could silently regress into filing false bugs — the worst failure mode.
- **Done when:** the workflow is green on a crew-touching PR (this PR).

## Phase 2 — Observability + heartbeat (make silence detectable) ✅ SHIPPED

Tracking issue **#2417**; `scheduled_run.sh` posts each verdict there;
`dogfood-judge-heartbeat.yml` is the GH-side dead-man's-switch. Verified live:
a real run posted a YELLOW verdict to #2417, and the freshness check reads it
(fresh → OK, >9h → fail). 2c (skip-clean placeholder) folded into the heartbeat's
`workflow_dispatch` — not a separate file.

The Bravo job can stop (reboot, LaunchAgent unload) and nobody would know. Fix by
making it *report* and *alarm on staleness* — the RBAC job's "post to #578" pattern.

- **2a. Verdict → tracking issue.** `scheduled_run.sh` posts each run's verdict
  (GREEN/YELLOW/RED + run dir + one-line summary) as a comment on a durable
  "Dogfood judge — rolling status" issue, gated on `GITHUB_PAT` (stg Doppler). Off
  when the token is absent; never fails the run.
- **2b. Dead-man's-switch workflow.** `dogfood-judge-heartbeat.yml` — a scheduled
  GH workflow (every ~6h) that reads *only the tracking issue's* last-comment
  timestamp via the GitHub API (no staging access needed, so it runs fine on
  GH-hosted runners) and **fails** if the newest verdict is older than N hours.
  This is the durability win: GitHub notices when Bravo goes quiet.
- **2c. (optional)** a skip-clean placeholder + `workflow_dispatch` mirroring
  `qa-rbac-inspect.yml` for on-demand docs/trigger.
- **Done when:** a run posts to the tracking issue and the heartbeat goes red if
  the last verdict is stale.

## Phase 3 — Guard the enabling fixes

- **3a.** A test asserting `seed-synthetic-users.ts` inserts into `tenants`
  (protect the beta-gate-enabling mirror; dropping it silently re-breaks QA
  uploads). Cheapest form: a unit test that greps the seeder for the
  `INSERT INTO tenants` mirror; stronger form: assert it in the seeder's
  DB-integration harness.
- **3b. (optional)** extend `crew-tests.yml` to `bash -n` syntax-lint every
  `tools/crew/dogfood/checks/*.check`.
- **Done when:** removing the `tenants` mirror turns a test red.

## Phase 4 — From "test" to "routine": filing + escalation ✅ SHIPPED

Shipped: `DOGFOOD_FILE_ISSUES=1` in the plist (verified live: run logged "filing
ENABLED", 0 REDs → filed nothing); heartbeat now fails on RED (verified: parses
the verdict, YELLOW → no escalation, RED → fail); weekly digest
`dogfood-weekly-digest.yml` posts a 7-day rollup to #2417 (verified: tallies
5 verdicts). Safe by construction — a RED is filed only after a second persona
reproduces it, deduped, and on a dedupe match in non-interactive mode
`create_issue.sh` DECLINES silently (no re-file, no repeat comment), so a
persistent RED files exactly once. 4c note below stays for context.

- **4a.** Flip `DOGFOOD_FILE_ISSUES=1` (plist env) so confirmed, two-persona-
  verified, deduped REDs auto-open issues (needs `GITHUB_PAT` in stg).
- **4b.** Route a RED verdict to a push/Slack notification so a customer-blocker
  *pages a human*, not just files.
- **4c.** Weekly rollup digest of the 4h verdicts (trend from `history.log` /
  the tracking issue) — is the product getting better or worse over time?
- **Done when:** an injected RED opens exactly one deduped issue + notifies, with
  no dupes across subsequent runs.

## Phase 5 — Portability (blocked externally)

When a public staging ingress exists (`stg.factorylm.com` or equivalent), the whole
judge can run as a scheduled GH Action with no Bravo dependency — the same blocker
`tools/qa/rbac/weekly_inspect.sh` documents (Tailscale-only staging Hub). Until
then, **Bravo launchd + the Phase 2 heartbeat is the durable arrangement.**

## Sequencing

Phase 1 now (shipped this PR). Phase 2 next — highest durability ROI (turns a
silent-death risk into a monitored routine). Phase 3 is small, fold in alongside
Phase 2. Phase 4 when autonomous filing is wanted. Phase 5 is gated on infra
outside this repo.

## Cross-references

- `tools/crew/dogfood/scheduled_run.sh` + `com.factorylm.dogfood-judge.plist` — the 4h job.
- `tools/qa/rbac/weekly_inspect.sh` — the launchd-on-Bravo pattern this mirrors.
- `.github/workflows/beta-gate.yml` — the already-durable release-gate claim.
- Memory: `project_dogfood_judge_schedule`, `project_rbac_qa_staging`.

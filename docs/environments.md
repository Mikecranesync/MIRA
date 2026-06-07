# MIRA Environments — Dev / Staging / Production

**Owner doctrine. Read before:** changing infra, running a migration, restarting a container, deploying a bot, seeding the KB, or wiring a new workflow.

This doctrine is referenced from `CLAUDE.md` and `.claude/CLAUDE.md`. Every Claude Code session is expected to honor it.

> **Status note (last refreshed 2026-05-31):** Staging is mostly mechanical as a CI gate — Doppler `factorylm/stg`, the NeonDB staging branch (closed Gap-2), and `.github/workflows/staging-gate.yml` (closed Gap-4) all exist and run on every PR. The two remaining gaps are local-development conveniences: `docker-compose.staging.yml` (Gap-1, makes interactive local staging easier) and `@MiraStagingBot` (Gap-3, makes interactive local Telegram probing possible). Neither blocks the CI gate. Locally-run staging today = Charlie boot with `doppler run -p factorylm -c stg`, against the staging Neon branch, with bot traffic routed to a personal/dev bot — *never* `@FactoryLM_Diagnose`.

---

## Why this exists

Mike has been burned multiple times by changes that worked locally but broke in production. The root cause has been the same every time: there is no enforced separation between "where I iterate," "where I prove it's safe," and "what customers see." This doc closes that gap.

The three environments below are not aspirational — they are how every code change must move from a branch to the VPS.

---

## The three environments

| | **DEV** | **STAGING** | **PRODUCTION** |
|---|---|---|---|
| **Where** | CHARLIE local (`~/MIRA`) | CHARLIE + NeonDB staging branch | VPS (`165.245.138.91`) |
| **Compose** | `docker-compose.yml` | `docker-compose.staging.yml` *(TODO — open Gap-1, local-dev only; CI gate runs Supervisor in-process)* | `docker-compose.saas.yml` |
| **Doppler config** | `factorylm/dev` | `factorylm/stg` | `factorylm/prd` |
| **NeonDB** | dev branch (or local Postgres) | staging branch (zero-copy clone of prod) — `br-small-term-ahtkz61d` | main branch — `br-lively-bread-ahoa86se` |
| **Telegram** | `@MiraDevBot` *(if created)* or skip | `@MiraStagingBot` *(TODO — open Gap-3, local-probing only; CI gate calls Supervisor directly)* | `@FactoryLM_Diagnose` |
| **Purpose** | Write code, run unit/eval tests, iterate fast | Test against real-shape data; final gate before prod | Customer surface |
| **Safe to break** | YES | YES (but must pass gate before promotion) | **NEVER** |
| **Gate to enter** | none | local tests pass | staging gate passes (see below) |
| **Who can deploy** | anyone | merge to main | `deploy-vps.yml` workflow (gated on `smoke-test.yml`) |

### Existing infrastructure (what's wired today)

- **prod-guard** — `tools/hooks/prod-guard.sh` is registered as a `PreToolUse(Bash)` hook in `.claude/settings.json`. It blocks SSH to `*.factorylm.com` / `factorylm-prod`, `docker restart|stop|down|kill` of prod services, `nginx -s reload`, `systemctl restart|stop|reload mira-*|nginx|atlas-*`, `kubectl apply|delete|rollout`, and prod-targeted `scp`/`rsync`. Override: `MIRA_ALLOW_PROD=1` (human-only, per-shell).
- **smoke test** — `.github/workflows/smoke-test.yml` runs on PR and on push to main. Pings `factorylm.com` + `app.factorylm.com`. Path-filtered (skips docs/wiki/markdown/.claude).
- **staging gate** — `.github/workflows/staging-gate.yml` (PR #1386, active since 2026-05-18). Instantiates Supervisor in-process against the NeonDB staging branch, runs the question bank in `tools/staging_questions.yaml` through the Groq→Cerebras→Gemini judge cascade, grades replies on the 5-dimension rubric in `docs/specs/mira-answer-quality-standard.md`. No path filter — runs on every PR to main. `deploy-vps.yml` refuses to deploy any commit whose Staging Gate run was not `completed:success`.
- **deploy-vps** — `.github/workflows/deploy-vps.yml` listens for `workflow_run: ["Smoke Test"] conclusion: success` on `main` and additionally verifies the Staging Gate run on the PR head SHA before deploying. Hotfix bypass via `workflow_dispatch` with `skip_staging_gate=true` (honor-system; record the reason in a PR/issue). Concurrency-locked (no parallel deploys).
- **NeonDB staging branch** — `br-small-term-ahtkz61d` ("staging"), zero-copy fork of `br-lively-bread-ahoa86se` ("production") under project `divine-heart-77277150`. Endpoint `ep-polished-hall-ahcqtcxe-pooler`. URL stored as `NEON_STG_DATABASE_URL` secret on the `staging` GitHub environment.
- **apply-migrations** — `.github/workflows/apply-migrations.yml` runs Hub migrations against prod NeonDB. Manual dispatch, `dry-run` mode default, `production` environment gate for audit + approval.

### Known gaps

Numbering is stable — closed gaps keep their original number so cross-references in older PRs / specs / issues still resolve.

**Open:**

- **Gap-1** — `docker-compose.staging.yml` does not exist. Today, "staging" is whatever you `docker compose up` locally with `--config stg`. Until the file lands, locally-running staging = Charlie boot with `doppler run -p factorylm -c stg`. (The CI `staging-gate.yml` does NOT need this file — it instantiates Supervisor in-process.)
- **Gap-3** — `@MiraStagingBot` does not exist. Until it does, do **not** point a staging build at `@FactoryLM_Diagnose`. Use a no-op adapter or a personal test bot. The CI `staging-gate.yml` calls Supervisor directly with `platform="staging"`, so no Telegram bot is needed for the gate; this gap matters only for interactive local probing.

**Closed (kept here for history):**

- ~~Gap-2~~ — NeonDB staging branch — **closed 2026-05-18** (PR #1386). Branch `br-small-term-ahtkz61d` zero-copy-forked from prod. See "Existing infrastructure" above.
- ~~Gap-4~~ — `staging-gate.yml` workflow — **closed 2026-05-18** (PR #1386). Workflow active continuously since then; do not treat the gate as aspirational. See "Existing infrastructure" above.

Track open gaps as issues, not assumptions. Closing them is what hardens this doctrine into mechanism. **No "staging-guard" hook is planned** — staging is safe-to-break by design; the guard exists for production.

---

## Hard rules (enforced in this codebase)

These are the floor. Cluster Law 1 (evidence-only completion) applies — if you can't prove a rule was honored, assume it wasn't.

1. **NEVER run `psql` / raw SQL against the prod NeonDB from a Claude Code session.** Use staging or dev. Read-only inspection of prod goes through `.github/workflows/db-inspect.yml`.
2. **NEVER restart, rebuild, or `docker compose up/down` a VPS container directly from a Claude Code session.** Use `deploy-vps.yml` (`gh workflow run deploy-vps.yml`). The `prod-guard` hook already blocks the obvious surface; do not work around it.
3. **NEVER point a feature-branch bot, eval, or scraper at the production Telegram bot (`@FactoryLM_Diagnose`).** Use a dev/staging bot or no-op adapter.
4. **ALL engine / RAG / retrieval / classifier changes MUST pass the staging gate before deploy.** Today: `smoke-test.yml` + the relevant `tests/eval/` regime. When `staging-gate.yml` ships, that becomes the canonical gate.
5. **Migrations follow dev → staging → prod.** Apply locally first, verify shape, then run `apply-migrations.yml` in `dry-run` mode, then `apply`. Never edit prod schema by hand.
6. **KB seeds follow staging → prod.** Verify BM25 retrieval on staging-shape data first (`tests/eval/`). Bulk seed via `.github/workflows/apply-seeds.yml` or `seed-oem-manuals.yml`, not manual `INSERT`.
7. **Secrets are environment-scoped.** `factorylm/dev` for local, `factorylm/stg` for staging, `factorylm/prd` for prod. Never copy `prd` values into a dev shell to "make it work" — if dev needs a secret prod has, set it in `factorylm/dev` explicitly.

A code path that violates any of these is a bug, regardless of whether it shipped a feature.

---

## The promotion workflow

Every change to engine / bot / pipeline / mira-web / migrations / KB seeds goes through this. No exceptions.

1. **Code on a feature branch.** Conventional commit (`feat/fix/refactor/...`). Local docker compose if relevant.
2. **Open PR to `main`.** `smoke-test.yml` runs automatically (plus `code-review.yml`, `ci.yml`, `enforcement-audit.yml`, etc.).
3. **All required checks green.** If a check fails, fix it. Do not bypass with `--no-verify` or by skipping required reviewers.
4. **Merge to `main`.** `smoke-test.yml` re-runs on the merge commit; `deploy-vps.yml` triggers on its success.
5. **Verify on production.** Smoke the affected route (`bash install/smoke_test.sh`). For UI: screenshot rule (`docs/promo-screenshots/`). For bots: send a real message to `@FactoryLM_Diagnose` and inspect the reply against grounding rules.

Hotfix path (production is degraded, normal flow too slow):
- `workflow_dispatch` on `deploy-vps.yml` with a specific `services:` list.
- File a follow-up PR with the actual fix on a branch within 24 hours so it goes through the normal gate.
- Note the bypass in the PR description.

---

## When the rules feel like friction

If you're tempted to break a rule because the gate "doesn't apply to this change," that is the moment to stop and write the rationale in the PR description. The 2nd time the same exception comes up, propose a rule edit. Don't quietly route around the gate.

The point isn't process for its own sake. The point is: when a customer hits a regression, we can answer the question *"how did this reach production?"* every time. Today, we often can't. That's what this doctrine fixes.

---

## Pointers

- `CLAUDE.md` § **Environments** — short rule card every session loads
- `.claude/CLAUDE.md` § **Environment boundaries** — product-rule angle
- `tools/hooks/prod-guard.sh` — PreToolUse enforcement
- `.github/workflows/{smoke-test,deploy-vps,apply-migrations,apply-seeds}.yml` — the deploy pipeline
- `docs/env-vars.md` — which env var lives in which Doppler config
- `~/factorylm/CLUSTER.md` Law 1 — evidence-only completion (this doc's parent principle)

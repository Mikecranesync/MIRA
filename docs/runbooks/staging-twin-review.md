# Staging Digital Twin — Review Deploys Before Prod

**Goal:** a running staging environment that mirrors production, where Mike and
Hermes can look at a change **before it ships to prod**.

This is the *operating model* for the `stg-*` stack on the VPS. Infrastructure
details (ports, isolation, Doppler config) live in `docs/runbooks/staging-vps.md`;
this doc is the **workflow**.

---

## The key insight: review the candidate ref, not main

Production auto-deploys on every push to `main` (`push → Smoke Test →
deploy-vps.yml`). So by the time code is on `main`, it is already prod-bound —
reviewing `main` on staging is too late.

The digital twin earns its keep by running the **candidate ref before it merges**:

```
feature branch ──▶ deploy-staging.yml --ref <branch> ──▶ stg-* twin
                                                            │
                                   Mike + Hermes review ◀───┘
                                                            │
                              looks good ──▶ merge to main ──▶ prod
```

`deploy-staging.yml` honors `--ref` as of **v3.24.9** (PR #2063 — before that it
silently always deployed the `staging` branch). The `staging` git *branch* is
**vestigial** — you deploy whatever ref you want to review; you do not maintain a
long-lived staging branch.

---

## How to stage a change for review

```bash
# Deploy a candidate branch (or main) to the staging twin:
gh workflow run deploy-staging.yml --ref <branch-or-main>

# Optional: only rebuild specific services (faster, lighter on the 8 GB VPS):
gh workflow run deploy-staging.yml --ref <branch> -f services="mira-hub mira-pipeline"

# Watch it: the run's "Health checks" step curls the internal services on the VPS.
gh run watch "$(gh run list --workflow=deploy-staging.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Staging URLs (plain HTTP, no TLS — see `staging-vps.md`):

| Surface | URL | Reachable |
|---|---|---|
| Hub (the app you review) | http://165.245.138.91:4101 | public |
| Web / marketing | http://165.245.138.91:4200 | public |
| Pipeline (chat backend) | http://165.245.138.91:4099/health | internal-only (deploy workflow checks it) |
| Atlas API | http://165.245.138.91:4088 | internal-only |

---

## The two-layer review gate

Per Cluster Law 2 (binary checks are scripts, not LLMs), the review is split:

### 1. Deterministic smoke gate — `tools/staging/staging-smoke.sh`

Pure curl + assert. Pass/fail. Asserts the externally-reachable review surfaces
(Hub + Web) return healthy; probes pipeline/atlas best-effort (the deploy
workflow is authoritative for those, on `127.0.0.1`).

```bash
tools/staging/staging-smoke.sh            # exit 0 = healthy, 1 = a required surface down
STAGING_HOST=127.0.0.1 tools/staging/staging-smoke.sh   # when run ON the VPS
```

### 2. Async Hermes review — `tools/staging/hermes-staging-review.sh`

Runs the smoke gate first; only if it passes does Hermes browse the staging Hub,
judge whether the change looks correct, and post a terse verdict to Telegram.
**Advisory, never a CI gate** — it must never block a deploy.

```bash
# On CHARLIE (where Hermes lives). Pass a description of what was deployed.
# NOTE: Hermes's configured primary (gpt-5.5 via openai-api) is currently
# quota-dead and the one-shot path doesn't always engage the OpenRouter
# fallback — drive it explicitly:
HERMES_PROVIDER=openrouter HERMES_MODEL="nvidia/nemotron-3-super-120b-a12b:free" \
  tools/staging/hermes-staging-review.sh "PR #1234 — onboarding upload step"
```

Verified live 2026-06-16 against the main-HEAD twin → `VERDICT: LOOKS GOOD`
(Hub login + web homepage load clean, no 500s/console errors), posted to Telegram.

Runs on CHARLIE because Hermes lives there and the VPS cannot reach CHARLIE.
Trigger it by hand after a staging deploy, from a Jarvis-node webhook, or cron.

---

## What "finished" means here

- ✅ `deploy-staging.yml --ref <X>` deploys `<X>` to the twin (v3.24.9 / #2063).
- ✅ A deterministic smoke gate over the review surfaces.
- ✅ An async Hermes verdict to Telegram, gated behind the smoke pass.
- ✅ Documented standing model: stage candidate → review → merge → prod.

### Known follow-ups (not blockers)

- **Hard pre-prod gate.** Today prod deploys on push-to-main independently; the
  twin review is a *parallel* advisory layer, not a synchronous gate that blocks
  prod until Hermes signs off. Making prod *wait* for a staging-review signal is
  a deploy-policy change (restructure `deploy-vps.yml` to depend on a recorded
  staging verdict) — deliberately deferred; it changes the prod deploy contract.
- **TLS/DNS for staging** (`staging.factorylm.com`) — Phase 2 in `staging-vps.md`.
- **pipeline/atlas public reachability** — currently internal-only; fine for Hub
  review, revisit if Hermes needs to hit the chat backend directly.

---

## Cross-references

- `docs/runbooks/staging-vps.md` — infra (ports, isolation, Doppler `factorylm/stg`)
- `.github/workflows/deploy-staging.yml` — the deploy (honors `--ref`)
- `tools/staging/staging-smoke.sh` — deterministic gate
- `tools/staging/hermes-staging-review.sh` — async Hermes review
- root `CLAUDE.md` § Environments — dev/staging/prod promotion doctrine

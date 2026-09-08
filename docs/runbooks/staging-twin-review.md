# Staging Digital Twin — Post-merge Exact-main Validation

> **DEPRECATED WORKFLOW (2026-09-07):** Do not deploy arbitrary feature refs
> with `deploy-staging.yml`. That workflow now accepts only an immutable SHA
> equal to the current remote `main`, behind the protected `staging-deploy`
> environment. Pre-merge Unified UI product and 412px visual review happens in
> the isolated FactoryLM UI lab; production staging validates an authorized
> merged head. The historical feature-ref procedure below is retained only to
> explain older receipts and must not be followed.

**Goal:** a running staging environment that mirrors production, where Mike and
Hermes can look at a change **before it ships to prod**.

This is the *operating model* for the `stg-*` stack on the VPS. Infrastructure
details (ports, isolation, Doppler config) live in `docs/runbooks/staging-vps.md`;
this doc is the **workflow**.

---

## Current operating model

For the Unified UI cutover, use the isolated lab to review an exact PR head,
obtain the required exact-head review, and merge only after its governance
gates pass. A maintainer may then deploy the exact current `main` SHA to the
staging twin for live-stack validation. See `staging-vps.md` for the guarded
dispatch command and the external provisioning HOLD.

## Historical model (deprecated): review the candidate ref, not main

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

## Historical feature-ref commands — do not run

```bash
# RETIRED: the current workflow rejects this feature-ref dispatch.
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

## What remains usable

- The deterministic smoke gate over the staging surfaces remains useful after
  an authorized exact-main deploy.
- The async Hermes verdict remains advisory evidence after that smoke pass.
- The old `deploy-staging.yml --ref <X>` feature-candidate contract is retired;
  a historical successful run is not authorization to use it again.

### Known follow-ups (not blockers)

- **Protected staging provisioning.** Create `staging-deploy`, its scoped
  non-root account variable, and its dedicated SSH secret before dispatch.
- **Hard pre-prod gate.** The staging twin is still not a synchronous production
  gate; changing that relationship remains a separate deploy-policy decision.
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

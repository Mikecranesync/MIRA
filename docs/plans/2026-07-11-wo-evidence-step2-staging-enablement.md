# Step 2 — WO-Evidence Staging Enablement Plan & Gate (#2445)

**Status:** DRAFT — not executed. **No Doppler / staging / prod change until explicitly run.**
**Owner action required:** this plan STOPS before production and waits for Mike's explicit approval.

**Landed prerequisites:**
- **#2630** (merged) — DoD golden case + CI guard.
- **#2634** (merged) — `ENABLE_WO_EVIDENCE` (+ `MIRA_WO_EVIDENCE_TIMEOUT_S`, `MIRA_WO_EVIDENCE_LIMIT`)
  wired **default-off** into all 4 engine services in `docker-compose.saas.yml` (prod).
- **Step 1.5 — #2647** (see below) — the same flags wired **default-off** into the staging compose files.

## Goal
Turn `ENABLE_WO_EVIDENCE=1` on **staging only**, prove that a real diagnosis injects the citable
`[WO <number>]` block from **real Hub `work_orders` data** and that the model cites it — AND that the
**no-match path** stays clean (no block, deterministically-unchanged model input) — then STOP for production
approval. Coverage spans all four engine surfaces (pipeline, Telegram, Slack, mira-ask), two of them live on
staging and two via a faithful shared-engine harness (see § Surfaces).

## Scope guardrails
- **Staging only.** Doppler `factorylm/stg`. Never `factorylm/prd` in this step.
- **Read-only against prod.** No prod psql, no prod bot, no prod Doppler.
- **Reversible.** The flag is a single Doppler var; rollback = unset / `=0` + redeploy staging.
- **Evidence-preserving.** Every probe writes a durable artifact under `docs/eval/wo-evidence-step2/`.

## Step 1.5 (prerequisite) — wire the flags default-off into the staging compose files  → PR #2647
Step 1 wired only `docker-compose.saas.yml` (prod). Before staging can enable the flag by config, the three
vars must exist **default-off** in the staging compose so enabling is a Doppler flip, not a compose edit.
PR **#2647** adds them to the engine services that actually exist on staging:
- `docker-compose.staging-vps.yml` (deployed VPS staging): `mira-pipeline`, `mira-bot-telegram` (list style).
- `docker-compose.staging.yml` (local-dev): the `x-staging-env` anchor (both `*-staging` engine services
  inherit via `<<:`).
Guarded by two added cases in `tests/test_wo_evidence_compose.py`; `env-drift` stays green (used in
saas + staging-vps, already documented). **This PR must merge and deploy to staging before enabling.**

## Surfaces — what is live on staging vs. harness-tested (corrected)
Staging deploys **only two** engine surfaces. Verified against the staging compose:
| Surface | On staging? | Evidence | Step-2 test path |
|---|---|---|---|
| **mira-pipeline** | **YES** | `docker-compose.staging-vps.yml` `mira-pipeline` (`stg-mira-pipeline`, port 4099); OpenAI-compat `/v1/chat/completions`, bearer `PIPELINE_API_KEY` (`mira-pipeline/main.py`) | **live staging** HTTP call |
| **Telegram** | **YES** | staging bot `@Mira_stagong_bot`, isolated `TELEGRAM_BOT_TOKEN_STG` (`docker-compose.staging-vps.yml` `mira-bot-telegram`) | **live staging** via Bot API `sendMessage` |
| **Slack** | **NO** | intentionally omitted — a shared `SLACK_BOT_TOKEN` would dual-poll prod (`docker-compose.staging-vps.yml:302`); only prod Slack creds exist | **shared-engine harness** (below) |
| **mira-ask** | **NO** | prod-only; no `mira-ask` service or `ASK_API_KEY` in any staging compose | **shared-engine harness** (below) |

### The shared-engine harness (faithful proxy for Slack + mira-ask)
Do **not** stand up a live staging Slack app or point staging at prod Slack/ask credentials. Instead validate
Slack + mira-ask through the **same engine** they run, in-process, against **real staging Neon**:
- **Harness:** `tests/eval/local_pipeline.py` — instantiates `shared.engine.Supervisor` with the identical
  constructor the adapters use, calls `engine.process()/process_full()`, and can point `NEON_DATABASE_URL`
  at the staging Neon branch so `wo_evidence.recall_work_orders()` runs against real `work_orders`.
- **Why faithful:** all four adapters (pipeline, Telegram, Slack, mira-ask) funnel through the SAME
  `Supervisor.process*` → the SAME `engine.py::_build_wo_evidence_context()` → `_format_wo_evidence()`. There is
  no adapter-specific WO-evidence logic. Set `ENABLE_WO_EVIDENCE=1` for the harness run and it exercises the
  exact code path Slack/mira-ask would. (Slack/mira-ask "surface" differences are message *rendering*, which is
  downstream of and irrelevant to whether the WO block is injected and cited.)
- **Honesty note:** the harness proves the *engine* behavior for Slack + mira-ask; it does not prove their
  network adapters. That is acceptable for Step 2 (the flag governs engine behavior, not rendering) and is
  called out explicitly in the artifacts.

## Preconditions (before flipping anything)
1. **Real WO data exists for the test tenant** — re-confirm at run time: read-only `GET /api/work-orders/`
   on the staging Hub for the chosen tenant; record WO number(s), asset, and `equipment_id`. If zero rows →
   STOP (the real gap is upstream, not the flag). (Baseline: dogfood `work-order.check` on 2026-07-11 showed a
   Hub WO with `resolution`+`closed_at` attached to an asset.)
2. **The WO's asset resolves** so `_build_wo_evidence_context` recall matches
   (`work_orders wo JOIN cmms_equipment eq ON eq.id = wo.equipment_id WHERE wo.tenant_id=$t AND eq.tenant_id=$t
   AND (uns match OR name match)`).
3. **Deployed-SHA check (replaces the old "deploy-staging ignores --ref" warning — that bug is FIXED).**
   `deploy-staging.yml` now forwards the dispatched ref explicitly (`DEPLOY_REF: ${{ github.ref_name }}` →
   over SSH → `REF="${DEPLOY_REF:-${GITHUB_REF_NAME:-staging}}"` → `git reset --hard origin/$REF`), so it
   deploys the selected ref (falling back to `origin/main` only if the ref is missing). Therefore **do not
   trust the ref — verify the deployed SHA** contains the Step-1.5 wiring before enabling:
   - `curl -s http://165.245.138.91:4101/api/version | jq -r .gitSha` (mira-hub `/api/version`, no auth) —
     assert it equals the merged `main` SHA that includes PR #2647.
   - `curl -s http://165.245.138.91:4099/health | jq -r .version` (mira-pipeline `/health`, version from
     `/app/VERSION`) — assert ≥ 3.129.9.
   - Confirm the flag is actually in the running containers:
     `docker exec stg-mira-pipeline printenv ENABLE_WO_EVIDENCE` (and `stg-mira-bot-telegram`) → present.
   Only proceed once the deployed SHA/version proves #2647 is live on staging.

## Enablement steps (staging)
1. Set in Doppler `factorylm/stg`: `ENABLE_WO_EVIDENCE=1` (leave timeout/limit at defaults unless a gate
   step overrides them per-run).
2. Redeploy the staging engine services (`deploy-staging.yml`, dispatched from the merged ref).
3. Re-run the deployed-SHA check (precondition 3) AND `printenv ENABLE_WO_EVIDENCE` → `1` on the running
   `stg-mira-pipeline` + `stg-mira-bot-telegram`.

## The gate (all must pass; artifacts preserved)
For a tenant/asset **with** prior work orders:
- **G1 — block injected (per surface):** the assembled diagnosis prompt/context contains
  `--- WORK ORDER HISTORY (CMMS; cite as [WO <number>]) ---` with the real WO number(s). Captured live for
  pipeline + Telegram; captured from the harness for Slack + mira-ask.
- **G2 — answer cites it (grounded):** the reply contains ≥1 `[WO <number>]` that **matches a real WO from
  G1** (grounded — a cited number must exist in the injected block, never invented). All four surfaces.
- **G3 — negative / no-match path is DETERMINISTICALLY clean:** for an asset/tenant with **no** work orders,
  assert **prompt/context equivalence**, NOT byte-for-byte answer equivalence (LLM output is stochastic and
  must not be diffed). Concretely, with the flag ON vs OFF for the no-WO asset:
  1. **no `--- WORK ORDER HISTORY` block** appears in the assembled context, and
  2. **no `[WO ...]` citation** appears in the reply, and
  3. **the downstream model input is unchanged** — capture the exact assembled prompt/context
     (`_build_wo_evidence_context` returns `""`) and assert it is **identical** to the flag-off capture.
  This is a deterministic check on the *engine input*, done via the harness (which can dump the assembled
  context), not a comparison of model *outputs*.
- **G4 — no regression:** run the staging gate (`smoke-test.yml` + the relevant `tests/eval/` regime) with the
  flag ON — groundedness/citation scores do not regress vs the flag-off baseline.
- **G5 — WO-recall failure boundary is isolated & fail-safe:** force **only the WO recall** to fail by setting
  a tiny `MIRA_WO_EVIDENCE_TIMEOUT_S` (e.g. `0.001`) for one probe — do **NOT** break the shared
  `NEON_DATABASE_URL` (that would also break `recall_knowledge` and every other DB read, testing the wrong
  thing). Assert: `_build_wo_evidence_context` times out → returns `""` → the reply still returns, carries no
  WO block, and surfaces no error to the user. This exercises exactly the `asyncio.wait_for(..., timeout=
  _WO_EVIDENCE_TIMEOUT_S)` guard in `engine.py` and nothing else.

## Evidence artifacts (preserve — append-only, no secrets)
Under `docs/eval/wo-evidence-step2/`:
- `run_manifest.md` — tenant id, asset, WO number(s)+`equipment_id`, deployed staging `gitSha`/version, timestamps.
- Per surface: `pipeline.json`, `telegram.txt` (live); `slack.harness.json`, `ask.harness.json` (harness) — positive path G1+G2.
- `negative/` — the no-WO **assembled-context** captures for flag-on and flag-off + the equivalence diff (G3).
- `gate/` — staging-gate + eval regime output (G4); the tiny-timeout probe log (G5).
- Screenshots for any UI surface → also `docs/promo-screenshots/` per the Screenshot Rule.

## Stop / decision point
When G1–G5 pass with artifacts preserved: **STOP.** Post a summary + link the artifacts and request
**explicit approval** to enable in production. Do **not** touch `factorylm/prd`. Production enablement
(identical flip in `factorylm/prd` → `deploy-vps.yml` → prod smoke) is a **separate** step gated on Mike's OK.

## Rollback (staging)
Unset `ENABLE_WO_EVIDENCE` (or `=0`) in Doppler `factorylm/stg` + redeploy the staging engine services. The
default-off wiring means the feature simply goes dark again; no schema or data change to undo.

## Cross-references
- PRs: #2647 (Step 1.5 staging wiring), #2634 (Step 1 saas wiring), #2630 (DoD golden case), #2472 (feature, flag-off).
- `mira-bots/shared/wo_evidence.py`, `engine.py::_build_wo_evidence_context` / `_format_wo_evidence`.
- `tests/eval/local_pipeline.py` (the shared-engine harness).
- `.github/workflows/deploy-staging.yml` (ref-respecting; deployed-SHA via `/api/version` + `/health`).
- `docs/environments.md` (promotion + staging gate), memory `project_wo_evidence_2445`.

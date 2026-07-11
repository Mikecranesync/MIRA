# Step 2 — WO-Evidence Staging Enablement Plan & Gate (#2445)

**Status:** DRAFT — not executed. **No Doppler / staging / prod change until explicitly run.**
**Owner action required:** this plan STOPS before production and waits for Mike's explicit approval.
**Precondition (Step 1) — DONE:** `ENABLE_WO_EVIDENCE` (+ `MIRA_WO_EVIDENCE_TIMEOUT_S`, `MIRA_WO_EVIDENCE_LIMIT`)
wired **default-off** into all four engine services in `docker-compose.saas.yml` (PR #2634); DoD golden
case + guard merged (PR #2630).

## Goal
Turn `ENABLE_WO_EVIDENCE=1` on **staging only**, prove that a real diagnosis on **each** engine surface
(mira-pipeline, Telegram, Slack, mira-ask) injects the citable `[WO <number>]` block from **real Hub
`work_orders` data** and that the model cites it — AND that the **no-match path** stays clean (no block,
diagnosis byte-for-byte unchanged) — then STOP for production approval.

## Scope guardrails
- **Staging only.** Doppler `factorylm/stg`. Never `factorylm/prd` in this step.
- **Read-only against prod.** No prod psql, no prod bot, no prod Doppler.
- **Reversible.** The flag is a single Doppler var; rollback = unset / `=0` + redeploy staging.
- **Evidence-preserving.** Every probe writes a durable artifact under `docs/eval/wo-evidence-step2/`
  (transcripts, request/response JSON, the exact prompt block, screenshots where a UI is involved).

## The four surfaces to exercise (all run `shared.engine.Supervisor`)
| Surface | How a turn is driven on staging | Evidence captured |
|---|---|---|
| **mira-pipeline** | `POST /v1/chat/completions` (or `/api/v1/ignition/chat`) to the staging pipeline with a tenant+asset that has WOs | full JSON response + the assembled prompt (debug log) |
| **Telegram** | staging bot `@Mira_stagong_bot` (`TELEGRAM_BOT_TOKEN_STG`) — real DM diagnosis for the asset | message transcript + engine trace |
| **Slack** | staging Slack workspace/app — real channel/DM diagnosis | message transcript + engine trace |
| **mira-ask** | staging AskMira kiosk endpoint (`ask_api`) — single-shot diagnostic question | JSON answer + trace |

## Precondition verification (before flipping anything)
1. **Real WO data exists for the test tenant** — confirmed via dogfood `work-order.check`
   (2026-07-11: Hub WO `ca382e5a-…` has `resolution`+`closed_at`, attached to an asset). Re-confirm at run
   time: read-only `GET /api/work-orders/` on the staging Hub for the chosen tenant; record the WO number(s),
   asset, and `equipment_id` join. If zero rows → STOP (the real gap is upstream, not the flag).
2. **The WO's asset resolves** — the asset the WO is attached to must be one the engine will confirm
   (UNS path or name), so `_build_wo_evidence_context` recall matches (`work_orders wo JOIN cmms_equipment
   eq ON eq.id = wo.equipment_id WHERE wo.tenant_id=$t AND eq.tenant_id=$t AND (uns match OR name match)`).
3. **Staging deploy path is sane** — ⚠ known issue: `deploy-staging.yml` ignores `--ref` and always deploys
   `origin/staging`, which has drifted behind `main` (see memory `project_staging_vps_not_ready`). Resolve
   the deploy target FIRST: either (a) fast-forward/rebuild staging from the merged `main` that contains
   #2634, or (b) use the local staging compose (`docker-compose.staging-vps.yml`) with the merged image.
   Do not enable the flag until the running staging engine image actually contains the #2634 wiring
   (verify: `docker exec <svc> env | grep ENABLE_WO_EVIDENCE`).

## Enablement steps (staging)
1. Set in Doppler `factorylm/stg`: `ENABLE_WO_EVIDENCE=1` (leave timeout/limit at defaults unless tuning).
2. Redeploy the four engine services on staging via the sanctioned staging path (per precondition 3).
3. Confirm the flag reached each container: `docker exec <svc> printenv ENABLE_WO_EVIDENCE` → `1` for all four.

## The gate (must all pass; artifacts preserved)
For a tenant/asset **with** prior work orders, on **each** of the four surfaces:
- **G1 — block injected:** the assembled diagnosis prompt contains
  `--- WORK ORDER HISTORY (CMMS; cite as [WO <number>]) ---` with the real WO number(s). (pipeline: debug log;
  bots/ask: engine trace.)
- **G2 — answer cites it:** the model's reply contains at least one `[WO <number>]` that matches a real WO
  from G1 (grounded — the cited number must exist in the injected block, not invented).
- **G3 — negative/no-match path clean:** for an asset/tenant with **no** work orders (or a WO-less asset),
  the reply contains **no** `[WO` block and the answer is byte-for-byte what it is with the flag off
  (diff against a flag-off baseline capture). Proves the best-effort `""`-on-miss contract holds live.
- **G4 — no regression:** run the staging gate (`smoke-test.yml` + the relevant `tests/eval/` regime) with
  the flag ON — groundedness/citation scores do not regress vs the flag-off baseline.
- **G5 — timeout/failure safety:** simulate a slow/unreachable WO recall (e.g. point `NEON_DATABASE_URL`
  at an unreachable host for one probe, or set `MIRA_WO_EVIDENCE_TIMEOUT_S=0.001`) → reply still returns,
  no block, no error surfaced to the user (fail-safe holds).

## Evidence artifacts (preserve — append-only)
Under `docs/eval/wo-evidence-step2/` (git-committed, no secrets):
- `run_manifest.md` — tenant id, asset, WO number(s)+`equipment_id`, staging image SHA, timestamps.
- Per surface: `pipeline.json`, `telegram.txt`, `slack.txt`, `ask.json` (positive path, G1+G2).
- `negative/` — the no-WO captures + the flag-off baseline diff (G3).
- `gate/` — staging-gate + eval regime output (G4), timeout probe log (G5).
- Screenshots for any UI surface → also `docs/promo-screenshots/` per the Screenshot Rule.

## Stop / decision point
When G1–G5 pass with artifacts preserved: **STOP.** Post a summary + link the artifacts and request
**explicit approval** to enable in production. Do **not** touch `factorylm/prd`. Production enablement
(identical flip in `factorylm/prd` → `deploy-vps.yml` → prod smoke) is a **separate** step gated on Mike's OK.

## Rollback (staging)
Unset `ENABLE_WO_EVIDENCE` (or `=0`) in Doppler `factorylm/stg` + redeploy the four services. The default-off
wiring means the feature simply goes dark again; no schema or data change to undo.

## Cross-references
- PR #2634 (Step 1 wiring), PR #2630 (DoD golden case), #2472 (feature, flag-off).
- `mira-bots/shared/wo_evidence.py`, `engine.py::_build_wo_evidence_context` / `_format_wo_evidence`.
- `docs/environments.md` (promotion + staging gate), memory `project_wo_evidence_2445`,
  `project_staging_vps_not_ready` (the staging-deploy drift caveat).

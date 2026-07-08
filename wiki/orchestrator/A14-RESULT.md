# A14 Result — Lens A (Hub security & auth) — 2026-06-22

**Verdict: 🟢 GREEN held + strengthened.** Scorecard **5G/1Y/0R** (D lone YELLOW) — unchanged.
Audited deploy truth `origin/main@f7650641` (freshness-guard exit 3 STALE; HEAD `feat/inference-together-replaces-gemini` 7 behind; `mira-hub` DIFFERS → `git show`).

## Baseline → window
Last Lens A = **A13 @ `926dda41`** (passed the i3x Bearer API + contextualization surface). This run diffs `926dda41..f7650641` = **14 hub/web commits**.

## Findings (all clean)
- **ONLY ONE new route:** `mira-hub/src/app/api/connectors/ignition/import/route.ts` (Phase 2a Ignition tag-mapper proxy). `sessionOr401` ✅ · `tenant_id = ctx.tenantId` server-derived, NOT client body → **no IDOR** ✅ · upstream `fetch(${PIPELINE_URL}/v1/connectors/ignition/import)` keyed off **env**, not user input → **no SSRF** ✅ · `AbortSignal.timeout(30s)` ✅ · `record_types`/`limit` type-validated ✅.
- **4 modified routes keep their guards:**
  - `assets/[id]/chat` — `sessionOr401`(:203); preserves #2178 hybrid-read law (`is_private=false OR tenant_id=$caller` on RAW owner pool, documented :253–260) + `cmms_equipment` IDOR guard `WHERE id=$1 AND tenant_id=$2`(:274).
  - `contextualization/import` — `sessionOr401`(:36) + 413 `MAX_UPLOAD_BYTES` cap(:205) + all SQL `tenant_id=$1::uuid`.
  - `contextualization/[id]/sources` — `sessionOr401`(:109) + 413(:131) + project-ownership IDOR `WHERE id=$1 AND tenant_id=$2::uuid`(:167).
  - `wizard/[step]` — `sessionOr401`(:62,95) + `WHERE tenant_id=$1` + tenant-scoped `kg_entities` upserts.
- **i3x Bearer API FROZEN** — 0 commits `926dda41..f7650641` under `api/i3x`+`lib/i3x*`; A13 GREEN holds.
- **Secrets scan clean** — 0 production hits; 3 matches = `AUTH_SECRET='cc-e2e-fixed-secret-do-not-use-in-prod'` in `playwright.*.config.ts` (self-labeled test fixtures, not stranger-reachable).
- **0 new unguarded routes · 0 weakened auth · 0 leak.**

## Low-watch (P3, not beta-blocking)
`connectors/ignition/import` `body.limit` has no upper clamp (default 500). Auth-gated + 30s timeout + upstream pipeline cap mitigate → not stranger-abusable. Mirror the proposals `clampLimit` pattern when convenient. No patch needed (window clean).

## KG
Nightly graph **4,475 nodes / 83,544 edges** (+11n since F12). This run **+9 nodes / +6 edges** → `kg/a14-findings.jsonl`. graphify UNINSTALLABLE (no module/CLI; GEMINI/GROQ/CEREBRAS unset); `kg_query.py search` RAN.
**Insight:** `search "connectors ignition import"` + `"sessionOr401 tenant"` + `"i3x bearer tenant"` ALL return **(none)** — the newest stranger-reachable hub-AUTH surface is **invisible to the code graph**; cleared only by reading deploy-truth bytes. Same blindspot F12 found for HubV3/i3x, now confirmed for the auth layer.

## Recovery note
The living `BETA_READINESS.md` (119KB) + `HISTORY.md` (190KB, ended E12) were still trapped in `stash@{0}` (concurrent WIP stash from the F12 cycle). I **restored both to the working tree via read-only `git show stash@{0}:`** (stash NOT popped/modified — hard rule honored), folded in F12's owed F-row (F11 YELLOW → F12 GREEN) + this A14 banner/row, and appended F12's owed HISTORY line + this one. No code edited; 0 new patches.

## Rotation
Round 14 → **B** next.

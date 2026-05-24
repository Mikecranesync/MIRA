# Staging → Prod Readiness — 2026-05-20

**Prepared by:** Autonomous Claude Code run (`feat/hub-namespace-explorer` session)
**Branch:** `fix/staging-audit-2026-05-20` (audit spec + benchmark) merged status TBD
**Target reviewer:** Mike Harper
**Verdict:** ⚠️ **PROCEED WITH CAUTION** — staging is green but two pre-existing retrieval quality issues are exposed by Phase 3 benchmark; one open PR (#1479) requires a staging migration before its work can land.

---

## What's on staging that isn't on prod (since 2026-05-19)

Today's merges into `main` (in landing order, most recent first):

| Commit | PR | Title | Risk |
|---|---|---|---|
| `636fbf67` | #1418 | Phase 0 — schema (025/026/027) + photo→KG demo loop | **HIGH** — DB schema |
| `4b185d67` | #1404 | dep bump: lxml ≥6.1.1 | LOW |
| `7d6cfe84` | #1410 | dep bump: sqlalchemy ≥2.0.49 | LOW |
| `553c5054` | #1407 | dep bump: pdfplumber ≥0.11.9 | LOW |
| `b32827ff` | #1417 | docs: MIRA ground-truth architecture investigation | NONE (docs) |
| `b191b8a8` | #1478 | hub wizard step 5 + 3 P2 investigation docs | MED — hub UI |
| `fe092a1b` | #1477 | marketing "Try MIRA Free" CTA | LOW |
| `4c223f96` | #1476 | hub: remove /plc GitHub Pages iframe | LOW |
| `7a926814` | #1475 | align /upgrade pricing with /pricing | MED — pricing UI |
| `72acfdaa` | #1473 | ci staging-gate Dependabot skip | NONE (CI only) |
| `048ad5ea` | #1460 | self-serve "Try MIRA Free" CTA on marketing | LOW |
| `350c6863` | #1462 | remove /plc iframe page | LOW |
| `11a0b6bd` | #1461 | /upgrade pricing alignment | MED |
| `1579b19d` | — | staging-gate skip Dependabot | NONE |
| `aac71463` | #1466 | staging atlas missing env | NONE (staging-only) |

Plus today's whole hub-overhaul batch (#1467, #1471): public `/quickstart`, nav restructure, mock-page LabsStub, sidecar removal (ADR-0014).

---

## Risk-ordered deploy concerns

### 1. Phase 0 schema migrations (#1418) — **HIGH**

PR #1418 includes migrations 025, 026, 027 (kg_entities natural key + dedupe + source_chunk_id). These are idempotent (use `IF NOT EXISTS`) but **must be applied to the prod Neon DB before deploy**, otherwise the new code paths will 500 on kg writes.

**Verification needed before deploy:**
```bash
# Connect to PROD Neon (NOT staging)
doppler run --project factorylm --config prd -- psql "$NEON_DATABASE_URL" -c "
SELECT column_name FROM information_schema.columns
 WHERE table_name='kg_entities' ORDER BY ordinal_position;
"
# Confirm presence of: source_chunk_id (migration 024), natural_key columns (025), unique constraint (026)
```

If columns missing, apply in order:
```bash
for n in 024_kg_source_chunk_id 025_kg_entities_natural_key 026_kg_entities_dedupe_and_constraint 027_*; do
  doppler run --project factorylm --config prd -- psql "$NEON_DATABASE_URL" --single-transaction \
    -f mira-hub/db/migrations/${n}.sql
done
```

### 2. Hub wizard step 5 (#1478) — MED

Adds a 5th step to onboarding wizard ("Try MIRA"). Step is in-session only; on reload, the wizard sees `status=completed` and redirects to `/namespace`. Finish API contract unchanged. Risk is low **if** the prod DB has the namespace_versions / wizard tables (migrations 021-023) applied.

### 3. Pricing alignment (#1475/#1461) — MED

`/upgrade` and `/pricing` now share the same tier amounts. Risk: if the hardcoded prices on `/upgrade` were intentionally different (e.g. Stripe tier mismatch), this is a regression. Verify Stripe products match the displayed amounts before deploy.

### 4. /quickstart public route (#1467/#1471) — LOW

`/quickstart` is publicly accessible (no auth) and renders the OEM corpus via `QUICKSTART_TENANT_ID` env var (falls back to founder tenant). Prod needs:
- `QUICKSTART_TENANT_ID` set in Doppler `factorylm/prd` (or rely on fallback)
- Public KB chunks available under that tenant (currently 83K chunks under founder tenant)

### 5. Marketing CTA (#1477/#1460) — LOW

Static HTML addition to `mira-web` homepage. No backend impact.

---

## Deploy command

```bash
ssh root@<PROD_VPS> "cd /opt/mira && git pull origin main && \
  doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --build"
```

**Services that need rebuild:**
- `mira-hub` (frontend + API routes — all of today's PRs touched it)
- `mira-web` (marketing CTA + pricing alignment)
- `mira-bot-telegram` (no engine changes today, but good practice)
- `mira-pipeline` (no changes, skip)
- `mira-mcp` (no changes, skip)

---

## Post-deploy verification

```bash
# 1. Smoke
bash install/smoke_test.sh

# 2. Public surfaces (anonymous, must return 200)
curl -sS -o /dev/null -w '%{http_code}\n' https://app.factorylm.com/quickstart/
curl -sS https://app.factorylm.com/api/quickstart/manufacturers | jq '.manufacturers | length'  # expect >0
curl -sS -o /dev/null -w '%{http_code}\n' https://factorylm.com/                              # marketing
curl -sS -o /dev/null -w '%{http_code}\n' https://factorylm.com/pricing                        # marketing pricing

# 3. /plc must be 404 (route removed in #1476)
# Anonymous gets a 307 to /login, but authenticated user should see Next 404.

# 4. Staging-quality E2E
cd mira-hub
E2E_HUB_URL=https://app.factorylm.com E2E_WEB_URL=https://factorylm.com \
E2E_HUB_EMAIL=playwright@factorylm.com E2E_HUB_PASSWORD=TestPass123 \
  npx playwright test tests/e2e/audit-staging-2026-05-20.spec.ts \
  --config=tests/e2e/audit-staging.config.ts
# Expect 12/12 passing (matches staging result).
```

---

## Rollback

```bash
# Roll back to the commit before today's batch landed
ssh root@<PROD_VPS> "cd /opt/mira && \
  git checkout 9ab924c8 -- . && \
  doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --build mira-hub mira-web mira-bot-telegram"
```

**Schema rollback NOT NEEDED** — migrations 025-027 are additive (new columns + constraints), not destructive. Leaving them applied is safe even on an older deploy.

---

## Issues surfaced by today's audit that prod should be aware of

These are **pre-existing** (not regressions from today's batch), but worth flagging:

1. **0/10 bot answers cite sources.** Phase 3 benchmark (`tests/golden_staging_benchmark_2026-05-20.csv`) shows the cite-or-refuse contract is implemented as refuse-only. No positive citations even when KB hits. **Impact:** technician can't tell grounded from generic.

2. **Retrieval misses for in-corpus equipment.** Q3 (PowerFlex 525 default baud rate) and Q5 (GS10 fault codes) returned "general industrial knowledge" despite Rockwell (34k chunks) + AutomationDirect (4k chunks) being in the KB. **Likely root cause:** Ollama-embed-sidecar-down regression pattern from 2026-05-18 (see `.claude/skills/bot-grounding-tests/SKILL.md`).

3. **UNS gate inconsistency.** Q4 (conveyor prox sensor too long) jumped straight to generic advice without resolving the asset context. The non-negotiable gate (`.claude/CLAUDE.md` §"UNS location-confirmation gate") was bypassed.

4. **`/plc` does not 404 for anonymous users.** Route was deleted in #1476, but the Next.js middleware (`mira-hub/src/middleware.ts`) still gates `/plc` — anonymous requests redirect to `/login`. Authenticated users get a proper 404. Behavior is acceptable but inconsistent with "route removed".

5. **Open PRs requiring follow-up:**
   - **#1479** ("namespace explorer — 7 staging bugs fixed, 12/12 E2E green") — body says "staging migration TBD". **DO NOT merge** until the associated migration is applied to staging Neon.
   - **#1445** ("GS11 regression net + agent-discovery surface") — CONFLICTING with current main; needs rebase.
   - **#1452** (Fuuz deep-dive) — CONFLICTING; rebase.

---

## What was NOT done this session

- **Direct Neon DB read** to verify which migrations are applied on staging — denied by the harness sandbox. Indirect evidence (healthy app + passing E2E + benchmark works) suggests migrations through #026 are present, but **DO NOT skip the prod migration verification step** above.
- **Telegram-side bot benchmark.** Phase 3 ran via `mira-pipeline` (same Supervisor engine, no Telegram delivery). For per-channel verification, a human needs to run the 10 questions through `@Mira_stagong_bot` directly.
- **Production deploy.** Goal explicitly said "DO NOT deploy to production"; this doc gives Mike the one-page review before approving prod push.

---

## Files committed this session

| File | Purpose |
|---|---|
| `mira-hub/tests/e2e/audit-staging.config.ts` | Playwright config for staging tunnel runs |
| `mira-hub/tests/e2e/audit-staging-2026-05-20.spec.ts` | 12-test audit covering hub-overhaul batch |
| `docs/promo-screenshots/2026-05-20_*.png` | 12 audit screenshots (per Screenshot Rule) |
| `tools/bench-staging-pipeline.sh` | Run the 10 golden questions against staging pipeline |
| `tests/golden_staging_benchmark_2026-05-20.csv` | Scored benchmark output (avg 3.64/5) |
| `docs/evaluations/staging-to-prod-readiness-2026-05-20.md` | THIS DOC |

Branch on remote: `fix/staging-audit-2026-05-20` — ready for review/merge.

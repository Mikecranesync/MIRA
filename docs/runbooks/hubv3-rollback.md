# HubV3 Rollback Runbook

**Scope:** rolling back the HubV3 contextualization-intake release (VERSION `3.29.0`, `mira-hub/v2.13.0`, `mira-contextualizer/v2.3.0`) from production.
**Owner:** whoever runs the `#2068 → main` merge + deploy.
**Companion:** `docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md`, `docs/versioning.md`, `docs/environments.md`.

> **Golden rule:** roll back the **smallest layer that fixes it**, in this order — Deploy → DB → Git. Don't revert the merge if a redeploy of the prior tag fixes it. Never `psql` prod by hand (`prod-guard.sh`); use the workflows.

---

## Anchors (the rollback targets)

| Layer | Anchor | What it restores |
|---|---|---|
| **Git (pre-release)** | tag `checkpoint/pre-hubv3-2026-06-20` (= `v3.28.3`, main before HubV3) | the exact main tree before HubV3 |
| **Git (auto on merge)** | `version-tag.yml` lays `v3.29.0` + an auto rollback checkpoint at merge | per-release revert point |
| **Deploy (prior app)** | `mira-hub/v2.12.x` (last pre-HubV3 hub tag) · prior `mira-contextualizer` tag | the running app before HubV3 |
| **DB** | Neon **prod snapshot** taken in Phase 5 + the `056` in-file rollback block | schema before `056` |

Record at deploy time (fill in during Phase 5):
- Prod-deployed hub tag BEFORE this release: `mira-hub/v________`
- Neon prod snapshot / branch id: `________`
- Merge commit SHA on main: `________`

---

## Decision tree

```
Smoke fails after deploy (factorylm.com / app.factorylm.com / @FactoryLM_Diagnose)
│
├─ App-level only (UI error, 5xx, bad bundle) — schema is fine
│     → ROLLBACK A: redeploy prior app tag. Fastest. DB untouched.
│
├─ DB-level (migration broke a query, RLS, or data shape)
│     → ROLLBACK B: run 056 down-SQL (or restore Neon snapshot), THEN redeploy prior tag.
│
└─ Both / unsure / need the code off main entirely
      → ROLLBACK C: revert the merge commit on main + ROLLBACK A + B.
```

---

## ROLLBACK A — redeploy the prior app tag (no DB change)

The rollback target is only real if **prod references the tag, not `main` HEAD** (`docs/versioning.md`). Redeploy the last pre-HubV3 hub tag:

```bash
# From an authorized shell (repo write + production environment):
gh workflow run deploy-vps.yml -f services="mira-hub" -f ref="mira-hub/v2.12.x"   # ← the recorded prior tag
# (contextualizer is a desktop app, not VPS-deployed — only re-pin if a bad build shipped)
```

Verify:
```bash
bash install/smoke_test.sh
# + browser-check factorylm.com + app.factorylm.com/hub, and @FactoryLM_Diagnose
ssh root@165.245.138.91 "cd /opt/mira && git describe --tags"   # confirms prod is back on the prior tag
```

---

## ROLLBACK B — undo migration 056

`apply-migrations.yml` has **no down mode** — apply the in-file rollback block, or restore the Neon snapshot.

**Option B1 — run the `056` rollback SQL** (preferred if data added under HubV3 is disposable). The block is at the bottom of `mira-hub/db/migrations/056_contextualization_intake.sql`:
```sql
DROP TABLE IF EXISTS ctx_extraction_asset_matches CASCADE;
ALTER TABLE ctx_sources DROP COLUMN IF EXISTS import_batch_id, DROP COLUMN IF EXISTS source_sha256;
DROP TABLE IF EXISTS ctx_import_batches CASCADE;
ALTER TABLE contextualization_projects DROP COLUMN IF EXISTS bundle_sha256;
-- also remove its ledger row so a future apply re-runs cleanly:
DELETE FROM schema_migrations WHERE filename LIKE '056_%';
```
Run it through the sanctioned path (NOT hand `psql` prod) — staging first to confirm, then prod via the migration runner / a reviewed one-off job against `factorylm/prd`. **055 and earlier stay — only `056` is HubV3.**

**Option B2 — restore the Neon prod snapshot** taken in Phase 5 (cleanest if `056` left bad data). Neon console → Branches/Restore → the recorded snapshot id. This reverts ALL writes since the snapshot, so prefer B1 unless data is corrupt.

After either: **ROLLBACK A** (redeploy prior tag) so app code matches the schema.

---

## ROLLBACK C — revert the merge on main

Only if the HubV3 code must leave `main` entirely.

```bash
git fetch origin
git checkout -b revert/hubv3 origin/main
git revert -m 1 <merge-commit-SHA>     # the #2068 → main merge commit (recorded above)
git push -u origin revert/hubv3
gh pr create --base main --title "revert: HubV3 (#2068) — <reason>" --fill
# version-gate needs a forward bump: set /VERSION to 3.29.1 in the revert PR.
```
Then ROLLBACK A + B. Anchor for diffing "what changed": `checkpoint/pre-hubv3-2026-06-20`.

---

## Post-rollback

1. Confirm `/VERSION` and the live tag prod runs match the intended rolled-back state.
2. Smoke green on both domains + Telegram.
3. File an incident note in `docs/known-issues.md` with the failure + which rollback was used.
4. Re-open `#2068` (or a fresh branch) with the fix before re-attempting the merge.

## What this runbook assumes was done (Phase 5 prerequisites)
- Prior hub tag + Neon snapshot id + merge SHA recorded in the **Anchors** table above.
- Prod deploy pinned to a **tag**, not `main` HEAD.
- `056` reversibility proven on staging (Phase 2) before prod apply.

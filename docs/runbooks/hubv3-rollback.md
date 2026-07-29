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
| **Deploy (prior app)** | monorepo tag **`checkpoint/pre-hubv3-2026-06-20`** (= `v3.28.3` = commit `529d62e2`) — what prod runs now | the running app before HubV3 |
| **DB** | Neon **prod snapshot** taken in Phase 5 + the `056` in-file rollback block | schema before `056` |

> ⚠️ **Component-tag drift (verified 2026-06-20):** the namespaced `mira-hub/v*` tags are stale — latest is `mira-hub/v2.3.1`, **149 commits behind prod**. Do NOT use `mira-hub/v2.x` as a deploy target; it doesn't match what's running. The reliable anchor is the **monorepo overall release tag** (`v3.28.3` now, `v3.29.0` after this release), which `version-tag.yml` lays automatically on every merge. Prod deploys from the `/opt/mira` monorepo checkout, so redeploy a **monorepo** tag, not a component tag.

Recorded (baseline confirmed 2026-06-20 via `ssh root@165.245.138.91 "cd /opt/mira && git describe --tags"` → `mira-web/v0.7.1-610-g529d62e2`):
- Prod-deployed commit BEFORE this release: **`529d62e2`** = `v3.28.3` = `checkpoint/pre-hubv3-2026-06-20` ✅
- Neon prod snapshot / branch id: **`br-square-cake-ah54ijqu`** (branch `pre-hubv3-2026-06-20`, parent `production`, forked 2026-06-20 15:55 -04:00, auto-delete never) ✅
- Merge commit SHA on main: `________` ← fill at Phase 4 merge

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

Redeploy the **monorepo baseline tag** (not a `mira-hub/v*` tag — those are stale, see drift note above):

```bash
# From an authorized shell (repo write + production environment):
gh workflow run deploy-vps.yml -f services="mira-hub" -f ref="checkpoint/pre-hubv3-2026-06-20"
# = v3.28.3 = commit 529d62e2, which is exactly what prod ran before this release.
# (contextualizer is a desktop app, not VPS-deployed — only re-pin if a bad build shipped)
```

Verify:
```bash
bash install/smoke_test.sh
# + browser-check factorylm.com + app.factorylm.com/hub, and @FactoryLM_Diagnose
ssh root@165.245.138.91 "cd /opt/mira && git rev-parse --short HEAD"   # must read 529d62e2 (the baseline)
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

**Option B2 — restore the Neon prod snapshot** `br-square-cake-ah54ijqu` (branch `pre-hubv3-2026-06-20`, cleanest if `056` left bad data). Neon console → **Backup & Restore** → **Restore from branch** → restore `production` from `br-square-cake-ah54ijqu`. This reverts **ALL** prod writes since 2026-06-20 15:55 (not just `056`), so prefer B1 unless data is corrupt. After restore, redeploy the matching app tag (ROLLBACK A).

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

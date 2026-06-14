# Diagnosis — "Insert failed" on the Train & approve onboarding step (2026-06-10)

**Reporter evidence:** two prod screenshots (app.factorylm.com `/hub`), demo tenant
(`enterprise.home_garage.conveyor_lab`, asset `Conv_Simple Bench Conveyor … (CV-101)`).

| # | Surface | Symptom |
|---|---------|---------|
| 1 | Onboarding wizard → **Train & approve before deploy** (`AssetValidateTab`) | Ask MIRA "is the photo eye blocked?" → red **"Insert failed"** |
| 2 | Namespace folder chat (Conveyor Lab, grounded) | "what is the photo eye status?" → "I don't have manual coverage for the photo eye status [1]." |

## Finding 1 (Image #3, folder chat) — NOT A BUG

The Conveyor Lab folder has **0 files** (status bar: "1 object (1 folder, 0 files)") and
the asset shows **0 docs · citation coverage 0**. The grounded folder chat correctly
refuses to answer from non-existent documents — this is the intended
groundedness behavior. **Fix = attach a manual to that asset/folder.** No code defect.

## Finding 2 (Image #2, "Insert failed") — REAL BUG, prod-specific

"Insert failed" is the literal 500 body from
`mira-hub/src/app/api/assets/[id]/validation-qa/route.ts` (POST `catch`). That route
does two writes inside `withTenantContext` (role `factorylm_app` + `app.tenant_id`/
`app.current_tenant_id` set to the session tenant):

1. `INSERT INTO asset_agent_status (tenant_id, equipment_id, uns_path, state) SELECT … ON CONFLICT DO NOTHING`
2. `INSERT INTO asset_validation_qa (…) VALUES (…) RETURNING …`

### ROOT CAUSE — `tenant_id` type mismatch (UUID column vs TEXT tenancy)

`cmms_equipment.tenant_id` is **`TEXT`** and MIRA runs a **dual tenancy-id space**:
- CMMS/equipment family (`tenants`, `tenant_cmms_config`, `cmms_equipment`, …) → **`tenant_id TEXT`**, with live **non-UUID slug tenants** (staging: `"mike"` = 74 assets, the demo
  tenant behind these screenshots; plus two UUID tenants).
- kg/Hub-proposal family (24 tables) → `tenant_id UUID`.

Migrations **046/047 keyed on `cmms_equipment.id` (the TEXT family) but declared
`tenant_id UUID`** (and RLS `current_setting('app.tenant_id', true)::UUID`), copying the
kg-family pattern. The POST route binds `ctx.tenantId` (the session's **text** tenant, e.g.
`"mike"`) into that `UUID` column →

```
ERROR: invalid input syntax for type uuid: "mike"
```

→ caught → **"Insert failed"**. (The RLS `::UUID` cast on `WITH CHECK` is a second
text-tenant failure point with the same cause.)

### Why GET works but POST fails (no prod drift involved)
- **GET** renders the badge → it returned 200. On a brand-new asset (0/0) the
  `asset_agent_status` / `asset_validation_qa` SELECTs match **zero** rows, so the RLS
  `::UUID` cast is never evaluated; the `cmms_equipment` read compares `tenant_id` as TEXT.
  No UUID cast is hit on the read path → GET succeeds even for the `"mike"` tenant.
- **POST** is the first write of the text tenant id into a `UUID` column → throws immediately.

### Proof (staging, real assets, real route SQL under `factorylm_app` + tenant context)
| Tenant | tenant_id | Route INSERTs |
|--------|-----------|---------------|
| demo | `"mike"` (TEXT) | **FAIL** — `invalid input syntax for type uuid: "mike"` |
| staging | `78917b56-…` (UUID-shaped TEXT) | **SUCCEED** (both inserts; probe row deleted) |

Clean-room (ephemeral pg16) passed only because it was seeded with a UUID tenant — that
masked the defect. Staging reproduced it on the first asset. (Earlier "prod drift"
hypothesis was wrong: the bug reproduces on staging and is a code/migration defect.)

## Fix
New migration **`048_asset_agent_tenant_text.sql`** (idempotent), modeled on
`008_tenant_cmms_config.sql` (the canonical TEXT-tenant pattern):
- `ALTER TABLE asset_agent_status  ALTER COLUMN tenant_id TYPE TEXT;`
- `ALTER TABLE asset_validation_qa ALTER COLUMN tenant_id TYPE TEXT;`
- Recreate both RLS policies **without** the `::UUID` cast:
  `USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = current_setting('app.current_tenant_id', true))`.

Works for **both** slug and UUID-string tenants (plain text compare). UNIQUE
`(tenant_id, equipment_id)` and the `(tenant_id, uns_path)` GiST index survive the type
change (btree_gist supports text). Promotion: `migration-verify.yml` auto-applies to
staging on the PR; prod via `apply-migrations.yml` (gated).

## Gap to close (process)
- `tools/verify_phase0_deploy.py` + the migration-verify integration tests cover migrations
  025–036 only. **046/047 had no schema/RLS test**, and there is **no test that exercises the
  validation write path under a non-UUID (slug) tenant** — which is why this shipped. Add a
  round-trip integration test that inserts a validation Q&A under the `"mike"`-style TEXT
  tenant.

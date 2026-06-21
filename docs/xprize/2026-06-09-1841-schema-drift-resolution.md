# #1841 (tenant-scope drift on /api/documents) — schema investigation & resolution

**Date:** 2026-06-09 · **Method:** read-only `db-inspect.yml` against **prod** (sanctioned path; no direct psql).

> **STATUS: RESOLVED & MERGED (Option A).** Mike chose Option A. #1841 was rebased onto current
> main (resolving the #1837 IDOR comment collision + the 045-number collision with main's
> `045_chunk_anchors.sql`), **migration 045 dropped**, rule doc corrected, and **merged** (squash
> on main, rollback tag `rollback/2026-06-09-12-after-1841`). The route-code fix (hybrid read
> filter + cmms IDOR scope + `is_private=true` on upload) is now live. Residual: the cosmetic
> `docs/migrations/001:13` `TEXT`→`uuid` doc-staleness (see USER ACTIONS #3) — low priority.

## The question
Migration `045_knowledge_entries_private_uploads.sql` failed `apply-and-verify` with
`operator does not exist: uuid ~ unknown`. The fix depended on the real prod type of
`knowledge_entries.tenant_id` (canonical `docs/migrations/001` says `TEXT`; staging said `uuid`).

## Definitive prod findings
Ran an added read-only probe (`SELECT data_type …`, tenant breakdown) against **prod NeonDB**:

| Fact | Value |
|---|---|
| `knowledge_entries.tenant_id` data_type | **`uuid`** (canonical `001` = `TEXT` is a **stale doc**; staging was NOT drifted — it matches prod) |
| `is_private` data_type | `boolean` |
| Total rows | **83,553** |
| Rows with uuid-format tenant_id | **83,553 (100%)** — **zero** non-UUID `'mike'`-style slugs |
| Distinct tenants | **1** — `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` owns **all** rows |
| of which public (`is_private=false`) | 83,543 (the OEM corpus) |
| of which private | 10 |

## What this means for migration 045
Migration 045's premise — "the shared OEM corpus is tagged with a non-UUID slug (`'mike'`),
so `tenant_id ~ uuid-regex` selects only per-tenant uploads" — is **false in prod**. Every row
is uuid-format, and the OEM corpus is **one system tenant's rows kept public via `is_private=false`**,
not a slug.

Therefore 045, even with the obvious `::text` cast, would match **all 83,553 rows** and flip the
**entire shared OEM corpus to `is_private=true`** → every tenant loses access to OEM manuals.
**This migration must NOT be applied as written.** It is not a one-line cast fix; the logic is wrong
for the real schema.

There is also **no existing leak to backfill**: only the OEM/system tenant has rows. The #1833
cross-tenant leak is a *future* risk (the moment a second tenant uploads with `is_private=false`),
which the **route-code change** in #1841 already prevents.

## Recommended resolution (needs Mike's confirmation — see USER ACTIONS)

**Split #1841:**
1. **Keep the route-code fix** (`mira-hub/src/app/api/documents/route.ts` + `upload/route.ts`):
   it adds the `(is_private = false OR tenant_id = $caller)` read filter and marks new uploads
   `is_private = true`. This is correct against the real schema (verified: works for a uuid
   `tenant_id`) and is the actual #1833 fix. Safe to ship.
2. **Migration 045 — choose one:**
   - **Option A (recommended): DROP migration 045.** No existing rows need backfilling (only the
     OEM tenant exists); the route code prevents future leaks. Simplest and safest.
   - **Option B: rewrite 045 to EXCLUDE the OEM/system tenant**, as a forward-guard (affects 0 rows today):
     ```sql
     UPDATE knowledge_entries
        SET is_private = true
      WHERE is_private = false
        AND tenant_id <> '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid;  -- keep shared OEM corpus public
     ```
     Only valid if `78917b56-…` is confirmed to be the shared/OEM/system tenant.

## USER ACTIONS for Mike
1. **Confirm** `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` is the shared **OEM/system tenant** whose corpus
   must stay universally visible (not a customer tenant).
2. **Decide** Option A (drop 045) vs Option B (rewrite to exclude that tenant). Recommend **A**.
3. **Fix the stale canonical doc:** `docs/migrations/001_knowledge_entries.sql:13` declares
   `tenant_id TEXT` but prod/staging are `uuid`. Update the doc (or add a corrective migration note)
   so the next person doesn't repeat this. Also correct the memory/law note
   (`.claude/rules/knowledge-entries-tenant-scoping.md` + `project_knowledge_entries_hybrid_corpus_law`)
   that asserts a non-UUID `'mike'` slug corpus — that's not the prod reality.

Once #1 and #2 are confirmed, the corrected #1841 (route code + Option A/B) merges cleanly through
the normal staging-gate. **Diagnostic queries** were added on branch
`chore/db-inspect-ke-tenant-type` (read-only `db-inspect` additions) — merge or delete as desired.
